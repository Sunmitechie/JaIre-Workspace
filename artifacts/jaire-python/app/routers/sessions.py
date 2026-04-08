"""
Session API — workspace check-in / check-out with escrow + Kamino.

POST /jaire/session/check-in          — lock USDC, deposit to Kamino
GET  /jaire/session/{id}/status       — real-time elapsed + cost (live ticking)
POST /jaire/session/{id}/check-out    — settle: split, refund, harvest yield
GET  /jaire/session/{id}              — full session record
GET  /jaire/sessions/{identifier}     — all sessions for a user
"""

import logging
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.database import get_db
from app.models import JaireSession, JaireUser
from app.services import session_service
from app.schemas.session import CheckInRequest, CheckOutRequest

router = APIRouter(tags=["sessions"])
logger = logging.getLogger(__name__)


@router.post("/jaire/session/check-in")
async def check_in(
    body: CheckInRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Check a user into a workspace.
    Locks USDC in escrow (treasury holds it) and simulates Kamino deposit.
    Returns the session ID and check-in details.
    """
    try:
        session = await session_service.check_in(
            db=db,
            user_identifier=body.user_identifier,
            workspace_id=body.workspace_id,
            planned_hours=body.planned_hours,
            is_test_mode=body.is_test_mode,
            mint_override=body.mint_override,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.error(f"Check-in error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Check-in failed: {e}")

    return {
        "session_id": str(session.id),
        "status": session.status,
        "workspace_name": session.workspace_name,
        "workspace_id": session.workspace_id,
        "check_in_time": session.check_in_time.isoformat(),
        "planned_hours": float(session.planned_hours),
        "hourly_rate_usdc": float(session.hourly_rate_usdc),
        "original_amount_usdc": float(session.original_amount_usdc),
        "is_kamino_active": session.is_kamino_active,
        "is_test_mode": session.is_test_mode,
        "escrow_tx": session.escrow_tx,
        "message": (
            f"Checked in to {session.workspace_name}. "
            f"{float(session.original_amount_usdc):.4f} USDC locked in escrow via Kamino. "
            f"You'll be billed per second — unused time is refunded on check-out."
        ),
    }


@router.get("/jaire/session/{session_id}/status")
async def session_status(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Real-time session status — call this as frequently as every second.
    Returns live elapsed time and running cost.
    """
    stmt = select(JaireSession).where(JaireSession.id == session_id)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return session_service.get_realtime_status(session)


@router.post("/jaire/session/{session_id}/check-out")
async def check_out(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
    mint_override: str = Query(default=None),
):
    """
    Check out from a session. Settles the escrow:
    - Withdraws from Kamino (principal + yield)
    - Calculates actual time cost to the second
    - Splits 85%/15% (host/treasury)
    - Refunds unused portion to user wallet
    - Yield remains entirely in JaIre treasury
    """
    try:
        result = await session_service.check_out(
            db=db,
            session_id=str(session_id),
            mint_override=mint_override,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Check-out error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Check-out failed: {e}")

    return result


@router.get("/jaire/session/{session_id}")
async def get_session(
    session_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get full session record."""
    stmt = select(JaireSession).where(JaireSession.id == session_id)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "id": str(session.id),
        "status": session.status,
        "workspace_id": session.workspace_id,
        "workspace_name": session.workspace_name,
        "hourly_rate_usdc": float(session.hourly_rate_usdc),
        "planned_hours": float(session.planned_hours),
        "original_amount_usdc": float(session.original_amount_usdc),
        "check_in_time": session.check_in_time.isoformat(),
        "check_out_time": session.check_out_time.isoformat() if session.check_out_time else None,
        "actual_seconds": session.actual_seconds,
        "time_cost_usdc": float(session.time_cost_usdc) if session.time_cost_usdc is not None else None,
        "host_payment_usdc": float(session.host_payment_usdc) if session.host_payment_usdc is not None else None,
        "treasury_payment_usdc": float(session.treasury_payment_usdc) if session.treasury_payment_usdc is not None else None,
        "user_refund_usdc": float(session.user_refund_usdc) if session.user_refund_usdc is not None else None,
        "kamino_yield_usdc": float(session.kamino_yield_usdc) if session.kamino_yield_usdc is not None else None,
        "is_kamino_active": session.is_kamino_active,
        "is_test_mode": session.is_test_mode,
        "escrow_tx": session.escrow_tx,
        "kamino_deposit_tx": session.kamino_deposit_tx,
        "kamino_withdraw_tx": session.kamino_withdraw_tx,
        "host_payment_tx": session.host_payment_tx,
        "user_refund_tx": session.user_refund_tx,
        "created_at": session.created_at.isoformat(),
    }


@router.get("/jaire/sessions/user/{identifier}")
async def get_user_sessions(
    identifier: str,
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=10, le=50),
):
    """List sessions for a user (by email or phone)."""
    user_stmt = select(JaireUser).where(
        (JaireUser.email == identifier) | (JaireUser.phone == identifier)
    )
    user_result = await db.execute(user_stmt)
    user = user_result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    stmt = (
        select(JaireSession)
        .where(JaireSession.user_id == user.id)
        .order_by(desc(JaireSession.created_at))
        .limit(limit)
    )
    result = await db.execute(stmt)
    sessions = result.scalars().all()

    return [
        {
            "id": str(s.id),
            "status": s.status,
            "workspace_name": s.workspace_name,
            "check_in_time": s.check_in_time.isoformat(),
            "check_out_time": s.check_out_time.isoformat() if s.check_out_time else None,
            "original_amount_usdc": float(s.original_amount_usdc),
            "time_cost_usdc": float(s.time_cost_usdc) if s.time_cost_usdc is not None else None,
            "user_refund_usdc": float(s.user_refund_usdc) if s.user_refund_usdc is not None else None,
            "kamino_yield_usdc": float(s.kamino_yield_usdc) if s.kamino_yield_usdc is not None else None,
        }
        for s in sessions
    ]
