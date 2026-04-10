"""
Price Oracle Service
====================
Fetches the live exchange rate between any fiat currency and USDC.

Strategy (cascading fallbacks):
  1. ExchangeRate.host free API (no key needed, 1500 req/month)
  2. CoinGecko public API (simple price endpoint)
  3. Hardcoded conservative fallback per currency (last resort)

The oracle caches the last successful rate for 60 seconds to avoid
hammering external APIs on every payment.
"""
import logging
import time
from typing import Optional
import httpx

logger = logging.getLogger(__name__)

# --- Fallback rates (last resort, deliberately conservative) ---------------
FALLBACK_RATES: dict[str, float] = {
    "NGN": 1600.0,   # ₦ per 1 USDC
    "GHS": 16.0,     # ₵ per 1 USDC (Ghana Cedi)
    "KES": 130.0,    # Ksh per 1 USDC (Kenya Shilling)
    "ZAR": 19.0,     # R per 1 USDC (South African Rand)
    "USD": 1.0,
    "EUR": 0.93,
    "GBP": 0.79,
    "default": 1600.0,
}

# Cache: { currency_code -> (rate, timestamp) }
_rate_cache: dict[str, tuple[float, float]] = {}
CACHE_TTL = 60  # seconds


async def get_usdc_rate(currency: str = "NGN") -> dict:
    """
    Returns how many units of `currency` equal 1 USDC.
    E.g. for NGN → {"rate": 1550.0, "currency": "NGN", "source": "exchangerate-host"}

    Raises: never — always returns a value (uses fallback on failure).
    """
    currency = currency.upper()

    # Check cache first
    if currency in _rate_cache:
        rate, ts = _rate_cache[currency]
        if time.time() - ts < CACHE_TTL:
            return {"rate": rate, "currency": currency, "source": "cache"}

    rate: Optional[float] = None
    source = "fallback"

    # --- Strategy 1: ExchangeRate.host (USDC/USD are pegged, so get fiat/USD rate) ---
    try:
        if currency == "USD":
            rate = 1.0
            source = "peg"
        else:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(
                    "https://open.er-api.com/v6/latest/USD",
                )
                if r.status_code == 200:
                    data = r.json()
                    rates = data.get("rates", {})
                    if currency in rates:
                        rate = float(rates[currency])
                        source = "open.er-api.com"
    except Exception as e:
        logger.warning(f"Oracle strategy 1 failed for {currency}: {e}")

    # --- Strategy 2: CoinGecko — get USDC price in USD, then cross with fiat ---
    if rate is None:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                # Get USDC price in the target currency
                vs = currency.lower()
                r = await client.get(
                    f"https://api.coingecko.com/api/v3/simple/price",
                    params={"ids": "usd-coin", "vs_currencies": vs},
                )
                if r.status_code == 200:
                    data = r.json()
                    price_in_currency = data.get("usd-coin", {}).get(vs)
                    if price_in_currency and price_in_currency > 0:
                        # CoinGecko returns "1 USDC = X currency"
                        rate = float(price_in_currency)
                        source = "coingecko"
        except Exception as e:
            logger.warning(f"Oracle strategy 2 (CoinGecko) failed for {currency}: {e}")

    # --- Fallback ---
    if rate is None:
        rate = FALLBACK_RATES.get(currency, FALLBACK_RATES["default"])
        source = "fallback"
        logger.warning(f"Oracle using hardcoded fallback rate for {currency}: {rate}")

    # Cache successful result
    _rate_cache[currency] = (rate, time.time())

    logger.info(f"Oracle rate [{source}]: 1 USDC = {rate} {currency}")
    return {"rate": rate, "currency": currency, "source": source}


async def convert_to_usdc(amount: float, currency: str = "NGN") -> dict:
    """
    Convert a fiat amount to USDC using the live oracle rate.

    Returns:
      {
        "amount_usdc": float,
        "amount_fiat": float,
        "currency": str,
        "rate": float,       # how many fiat units = 1 USDC
        "source": str
      }
    """
    oracle = await get_usdc_rate(currency)
    rate = oracle["rate"]
    amount_usdc = round(amount / rate, 6)
    return {
        "amount_usdc": amount_usdc,
        "amount_fiat": amount,
        "currency": currency,
        "rate": rate,
        "source": oracle["source"],
    }
