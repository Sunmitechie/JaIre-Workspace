import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.services.solana_service import get_solana_service
from app.services.devnet_setup import get_devnet_setup, set_test_mint, get_test_mint

router = APIRouter(tags=["devnet"])
logger = logging.getLogger(__name__)


def _require_devnet():
    if settings.solana_network != "devnet":
        raise HTTPException(status_code=403, detail="Only available on devnet")


class AirdropRequest(BaseModel):
    pubkey: str
    sol_amount: float = 1.0


class MintUsdcRequest(BaseModel):
    recipient: str
    amount_usdc: float = 10.0
    mint_pubkey: Optional[str] = None


class RegisterMintRequest(BaseModel):
    mint_pubkey: str


class LivePaymentRequest(BaseModel):
    user_identifier: str
    amount_ngn: float
    mint_pubkey: str
    user_name: Optional[str] = None


@router.get("/jaire/devnet/treasury")
async def get_treasury_info():
    _require_devnet()
    try:
        svc = get_solana_service()
        info = await svc.get_treasury_info()
        return info
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/jaire/devnet/airdrop")
async def airdrop_sol(body: AirdropRequest):
    """Request SOL from the devnet faucet. Rate-limited by Solana to ~1 SOL/day."""
    _require_devnet()
    if body.sol_amount > 2.0:
        raise HTTPException(status_code=400, detail="Max 2 SOL per airdrop on devnet")
    try:
        svc = get_solana_service()
        signature = await svc.request_airdrop(body.pubkey, body.sol_amount)
        return {"signature": signature, "pubkey": body.pubkey, "amount_sol": body.sol_amount}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/jaire/devnet/setup/fund-treasury")
async def fund_treasury():
    """Try to get SOL for the treasury from the devnet faucet."""
    _require_devnet()
    try:
        setup = get_devnet_setup()
        balance = await setup.ensure_sol_funded(min_sol=0.5)
        return {
            "treasury": str(setup.treasury_pubkey),
            "sol_balance": balance,
            "funded": balance >= 0.1,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/jaire/devnet/setup/create-test-mint")
async def create_test_mint():
    """
    Create a new SPL token mint owned by the treasury.
    Use this instead of real devnet USDC for test payment flows.
    Treasury must have SOL first — call /setup/fund-treasury if needed.
    """
    _require_devnet()
    try:
        setup = get_devnet_setup()
        mint = await setup.create_test_mint()
        return {
            "test_mint": mint,
            "mint_authority": str(setup.treasury_pubkey),
            "decimals": 6,
            "note": "Use this mint_pubkey in test payment flows",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/jaire/devnet/setup/mint-usdc")
async def mint_test_usdc(body: MintUsdcRequest):
    """Mint test tokens (USDC-equivalent) to a recipient wallet."""
    _require_devnet()
    if not body.mint_pubkey:
        raise HTTPException(
            status_code=400,
            detail="mint_pubkey is required. Create a test mint first via POST /jaire/devnet/setup/create-test-mint"
        )
    try:
        setup = get_devnet_setup()
        sig = await setup.mint_test_usdc(body.recipient, body.amount_usdc, body.mint_pubkey)
        return {
            "signature": sig,
            "recipient": body.recipient,
            "amount_usdc": body.amount_usdc,
            "mint": body.mint_pubkey,
        }
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


@router.post("/jaire/devnet/setup/register-mint")
async def register_existing_mint(body: RegisterMintRequest):
    """
    Register an existing SPL mint address (no new on-chain transaction).
    Use this when the mint was already created in a previous session.
    """
    _require_devnet()
    set_test_mint(body.mint_pubkey)
    return {
        "registered_mint": body.mint_pubkey,
        "status": "active",
        "note": "Mint registered. Use POST /jaire/devnet/setup/mint-usdc to issue tokens.",
    }


@router.get("/jaire/devnet/setup/current-mint")
async def get_current_mint():
    """Return the currently active test mint address."""
    _require_devnet()
    mint = get_test_mint()
    return {
        "test_mint": mint,
        "registered": mint is not None,
    }


@router.post("/jaire/devnet/live-payment")
async def live_on_chain_payment(
    body: LivePaymentRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Perform a REAL on-chain SPL token transfer (devnet only).
    The treasury sends test-USDC to the user's wallet for the given NGN amount.
    Treasury must already hold tokens for the specified mint.
    """
    _require_devnet()
    try:
        from app.services import payment_service

        # Ensure user + wallet exist
        payment = await payment_service.process_payment(
            db=db,
            user_identifier=body.user_identifier,
            amount_ngn=body.amount_ngn,
            payment_reference=f"LIVE-DEVNET-{body.user_identifier[:8].upper()}",
            provider="test",
            is_test_mode=False,
            user_name=body.user_name,
            mint_override=body.mint_pubkey,
        )

        return {
            "payment_id": str(payment.id),
            "status": payment.status,
            "amount_ngn": float(payment.amount_ngn),
            "amount_usdc": float(payment.amount_usdc),
            "exchange_rate": float(payment.exchange_rate),
            "tx_signature": payment.tx_signature,
            "is_test_mode": False,
            "network": "devnet",
            "mint_used": body.mint_pubkey,
            "explorer": {
                "solana_explorer": f"https://explorer.solana.com/tx/{payment.tx_signature}?cluster=devnet",
                "solscan": f"https://solscan.io/tx/{payment.tx_signature}?cluster=devnet",
                "solana_fm": f"https://solana.fm/tx/{payment.tx_signature}?cluster=devnet-solana",
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/jaire/devnet/balance-for-mint/{pubkey}/{mint}")
async def get_balance_for_mint(pubkey: str, mint: str):
    """Get SOL + token balance for a specific mint (useful for test mints)."""
    try:
        from app.services.solana_service import get_ata_address
        from solders.pubkey import Pubkey
        from solana.rpc.commitment import Confirmed

        svc = get_solana_service()
        sol = await svc.get_sol_balance(pubkey)

        owner = Pubkey.from_string(pubkey)
        mint_pk = Pubkey.from_string(mint)
        ata = get_ata_address(owner, mint_pk)
        ata_resp = await svc.client.get_account_info(ata, commitment=Confirmed)
        token_balance = 0.0
        if ata_resp.value is not None:
            bal_resp = await svc.client.get_token_account_balance(ata, commitment=Confirmed)
            if bal_resp.value:
                token_balance = float(bal_resp.value.ui_amount or 0)

        return {
            "pubkey": pubkey,
            "ata": str(ata),
            "sol_balance": sol,
            "token_balance": token_balance,
            "mint": mint,
            "network": settings.solana_network,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
