import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import JaireUser, JaireWallet
from app.schemas.webhook import WalletCreateRequest, WalletResponse
from app.services.payment_service import _get_or_create_user, _get_or_create_wallet

router = APIRouter(tags=["wallet"])
logger = logging.getLogger(__name__)


@router.post("/jaire/wallet/create", response_model=WalletResponse)
async def create_wallet(
    body: WalletCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    user = await _get_or_create_user(db, body.user_identifier, name=body.user_name)
    wallet = await _get_or_create_wallet(db, user)

    return WalletResponse(
        pubkey=wallet.pubkey,
        network=wallet.network,
        user_id=str(user.id),
    )


@router.get("/jaire/wallet/{identifier}")
async def get_wallet(identifier: str, db: AsyncSession = Depends(get_db)):
    is_email = "@" in identifier
    if is_email:
        stmt = select(JaireUser).where(JaireUser.email == identifier)
    else:
        stmt = select(JaireUser).where(JaireUser.phone == identifier)

    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    wallet_stmt = (
        select(JaireWallet)
        .where(JaireWallet.user_id == user.id)
        .where(JaireWallet.is_active == True)
    )
    wallet_result = await db.execute(wallet_stmt)
    wallet = wallet_result.scalar_one_or_none()

    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")

    return {
        "pubkey": wallet.pubkey,
        "network": wallet.network,
        "user_id": str(user.id),
        "created_at": wallet.created_at.isoformat(),
    }
