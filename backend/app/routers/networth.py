"""The Stewardship Dashboard's engine.

The arithmetic lives in `v_net_worth` (0004) so it is computed once, in the
database, in the user's base currency, with every foreign holding converted at
its own as-of date. These handlers read the view and add history.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status

from ..deps import CurrentUser, get_current_user
from ..schemas import (
    AnnualSummary,
    CashFlowPoint,
    CategorySpend,
    NetWorthOut,
    NetWorthPoint,
)

router = APIRouter()


def _rows(response):
    return response.data or []


def _current(user: CurrentUser) -> dict:
    rows = _rows(
        user.client.table("v_net_worth").select("*").eq("user_id", user.id).execute()
    )
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    return rows[0]


@router.get("/networth", response_model=NetWorthOut)
def get_net_worth(trend_days: int = 365, user: CurrentUser = Depends(get_current_user)):
    live = _current(user)
    history = _rows(
        user.client.table("net_worth_snapshots")
        .select("captured_on, net_worth")
        .order("captured_on", desc=True)
        .limit(180)
        .execute()
    )
    history.reverse()

    previous = Decimal(str(history[-1]["net_worth"])) if history else None
    current = Decimal(str(live["net_worth"]))
    change = (current - previous) if previous is not None else None
    change_pct = (
        float(change / abs(previous) * 100)
        if change is not None and previous not in (None, 0)
        else None
    )

    return NetWorthOut(
        base_currency=live["base_currency"],
        total_assets=live["total_assets"],
        total_liabilities=live["total_liabilities"],
        net_worth=current,
        liquid_cash=live["liquid_cash"],
        investable_assets=live["investable_assets"],
        previous_net_worth=previous,
        change_amount=change,
        change_pct=change_pct,
        trend=[NetWorthPoint(**point) for point in history],
    )


@router.post("/networth/snapshot", response_model=NetWorthPoint, status_code=201)
def capture_snapshot(user: CurrentUser = Depends(get_current_user)):
    """Freeze today's position. One row per day — calling twice just updates it."""
    live = _current(user)
    body = {
        "user_id": user.id,
        "captured_on": date.today().isoformat(),
        "base_currency": live["base_currency"],
        "total_assets": str(live["total_assets"]),
        "total_liabilities": str(live["total_liabilities"]),
        "net_worth": str(live["net_worth"]),
    }
    rows = _rows(
        user.client.table("net_worth_snapshots")
        .upsert(body, on_conflict="user_id,captured_on")
        .execute()
    )
    return NetWorthPoint(
        captured_on=rows[0]["captured_on"] if rows else date.today(),
        net_worth=live["net_worth"],
    )


@router.get("/cashflow", response_model=list[CashFlowPoint])
def get_cash_flow(year: int | None = None, user: CurrentUser = Depends(get_current_user)):
    """Monthly totals by entry type. Giving is its own band, not buried in expenses."""
    query = user.client.table("v_cash_flow_monthly").select(
        "year, month, entry_type, total"
    )
    if year:
        query = query.eq("year", year)
    return _rows(query.order("year").order("month").execute())


@router.get("/spend-by-category", response_model=list[CategorySpend])
def get_category_spend(year: int | None = None, user: CurrentUser = Depends(get_current_user)):
    query = user.client.table("v_category_spend").select(
        "category_group, category_name, total"
    )
    if year:
        query = query.eq("year", year)
    return _rows(query.order("total", desc=True).limit(50).execute())


@router.get("/years", response_model=list[int])
def list_years(user: CurrentUser = Depends(get_current_user)):
    """Every year the user actually has entries for, newest first.

    Drives the year picker, so it only ever offers years with something in them
    — plus the current year, which is always selectable even when empty.
    """
    rows = _rows(user.client.table("v_cash_flow_monthly").select("year").execute())
    years = {int(row["year"]) for row in rows}
    years.add(date.today().year)
    return sorted(years, reverse=True)


@router.get("/annual-summary", response_model=list[AnnualSummary])
def get_annual_summary(user: CurrentUser = Depends(get_current_user)):
    """The yearly record: one line per year, newest first.

    Built from the same monthly view the dashboard chart uses, so a year's
    figures always reflect the ledger as it stands — correct an old row and its
    year moves with it.
    """
    rows = _rows(
        user.client.table("v_cash_flow_monthly")
        .select("year, entry_type, total, base_currency")
        .execute()
    )

    buckets: dict[int, dict[str, Decimal]] = {}
    currency = None
    for row in rows:
        year = int(row["year"])
        currency = currency or row.get("base_currency")
        bucket = buckets.setdefault(year, {})
        key = row["entry_type"]
        bucket[key] = bucket.get(key, Decimal("0")) + Decimal(str(row["total"] or 0))

    summaries = []
    for year in sorted(buckets, reverse=True):
        bucket = buckets[year]
        income = bucket.get("income", Decimal("0"))
        expenses = bucket.get("expense", Decimal("0"))
        giving = bucket.get("giving", Decimal("0"))
        saved = bucket.get("savings", Decimal("0")) + bucket.get("investment", Decimal("0"))
        summaries.append(
            AnnualSummary(
                year=year,
                base_currency=currency or "CAD",
                income=income,
                expenses=expenses,
                giving=giving,
                saved=saved,
                # Transfers move money between the user's own pots, so they are
                # deliberately left out of the net figure.
                net=income - expenses - giving - saved,
                giving_rate=float(giving / income * 100) if income else None,
                savings_rate=float(saved / income * 100) if income else None,
            )
        )
    return summaries
