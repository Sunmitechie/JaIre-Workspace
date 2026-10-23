import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.database import get_db
from app.routers import webhooks


def _stripe_client():
    app = FastAPI()
    app.include_router(webhooks.router)
    return app, TestClient(app)


def test_stripe_webhook_rejects_signature_mismatch(monkeypatch):
    app, client = _stripe_client()
    monkeypatch.setattr(webhooks.settings, "stripe_webhook_secret", "stripe-secret", raising=False)

    def raise_signature_error(_body, _signature, _secret):
        raise webhooks.stripe.SignatureVerificationError("signature mismatch")

    monkeypatch.setattr(webhooks.stripe.Webhook, "construct_event", raise_signature_error)
    app.dependency_overrides[get_db] = lambda: SimpleNamespace()

    response = client.post(
        "/jaire/webhook/stripe",
        content=json.dumps({"type": "payment_intent.succeeded"}).encode(),
        headers={"stripe-signature": "invalid"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid Stripe signature"


def test_stripe_webhook_returns_duplicate_for_existing_reference(monkeypatch):
    app, client = _stripe_client()
    monkeypatch.setattr(webhooks.settings, "stripe_webhook_secret", "stripe-secret", raising=False)
    reference = "existing-payment-ref"
    event = {
        "type": "payment_intent.succeeded",
        "data": {
            "object": {
                "id": "pi_existing",
                "amount_received": 2500,
                "currency": "usd",
                "receipt_email": "buyer@example.com",
                "metadata": {"jaire_reference": reference},
            }
        },
    }
    monkeypatch.setattr(
        webhooks.stripe.Webhook,
        "construct_event",
        lambda _body, _signature, _secret: event,
    )
    process_payment = AsyncMock(side_effect=ValueError("Duplicate payment reference"))
    monkeypatch.setattr(webhooks.payment_service, "process_payment", process_payment)
    app.dependency_overrides[get_db] = lambda: SimpleNamespace()

    response = client.post(
        "/jaire/webhook/stripe",
        content=json.dumps(event).encode(),
        headers={"stripe-signature": "valid"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "received": True,
        "action": "duplicate",
        "reference": reference,
    }
    process_payment.assert_awaited_once()
