from datetime import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, Field


class CheckInRequest(BaseModel):
    user_identifier: str = Field(..., description="User email or phone number")
    workspace_id: str = Field(..., description="Workspace ID (e.g. ws-003)")
    planned_hours: float = Field(..., ge=1, le=24, description="Planned booking duration in hours")
    is_test_mode: bool = Field(default=True, description="Use simulated Kamino (devnet)")
    mint_override: Optional[str] = Field(default=None, description="Override USDC mint (devnet testing)")


class CheckOutRequest(BaseModel):
    session_id: UUID = Field(..., description="Session ID from check-in response")


class RealtimeStatus(BaseModel):
    session_id: UUID
    status: str
    workspace_name: str
    check_in_time: datetime
    elapsed_seconds: int
    elapsed_hms: str
    current_cost_usdc: Decimal
    current_cost_ngn: Decimal
    original_amount_usdc: Decimal
    estimated_yield_usdc: Decimal
    planned_hours: Decimal
    hourly_rate_usdc: Decimal
    is_kamino_active: bool


class SettlementResult(BaseModel):
    session_id: UUID
    status: str
    actual_seconds: int
    actual_duration_hms: str

    original_amount_usdc: Decimal
    time_cost_usdc: Decimal
    kamino_yield_usdc: Decimal

    host_payment_usdc: Decimal
    treasury_payment_usdc: Decimal
    user_refund_usdc: Decimal

    escrow_tx: Optional[str]
    host_payment_tx: Optional[str]
    user_refund_tx: Optional[str]
    kamino_withdraw_tx: Optional[str]

    is_simulated: bool
    settlement_breakdown: dict
