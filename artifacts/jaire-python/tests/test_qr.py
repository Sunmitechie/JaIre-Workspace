import uuid
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import sessions


@pytest.fixture
def client_app():
    app = FastAPI()
    app.include_router(sessions.router)
    with TestClient(app) as client:
        yield client


def test_check_in_route_success(monkeypatch, client_app):
    client = client_app

    fake_session = SimpleNamespace(
        id=uuid.uuid4(),
        status="active",
        workspace_name="North Desk",
        workspace_id="ws-001",
        check_in_time=__import__("datetime").datetime.utcnow(),
        planned_hours=2.0,
        hourly_rate_usdc=12.0,
        original_amount_usdc=24.0,
        is_kamino_active=True,
        is_test_mode=True,
        escrow_tx="simulated_tx_123",
    )

    mock_check_in = pytest.importorskip("unittest.mock").AsyncMock(return_value=fake_session)
    monkeypatch.setattr(sessions.session_service, "check_in", mock_check_in)

    response = client.post(
        "/jaire/session/check-in",
        json={
            "user_identifier": "user@example.com",
            "workspace_id": "ws-001",
            "planned_hours": 2.0,
            "is_test_mode": True,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "active"
    assert payload["workspace_name"] == "North Desk"
    assert payload["workspace_id"] == "ws-001"
    assert payload["escrow_tx"] == "simulated_tx_123"
    mock_check_in.assert_awaited_once()


def test_check_in_route_rejects_invalid_payload(client_app):
    client = client_app

    response = client.post(
        "/jaire/session/check-in",
        json={
            "workspace_id": "ws-001",
            "planned_hours": 2.0,
        },
    )

    assert response.status_code == 422
    assert "user_identifier" in response.text


def test_session_status_returns_live_status(monkeypatch, client_app):
    client = client_app

    session_row = SimpleNamespace(
        id=uuid.uuid4(),
        status="active",
        workspace_name="North Desk",
        workspace_id="ws-001",
        check_in_time=__import__("datetime").datetime.utcnow(),
        planned_hours=2.0,
        hourly_rate_usdc=12.0,
        original_amount_usdc=24.0,
        is_kamino_active=True,
        is_test_mode=True,
        escrow_tx="simulated_tx_123",
    )

    fake_db = SimpleNamespace()
    fake_db.execute = pytest.importorskip("unittest.mock").AsyncMock(
        return_value=SimpleNamespace(scalar_one_or_none=lambda: session_row)
    )
    app = client.app
    app.dependency_overrides[sessions.get_db] = lambda: fake_db

    monkeypatch.setattr(
        sessions.session_service,
        "get_realtime_status",
        lambda session: {
            "session_id": str(session.id),
            "status": session.status,
            "workspace_name": session.workspace_name,
            "elapsed_seconds": 1800,
            "current_cost_usdc": 6.0,
        },
    )

    response = client.get(f"/jaire/session/{session_row.id}/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "active"
    assert payload["workspace_name"] == "North Desk"
    assert payload["elapsed_seconds"] == 1800
