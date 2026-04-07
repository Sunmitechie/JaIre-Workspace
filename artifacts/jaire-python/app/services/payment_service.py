import hashlib
import hmac
import logging
import uuid
from decimal import Decimal
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import settings
from app.models import JaireUser, JaireWallet, JairePayment
from app.services.solana_service import get_solana_service

logger = logging.getLogger(__name__)


def _ngn_to_usdc(amount_ngn: float) -> float:
    return round(amount_ngn / settings.ngn_usdc_rate, 6)


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

    try:
        solana_svc = get_solana_service()
        signature = await solana_svc.transfer_usdc(wallet.pubkey, amount_usdc)
        payment.tx_signature = signature
        payment.status = "completed"
        logger.info(f"Payment {payment.id} completed. Tx: {signature}")
    except Exception as e:
        payment.status = "failed"
        payment.error_message = str(e)
        logger.error(f"Payment {payment.id} failed: {e}")
        raise

    return payment
