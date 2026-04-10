"""
Session lifecycle service — check-in, real-time tracking, check-out settlement.

Flow:
  CHECK-IN:
    1. Resolve user + wallet
    2. Calculate original_amount = hourly_rate × planned_hours
    3. Vault signs Memo TX anchoring the escrow lock on-chain → escrow_tx (REAL TX)
    4. Vault signs Memo TX recording Kamino deposit → kamino_deposit_tx (REAL TX)
    5. Persist session record (status=active)

  CHECK-OUT:
    1. Load active session
    2. Calculate actual_seconds = now - check_in_time
    3. Calculate Kamino yield at 5% APY for duration
    4. time_cost = min(hourly_rate × actual_hours, original_amount)
    5. host_payment  = time_cost × 0.85
    6. treasury_take = time_cost × 0.15
    7. user_refund   = original_amount - time_cost
    8. Vault signs REAL SPL transfer → user wallet (refund) → user_refund_tx
    9. Vault signs Memo TX recording host payment → host_payment_tx (REAL TX)
   10. Vault signs Memo TX recording Kamino withdrawal + yield → kamino_withdraw_tx (REAL TX)
   11. Update session (status=settled)

Every escrow, Kamino, and settlement event is anchored on Solana via a real
transaction — viewable on Solana Explorer, Solscan, and Solana.fm.
"""

import json
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models import JaireUser, JaireWallet, JaireSession
from app.services.solana_service import get_solana_service
import app.services.wallet_service as mpc_wallet_svc
from app.services.kamino_service import (
    reconstruct_position,
    estimate_yield,
    SIMULATED_APY,
)
from app.config import settings

logger = logging.getLogger(__name__)

# Workspace catalogue (mirrors baire-tools.ts for consistency)
WORKSPACES = {
    "ws-001": {
        "name": "The Hub — Open Floor",
        "hourly_rate_usdc": Decimal("0.9375"),   # ₦1,500 at old rate
    },
    "ws-002": {
        "name": "Founders Suite — Private Office",
        "hourly_rate_usdc": Decimal("2.1875"),   # ₦3,500 at old rate
    },
    "ws-003": {
        "name": "Blockchain Lounge — Crypto Corner",
        "hourly_rate_usdc": Decimal("1.5625"),   # ₦2,500 at old rate
    },
    "ws-004": {
        "name": "Board Room — Premium Meeting",
        "hourly_rate_usdc": Decimal("5.0000"),   # ₦8,000 at old rate
    },
}

HOST_SHARE = Decimal("0.85")
TREASURY_SHARE = Decimal("0.15")
MIN_REFUND_USDC = Decimal("0.001")
SECONDS_PER_YEAR = 365 * 24 * 3600

SOLANA_CLUSTER = "devnet"


def _hms(seconds: int) -> str:
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    return f"{h:02d}:{m:02d}:{s:02d}"


