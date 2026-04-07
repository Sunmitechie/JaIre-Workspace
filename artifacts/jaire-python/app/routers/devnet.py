import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.services.solana_service import get_solana_service

router = APIRouter(tags=["devnet"])
logger = logging.getLogger(__name__)


class AirdropRequest(BaseModel):
    pubkey: str
    sol_amount: float = 1.0


@router.get("/jaire/devnet/treasury")
async def get_treasury_info():
    if settings.solana_network != "devnet":
        raise HTTPException(status_code=403, detail="Only available on devnet")
    try:
        svc = get_solana_service()
        info = await svc.get_treasury_info()
        return info
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/jaire/devnet/airdrop")
async def airdrop_sol(body: AirdropRequest):
    if settings.solana_network != "devnet":
        raise HTTPException(status_code=403, detail="Only available on devnet")
    if body.sol_amount > 2.0:
        raise HTTPException(status_code=400, detail="Max 2 SOL per airdrop on devnet")
    try:
        svc = get_solana_service()
        signature = await svc.request_airdrop(body.pubkey, body.sol_amount)
        return {"signature": signature, "pubkey": body.pubkey, "amount_sol": body.sol_amount}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/jaire/devnet/balance/{pubkey}")
async def get_balance(pubkey: str):
    try:
        svc = get_solana_service()
        sol = await svc.get_sol_balance(pubkey)
        usdc = await svc.get_usdc_balance(pubkey)
        return {
            "pubkey": pubkey,
            "sol_balance": sol,
            "usdc_balance": usdc,
            "network": settings.solana_network,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
