"""
Web3Auth MPC wallet endpoints — frontend-facing.

These endpoints connect the user's Web3Auth login to their invisible Solana wallet,
show balances, and allow test funding on devnet.

Routes:
  POST /jaire/wallet/connect   — verify JWT, link wallet, return address + balance
  POST /jaire/wallet/balance   — get USDC balance for a JWT user
  POST /jaire/wallet/fund      — fund wallet with USDC (devnet/test only)
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.database import get_db
from app.models import JaireUser, JaireWallet
from app.services import wallet_service
from app.config import settings

router = APIRouter(prefix="/jaire/wallet", tags=["wallet-mpc"])
logger = logging.getLogger(__name__)


# ── Schemas ───────────────────────────────────────────────────────────────────

class ConnectRequest(BaseModel):
    id_token: str
    user_identifier: Optional[str] = None  # email/phone if known (for linking)


class BalanceRequest(BaseModel):
    id_token: str
    mint: Optional[str] = None


class FundRequest(BaseModel):
    id_token: str
    amount_usdc: float
    is_simulated: bool = True
    mint: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_or_create_user(
    db: AsyncSession,
    identifier: Optional[str],
    name: Optional[str] = None,
) -> Optional[JaireUser]:
    if not identifier:
        return None
    stmt = select(JaireUser).where(
        (JaireUser.email == identifier) | (JaireUser.phone == identifier)
    )
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        is_email = "@" in identifier
        user = JaireUser(
            email=identifier if is_email else None,
            phone=None if is_email else identifier,
            name=name,
        )
        db.add(user)
        await db.flush()
    return user


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/connect")
async def connect_wallet(
    body: ConnectRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Verify a Web3Auth JWT and link the user's invisible Solana wallet
    to their JaIre account. Creates the account if it doesn't exist.

    Returns the wallet address, identity info, and current USDC balance.
    """
    try:
        info = await wallet_service.verify_web3auth_token(body.id_token)
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Web3Auth verification failed: {e}")

    identifier = body.user_identifier or info.email or info.verifier_id
    async with db.begin_nested():
        user = await _get_or_create_user(db, identifier, name=info.name)

    if user:
        try:
            await wallet_service.get_or_link_mpc_wallet(
                db, user, info.wallet_address, info.verifier_id
            )
            await db.commit()
        except Exception as e:
            logger.warning(f"[wallet/connect] Could not link wallet to DB user: {e}")

    # Fetch balance (non-blocking — fail gracefully)
    balance = {}
    try:
        balance = await wallet_service.get_wallet_balance(body.id_token)
    except Exception as e:
        logger.warning(f"[wallet/connect] Balance fetch failed: {e}")

    return {
        "connected": True,
        "wallet_address": info.wallet_address,
        "verifier_id": info.verifier_id,
        "email": info.email,
        "name": info.name,
        "sol_balance": balance.get("sol_balance", 0),
        "usdc_balance": balance.get("usdc_balance", 0),
        "usdc_mint": balance.get("usdc_mint", ""),
        "network": settings.solana_network,
        "wallet_type": "mpc_invisible",
        "message": (
            f"Invisible wallet ready on {settings.solana_network}. "
            f"USDC balance: {balance.get('usdc_balance', 0):.4f} USDC."
        ),
    }


@router.post("/balance")
async def wallet_balance(body: BalanceRequest):
    """
    Return SOL and USDC balance for a Web3Auth user's invisible wallet.
    Call this to show the user how much USDC they have before booking.
    """
    try:
        result = await wallet_service.get_wallet_balance(body.id_token, body.mint)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/fund")
async def fund_wallet(body: FundRequest):
    """
    Fund a user's invisible wallet with USDC from the JaIre treasury.

    On devnet: real on-chain transfer from treasury → user wallet.
    Test mode (is_simulated=True): returns a simulated TX signature.

    This is called automatically after a successful Paystack payment.
    The frontend can also call it directly for devnet testing.
    """
    if body.amount_usdc <= 0 or body.amount_usdc > 10_000:
        raise HTTPException(status_code=400, detail="amount_usdc must be between 0 and 10,000")

    try:
        result = await wallet_service.fund_mpc_wallet(
            id_token=body.id_token,
            amount_usdc=body.amount_usdc,
            is_simulated=body.is_simulated,
            mint_override=body.mint,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