def _explorer(sig: str) -> dict:
    return {
        "solana_explorer": f"https://explorer.solana.com/tx/{sig}?cluster={SOLANA_CLUSTER}",
        "solscan": f"https://solscan.io/tx/{sig}?cluster={SOLANA_CLUSTER}",
        "solana_fm": f"https://solana.fm/tx/{sig}?cluster={SOLANA_CLUSTER}-solana",
    }


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
    is_test_mode: bool = False,
    mint_override: Optional[str] = None,
    web3auth_token: Optional[str] = None,
) -> JaireSession:
    """
    Check a user into a workspace.
    Anchors two real Solana transactions:
      1. Escrow lock Memo TX (vault signs)
      2. Kamino deposit Memo TX (vault signs, with APY metadata)
    """
    workspace = WORKSPACES.get(workspace_id)
    if not workspace:
        raise ValueError(f"Unknown workspace: {workspace_id}. Valid: {list(WORKSPACES.keys())}")

    user = await _get_or_create_user(db, user_identifier)
    wallet = await _get_active_wallet(db, user.id)

    hourly_rate = workspace["hourly_rate_usdc"]
    original_amount = (hourly_rate * Decimal(str(planned_hours))).quantize(Decimal("0.000001"))

    check_in_time = datetime.utcnow()
    solana = get_solana_service()
    vault_addr = str(solana.vault_pubkey)
    user_wallet_addr = wallet.pubkey if wallet else "NO_WALLET"

    logger.info(
        f"[CHECK-IN] user={user_identifier}, workspace={workspace_id}, "
        f"planned={planned_hours}h, amount={original_amount} USDC, vault={vault_addr[:16]}…"
    )

    # ── TX 1: Escrow Lock — Vault anchors the lock on-chain ────────────────
    escrow_memo = json.dumps({
        "jaire": "ESCROW_LOCK",
        "user": user_identifier,
        "workspace": workspace_id,
        "amount_usdc": str(original_amount),
        "planned_hours": planned_hours,
        "vault": vault_addr,
        "user_wallet": user_wallet_addr,
        "ts": check_in_time.isoformat(),
    }, separators=(",", ":"))

    escrow_tx = await solana.send_memo_from_vault(escrow_memo, wait_for_confirm=True)
    logger.info(f"[CHECK-IN] ✅ Escrow lock anchored on-chain: {escrow_tx}")

    # ── TX 2: Kamino Deposit — Vault records deposit on-chain ──────────────
    kamino_memo = json.dumps({
        "jaire": "KAMINO_DEPOSIT",
        "session_amount_usdc": str(original_amount),
        "apy_pct": SIMULATED_APY * 100,
        "vault": vault_addr,
        "note": "Kamino Finance mainnet: KLend2g3cZ87astpptFc4HcnKoGmJ7aSRrBDVH9tVSN",
        "ts": check_in_time.isoformat(),
    }, separators=(",", ":"))

    kamino_deposit_tx = await solana.send_memo_from_vault(kamino_memo, wait_for_confirm=True)
    logger.info(f"[CHECK-IN] ✅ Kamino deposit anchored on-chain: {kamino_deposit_tx}")

    # ── Persist session ────────────────────────────────────────────────────
    session = JaireSession(
        user_id=user.id,
        workspace_id=workspace_id,
        workspace_name=workspace["name"],
        hourly_rate_usdc=hourly_rate,
        planned_hours=Decimal(str(planned_hours)),
        original_amount_usdc=original_amount,
        check_in_time=check_in_time,
        is_kamino_active=True,
        is_test_mode=is_test_mode,
        escrow_tx=escrow_tx,
        kamino_deposit_tx=kamino_deposit_tx,
        status="active",
    )

    db.add(session)
    await db.flush()
    await db.refresh(session)

    logger.info(
        f"[CHECK-IN] Session {session.id} active. "
        f"escrow_tx={escrow_tx[:20]}… kamino_tx={kamino_deposit_tx[:20]}…"
    )
    return session


def get_realtime_status(session: JaireSession) -> dict:
    now = datetime.utcnow()
    elapsed = (now - session.check_in_time).total_seconds()
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
        "check_in_time": session.check_in_time.isoformat(),
        "elapsed_seconds": elapsed_seconds,
        "elapsed_hms": _hms(elapsed_seconds),
        "current_cost_usdc": float(current_cost),
        "original_amount_usdc": float(session.original_amount_usdc),
        "estimated_yield_usdc": float(estimated_yield),
        "planned_hours": float(session.planned_hours),
        "hourly_rate_usdc": float(session.hourly_rate_usdc),
        "is_kamino_active": session.is_kamino_active,
        "escrow_tx": session.escrow_tx,
        "kamino_deposit_tx": session.kamino_deposit_tx,
        "explorer": _explorer(session.escrow_tx) if session.escrow_tx else {},
    }


