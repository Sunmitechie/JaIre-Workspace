from pydantic import BaseModel
from typing import Optional


class PaystackCustomer(BaseModel):
    email: Optional[str] = None
    phone: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None


class PaystackData(BaseModel):
    reference: str
    amount: int
    currency: str = "NGN"
    customer: PaystackCustomer
    status: str


class PaystackWebhook(BaseModel):
    event: str
    data: PaystackData


class RoqquWebhook(BaseModel):
    event: str
    reference: str
    amount: float
    currency: str = "NGN"
    email: Optional[str] = None
    phone: Optional[str] = None
    status: str


class TestPaymentRequest(BaseModel):
    user_identifier: str
    amount_ngn: float
    user_name: Optional[str] = None


class WalletCreateRequest(BaseModel):
    user_identifier: str
    user_name: Optional[str] = None


class WalletResponse(BaseModel):
    pubkey: str
    network: str
    user_id: str


class ExplorerLinks(BaseModel):
    solana_explorer: str
    solscan: str
    solana_fm: str


class PaymentStatusResponse(BaseModel):
    payment_id: str
    status: str
    amount_ngn: float
    amount_usdc: float
    exchange_rate: float = 1600.0
    tx_signature: Optional[str] = None
    is_test_mode: bool
    explorer_links: Optional[ExplorerLinks] = None
    wallet_address: Optional[str] = None
    user_id: Optional[str] = None
    network: str = "devnet"
