import hashlib
import hmac
import uuid
import logging
from decimal import Decimal
from typing import Any, Optional

import stripe
from fastapi import APIRouter, Request, HTTPException, Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import settings
from app.database import get_db
from app.schemas.webhook import (
    ExplorerLinks,
    PaystackWebhook,
    RoqquWebhook,
    TestPaymentRequest,
    PaymentStatusResponse,
)
from app.services import payment_service
from app.services.payment_service import _explorer_links
from app.services.oracle_service import get_usdc_rate
from app.models import JaireWallet, HubVault, HubWithdrawal

router = APIRouter(tags=["webhooks"])
logger = logging.getLogger(__name__)

stripe.api_key = settings.stripe_secret_key


# ── Paystack Webhook ───────────────────────────────────────────────────────

@router.post("/jaire/webhook/paystack")
async def paystack_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
    x_paystack_signature: str = Header(default=""),
):
    body = await request.body()

    if settings.paystack_secret_key:
        expected = hmac.new(
            settings.paystack_secret_key.encode(),
            body,
            hashlib.sha512,
        ).hexdigest()
        if not hmac.compare_digest(expected, x_paystack_signature):
            raise HTTPException(status_code=401, detail="Invalid Paystack signature")

    try:
        payload = PaystackWebhook.model_validate_json(body)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid payload: {e}")

    if payload.event != "charge.success":
        return {"received": True, "action": "ignored", "event": payload.event}

    if payload.data.status != "success":
        return {"received": True, "action": "ignored", "reason": "non-success status"}

    customer = payload.data.customer
    identifier = customer.email or customer.phone
    if not identifier:
        raise HTTPException(status_code=400, detail="No email or phone in webhook payload")

    # Paystack amounts are in smallest unit (kobo for NGN, pesewas for GHS, etc.)
    currency = (payload.data.currency or "NGN").upper()
    amount_fiat = payload.data.amount / 100

    payment = await payment_service.process_payment(
        db=db,
        user_identifier=identifier,
        amount_ngn=amount_fiat,
        amount_fiat=amount_fiat,
        fiat_currency=currency,
        payment_reference=payload.data.reference,
        provider="paystack",
        is_test_mode=False,
        user_name=(
            f"{customer.first_name or ''} {customer.last_name or ''}".strip()
            or None
        ),
    )

    return {
        "received": True,
        "payment_id": str(payment.id),
        "status": payment.status,
        "tx_signature": payment.tx_signature,
        "currency": currency,
        "amount_fiat": amount_fiat,
        "amount_usdc": float(payment.amount_usdc),
        "oracle_rate": float(payment.exchange_rate),
        "oracle_source": payment.oracle_source,
    }


# ── Stripe Webhook ─────────────────────────────────────────────────────────

@router.post("/jaire/webhook/stripe")
async def stripe_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
    stripe_signature: str = Header(default=""),
):
    body = await request.body()

    if settings.stripe_webhook_secret and stripe_signature:
        try:
            event = stripe.Webhook.construct_event(
                body, stripe_signature, settings.stripe_webhook_secret
            )
        except stripe.SignatureVerificationError:
            raise HTTPException(status_code=401, detail="Invalid Stripe signature")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Stripe webhook error: {e}")
    else:
        import json
        try:
            event = json.loads(body)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid JSON: {e}")

    event_type = event.get("type") if isinstance(event, dict) else event["type"]

    if event_type not in ("payment_intent.succeeded", "checkout.session.completed"):
        return {"received": True, "action": "ignored", "event": event_type}

    data_obj = (
        event.get("data", {}).get("object", {})
        if isinstance(event, dict)
        else event["data"]["object"]
    )

    email = (
        data_obj.get("receipt_email")
        or data_obj.get("customer_email")
        or (data_obj.get("customer_details") or {}).get("email")
    )
    if not email:
        logger.warning("Stripe webhook: no email found in payment intent")
        return {"received": True, "action": "ignored", "reason": "no email"}

    currency = (data_obj.get("currency") or "usd").upper()
    amount_fiat = data_obj.get("amount_received", data_obj.get("amount", 0)) / 100
    payment_intent_id = data_obj.get("id", f"stripe_{uuid.uuid4().hex[:12]}")
    reference = (data_obj.get("metadata") or {}).get("jaire_reference") or payment_intent_id
    name = (data_obj.get("customer_details") or {}).get("name")

    try:
        payment = await payment_service.process_payment(
            db=db,
            user_identifier=email,
            amount_ngn=amount_fiat,
            amount_fiat=amount_fiat,
            fiat_currency=currency,
            payment_reference=reference,
            provider="stripe",
            is_test_mode=False,
            user_name=name,
        )
    except ValueError as e:
        logger.info(f"Stripe duplicate: {e}")
        return {"received": True, "action": "duplicate", "reference": reference}

    return {
        "received": True,
        "payment_id": str(payment.id),
        "status": payment.status,
        "tx_signature": payment.tx_signature,
        "currency": currency,
        "amount_fiat": amount_fiat,
        "amount_usdc": float(payment.amount_usdc),
        "oracle_rate": float(payment.exchange_rate),
        "oracle_source": payment.oracle_source,
    }


