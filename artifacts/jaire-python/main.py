import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from sqlalchemy import text

from app.config import settings
from app.database import engine, Base
from app.routers import health, webhooks, wallet, devnet, sessions, wallet_mpc

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting JaIre Python API...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Safe column migrations for jaire_wallets (v2 MPC fields)
        for col_sql in [
            "ALTER TABLE jaire_wallets ADD COLUMN IF NOT EXISTS verifier_id VARCHAR(255)",
            "ALTER TABLE jaire_wallets ADD COLUMN IF NOT EXISTS wallet_type VARCHAR(20) DEFAULT 'mpc'",
        ]:
            try:
                await conn.execute(text(col_sql))
            except Exception:
                pass
    logger.info("Database tables ready.")
    logger.info(f"Solana network: {settings.solana_network}")
    logger.info(f"Test mode: {settings.test_mode_enabled}")
    yield
    logger.info("Shutting down JaIre Python API.")
    await engine.dispose()


app = FastAPI(
    title="JaIre Python API",
    description="JaIre Vault Opener — Fiat-to-Solana Bridge",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/jaire/docs",
    openapi_url="/jaire/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(webhooks.router)
app.include_router(wallet.router)
app.include_router(devnet.router)
app.include_router(sessions.router)
app.include_router(wallet_mpc.router)
