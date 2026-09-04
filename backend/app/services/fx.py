"""Foreign-exchange rates.

Every ledger row stores both its native amount and a base-currency amount priced
at the row's own date, so historical totals never drift when today's rate moves.
This module is the only place that decides what rate a row gets.

Rates come from Frankfurter (ECB reference rates, no API key). Anything we cannot
price falls back to 1.0 rather than failing the write — a row saved at par is a
visible, correctable mistake; a lost row is not.
"""

from __future__ import annotations

import logging
import time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import httpx
from supabase import Client

logger = logging.getLogger(__name__)

# ECB reference rates: authoritative and historical, but ~30 currencies only.
FRANKFURTER = "https://api.frankfurter.dev/v1"
# 166 currencies, latest only, no key. Covers the rest of the world.
OPEN_ERAPI = "https://open.er-api.com/v6/latest"

# Every rate is stored against this one currency, so cross-pairs triangulate
# through it. Keep it in step with the base used by refresh_rates.
PIVOT = "USD"

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

    rate = _direct(client, base, quote, on)
    if rate is None:
        # Rates are stored against a single pivot, so a cross-pair like NGN->CAD
        # has no row of its own and has to hop through USD.
        left = _direct(client, base, PIVOT, on)
        right = _direct(client, PIVOT, quote, on)
        if left and right:
            rate = left * right
        else:
            # Par is a deliberate, visible fallback: a row saved at 1:1 is a
            # mistake the user can see and correct, whereas a failed write loses
            # the entry. But it is wrong, so say so loudly.
            logger.warning(
                "No FX rate for %s->%s on %s — falling back to 1:1. "
                "Run POST /api/fx/refresh; if it persists, this pair is not "
                "covered by either rate provider.",
                base, quote, on,
            )
            rate = Decimal(1)

    _cache[key] = (rate, time.time())
    return rate


def _direct(client: Client, base: str, quote: str, on: date) -> Decimal | None:
    """One hop: the stored pair, or the inverse of the opposite pair."""
    if base == quote:
        return Decimal(1)
    found = _lookup(client, base, quote, on)
    if found is not None:
        return found
    inverse = _lookup(client, quote, base, on)
    return (Decimal(1) / inverse) if inverse and inverse != 0 else None


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


async def _fetch_frankfurter(
    base: str, symbols: list[str], on: date
) -> tuple[date, dict[str, float]]:
    """ECB reference rates. Authoritative and historical, but only ~30 currencies."""
    async with httpx.AsyncClient(timeout=20) as http:
        response = await http.get(
            f"{FRANKFURTER}/{on.isoformat()}",
            params={"base": base, "symbols": ",".join(symbols)},
        )
        response.raise_for_status()
        payload = response.json()
    # Frankfurter answers with the nearest preceding business day.
    return date.fromisoformat(payload.get("date") or on.isoformat()), payload.get("rates") or {}


async def _fetch_open_erapi(base: str) -> tuple[date, dict[str, float]]:
    """166 currencies, latest only. This is what covers NGN, GHS, KES, XOF and
    the rest of the world the ECB list leaves out."""
    async with httpx.AsyncClient(timeout=20) as http:
        response = await http.get(f"{OPEN_ERAPI}/{base}")
        response.raise_for_status()
        payload = response.json()
    if payload.get("result") != "success":
        raise RuntimeError(payload.get("error-type") or "open.er-api returned no result")
    stamp = payload.get("time_last_update_unix")
    rate_date = (
        datetime.fromtimestamp(stamp, tz=timezone.utc).date() if stamp else date.today()
    )
    return rate_date, payload.get("rates") or {}


def _rows_for(base: str, rates: dict[str, float], codes: set[str], on: date) -> list[dict]:
    """Both directions, so get_rate hits on the first lookup for USD->NGN and NGN->USD."""
    rows: list[dict] = []
    for quote, value in rates.items():
        if quote not in codes or quote == base or not value:
            continue
        rows.append({
            "base": base, "quote": quote,
            "rate_date": on.isoformat(), "rate": str(value),
        })
        rows.append({
            "base": quote, "quote": base,
            "rate_date": on.isoformat(), "rate": str(1 / float(value)),
        })
    return rows


async def refresh_rates(service: Client, base: str = "USD", on: date | None = None) -> dict:
    """Upsert one day of rates for every currency we hold, from two sources.

    The ECB feed covers roughly 30 currencies — it leaves out almost all of
    Africa, the Gulf and South Asia, which for this app's users is most of the
    world. open.er-api fills that in. Where both quote a pair the ECB value wins,
    being the more authoritative reference and the only one with history.
    """
    on = on or date.today()
    codes = {
        row["code"]
        for row in (service.table("currencies").select("code").execute().data or [])
    }
    if not codes:
        return {"base": base, "rate_date": on, "pairs": 0, "covered": 0, "missing": []}

    wanted = sorted(c for c in codes if c != base)
    batches: list[list[dict]] = []
    covered: set[str] = set()

    # Broad, latest-only. Skipped when backfilling a past date, which it cannot serve.
    if on >= date.today():
        try:
            erapi_date, erapi_rates = await _fetch_open_erapi(base)
            batches.append(_rows_for(base, erapi_rates, codes, erapi_date))
            covered |= {c for c in erapi_rates if c in codes}
        except Exception as exc:  # noqa: BLE001 - one source failing is not fatal
            logger.warning("open.er-api refresh failed: %s", exc)

    # Narrow but authoritative, and the only source that can serve a past date.
    try:
        ecb_date, ecb_rates = await _fetch_frankfurter(base, wanted, on)
        batches.append(_rows_for(base, ecb_rates, codes, ecb_date))
        covered |= {c for c in ecb_rates if c in codes}
    except Exception as exc:  # noqa: BLE001
        logger.warning("Frankfurter refresh failed: %s", exc)

    if not batches:
        raise RuntimeError("No exchange-rate provider could be reached")

    pairs = 0
    for rows in batches:
        if not rows:
            continue
        service.table("fx_rates").upsert(rows, on_conflict="base,quote,rate_date").execute()
        pairs += len(rows)

    _cache.clear()

    missing = sorted(c for c in codes if c != base and c not in covered)
    if missing:
        logger.warning("No rate available for: %s", ", ".join(missing))

    return {
        "base": base,
        "rate_date": on,
        "pairs": pairs,
        "covered": len(covered),
        "missing": missing,
    }


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