# ── Stripe Payment Intent creation ────────────────────────────────────────

@router.post("/jaire/stripe/create-payment-intent")
async def create_stripe_payment_intent(request: Request):
    body = await request.json()
    amount_fiat: float = body.get("amount_fiat", 0)
    currency: str = body.get("currency", "usd").lower()
    email: Optional[str] = body.get("email")
    jaire_reference: str = body.get("reference", f"jaire_{uuid.uuid4().hex[:12]}")

    if amount_fiat <= 0:
        raise HTTPException(status_code=400, detail="amount_fiat must be positive")

    oracle = await get_usdc_rate(currency.upper())
    amount_cents = int(amount_fiat * 100)

    try:
        intent = stripe.PaymentIntent.create(
            amount=amount_cents,
            currency=currency,
            receipt_email=email,
            automatic_payment_methods={"enabled": True},
            metadata={
                "jaire_reference": jaire_reference,
                "oracle_rate": str(oracle["rate"]),
                "oracle_source": oracle["source"],
            },
        )
    except stripe.StripeError as e:
        raise HTTPException(status_code=502, detail=f"Stripe error: {e.user_message}")

    return {
        "client_secret": intent.client_secret,
        "payment_intent_id": intent.id,
        "amount_fiat": amount_fiat,
        "currency": currency.upper(),
        "oracle_rate": oracle["rate"],
        "oracle_source": oracle["source"],
        "estimated_usdc": round(amount_fiat / oracle["rate"], 4),
    }


# ── Paystack Payment Initialization ──────────────────────────────────────

@router.post("/jaire/paystack/initialize")
async def initialize_paystack_payment(request: Request):
    import httpx

    body = await request.json()
    amount_fiat: float = body.get("amount_fiat", 0)
    currency: str = body.get("currency", "NGN").upper()
    email: str = body.get("email", "")
    callback_url: Optional[str] = body.get("callback_url")
    reference: str = body.get("reference", f"jaire_{uuid.uuid4().hex[:12]}")

    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Valid email required")
    if amount_fiat <= 0:
        raise HTTPException(status_code=400, detail="amount_fiat must be positive")

    oracle = await get_usdc_rate(currency)
    amount_kobo = int(amount_fiat * 100)

    payload = {
        "email": email,
        "amount": amount_kobo,
        "currency": currency,
        "reference": reference,
        "metadata": {
            "oracle_rate": oracle["rate"],
            "oracle_source": oracle["source"],
            "jaire_reference": reference,
        },
    }
    if callback_url:
        payload["callback_url"] = callback_url

    headers = {
        "Authorization": f"Bearer {settings.paystack_secret_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            "https://api.paystack.co/transaction/initialize",
            headers=headers,
            json=payload,
        )
    data = r.json()
    if not data.get("status"):
        raise HTTPException(status_code=502, detail=f"Paystack error: {data.get('message')}")

    return {
        "authorization_url": data["data"]["authorization_url"],
        "access_code": data["data"]["access_code"],
        "reference": data["data"]["reference"],
        "amount_fiat": amount_fiat,
        "currency": currency,
        "oracle_rate": oracle["rate"],
        "oracle_source": oracle["source"],
        "estimated_usdc": round(amount_fiat / oracle["rate"], 4),
    }


# ── Price Oracle endpoint (public — UI uses to show live rates) ────────────

@router.get("/jaire/oracle/rate/{currency}")
async def get_oracle_rate(currency: str):
    """Returns how many fiat units equal 1 USDC at the current live rate."""
    oracle = await get_usdc_rate(currency.upper())
    return oracle


