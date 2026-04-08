"""
Web3Auth MPC wallet service.

Bridges the Python API to the MPC sidecar:
  - Verify Web3Auth JWTs and resolve user wallet addresses
  - Link wallet addresses to JaIre user records in the DB
  - Fund user wallets with USDC after successful fiat payment
  - Co-sign escrow transfers during check-in (devnet simulation)

MPC Sidecar endpoints used:
  POST /mpc/verify-token    → verify JWT, get wallet address
  POST /mpc/fund-wallet     → transfer USDC from treasury to user wallet
  POST /mpc/sign-usdc-transfer → sign escrow deposit from user wallet
  POST /mpc/wallet-balance  → get SOL + USDC balance
"""

import logging
from typing import Optional
from uuid import UUID

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.models import JaireUser, JaireWallet
from app.config import settings

logger = logging.getLogger(__name__)

MPC_TIMEOUT = 10.0


def _sidecar_url() -> str:
    return settings.mpc_sidecar_url.rstrip("/")


# ── Internal sidecar caller ───────────────────────────────────────────────────

async def _call_sidecar(endpoint: str, body: dict) -> dict:
    """Call the MPC sidecar and raise on HTTP/network errors."""
    url = f"{_sidecar_url()}{endpoint}"
    async with httpx.AsyncClient(timeout=MPC_TIMEOUT) as client:
        resp = await client.post(url, json=body)
        data = resp.json()
        if resp.status_code != 200:
            raise ValueError(data.get("error", f"Sidecar {endpoint} failed: HTTP {resp.status_code}"))
        return data


# ── JWT verification + wallet resolution ─────────────────────────────────────

class MpcWalletInfo:
    def __init__(self, data: dict):
        self.sub: str = data["sub"]
        self.email: Optional[str] = data.get("email")
        self.name: Optional[str] = data.get("name")
        self.verifier_id: str = data["verifier_id"]
        self.wallet_address: str = data["wallet_address"]
        self.verified: bool = data.get("verified", True)


async def verify_web3auth_token(id_token: str) -> MpcWalletInfo:
    """
    Verify a Web3Auth JWT via the MPC sidecar and return the user's
    invisible Solana wallet address.
    """
    data = await _call_sidecar("/mpc/verify-token", {"id_token": id_token})
    return MpcWalletInfo(data)


# ── DB wallet linkage ─────────────────────────────────────────────────────────

async def get_or_link_mpc_wallet(
    db: AsyncSession,
    user: JaireUser,
    wallet_address: str,
    verifier_id: str,
) -> JaireWallet:
    """
    Ensure the JaireWallet record exists for this user's MPC wallet.
    Creates one if absent, updates verifier_id if it changed.
    Returns the active JaireWallet row.
    """
    stmt = (
        select(JaireWallet)
        .where(JaireWallet.user_id == user.id)
        .where(JaireWallet.pubkey == wallet_address)
    )
    result = await db.execute(stmt)
    wallet = result.scalar_one_or_none()

    if wallet:
        if wallet.verifier_id != verifier_id:
            wallet.verifier_id = verifier_id
            await db.flush()
        return wallet

    # Deactivate any existing wallets for this user
    await db.execute(
        update(JaireWallet)
        .where(JaireWallet.user_id == user.id)
        .values(is_active=False)
    )

    wallet = JaireWallet(
        user_id=user.id,
        pubkey=wallet_address,
        verifier_id=verifier_id,
        wallet_type="mpc",
        is_active=True,
    )
    db.add(wallet)
    await db.flush()
    await db.refresh(wallet)
    return wallet


async def connect_web3auth_wallet(
    db: AsyncSession,
    user: JaireUser,
    id_token: str,
) -> tuple[MpcWalletInfo, JaireWallet]:
    """
    Verify JWT, then link the wallet to the user in the DB.
    Returns (wallet_info, db_wallet_row).
    """
    info = await verify_web3auth_token(id_token)
    wallet = await get_or_link_mpc_wallet(db, user, info.wallet_address, info.verifier_id)
    return info, wallet


# ── Fund wallet after payment ─────────────────────────────────────────────────

async def fund_mpc_wallet(
    id_token: str,
    amount_usdc: float,
    is_simulated: bool = True,
    mint_override: Optional[str] = None,
) -> dict:
    """
    Transfer USDC from the JaIre treasury to a user's invisible wallet.
    Called automatically after a successful Paystack/Roqqu payment.

    Returns the funding result dict from the MPC sidecar.
    """
    body: dict = {
        "id_token": id_token,
        "amount_usdc": amount_usdc,
        "is_simulated": is_simulated,
    }
    if mint_override:
        body["mint"] = mint_override

    try:
        result = await _call_sidecar("/mpc/fund-wallet", body)
        logger.info(
            f"[WalletService] Funded {amount_usdc} USDC → {result.get('wallet_address', '?')[:8]}... "
            f"tx={result.get('tx_signature')} simulated={result.get('is_simulated')}"
        )
        return result
    except Exception as e:
        logger.error(f"[WalletService] fund_mpc_wallet failed: {e}")
        raise


# ── Sign escrow deposit during check-in ───────────────────────────────────────

async def sign_escrow_deposit(
    id_token: str,
    to_address: str,
    amount_usdc: float,
    is_simulated: bool = True,
    mint_override: Optional[str] = None,
) -> dict:
    """
    Co-sign a USDC transfer from the user's invisible wallet → escrow.
    Returns the transfer result dict.
    """
    body: dict = {
        "id_token": id_token,
        "to_address": to_address,
        "amount_usdc": amount_usdc,
        "is_simulated": is_simulated,
    }
    if mint_override:
        body["mint"] = mint_override

    try:
        result = await _call_sidecar("/mpc/sign-usdc-transfer", body)
        logger.info(
            f"[WalletService] Escrow deposit signed: {amount_usdc} USDC "
            f"tx={result.get('tx_signature')} simulated={result.get('is_simulated')}"
        )
        return result
    except Exception as e:
        logger.error(f"[WalletService] sign_escrow_deposit failed: {e}")
        raise


# ── Balance check ─────────────────────────────────────────────────────────────

async def get_wallet_balance(
    id_token: str,
    mint_override: Optional[str] = None,
) -> dict:
    """Return SOL + USDC balance for a Web3Auth user's wallet."""
    body: dict = {"id_token": id_token}
    if mint_override:
        body["mint"] = mint_override
    return await _call_sidecar("/mpc/wallet-balance", body)
