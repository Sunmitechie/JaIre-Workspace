"""
Hub Vault Service
=================
Manages Hub Owner USDC balances and the fiat liquidity buffer withdrawal system.

Flow:
  1. When a session ends (85/15 split), 85% USDC is credited to the hub owner's vault.
  2. Owner clicks "Withdraw to Bank" → JaIre instantly sends NGN (or local currency)
     via Paystack Transfer / Stripe Payout from JaIre's own fiat liquidity.
  3. The USDC in the Hub Vault is then swept back to JaIre's central liquidity pool
     (JAIRE_VAULT_ADDRESS) to replenish the fiat that was paid out.

This is the "Liquidity Buffer" model: no crypto exposure for the Hub Owner.
"""
import logging
import os
from decimal import Decimal
from typing import Optional

import httpx
import stripe

from app.config import settings
from app.services.oracle_service import get_usdc_rate

logger = logging.getLogger(__name__)

stripe.api_key = settings.stripe_secret_key


# ── Paystack Transfer ──────────────────────────────────────────────────────

async def paystack_send_bank_transfer(
    amount_ngn: float,
    recipient_code: str,
    reason: str = "JaIre Hub Withdrawal",
) -> dict:
    """
    Initiate a Paystack transfer to a hub owner's bank account.
    `recipient_code` is obtained from Paystack's Create Transfer Recipient API.
    Returns the Paystack transfer object or raises on failure.
    """
    headers = {
        "Authorization": f"Bearer {settings.paystack_secret_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "source": "balance",
        "amount": int(amount_ngn * 100),  # Paystack uses kobo
        "recipient": recipient_code,
        "reason": reason,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            "https://api.paystack.co/transfer",
            headers=headers,
            json=payload,
        )
    data = r.json()
    if not data.get("status"):
        raise RuntimeError(f"Paystack transfer failed: {data.get('message')}")
    logger.info(f"Paystack transfer initiated: {data['data']['transfer_code']}")
    return data["data"]


async def paystack_create_recipient(
    name: str,
    account_number: str,
    bank_code: str,
    currency: str = "NGN",
) -> str:
    """
    Creates a Paystack transfer recipient. Returns the recipient_code.
    """
    headers = {
        "Authorization": f"Bearer {settings.paystack_secret_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "type": "nuban",
        "name": name,
        "account_number": account_number,
        "bank_code": bank_code,
        "currency": currency,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            "https://api.paystack.co/transferrecipient",
            headers=headers,
            json=payload,
        )
    data = r.json()
    if not data.get("status"):
        raise RuntimeError(f"Paystack recipient creation failed: {data.get('message')}")
    return data["data"]["recipient_code"]


# ── Stripe Payout ──────────────────────────────────────────────────────────

def stripe_send_payout(
    amount_usd_cents: int,
    destination: str,
    currency: str = "usd",
    description: str = "JaIre Hub Withdrawal",
) -> dict:
    """
    Send a Stripe payout to a connected bank account.
    `destination` is the Stripe bank account or external account ID.
    """
    try:
        payout = stripe.Payout.create(
            amount=amount_usd_cents,
            currency=currency,
            description=description,
            destination=destination,
        )
        logger.info(f"Stripe payout created: {payout['id']}")
        return dict(payout)
    except stripe.StripeError as e:
        raise RuntimeError(f"Stripe payout failed: {e.user_message}")


# ── Withdrawal Orchestration ───────────────────────────────────────────────

async def process_hub_withdrawal(
    hub_owner_id: str,
    amount_usdc: float,
    payout_currency: str,
    payout_provider: str,
    payout_destination: str,
    payout_name: str = "Hub Owner",
) -> dict:
    """
    Master withdrawal orchestrator:

    1. Convert USDC → local currency at live oracle rate
    2. Send fiat via Paystack or Stripe from JaIre's liquidity
    3. Return sweep info for the caller to handle USDC replenishment

    Returns a result dict with payout details and sweep_amount_usdc.
    """
    # Step 1: Live oracle conversion
    oracle = await get_usdc_rate(payout_currency)
    rate = oracle["rate"]
    fiat_amount = round(amount_usdc * rate, 2)

    logger.info(
        f"Withdrawal: {amount_usdc} USDC → {fiat_amount} {payout_currency} "
        f"@ {rate} {payout_currency}/USDC (source: {oracle['source']})"
    )

    # Step 2: Send fiat payout
    payout_result = {}
    if payout_provider == "paystack":
        # payout_destination = paystack recipient_code OR "acct_XXXX:bankcode" for new recipients
        if payout_destination.startswith("RCP_"):
            recipient_code = payout_destination
        else:
            # Create recipient on the fly if bank details provided
            parts = payout_destination.split(":")
            if len(parts) == 2:
                account_number, bank_code = parts
                recipient_code = await paystack_create_recipient(
                    name=payout_name,
                    account_number=account_number,
                    bank_code=bank_code,
                    currency=payout_currency,
                )
            else:
                raise ValueError("Invalid Paystack destination. Use 'RCP_xxx' or 'account_number:bank_code'")

        payout_result = await paystack_send_bank_transfer(
            amount_ngn=fiat_amount,
            recipient_code=recipient_code,
            reason=f"JaIre Hub earnings — {amount_usdc:.4f} USDC",
        )

    elif payout_provider == "stripe":
        # payout_destination = Stripe bank account ID
        usd_equivalent = round(amount_usdc * 100)  # 1 USDC ≈ 1 USD
        payout_result = stripe_send_payout(
            amount_usd_cents=usd_equivalent,
            destination=payout_destination,
            currency="usd",
            description=f"JaIre Hub earnings — {amount_usdc:.4f} USDC",
        )

    else:
        raise ValueError(f"Unknown payout provider: {payout_provider}")

    return {
        "hub_owner_id": hub_owner_id,
        "amount_usdc": amount_usdc,
        "fiat_amount": fiat_amount,
        "fiat_currency": payout_currency,
        "oracle_rate": rate,
        "oracle_source": oracle["source"],
        "payout_provider": payout_provider,
        "payout_result": payout_result,
        "sweep_amount_usdc": amount_usdc,  # Amount to sweep back to JaIre vault
        "jaire_vault": settings.jaire_vault_address,
        "status": "payout_initiated",
    }
