import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.database import get_db
from app.routers import devnet, health, wallet, wallet_mpc


class FakeResult:
    def __init__(self, row=None):
        self.row = row

    def scalar_one_or_none(self):
        return self.row


class FakeTransaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False


@pytest.fixture
def client_app():
    app = FastAPI()
    app.include_router(health.router)
    app.include_router(devnet.router)
    app.include_router(wallet.router)
    app.include_router(wallet_mpc.router)
    db = SimpleNamespace(
        execute=AsyncMock(),
        add=MagicMock(),
        flush=AsyncMock(),
        refresh=AsyncMock(),
        commit=AsyncMock(),
        begin_nested=MagicMock(return_value=FakeTransaction()),
    )
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as client:
        yield app, client, db
    app.dependency_overrides.clear()


def test_health_router_reports_service_and_network(client_app):
    _, client, _ = client_app

    response = client.get("/jaire/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["service"] == "jaire-python-api"
    assert response.json()["network"] == health.settings.solana_network


def test_devnet_router_rejects_vault_access_off_devnet(monkeypatch, client_app):
    _, client, _ = client_app
    monkeypatch.setattr(devnet.settings, "solana_network", "mainnet-beta")

    response = client.get("/jaire/devnet/vault")

    assert response.status_code == 403
    assert response.json()["detail"] == "Only available on devnet"


def test_devnet_airdrop_enforces_maximum_amount(client_app):
    _, client, _ = client_app

    response = client.post("/jaire/devnet/airdrop", json={"pubkey": "wallet-1", "sol_amount": 2.1})

    assert response.status_code == 400
    assert response.json()["detail"] == "Max 2 SOL per airdrop on devnet"


def test_devnet_airdrop_returns_mocked_signature(monkeypatch, client_app):
    _, client, _ = client_app
    service = SimpleNamespace(request_airdrop=AsyncMock(return_value="airdrop-signature"))
    monkeypatch.setattr(devnet, "get_solana_service", lambda: service)

    response = client.post(
        "/jaire/devnet/airdrop",
        json={"pubkey": "wallet-1", "sol_amount": 1.25},
    )

    assert response.status_code == 200
    assert response.json() == {
        "signature": "airdrop-signature",
        "pubkey": "wallet-1",
        "amount_sol": 1.25,
    }
    service.request_airdrop.assert_awaited_once_with("wallet-1", 1.25)


def test_devnet_balance_returns_service_balances(monkeypatch, client_app):
    _, client, _ = client_app
    service = SimpleNamespace(
        get_sol_balance=AsyncMock(return_value=1.25),
        get_usdc_balance=AsyncMock(return_value=30.5),
    )
    monkeypatch.setattr(devnet, "get_solana_service", lambda: service)

    response = client.get("/jaire/devnet/balance/wallet-1")

    assert response.status_code == 200
    assert response.json()["sol_balance"] == 1.25
    assert response.json()["usdc_balance"] == 30.5
    service.get_sol_balance.assert_awaited_once_with("wallet-1")


def test_devnet_mint_requires_a_registered_mint(client_app):
    _, client, _ = client_app

    response = client.post(
        "/jaire/devnet/setup/mint-usdc",
        json={"recipient": "wallet-1", "amount_usdc": 10},
    )

    assert response.status_code == 400
    assert "mint_pubkey is required" in response.json()["detail"]


def test_devnet_registers_and_reports_current_mint(monkeypatch, client_app):
    _, client, _ = client_app
    registered = []
    monkeypatch.setattr(devnet, "set_test_mint", registered.append)
    monkeypatch.setattr(devnet, "get_test_mint", lambda: registered[-1] if registered else None)

    registration = client.post(
        "/jaire/devnet/setup/register-mint",
        json={"mint_pubkey": "mint-test-1"},
    )
    current = client.get("/jaire/devnet/setup/current-mint")

    assert registration.status_code == 200
    assert registration.json()["registered_mint"] == "mint-test-1"
    assert current.json() == {"test_mint": "mint-test-1", "registered": True}


def test_wallet_create_returns_created_wallet(monkeypatch, client_app):
    _, client, _ = client_app
    user = SimpleNamespace(id=uuid.uuid4())
    wallet_row = SimpleNamespace(pubkey="wallet-pubkey", network="devnet")
    create_user = AsyncMock(return_value=user)
    create_wallet = AsyncMock(return_value=wallet_row)
    monkeypatch.setattr(wallet, "_get_or_create_user", create_user)
    monkeypatch.setattr(wallet, "_get_or_create_wallet", create_wallet)

    response = client.post(
        "/jaire/wallet/create",
        json={"user_identifier": "buyer@example.com", "user_name": "Buyer"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "pubkey": "wallet-pubkey",
        "network": "devnet",
        "user_id": str(user.id),
    }
    create_user.assert_awaited_once()
    create_wallet.assert_awaited_once_with(client_app[2], user)


def test_wallet_lookup_returns_404_for_unknown_user(client_app):
    _, client, db = client_app
    db.execute.return_value = FakeResult()

    response = client.get("/jaire/wallet/unknown@example.com")

    assert response.status_code == 404
    assert response.json()["detail"] == "User not found"


def test_wallet_lookup_returns_active_wallet_for_email(client_app):
    _, client, db = client_app
    user = SimpleNamespace(id=uuid.uuid4())
    created_at = datetime(2025, 1, 2, tzinfo=timezone.utc)
    wallet_row = SimpleNamespace(pubkey="wallet-pubkey", network="devnet", created_at=created_at)
    db.execute.side_effect = [FakeResult(user), FakeResult(wallet_row)]

    response = client.get("/jaire/wallet/buyer@example.com")

    assert response.status_code == 200
    assert response.json() == {
        "pubkey": "wallet-pubkey",
        "network": "devnet",
        "user_id": str(user.id),
        "created_at": created_at.isoformat(),
    }
    assert db.execute.await_count == 2


def test_wallet_mpc_connect_returns_verified_wallet(monkeypatch, client_app):
    _, client, db = client_app
    info = SimpleNamespace(
        wallet_address="wallet-mpc",
        verifier_id="verifier-1",
        email="user@example.com",
        name="Test User",
    )
    monkeypatch.setattr(wallet_mpc.wallet_service, "verify_web3auth_token", AsyncMock(return_value=info))
    monkeypatch.setattr(wallet_mpc, "_get_or_create_user", AsyncMock(return_value=SimpleNamespace(id=uuid.uuid4())))
    monkeypatch.setattr(wallet_mpc.wallet_service, "get_or_link_mpc_wallet", AsyncMock())
    monkeypatch.setattr(
        wallet_mpc.wallet_service,
        "get_wallet_balance",
        AsyncMock(return_value={"sol_balance": 0.5, "usdc_balance": 12, "usdc_mint": "mint-1"}),
    )

    response = client.post("/jaire/wallet/connect", json={"id_token": "test-token"})

    assert response.status_code == 200
    assert response.json()["connected"] is True
    assert response.json()["wallet_address"] == "wallet-mpc"
    assert response.json()["usdc_balance"] == 12
    db.commit.assert_awaited_once()


def test_wallet_mpc_balance_and_fund_validate_and_return_service_results(monkeypatch, client_app):
    _, client, _ = client_app
    balance_call = AsyncMock(return_value={"wallet_address": "wallet-mpc", "usdc_balance": 5})
    fund_call = AsyncMock(return_value={"success": True, "tx_signature": "simulated-tx"})
    monkeypatch.setattr(wallet_mpc.wallet_service, "get_wallet_balance", balance_call)
    monkeypatch.setattr(wallet_mpc.wallet_service, "fund_mpc_wallet", fund_call)

    balance = client.post("/jaire/wallet/balance", json={"id_token": "test-token", "mint": "mint-1"})
    invalid_fund = client.post("/jaire/wallet/fund", json={"id_token": "test-token", "amount_usdc": 0})
    funded = client.post("/jaire/wallet/fund", json={"id_token": "test-token", "amount_usdc": 2.5})

    assert balance.status_code == 200
    assert balance.json()["usdc_balance"] == 5
    assert invalid_fund.status_code == 400
    assert funded.status_code == 200
    assert funded.json()["tx_signature"] == "simulated-tx"
    balance_call.assert_awaited_once_with("test-token", "mint-1")
    fund_call.assert_awaited_once_with(
        id_token="test-token",
        amount_usdc=2.5,
        is_simulated=True,
        mint_override=None,
    )