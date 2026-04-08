import base64
import hashlib
import hmac
import logging
import os
import uuid
from decimal import Decimal
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import settings
from app.models import JaireUser, JaireWallet, JairePayment
from app.services.solana_service import get_solana_service

logger = logging.getLogger(__name__)


SOLANA_NETWORK = "devnet"
EXPLORER_BASE = "https://explorer.solana.com"
SOLSCAN_BASE = "https://solscan.io"
SOLANAFM_BASE = "https://solana.fm"


def _ngn_to_usdc(amount_ngn: float) -> float:
    return round(amount_ngn / settings.ngn_usdc_rate, 6)


def _explorer_links(signature: str, is_simulated: bool = False) -> dict:
    """Return Solana explorer URLs for a transaction signature."""
    cluster = f"?cluster={SOLANA_NETWORK}"
    fm_cluster = f"?cluster={SOLANA_NETWORK}-solana"
    prefix = "[SIMULATED] " if is_simulated else ""
    return {
        "solana_explorer": f"{prefix}{EXPLORER_BASE}/tx/{signature}{cluster}",
        "solscan": f"{prefix}{SOLSCAN_BASE}/tx/{signature}{cluster}",
        "solana_fm": f"{prefix}{SOLANAFM_BASE}/tx/{signature}{fm_cluster}",
    }


def _simulated_signature() -> str:
    """Generate a base58-encoded 64-byte random value that looks like a real Solana signature."""
    alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    raw = os.urandom(64)
    n = int.from_bytes(raw, "big")
    result = []
    while n:
        n, rem = divmod(n, 58)
        result.append(alphabet[rem])
    # pad leading zeros
    for byte in raw:
        if byte == 0:
            result.append(alphabet[0])
        else:
            break
    return "".join(reversed(result))[:88]  # Solana sigs are 88 chars


def verify_paystack_signature(payload: bytes, signature: str) -> bool:
    expected = hmac.new(
        settings.paystack_secret_key.encode(),
        payload,
        hashlib.sha512,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def verify_roqqu_signature(payload: bytes, signature: str) -> bool:
    expected = hmac.new(
        settings.roqqu_webhook_secret.encode(),
        payload,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


async def _get_or_create_user(
    db: AsyncSession,
    identifier: str,
    name: Optional[str] = None,
) -> JaireUser:
    is_email = "@" in identifier
    if is_email:
        stmt = select(JaireUser).where(JaireUser.email == identifier)
    else:
        stmt = select(JaireUser).where(JaireUser.phone == identifier)

    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if user is None:
        user = JaireUser(
            email=identifier if is_email else None,
            phone=None if is_email else identifier,
            name=name,
        )
        db.add(user)
        await db.flush()
        logger.info(f"Created user: {user.id}")

    return user


async def _get_or_create_wallet(
    db: AsyncSession,
    user: JaireUser,
) -> JaireWallet:
    stmt = (
        select(JaireWallet)
        .where(JaireWallet.user_id == user.id)
        .where(JaireWallet.is_active == True)
        .where(JaireWallet.network == settings.solana_network)
    )
    result = await db.execute(stmt)
    wallet = result.scalar_one_or_none()

    if wallet is None:
        solana_svc = get_solana_service()
        new_wallet = solana_svc.generate_wallet()

        wallet = JaireWallet(
            user_id=user.id,
            pubkey=new_wallet["pubkey"],
            encrypted_secret=new_wallet["secret_hex"],
            network=settings.solana_network,
            is_active=True,
        )
        db.add(wallet)
        await db.flush()
        logger.info(f"Created wallet {wallet.pubkey} for user {user.id}")

        try:
            await solana_svc.request_airdrop(wallet.pubkey, sol_amount=0.1)
            logger.info(f"Airdropped 0.1 SOL to {wallet.pubkey}")
        except Exception as e:
            logger.warning(f"Airdrop failed (non-fatal): {e}")

    return wallet


async def process_payment(
    db: AsyncSession,
    user_identifier: str,
    amount_ngn: float,
    payment_reference: str,
    provider: str = "paystack",
    is_test_mode: bool = False,
    user_name: Optional[str] = None,
    mint_override: Optional[str] = None,
) -> JairePayment:
    existing_stmt = select(JairePayment).where(
        JairePayment.payment_reference == payment_reference
    )
    existing = await db.execute(existing_stmt)
    if existing.scalar_one_or_none():
        raise ValueError(f"Duplicate payment reference: {payment_reference}")

    amount_usdc = _ngn_to_usdc(amount_ngn)

    user = await _get_or_create_user(db, user_identifier, name=user_name)
    wallet = await _get_or_create_wallet(db, user)

    payment = JairePayment(
        user_id=user.id,
        amount_ngn=Decimal(str(amount_ngn)),
        amount_usdc=Decimal(str(amount_usdc)),
        exchange_rate=Decimal(str(settings.ngn_usdc_rate)),
        payment_reference=payment_reference,
        status="processing",
        is_test_mode=is_test_mode,
        provider=provider,
    )
    db.add(payment)
    await db.flush()

    if is_test_mode:
        # In test mode: generate a realistic-looking simulated signature
        # The USDC transfer is skipped but everything else is real (DB records, wallet, user)
        sim_sig = _simulated_signature()
        payment.tx_signature = sim_sig
        payment.status = "completed"
        payment.error_message = None
        links = _explorer_links(sim_sig, is_simulated=True)
        logger.info(
            f"[TEST MODE] Payment {payment.id} simulated. "
            f"Sig: {sim_sig} | Solscan: {links['solscan']}"
        )
    else:
        try:
            solana_svc = get_solana_service()
            # Submit transaction and return immediately; confirmation runs in background
            signature = await solana_svc.submit_transaction_and_return(
                wallet.pubkey, amount_usdc, mint_pubkey_str=mint_override
            )
            payment.tx_signature = signature
            payment.status = "pending_confirmation"
            links = _explorer_links(signature, is_simulated=False)
            logger.info(
                f"Payment {payment.id} submitted (pending confirmation). "
                f"Tx: {signature} | Solscan: {links['solscan']}"
            )
        except Exception as e:
            payment.status = "failed"
            payment.error_message = str(e)
            logger.error(f"Payment {payment.id} failed: {e}")
            raise

    return payment
