import hashlib
import hmac
import json
import uuid
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.database import get_db
from app.routers import webhooks


class FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


@pytest.fixture
def client_app():
    app = FastAPI()
    app.include_router(webhooks.router)
    with TestClient(app) as client:
        yield app, client


@pytest.fixture
def fake_db():
    db = SimpleNamespace()
    db.execute = AsyncMock()
    db.add = MagicMock()
    db.flush = AsyncMock()
    return db


def _signed_payload(secret: str, body: bytes, algorithm: str = "sha256"):
    digest = getattr(hashlib, algorithm)
    return hmac.new(secret.encode(), body, digest).hexdigest()


def test_paystack_webhook_rejects_invalid_signature(monkeypatch, client_app):
    app, client = client_app
    monkeypatch.setattr(webhooks.settings, "paystack_secret_key", "paystack-secret", raising=False)

    payload = {
        "event": "charge.success",
        "data": {
            "reference": "ref_paystack_1",
            "amount": 5000,
            "currency": "NGN",
            "customer": {
                "email": "user@example.com",
                "phone": "",
                "first_name": "Ada",
                "last_name": "Lovelace",
            },
            "status": "success",
        },
    }
    body = json.dumps(payload).encode()

    app.dependency_overrides[get_db] = lambda: SimpleNamespace()
    response = client.post(
        "/jaire/webhook/paystack",
        content=body,
        headers={"x-paystack-signature": "bad-signature"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid Paystack signature"


def test_paystack_webhook_processes_valid_event(monkeypatch, client_app, fake_db):
    app, client = client_app
    monkeypatch.setattr(webhooks.settings, "paystack_secret_key", "paystack-secret", raising=False)

    payload = {
        "event": "charge.success",
        "data": {
            "reference": "ref_paystack_2",
            "amount": 5000,
            "currency": "NGN",
            "customer": {
                "email": "user@example.com",
                "phone": "",
                "first_name": "Ada",
                "last_name": "Lovelace",
            },
            "status": "success",
        },
    }
    body = json.dumps(payload).encode()
    signature = _signed_payload("paystack-secret", body, "sha512")

    fake_payment = SimpleNamespace(
        id=uuid.uuid4(),
        status="completed",
        tx_signature="paystack_sig_123",
        amount_usdc=Decimal("1.25"),
        exchange_rate=Decimal("4000"),
        oracle_source="mock",
    )

    mock_process_payment = AsyncMock(return_value=fake_payment)
    monkeypatch.setattr(webhooks.payment_service, "process_payment", mock_process_payment)
    app.dependency_overrides[get_db] = lambda: fake_db

    response = client.post(
        "/jaire/webhook/paystack",
        content=body,
        headers={"x-paystack-signature": signature},
    )

    assert response.status_code == 200
    body_json = response.json()
    assert body_json["status"] == "completed"
    assert body_json["currency"] == "NGN"
    assert body_json["amount_fiat"] == 50.0
    assert body_json["payment_id"] == str(fake_payment.id)
    mock_process_payment.assert_awaited_once()


def test_stripe_webhook_rejects_invalid_signature(monkeypatch, client_app):
    app, client = client_app
    monkeypatch.setattr(webhooks.settings, "stripe_webhook_secret", "stripe-secret", raising=False)

    event = {
        "type": "checkout.session.completed",
        "data": {"object": {"id": "cs_test_1", "amount_received": 2500, "currency": "usd", "customer_details": {"email": "buyer@example.com"}}},
    }
    body = json.dumps(event).encode()

    def raise_signature_error(_body, _sig, _secret):
        raise webhooks.stripe.SignatureVerificationError("bad signature")

    monkeypatch.setattr(webhooks.stripe.Webhook, "construct_event", raise_signature_error)
    app.dependency_overrides[get_db] = lambda: SimpleNamespace()

    response = client.post(
        "/jaire/webhook/stripe",
        content=body,
        headers={"stripe-signature": "bad-signature"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid Stripe signature"


def test_stripe_webhook_processes_valid_event(monkeypatch, client_app, fake_db):
    app, client = client_app
    monkeypatch.setattr(webhooks.settings, "stripe_webhook_secret", "stripe-secret", raising=False)

    event = {
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "id": "cs_test_2",
                "amount_received": 2500,
                "currency": "usd",
                "receipt_email": "buyer@example.com",
                "customer_details": {"name": "Buyer Person"},
                "metadata": {"jaire_reference": "ref_stripe_2"},
            }
        },
    }
    body = json.dumps(event).encode()

    monkeypatch.setattr(webhooks.stripe.Webhook, "construct_event", lambda _body, _sig, _secret: event)
    fake_payment = SimpleNamespace(
        id=uuid.uuid4(),
        status="completed",
        tx_signature="stripe_sig_456",
        amount_usdc=Decimal("1.50"),
        exchange_rate=Decimal("1666.67"),
        oracle_source="mock",
    )
    mock_process_payment = AsyncMock(return_value=fake_payment)
    monkeypatch.setattr(webhooks.payment_service, "process_payment", mock_process_payment)
    app.dependency_overrides[get_db] = lambda: fake_db

    response = client.post(
        "/jaire/webhook/stripe",
        content=body,
        headers={"stripe-signature": "good-signature"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "completed"
    assert response.json()["currency"] == "USD"
    mock_process_payment.assert_awaited_once()


def test_create_stripe_payment_intent(monkeypatch, client_app):
    app, client = client_app
    monkeypatch.setattr(webhooks, "get_usdc_rate", AsyncMock(return_value={"rate": 1500.0, "source": "mock"}))

    response_obj = SimpleNamespace(client_secret="secret_abc", id="pi_test_123")
    monkeypatch.setattr(webhooks.stripe.PaymentIntent, "create", staticmethod(lambda **kwargs: response_obj))

    response = client.post(
        "/jaire/stripe/create-payment-intent",
        json={"amount_fiat": 1500.0, "currency": "usd", "email": "buyer@example.com", "reference": "ref_456"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["payment_intent_id"] == "pi_test_123"
    assert payload["amount_fiat"] == 1500.0
    assert payload["estimated_usdc"] == 1.0


def test_initialize_paystack_payment(monkeypatch, client_app):
    app, client = client_app
    monkeypatch.setattr(webhooks, "get_usdc_rate", AsyncMock(return_value={"rate": 1600.0, "source": "mock"}))
    monkeypatch.setattr(webhooks.settings, "paystack_secret_key", "paystack-secret", raising=False)

    class FakeResponse:
        def __init__(self, payload):
            self._payload = payload

        def json(self):
            return self._payload

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            self.timeout = kwargs.get("timeout")

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, *args, **kwargs):
            return FakeResponse({
                "status": True,
                "data": {
                    "authorization_url": "https://example.com/checkout",
                    "access_code": "access_123",
                    "reference": "ref_789",
                },
            })

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)

    response = client.post(
        "/jaire/paystack/initialize",
        json={"amount_fiat": 2500.0, "currency": "NGN", "email": "test@example.com", "reference": "ref_789"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["authorization_url"] == "https://example.com/checkout"
    assert payload["reference"] == "ref_789"
    assert payload["estimated_usdc"] == 1.5625


def test_get_oracle_rate(monkeypatch, client_app):
    _, client = client_app
    monkeypatch.setattr(webhooks, "get_usdc_rate", AsyncMock(return_value={"rate": 1800.0, "currency": "NGN", "source": "mock"}))

    response = client.get("/jaire/oracle/rate/NGN")

    assert response.status_code == 200
    assert response.json()["rate"] == 1800.0
    assert response.json()["source"] == "mock"


def test_roqqu_webhook_processes_valid_request(monkeypatch, client_app, fake_db):
    app, client = client_app
    monkeypatch.setattr(webhooks.settings, "roqqu_webhook_secret", "roqqu-secret", raising=False)

    payload = {
        "event": "payment",
        "reference": "ref_roqqu_1",
        "amount": 1500.0,
        "currency": "NGN",
        "email": "roqqu@example.com",
        "phone": "",
        "status": "successful",
    }
    body = json.dumps(payload).encode()
    signature = _signed_payload("roqqu-secret", body, "sha256")

    fake_payment = SimpleNamespace(
        id=uuid.uuid4(),
        status="completed",
        tx_signature="roqqu_sig_123",
        amount_usdc=Decimal("0.75"),
        exchange_rate=Decimal("2000"),
        oracle_source="mock",
    )
    mock_process_payment = AsyncMock(return_value=fake_payment)
    monkeypatch.setattr(webhooks.payment_service, "process_payment", mock_process_payment)
    app.dependency_overrides[get_db] = lambda: fake_db

    response = client.post(
        "/jaire/webhook/roqqu",
        content=body,
        headers={"x-roqqu-signature": signature},
    )

    assert response.status_code == 200
    response_json = response.json()
    assert response_json["status"] == "completed"
    assert response_json["amount_usdc"] == 0.75
    mock_process_payment.assert_awaited_once()


def test_hub_withdrawal_success(monkeypatch, client_app, fake_db):
    app, client = client_app

    vault = SimpleNamespace(
        id=uuid.uuid4(),
        hub_id="hub-1",
        balance_usdc=Decimal("100.00"),
        total_withdrawn_usdc=Decimal("0.00"),
        payout_provider="paystack",
        payout_destination="recipient_123",
        payout_currency="NGN",
        owner_name="Jane Owner",
        hub_name="The Hub",
    )
    fake_db.execute = AsyncMock(return_value=FakeResult(vault))

    async def fake_process_hub_withdrawal(**kwargs):
        return {
            "fiat_amount": 15000.0,
            "oracle_rate": 1500.0,
            "oracle_source": "mock",
            "payout_result": {"transfer_code": "transfer_1"},
        }

    monkeypatch.setattr(
        "app.services.hub_vault_service.process_hub_withdrawal",
        fake_process_hub_withdrawal,
    )
    app.dependency_overrides[get_db] = lambda: fake_db

    response = client.post(
        "/jaire/hub/withdraw",
        json={"hub_id": "hub-1", "amount_usdc": 25.0},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["hub_id"] == "hub-1"
    assert body["amount_usdc"] == 25.0
    assert body["payout_reference"] == "transfer_1"
    assert body["sweep_status"] == "pending"


def test_hub_vault_balance(monkeypatch, client_app, fake_db):
    app, client = client_app
    vault = SimpleNamespace(
        hub_id="hub-2",
        hub_name="Alpha Workspace",
        payout_currency="NGN",
        balance_usdc=Decimal("50.00"),
        total_earned_usdc=Decimal("80.00"),
        total_withdrawn_usdc=Decimal("20.00"),
    )
    fake_db.execute = AsyncMock(return_value=FakeResult(vault))
    monkeypatch.setattr(webhooks, "get_usdc_rate", AsyncMock(return_value={"rate": 1600.0, "source": "mock"}))
    app.dependency_overrides[get_db] = lambda: fake_db

    response = client.get("/jaire/hub/hub-2/balance")

    assert response.status_code == 200
    payload = response.json()
    assert payload["hub_id"] == "hub-2"
    assert payload["hub_name"] == "Alpha Workspace"
    assert payload["balance_usdc"] == 50.0
    assert payload["balance_fiat"] == 80000.0
    assert payload["oracle_rate"] == 1600.0


def test_test_payment_endpoint(monkeypatch, client_app, fake_db):
    app, client = client_app
    monkeypatch.setattr(webhooks.settings, "test_mode_enabled", True, raising=False)

    fake_payment = SimpleNamespace(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        amount_fiat=Decimal("1500.00"),
        amount_ngn=Decimal("1500.00"),
        amount_usdc=Decimal("0.9375"),
        exchange_rate=Decimal("1600.00"),
        oracle_source="mock",
        tx_signature="simulated_sig_abc",
        is_test_mode=True,
        status="completed",
        fiat_currency="NGN",
    )
    mock_process_payment = AsyncMock(return_value=fake_payment)
    monkeypatch.setattr(webhooks.payment_service, "process_payment", mock_process_payment)

    wallet = SimpleNamespace(pubkey="wallet_pubkey_123")
    fake_db.execute = AsyncMock(return_value=FakeResult(wallet))
    app.dependency_overrides[get_db] = lambda: fake_db

    response = client.post(
        "/jaire/webhook/test",
        json={"user_identifier": "tester@example.com", "amount_ngn": 1500.0, "user_name": "Tester"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "completed"
    assert payload["wallet_address"] == "wallet_pubkey_123"
    assert payload["amount_usdc"] == 0.9375
    assert payload["payment_reference"]
    mock_process_payment.assert_awaited_once()
