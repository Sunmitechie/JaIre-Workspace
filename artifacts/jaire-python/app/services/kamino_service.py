"""
Kamino Finance integration for JaIre.

On devnet: Simulates Kamino lending by tracking a configurable APY in the DB.
           No real Kamino transactions are sent (Kamino doesn't have a full
           devnet deployment). Yield is calculated and simulated.

On mainnet: The `deposit` and `withdraw` methods should call the Kamino
            Klend SDK (TypeScript) via the api-server or directly via
            Kamino's on-chain program instructions.

Kamino USDC Market (mainnet):
  Program: KLend2g3cZ87astpptFc4HcnKoGmJ7aSRrBDVH9tVSN
  USDC Reserve: BgxfHJDzm44T7XG68MYKx7YisTjZu73tVovyZSjJMpmw (approx)
"""

import logging
import os
from decimal import Decimal
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Simulated annual yield rate for devnet testing (5% APY)
SIMULATED_APY = float(os.getenv("KAMINO_SIMULATED_APY", "0.05"))

# Seconds in a year (365 days)
SECONDS_PER_YEAR = 365 * 24 * 3600

KAMINO_MAINNET_PROGRAM = "KLend2g3cZ87astpptFc4HcnKoGmJ7aSRrBDVH9tVSN"
KAMINO_USDC_MARKET = "BgxfHJDzm44T7XG68MYKx7YisTjZu73tVovyZSjJMpmw"


class KaminoPosition:
    """
    Tracks a Kamino lending position for a session.
    On devnet: purely in-memory/DB; simulates yield.
    On mainnet: references on-chain kToken balance.
    """

    def __init__(
        self,
        principal_usdc: Decimal,
        deposit_time: datetime,
        is_simulated: bool = True,
        on_chain_tx: str | None = None,
    ):
        self.principal_usdc = principal_usdc
        self.deposit_time = deposit_time
        self.is_simulated = is_simulated
        self.on_chain_tx = on_chain_tx

    def calculate_yield(self, withdraw_time: datetime | None = None) -> Decimal:
        """
        Calculate yield earned between deposit and withdraw time.
        Uses the simulated APY for devnet or real on-chain data for mainnet.
        """
        end_time = withdraw_time or datetime.now(timezone.utc)

        if self.deposit_time.tzinfo is None:
            deposit_aware = self.deposit_time.replace(tzinfo=timezone.utc)
        else:
            deposit_aware = self.deposit_time

        if end_time.tzinfo is None:
            end_time = end_time.replace(tzinfo=timezone.utc)

        duration_seconds = (end_time - deposit_aware).total_seconds()
        if duration_seconds <= 0:
            return Decimal("0")

        if self.is_simulated:
            yield_amount = float(self.principal_usdc) * SIMULATED_APY * (duration_seconds / SECONDS_PER_YEAR)
            return Decimal(str(round(yield_amount, 6)))

        return Decimal("0")

    def total_at_withdraw(self, withdraw_time: datetime | None = None) -> Decimal:
        return self.principal_usdc + self.calculate_yield(withdraw_time)


async def deposit_to_kamino(
    amount_usdc: Decimal,
    session_id: str,
    is_test_mode: bool = True,
) -> dict:
    """
    Deposit USDC into Kamino lending market.

    On devnet/test: Records the deposit time and returns a simulated position.
    On mainnet: Would call Kamino's deposit instruction via the treasury keypair.

    Returns: { position: KaminoPosition, tx: str | None, simulated: bool }
    """
    deposit_time = datetime.now(timezone.utc)

    if is_test_mode:
        logger.info(
            f"[Kamino] SIMULATED deposit: {amount_usdc} USDC for session {session_id} "
            f"at APY {SIMULATED_APY * 100:.1f}%"
        )
        position = KaminoPosition(
            principal_usdc=amount_usdc,
            deposit_time=deposit_time,
            is_simulated=True,
            on_chain_tx=None,
        )
        return {
            "position": position,
            "tx": None,
            "simulated": True,
            "apy": SIMULATED_APY,
            "deposit_time": deposit_time.isoformat(),
            "message": f"Simulated Kamino deposit: {amount_usdc} USDC @ {SIMULATED_APY * 100:.1f}% APY",
        }

    # ── Mainnet Kamino integration ─────────────────────────────────────────
    # TODO: Call Kamino Klend program to deposit USDC
    # Steps:
    #   1. Get Kamino USDC reserve account
    #   2. Build deposit instruction: supply_collateral_and_deposit_reserve_liquidity
    #   3. Sign with JaIre treasury keypair
    #   4. Submit transaction → get tx signature and kToken amount
    #   5. Return real KaminoPosition with on_chain_tx
    #
    # Reference:
    #   https://github.com/Kamino-Finance/klend-sdk
    #   Program: KLend2g3cZ87astpptFc4HcnKoGmJ7aSRrBDVH9tVSN
    logger.warning("[Kamino] Mainnet Kamino deposit not yet implemented — falling back to simulation")
    position = KaminoPosition(
        principal_usdc=amount_usdc,
        deposit_time=deposit_time,
        is_simulated=True,
    )
    return {
        "position": position,
        "tx": None,
        "simulated": True,
        "apy": SIMULATED_APY,
        "deposit_time": deposit_time.isoformat(),
        "message": "Kamino mainnet deposit pending implementation",
    }


async def withdraw_from_kamino(
    position: KaminoPosition,
    session_id: str,
    is_test_mode: bool = True,
) -> dict:
    """
    Withdraw USDC + yield from Kamino.

    Returns: { principal: Decimal, yield: Decimal, total: Decimal, tx: str | None }
    """
    withdraw_time = datetime.now(timezone.utc)
    yield_earned = position.calculate_yield(withdraw_time)
    total = position.principal_usdc + yield_earned

    if is_test_mode or position.is_simulated:
        logger.info(
            f"[Kamino] SIMULATED withdrawal for session {session_id}: "
            f"principal={position.principal_usdc} USDC, "
            f"yield={yield_earned} USDC, total={total} USDC"
        )
        return {
            "principal": position.principal_usdc,
            "yield_earned": yield_earned,
            "total": total,
            "tx": None,
            "simulated": True,
            "withdraw_time": withdraw_time.isoformat(),
        }

    # ── Mainnet Kamino withdrawal ──────────────────────────────────────────
    # TODO: Redeem kTokens from Kamino
    # Steps:
    #   1. Get kToken balance from on-chain
    #   2. Build redeem instruction: redeem_reserve_collateral
    #   3. Sign with JaIre treasury keypair
    #   4. Submit transaction → get actual USDC received
    logger.warning("[Kamino] Mainnet Kamino withdrawal not yet implemented")
    return {
        "principal": position.principal_usdc,
        "yield_earned": yield_earned,
        "total": total,
        "tx": None,
        "simulated": True,
    }


def reconstruct_position(
    principal_usdc: Decimal,
    check_in_time: datetime,
    is_simulated: bool = True,
) -> KaminoPosition:
    """Reconstruct a KaminoPosition from DB data (after server restart)."""
    return KaminoPosition(
        principal_usdc=principal_usdc,
        deposit_time=check_in_time,
        is_simulated=is_simulated,
    )


def estimate_yield(principal_usdc: Decimal, duration_seconds: float) -> Decimal:
    """Quick yield estimate without a full KaminoPosition object."""
    if duration_seconds <= 0:
        return Decimal("0")
    yield_amount = float(principal_usdc) * SIMULATED_APY * (duration_seconds / SECONDS_PER_YEAR)
    return Decimal(str(round(yield_amount, 6)))
