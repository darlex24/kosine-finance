"""Foreign-exchange rates.

Every ledger row stores both its native amount and a base-currency amount priced
at the row's own date, so historical totals never drift when today's rate moves.
This module is the only place that decides what rate a row gets.

Rates come from Frankfurter (ECB reference rates, no API key). Anything we cannot
price falls back to 1.0 rather than failing the write — a row saved at par is a
visible, correctable mistake; a lost row is not.
"""

from __future__ import annotations

import time
from datetime import date, timedelta
from decimal import Decimal

import httpx
from supabase import Client

FRANKFURTER = "https://api.frankfurter.dev/v1"

# Today's rate can still be published later in the day, so it is only held
# briefly. A past date's rate is settled and cached for the process lifetime.
TODAY_TTL_SECONDS = 15 * 60

# (base, quote, iso_date) -> (rate, cached_at)
_cache: dict[tuple[str, str, str], tuple[Decimal, float]] = {}


def _key(base: str, quote: str, on: date) -> tuple[str, str, str]:
    return (base.upper(), quote.upper(), on.isoformat())


def _cached(key: tuple[str, str, str], on: date) -> Decimal | None:
    hit = _cache.get(key)
    if hit is None:
        return None
    rate, cached_at = hit
    if on >= date.today() and time.time() - cached_at > TODAY_TTL_SECONDS:
        _cache.pop(key, None)
        return None
    return rate


def get_rate(client: Client, base: str, quote: str, on: date) -> Decimal:
    """Rate to multiply a `base` amount by to get `quote`, as of `on`.

    Reads the stored `fx_rates` table (newest row on or before the date, then the
    inverse pair). Never raises — returns 1 when the pair is unknown.
    """
    base, quote = base.upper(), quote.upper()
    if base == quote:
        return Decimal(1)

    key = _key(base, quote, on)
    cached = _cached(key, on)
    if cached is not None:
        return cached

    rate = _lookup(client, base, quote, on)
    if rate is None:
        inverse = _lookup(client, quote, base, on)
        rate = (Decimal(1) / inverse) if inverse and inverse != 0 else Decimal(1)

    _cache[key] = (rate, time.time())
    return rate


def _lookup(client: Client, base: str, quote: str, on: date) -> Decimal | None:
    try:
        rows = (
            client.table("fx_rates")
            .select("rate")
            .eq("base", base)
            .eq("quote", quote)
            .lte("rate_date", on.isoformat())
            .order("rate_date", desc=True)
            .limit(1)
            .execute()
            .data
            or []
        )
        if not rows:
            # No history on or before the date — accept the earliest we hold.
            rows = (
                client.table("fx_rates")
                .select("rate")
                .eq("base", base)
                .eq("quote", quote)
                .order("rate_date")
                .limit(1)
                .execute()
                .data
                or []
            )
        return Decimal(str(rows[0]["rate"])) if rows else None
    except Exception:  # noqa: BLE001 - pricing must never break a write
        return None


def convert(client: Client, amount: Decimal, base: str, quote: str, on: date):
    """Returns (converted_amount, rate_used), rounded to 2 dp."""
    rate = get_rate(client, base, quote, on)
    return (amount * rate).quantize(Decimal("0.01")), rate


async def refresh_rates(service: Client, base: str = "USD", on: date | None = None) -> dict:
    """Pull one day of rates for `base` and upsert every pair we hold a currency for.

    Also writes the inverse direction so `get_rate` hits on the first lookup for
    both `USD->NGN` and `NGN->USD`.
    """
    on = on or date.today()
    codes = [
        row["code"]
        for row in (service.table("currencies").select("code").execute().data or [])
    ]
    if not codes:
        return {"base": base, "rate_date": on, "pairs": 0}

    symbols = ",".join(c for c in codes if c != base)
    async with httpx.AsyncClient(timeout=20) as http:
        response = await http.get(f"{FRANKFURTER}/{on.isoformat()}", params={
            "base": base, "symbols": symbols
        })
        response.raise_for_status()
        payload = response.json()

    # Frankfurter answers with the nearest preceding business day.
    rate_date = date.fromisoformat(payload.get("date") or on.isoformat())
    rates: dict[str, float] = payload.get("rates") or {}

    rows = []
    for quote, value in rates.items():
        if not value:
            continue
        rows.append({
            "base": base, "quote": quote,
            "rate_date": rate_date.isoformat(), "rate": str(value),
        })
        rows.append({
            "base": quote, "quote": base,
            "rate_date": rate_date.isoformat(), "rate": str(1 / float(value)),
        })

    if rows:
        service.table("fx_rates").upsert(rows, on_conflict="base,quote,rate_date").execute()
    _cache.clear()

    return {"base": base, "rate_date": rate_date, "pairs": len(rows)}


def latest_rate_date(client: Client) -> date | None:
    rows = (
        client.table("fx_rates")
        .select("rate_date")
        .order("rate_date", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    return date.fromisoformat(rows[0]["rate_date"]) if rows else None


def is_stale(client: Client, max_age_days: int = 4) -> bool:
    seen = latest_rate_date(client)
    return seen is None or seen < date.today() - timedelta(days=max_age_days)
