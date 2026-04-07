import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Boolean, Numeric, ForeignKey, Text
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
