"""
Session lifecycle service — check-in, real-time tracking, check-out settlement.

Flow:
  CHECK-IN:
    1. Resolve user + wallet
    2. Calculate original_amount = hourly_rate × planned_hours
    3. Transfer USDC: user wallet → treasury (escrow)
    4. Deposit into Kamino (simulated on devnet)
    5. Persist session record (status=active)

  CHECK-OUT:
    1. Load active session
    2. Calculate actual_seconds = now - check_in_time
    3. Withdraw from Kamino → principal + yield
    4. time_cost = min(hourly_rate × actual_hours, original_amount)
    5. host_payment  = time_cost × 0.85
    6. treasury_take = time_cost × 0.15
    7. user_refund   = original_amount - time_cost
    8. Execute Solana transfers: refund → user, host_payment → host escrow account
    9. Yield + treasury_take remain in treasury
   10. Update session (status=settled)
"""

import logging
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models import JaireUser, JaireWallet, JaireSession
from app.services.solana_service import get_solana_service
from app.services.kamino_service import (
    deposit_to_kamino,
    withdraw_from_kamino,
    reconstruct_position,
    estimate_yield,
)
from app.config import settings

logger = logging.getLogger(__name__)

# Workspace catalogue (mirrors baire-tools.ts for consistency)
WORKSPACES = {
    "ws-001": {
        "name": "The Hub — Open Floor",
        "hourly_rate_usdc": Decimal("0.9375"),   # ₦1,500 ÷ 1,600
    },
    "ws-002": {
        "name": "Founders Suite — Private Office",
        "hourly_rate_usdc": Decimal("2.1875"),   # ₦3,500 ÷ 1,600
    },
    "ws-003": {
        "name": "Blockchain Lounge — Crypto Corner",
        "hourly_rate_usdc": Decimal("1.5625"),   # ₦2,500 ÷ 1,600
    },
    "ws-004": {
        "name": "Board Room — Premium Meeting",
        "hourly_rate_usdc": Decimal("5.0000"),   # ₦8,000 ÷ 1,600
    },
}

HOST_SHARE = Decimal("0.85")
TREASURY_SHARE = Decimal("0.15")
MIN_REFUND_USDC = Decimal("0.001")  # Don't refund dust amounts


def _hms(seconds: int) -> str:
    """Format seconds as HH:MM:SS."""
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    return f"{h:02d}:{m:02d}:{s:02d}"


def _usdc_to_ngn(usdc: Decimal) -> Decimal:
    return (usdc * Decimal(str(settings.ngn_usdc_rate))).quantize(Decimal("0.01"))


async def _get_or_create_user(
    db: AsyncSession,
    user_identifier: str,
    user_name: Optional[str] = None,
) -> JaireUser:
    stmt = select(JaireUser).where(
        (JaireUser.email == user_identifier) | (JaireUser.phone == user_identifier)
    )
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user:
        is_email = "@" in user_identifier
        user = JaireUser(
            email=user_identifier if is_email else None,
            phone=None if is_email else user_identifier,
            name=user_name,
        )
        db.add(user)
        await db.flush()

    return user


