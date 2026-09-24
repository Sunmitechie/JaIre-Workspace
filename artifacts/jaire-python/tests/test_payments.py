import uuid
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services import payment_service


@pytest.mark.asyncio
async def test_process_payment_rejects_duplicate_reference(monkeypatch):
    db = SimpleNamespace()
    db.execute = AsyncMock(return_value=SimpleNamespace(scalar_one_or_none=lambda: object()))

    with pytest.raises(ValueError, match="Duplicate payment reference"):
        await payment_service.process_payment(
            db=db,
            user_identifier="payee@example.com",
            amount_ngn=2500,
            payment_reference="dup-ref",
            provider="paystack",
            is_test_mode=False,
            fiat_currency="NGN",
            amount_fiat=2500,
        )


@pytest.mark.asyncio
async def test_process_payment_creates_user_wallet_and_records_payment(monkeypatch):
    db = SimpleNamespace()
    db.execute = AsyncMock()
    db.add = MagicMock()
    db.flush = AsyncMock()

    db.execute.side_effect = [
        SimpleNamespace(scalar_one_or_none=lambda: None),
        SimpleNamespace(scalar_one_or_none=lambda: None),
        SimpleNamespace(scalar_one_or_none=lambda: None),
    ]

    monkeypatch.setattr(
        payment_service,
        "convert_to_usdc",
        AsyncMock(return_value={"amount_usdc": 1.5, "rate": 1600.0, "source": "mock-oracle"}),
    )

    class FakeWalletService:
        def generate_wallet(self):
            return {"pubkey": "wallet-pubkey-123", "secret_hex": "deadbeef"}

        async def request_airdrop(self, *_args, **_kwargs):
            return None

    monkeypatch.setattr(payment_service, "get_solana_service", lambda: FakeWalletService())

    payment = await payment_service.process_payment(
        db=db,
        user_identifier="buyer@example.com",
        amount_ngn=2400,
        payment_reference="ref-001",
        provider="paystack",
        is_test_mode=True,
        fiat_currency="NGN",
        amount_fiat=2400,
        user_name="Buyer Person",
    )

    assert payment.payment_reference == "ref-001"
    assert payment.provider == "paystack"
    assert payment.status == "completed"
    assert payment.tx_signature
    assert payment.amount_usdc == Decimal("1.500000")
    assert payment.user_id is not None