# ── Roqqu Webhook ──────────────────────────────────────────────────────────

@router.post("/jaire/webhook/roqqu")
async def roqqu_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
    x_roqqu_signature: str = Header(default=""),
):
    body = await request.body()

    if settings.roqqu_webhook_secret and x_roqqu_signature:
        expected = hmac.new(
            settings.roqqu_webhook_secret.encode(),
            body,
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected, x_roqqu_signature):
            raise HTTPException(status_code=401, detail="Invalid Roqqu signature")

    try:
        payload = RoqquWebhook.model_validate_json(body)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid payload: {e}")

    if payload.status != "successful":
        return {"received": True, "action": "ignored", "reason": "non-successful status"}

    identifier = payload.email or payload.phone
    if not identifier:
        raise HTTPException(status_code=400, detail="No email or phone in Roqqu payload")

    currency = (payload.currency or "NGN").upper()

    payment = await payment_service.process_payment(
        db=db,
        user_identifier=identifier,
        amount_ngn=payload.amount,
        amount_fiat=payload.amount,
        fiat_currency=currency,
        payment_reference=payload.reference,
        provider="roqqu",
        is_test_mode=False,
    )

    return {
        "received": True,
        "payment_id": str(payment.id),
        "status": payment.status,
        "tx_signature": payment.tx_signature,
        "amount_usdc": float(payment.amount_usdc),
        "oracle_rate": float(payment.exchange_rate),
        "oracle_source": payment.oracle_source,
    }


# ── Hub Vault: Withdraw ────────────────────────────────────────────────────