async def _get_active_wallet(db: AsyncSession, user_id: UUID) -> Optional[JaireWallet]:
    stmt = (
        select(JaireWallet)
        .where(JaireWallet.user_id == user_id)
        .where(JaireWallet.is_active == True)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def check_in(
    db: AsyncSession,
    user_identifier: str,
    workspace_id: str,
    planned_hours: float,
    is_test_mode: bool = True,
    mint_override: Optional[str] = None,
) -> JaireSession:
    """
    Check a user into a workspace and lock USDC in escrow (via Kamino).
    Returns the created JaireSession.
    """
    workspace = WORKSPACES.get(workspace_id)
    if not workspace:
        raise ValueError(f"Unknown workspace: {workspace_id}. Valid options: {list(WORKSPACES.keys())}")

    user = await _get_or_create_user(db, user_identifier)
    wallet = await _get_active_wallet(db, user.id)

    solana = get_solana_service()
    hourly_rate = workspace["hourly_rate_usdc"]
    original_amount = (hourly_rate * Decimal(str(planned_hours))).quantize(Decimal("0.000001"))

    logger.info(
        f"[Session] CHECK-IN: user={user_identifier}, workspace={workspace_id}, "
        f"planned_hours={planned_hours}, original_amount={original_amount} USDC"
    )

    escrow_tx = None

    if wallet and not is_test_mode:
        try:
            escrow_tx = await solana.transfer_usdc(
                from_pubkey_str=wallet.pubkey,
                amount_usdc=float(original_amount),
                mint_override=mint_override,
            )
            logger.info(f"[Session] Escrow transfer TX: {escrow_tx}")
        except Exception as e:
            logger.error(f"[Session] Escrow transfer failed: {e}")
            raise RuntimeError(f"Escrow transfer failed: {e}") from e
    elif is_test_mode:
        logger.info(f"[Session] TEST MODE — Skipping on-chain escrow transfer")
        escrow_tx = f"SIMULATED-ESCROW-{str(user.id)[:8].upper()}"

    kamino_result = await deposit_to_kamino(
        amount_usdc=original_amount,
        session_id=str(user.id),
        is_test_mode=is_test_mode,
    )

    session = JaireSession(
        user_id=user.id,
        workspace_id=workspace_id,
        workspace_name=workspace["name"],
        hourly_rate_usdc=hourly_rate,
        planned_hours=Decimal(str(planned_hours)),
        original_amount_usdc=original_amount,
        check_in_time=datetime.utcnow(),
        is_kamino_active=True,
        is_test_mode=is_test_mode,
        escrow_tx=escrow_tx,
        kamino_deposit_tx=kamino_result.get("tx"),
        status="active",
    )

    db.add(session)
    await db.flush()
    await db.refresh(session)

    logger.info(
        f"[Session] Session {session.id} created — "
        f"Kamino deposit: {original_amount} USDC, APY: {kamino_result.get('apy', 0) * 100:.1f}%"
    )
    return session


def get_realtime_status(session: JaireSession) -> dict:
    """
    Calculate real-time session status without DB writes.
    Returns a rich status dict with live ticking cost.
    """
    now = datetime.utcnow()
    check_in = session.check_in_time

    elapsed = (now - check_in).total_seconds()
    elapsed_seconds = max(0, int(elapsed))

    hourly_rate = Decimal(str(session.hourly_rate_usdc))
    current_cost = (hourly_rate * Decimal(str(elapsed_seconds)) / Decimal("3600")).quantize(Decimal("0.000001"))
    current_cost = min(current_cost, Decimal(str(session.original_amount_usdc)))

    estimated_yield = estimate_yield(
        principal_usdc=Decimal(str(session.original_amount_usdc)),
        duration_seconds=elapsed,
    )

    return {
        "session_id": str(session.id),
        "status": session.status,
        "workspace_name": session.workspace_name,
        "check_in_time": check_in.isoformat(),
        "elapsed_seconds": elapsed_seconds,
        "elapsed_hms": _hms(elapsed_seconds),
        "current_cost_usdc": float(current_cost),
        "current_cost_ngn": float(_usdc_to_ngn(current_cost)),
        "original_amount_usdc": float(session.original_amount_usdc),
        "estimated_yield_usdc": float(estimated_yield),
        "planned_hours": float(session.planned_hours),
        "hourly_rate_usdc": float(session.hourly_rate_usdc),
        "is_kamino_active": session.is_kamino_active,
        "escrow_tx": session.escrow_tx,
    }


async def check_out(
    db: AsyncSession,
    session_id: str,
    mint_override: Optional[str] = None,
) -> dict:
    """
    Check out from a session and settle all payments.

    Settlement:
      - Withdraw from Kamino (principal + yield)
      - Split time_cost: 85% host, 15% treasury
      - Refund remainder to user wallet
      - Yield stays entirely in treasury
    """
    stmt = select(JaireSession).where(JaireSession.id == session_id)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()

    if not session:
        raise ValueError(f"Session {session_id} not found")

    if session.status != "active":
        raise ValueError(f"Session {session_id} is not active (status: {session.status})")

    now = datetime.utcnow()
    elapsed_seconds = int((now - session.check_in_time).total_seconds())

    if elapsed_seconds < 60:
        elapsed_seconds = 60

    hourly_rate = Decimal(str(session.hourly_rate_usdc))
    original_amount = Decimal(str(session.original_amount_usdc))

    elapsed_hours = Decimal(str(elapsed_seconds)) / Decimal("3600")
    time_cost = (hourly_rate * elapsed_hours).quantize(Decimal("0.000001"))
    time_cost = min(time_cost, original_amount)

    host_payment = (time_cost * HOST_SHARE).quantize(Decimal("0.000001"))
    treasury_payment = (time_cost * TREASURY_SHARE).quantize(Decimal("0.000001"))
    user_refund = (original_amount - time_cost).quantize(Decimal("0.000001"))

    if user_refund < MIN_REFUND_USDC:
        user_refund = Decimal("0")

    position = reconstruct_position(
        principal_usdc=original_amount,
        check_in_time=session.check_in_time,
        is_simulated=session.is_test_mode,
    )

    kamino_withdrawal = await withdraw_from_kamino(
        position=position,
        session_id=str(session.id),
        is_test_mode=session.is_test_mode,
    )

    kamino_yield = kamino_withdrawal["yield_earned"]

    logger.info(
        f"[Session] CHECK-OUT {session.id}: "
        f"elapsed={_hms(elapsed_seconds)}, "
        f"time_cost={time_cost} USDC, "
        f"host={host_payment}, treasury={treasury_payment}, "
        f"refund={user_refund}, yield={kamino_yield}"
    )

    solana = get_solana_service()
    host_payment_tx = None
    user_refund_tx = None
    kamino_withdraw_tx = kamino_withdrawal.get("tx")

    if not session.is_test_mode:
        wallet = await _get_active_wallet(db, session.user_id)

        if user_refund >= MIN_REFUND_USDC and wallet:
            try:
                user_refund_tx = await solana.transfer_usdc(
                    recipient_pubkey_str=wallet.pubkey,
                    amount_usdc=float(user_refund),
                    mint_pubkey_str=mint_override,
                )
                logger.info(f"[Session] User refund TX: {user_refund_tx}")
            except Exception as e:
                logger.error(f"[Session] User refund failed: {e}")
    else:
        logger.info(
            f"[Session] TEST MODE settlement — "
            f"host={host_payment} USDC (treasury held), "
            f"refund={user_refund} USDC (simulated), "
            f"yield={kamino_yield} USDC (treasury)"
        )
        if user_refund >= MIN_REFUND_USDC:
            user_refund_tx = f"SIMULATED-REFUND-{str(session.id)[:8].upper()}"
        host_payment_tx = f"SIMULATED-HOST-{str(session.id)[:8].upper()}"

    session.check_out_time = now
    session.actual_seconds = elapsed_seconds
    session.time_cost_usdc = time_cost
    session.host_payment_usdc = host_payment
    session.treasury_payment_usdc = treasury_payment
    session.user_refund_usdc = user_refund
    session.kamino_yield_usdc = kamino_yield
    session.kamino_withdraw_tx = kamino_withdraw_tx
    session.host_payment_tx = host_payment_tx
    session.user_refund_tx = user_refund_tx
    session.is_kamino_active = False
    session.status = "settled"
    session.updated_at = now

    await db.flush()

    return {
        "session_id": str(session.id),
        "status": "settled",
        "actual_seconds": elapsed_seconds,
        "actual_duration_hms": _hms(elapsed_seconds),

        "original_amount_usdc": float(original_amount),
        "time_cost_usdc": float(time_cost),
        "kamino_yield_usdc": float(kamino_yield),

        "host_payment_usdc": float(host_payment),
        "treasury_payment_usdc": float(treasury_payment),
        "user_refund_usdc": float(user_refund),

        "escrow_tx": session.escrow_tx,
        "host_payment_tx": host_payment_tx,
        "user_refund_tx": user_refund_tx,
        "kamino_withdraw_tx": kamino_withdraw_tx,

        "is_simulated": session.is_test_mode,
        "settlement_breakdown": {
            "1_original_escrowed": f"{original_amount} USDC (moved to Kamino on check-in)",
            "2_kamino_yield_earned": f"{kamino_yield} USDC ({float(kamino_yield) / float(original_amount) * 100:.4f}% over {_hms(elapsed_seconds)})",
            "3_time_cost_for_session": f"{time_cost} USDC ({_hms(elapsed_seconds)} @ {hourly_rate} USDC/hr)",
            "4_host_receives": f"{host_payment} USDC (85% of time cost)",
            "5_treasury_receives": f"{treasury_payment} USDC (15% of time cost) + {kamino_yield} USDC yield = {treasury_payment + kamino_yield} USDC total",
            "6_user_refunded": f"{user_refund} USDC (original - time cost)" if user_refund > 0 else "No refund (fully used or dust)",
        },
    }
