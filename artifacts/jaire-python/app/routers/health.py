from fastapi import APIRouter
from datetime import datetime, timezone

from app.config import settings

router = APIRouter(tags=["health"])


@router.get("/jaire/health")
async def health():
    return {
        "status": "ok",
        "service": "jaire-python-api",
        "version": "0.1.0",
        "network": settings.solana_network,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
