import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Boolean, Numeric, ForeignKey, Text, Integer, BigInteger
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base


class JaireUser(Base):
    __tablename__ = "jaire_users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=True, index=True)
    phone = Column(String(30), unique=True, nullable=True, index=True)
    name = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    wallets = relationship("JaireWallet", back_populates="user", lazy="select")
    payments = relationship("JairePayment", back_populates="user", lazy="select")


class JaireWallet(Base):
    __tablename__ = "jaire_wallets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("jaire_users.id"), nullable=False, index=True)
    pubkey = Column(String(44), nullable=False, unique=True)
    encrypted_secret = Column(Text, nullable=True)
    network = Column(String(20), nullable=False, default="devnet")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("JaireUser", back_populates="wallets")


class JairePayment(Base):
    __tablename__ = "jaire_payments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("jaire_users.id"), nullable=True, index=True)
    amount_ngn = Column(Numeric(18, 2), nullable=False)
    amount_usdc = Column(Numeric(18, 6), nullable=False)
    exchange_rate = Column(Numeric(18, 6), nullable=True)
    tx_signature = Column(String(128), nullable=True)
    status = Column(String(20), default="pending", index=True)
    payment_reference = Column(String(255), unique=True, nullable=True)
    is_test_mode = Column(Boolean, default=False)
    provider = Column(String(20), default="paystack")
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("JaireUser", back_populates="payments")


class JaireSession(Base):
    """
    A coworking session — from check-in to check-out.
    USDC is held in the JaIre treasury (escrow keeper) and deposited into
    Kamino Finance while the session is active. On check-out, the time cost
    is split 85/15 (host/treasury); any remainder refunds to the user;
    Kamino yield stays entirely in the treasury.
    """
    __tablename__ = "jaire_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("jaire_users.id"), nullable=False, index=True)

    workspace_id = Column(String(20), nullable=False)
    workspace_name = Column(String(100), nullable=False)
    hourly_rate_usdc = Column(Numeric(18, 6), nullable=False)
    planned_hours = Column(Numeric(6, 4), nullable=False)

    original_amount_usdc = Column(Numeric(18, 6), nullable=False)

    check_in_time = Column(DateTime, nullable=False, default=datetime.utcnow)
    check_out_time = Column(DateTime, nullable=True)
    actual_seconds = Column(BigInteger, nullable=True)

    time_cost_usdc = Column(Numeric(18, 6), nullable=True)
    host_payment_usdc = Column(Numeric(18, 6), nullable=True)
    treasury_payment_usdc = Column(Numeric(18, 6), nullable=True)
    user_refund_usdc = Column(Numeric(18, 6), nullable=True)
    kamino_yield_usdc = Column(Numeric(18, 6), nullable=True)

    escrow_tx = Column(String(128), nullable=True)
    kamino_deposit_tx = Column(String(128), nullable=True)
    kamino_withdraw_tx = Column(String(128), nullable=True)
    host_payment_tx = Column(String(128), nullable=True)
    user_refund_tx = Column(String(128), nullable=True)

    is_kamino_active = Column(Boolean, default=False)
    is_test_mode = Column(Boolean, default=False)
    status = Column(String(20), default="active", index=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("JaireUser")