@router.post("/jaire/hub/withdraw")
async def hub_withdrawal(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    from app.services.hub_vault_service import process_hub_withdrawal

    body = await request.json()
    hub_id: str = body.get("hub_id", "")
    amount_usdc: float = body.get("amount_usdc", 0)

    if not hub_id or amount_usdc <= 0:
        raise HTTPException(status_code=400, detail="hub_id and amount_usdc required")

    vault_stmt = select(HubVault).where(HubVault.hub_id == hub_id)
    result = await db.execute(vault_stmt)
    vault = result.scalar_one_or_none()

    if not vault:
        raise HTTPException(status_code=404, detail=f"Hub vault not found: {hub_id}")

    if float(vault.balance_usdc) < amount_usdc:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient balance: {float(vault.balance_usdc)} USDC available",
        )

    payout_provider = vault.payout_provider or "paystack"
    payout_destination = vault.payout_destination or ""
    payout_currency = vault.payout_currency or "NGN"

    if not payout_destination:
        raise HTTPException(status_code=400, detail="Hub payout destination not configured")

    try:
        result_data = await process_hub_withdrawal(
            hub_owner_id=hub_id,
            amount_usdc=amount_usdc,
            payout_currency=payout_currency,
            payout_provider=payout_provider,
            payout_destination=payout_destination,
            payout_name=vault.owner_name or vault.hub_name or "Hub Owner",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    vault.balance_usdc = Decimal(str(float(vault.balance_usdc) - amount_usdc))
    vault.total_withdrawn_usdc = Decimal(
        str(float(vault.total_withdrawn_usdc) + amount_usdc)
    )

    payout_ref = (
        result_data.get("payout_result", {}).get("transfer_code")
        or result_data.get("payout_result", {}).get("id")
        or f"payout_{uuid.uuid4().hex[:12]}"
    )
    withdrawal = HubWithdrawal(
        vault_id=vault.id,
        amount_usdc=Decimal(str(amount_usdc)),
        fiat_amount=Decimal(str(result_data["fiat_amount"])),
        fiat_currency=payout_currency,
        oracle_rate=Decimal(str(result_data["oracle_rate"])),
        oracle_source=result_data["oracle_source"],
        payout_provider=payout_provider,
        payout_reference=payout_ref,
        payout_status="initiated",
        sweep_status="pending",
    )
    db.add(withdrawal)
    await db.flush()

    logger.info(
        f"Hub withdrawal: {amount_usdc} USDC -> {result_data['fiat_amount']} "
        f"{payout_currency} via {payout_provider} | vault {hub_id}"
    )

    return {
        "withdrawal_id": str(withdrawal.id),
        "hub_id": hub_id,
        "amount_usdc": amount_usdc,
        "fiat_amount": result_data["fiat_amount"],
        "fiat_currency": payout_currency,
        "oracle_rate": result_data["oracle_rate"],
        "oracle_source": result_data["oracle_source"],
        "payout_provider": payout_provider,
        "payout_reference": payout_ref,
        "vault_balance_remaining_usdc": float(vault.balance_usdc),
        "sweep_status": "pending",
        "message": f"{payout_currency} {result_data['fiat_amount']:,.2f} is being transferred to your bank account.",
    }


# ── Hub Vault: Balance ──────────────────────────────────────────────────────

@router.get("/jaire/hub/{hub_id}/balance")
async def hub_vault_balance(hub_id: str, db: AsyncSession = Depends(get_db)):
    vault_stmt = select(HubVault).where(HubVault.hub_id == hub_id)
    result = await db.execute(vault_stmt)
    vault = result.scalar_one_or_none()
    if not vault:
        raise HTTPException(status_code=404, detail="Hub vault not found")

    oracle = await get_usdc_rate(vault.payout_currency or "NGN")
    balance_usdc = float(vault.balance_usdc)
    balance_fiat = round(balance_usdc * oracle["rate"], 2)

    return {
        "hub_id": hub_id,
        "hub_name": vault.hub_name,
        "balance_usdc": balance_usdc,
        "balance_fiat": balance_fiat,
        "fiat_currency": vault.payout_currency or "NGN",
        "oracle_rate": oracle["rate"],
        "oracle_source": oracle["source"],
        "total_earned_usdc": float(vault.total_earned_usdc),
        "total_withdrawn_usdc": float(vault.total_withdrawn_usdc),
    }


# ── Test payment (unchanged, now uses live oracle) ─────────────────────────

@router.post("/jaire/webhook/test")
async def test_payment(
    body: TestPaymentRequest,
    db: AsyncSession = Depends(get_db),
):
    if not settings.test_mode_enabled:
        raise HTTPException(status_code=403, detail="Test mode is disabled")

    reference = f"TEST-{uuid.uuid4().hex[:12].upper()}"
    currency = getattr(body, "currency", "NGN") or "NGN"

    try:
        payment = await payment_service.process_payment(
            db=db,
            user_identifier=body.user_identifier,
            amount_ngn=body.amount_ngn,
            amount_fiat=body.amount_ngn,
            fiat_currency=currency,
            payment_reference=reference,
            provider="test",
            is_test_mode=True,
            user_name=body.user_name,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    wallet_stmt = (
        select(JaireWallet)
        .where(JaireWallet.user_id == payment.user_id)
        .where(JaireWallet.is_active == True)
    )
    wallet_result = await db.execute(wallet_stmt)
    wallet = wallet_result.scalar_one_or_none()
    wallet_address = wallet.pubkey if wallet else None

    explorer = None
    if payment.tx_signature:
        raw_links = _explorer_links(payment.tx_signature, is_simulated=True)
        explorer = ExplorerLinks(
            solana_explorer=raw_links["solana_explorer"],
            solscan=raw_links["solscan"],
            solana_fm=raw_links["solana_fm"],
        )

    fiat_amount = float(payment.amount_fiat or payment.amount_ngn)
    fiat_currency = payment.fiat_currency or "NGN"

    return {
        "payment_id": str(payment.id),
        "status": payment.status,
        "amount_fiat": fiat_amount,
        "fiat_currency": fiat_currency,
        "amount_ngn": float(payment.amount_ngn),
        "amount_usdc": float(payment.amount_usdc),
        "exchange_rate": float(payment.exchange_rate),
        "oracle_source": payment.oracle_source,
        "tx_signature": payment.tx_signature,
        "is_test_mode": payment.is_test_mode,
        "network": settings.solana_network,
        "wallet_address": wallet_address,
        "user_id": str(payment.user_id),
        "payment_reference": reference,
        "explorer_links": explorer.model_dump() if explorer else None,
        "flow_trace": {
            "1_fiat_received": f"{fiat_amount:,.2f} {fiat_currency} received",
            "2_oracle_rate": f"Live rate: {float(payment.exchange_rate):,.4f} {fiat_currency}/USDC [source: {payment.oracle_source}]",
            "3_usdc_calculated": f"{float(payment.amount_usdc):.6f} USDC",
            "4_wallet_assigned": wallet_address or "being created",
            "5_solana_tx": payment.tx_signature,
            "6_status": payment.status.upper(),
            "note": "[TEST MODE] — USDC transfer simulated on-chain.",
        },
    }