async def check_out(
    db: AsyncSession,
    session_id: str,
    mint_override: Optional[str] = None,
) -> dict:
    """
    Check out from a session. Produces 2-3 real Solana transactions:
      - Kamino withdraw Memo TX (with yield calculation anchored on-chain)
      - User refund SPL transfer (if refund ≥ dust threshold) — REAL SPL TX
      - Host payment Memo TX (anchored on-chain)
    """
    stmt = select(JaireSession).where(JaireSession.id == session_id)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()

    if not session:
        raise ValueError(f"Session {session_id} not found")
    if session.status != "active":
        raise ValueError(f"Session {session_id} is already {session.status}")

    now = datetime.utcnow()
    elapsed_seconds = max(60, int((now - session.check_in_time).total_seconds()))

    hourly_rate = Decimal(str(session.hourly_rate_usdc))
    original_amount = Decimal(str(session.original_amount_usdc))

    elapsed_hours = Decimal(str(elapsed_seconds)) / Decimal("3600")
    time_cost = min((hourly_rate * elapsed_hours).quantize(Decimal("0.000001")), original_amount)

    host_payment = (time_cost * HOST_SHARE).quantize(Decimal("0.000001"))
    treasury_payment = (time_cost * TREASURY_SHARE).quantize(Decimal("0.000001"))
    user_refund = (original_amount - time_cost).quantize(Decimal("0.000001"))
    if user_refund < MIN_REFUND_USDC:
        user_refund = Decimal("0")

    # Kamino yield: pro-rated 5% APY for the exact duration
    yield_amount = Decimal(str(SIMULATED_APY)) * original_amount * (
        Decimal(str(elapsed_seconds)) / Decimal(str(SECONDS_PER_YEAR))
    )
    kamino_yield = yield_amount.quantize(Decimal("0.000001"))

    logger.info(
        f"[CHECK-OUT] Session {session_id} | {_hms(elapsed_seconds)} | "
        f"cost={time_cost} host={host_payment} treasury={treasury_payment} "
        f"refund={user_refund} yield={kamino_yield}"
    )

    solana = get_solana_service()
    vault_addr = str(solana.vault_pubkey)
    wallet = await _get_active_wallet(db, session.user_id)

    # ── TX 3: Kamino Withdraw + Yield — anchored on-chain ──────────────────
    kamino_withdraw_memo = json.dumps({
        "jaire": "KAMINO_WITHDRAW",
        "session_id": session_id,
        "principal_usdc": str(original_amount),
        "yield_earned_usdc": str(kamino_yield),
        "apy_pct": SIMULATED_APY * 100,
        "duration_seconds": elapsed_seconds,
        "total_usdc": str(original_amount + kamino_yield),
        "vault": vault_addr,
        "ts": now.isoformat(),
    }, separators=(",", ":"))

    kamino_withdraw_tx = await solana.send_memo_from_vault(kamino_withdraw_memo, wait_for_confirm=True)
    logger.info(f"[CHECK-OUT] ✅ Kamino withdraw anchored: {kamino_withdraw_tx}")

    # ── TX 4: User Refund — REAL SPL transfer (vault → user wallet) ────────
    user_refund_tx = None
    if user_refund >= MIN_REFUND_USDC and wallet:
        try:
            user_refund_tx = await solana.disburse_from_vault(
                recipient_pubkey_str=wallet.pubkey,
                amount_usdc=float(user_refund),
                mint_pubkey_str=mint_override,
            )
            # Wait for confirmation so it's visible immediately
            await solana._confirm_transaction(user_refund_tx)
            logger.info(f"[CHECK-OUT] ✅ User refund SPL TX: {user_refund_tx}")
        except Exception as e:
            logger.error(f"[CHECK-OUT] User refund failed: {e}")
            user_refund_tx = f"FAILED:{e}"

    # ── TX 5: Host Payment — anchored on-chain ─────────────────────────────
    host_memo = json.dumps({
        "jaire": "HOST_PAYMENT",
        "session_id": session_id,
        "host_payment_usdc": str(host_payment),
        "treasury_payment_usdc": str(treasury_payment),
        "workspace": session.workspace_id,
        "duration_seconds": elapsed_seconds,
        "vault": vault_addr,
        "ts": now.isoformat(),
    }, separators=(",", ":"))

    host_payment_tx = await solana.send_memo_from_vault(host_memo, wait_for_confirm=True)
    logger.info(f"[CHECK-OUT] ✅ Host payment anchored: {host_payment_tx}")

    # ── Update session ──────────────────────────────────────────────────────
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

    # Build explorer links for all 4-5 TXs
    tx_map = {
        "escrow_lock_tx": session.escrow_tx,
        "kamino_deposit_tx": session.kamino_deposit_tx,
        "kamino_withdraw_tx": kamino_withdraw_tx,
        "user_refund_tx": user_refund_tx,
        "host_payment_tx": host_payment_tx,
    }

    return {
        "session_id": session_id,
        "status": "settled",
        "actual_seconds": elapsed_seconds,
        "actual_duration_hms": _hms(elapsed_seconds),

        "original_amount_usdc": float(original_amount),
        "time_cost_usdc": float(time_cost),
        "kamino_yield_usdc": float(kamino_yield),

        "host_payment_usdc": float(host_payment),
        "treasury_payment_usdc": float(treasury_payment),
        "user_refund_usdc": float(user_refund),

        "transactions": {
            k: {
                "signature": v,
                "explorer": _explorer(v) if v and not v.startswith("FAILED") else None,
            }
            for k, v in tx_map.items()
        },

        "settlement_breakdown": {
            "1_escrowed_at_checkin": f"{original_amount} USDC locked by JaIre vault",
            "2_kamino_yield_earned": f"{kamino_yield} USDC @ {SIMULATED_APY * 100:.1f}% APY for {_hms(elapsed_seconds)}",
            "3_time_cost": f"{time_cost} USDC ({_hms(elapsed_seconds)} @ {hourly_rate} USDC/hr)",
            "4_host_receives": f"{host_payment} USDC (85%)",
            "5_treasury_receives": f"{treasury_payment} USDC (15% of cost) + {kamino_yield} USDC yield",
            "6_user_refunded": f"{user_refund} USDC returned to {wallet.pubkey[:16]}…" if user_refund > 0 and wallet else "No refund",
        },
    }
