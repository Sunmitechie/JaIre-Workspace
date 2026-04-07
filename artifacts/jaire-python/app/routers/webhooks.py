import hashlib
import hmac
import uuid
import logging
from typing import Any

from fastapi import APIRouter, Request, HTTPException, Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.schemas.webhook import (
    PaystackWebhook,
    RoqquWebhook,
    TestPaymentRequest,
    PaymentStatusResponse,
)
from app.services import payment_service

router = APIRouter(tags=["webhooks"])
logger = logging.getLogger(__name__)


@router.post("/jaire/webhook/paystack")
async def paystack_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
    x_paystack_signature: str = Header(default=""),
):
    body = await request.body()

    if not settings.test_mode_enabled or settings.paystack_secret_key:
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

    amount_ngn = payload.data.amount / 100

    payment = await payment_service.process_payment(
        db=db,
        user_identifier=identifier,
        amount_ngn=amount_ngn,
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
    }


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

    payment = await payment_service.process_payment(
        db=db,
        user_identifier=identifier,
        amount_ngn=payload.amount,
        payment_reference=payload.reference,
        provider="roqqu",
        is_test_mode=False,
    )

    return {
        "received": True,
        "payment_id": str(payment.id),
        "status": payment.status,
        "tx_signature": payment.tx_signature,
    }


@router.post("/jaire/webhook/test", response_model=PaymentStatusResponse)
async def test_payment(
    body: TestPaymentRequest,
    db: AsyncSession = Depends(get_db),
):
    if not settings.test_mode_enabled:
        raise HTTPException(status_code=403, detail="Test mode is disabled")

    reference = f"TEST-{uuid.uuid4().hex[:12].upper()}"

    try:
        payment = await payment_service.process_payment(
            db=db,
            user_identifier=body.user_identifier,
            amount_ngn=body.amount_ngn,
            payment_reference=reference,
            provider="test",
            is_test_mode=True,
            user_name=body.user_name,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return PaymentStatusResponse(
        payment_id=str(payment.id),
        status=payment.status,
        amount_ngn=float(payment.amount_ngn),
        amount_usdc=float(payment.amount_usdc),
        tx_signature=payment.tx_signature,
        is_test_mode=payment.is_test_mode,
    )
