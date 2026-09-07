"""Envelope budgeting: planned per category, against what actually happened.

The legacy `/budgets` handlers in core.py stay where they are — they own
`monthly_budgets`, which still holds income and the top-level split, and the
frontend's existing calls keep working. This router owns the per-category layer
added in 0012 and the planned-vs-actual join that makes it useful.
"""

from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..deps import CurrentUser, get_current_user
from ..schemas import (
    BudgetAllocationsIn,
    BudgetLine,
    BudgetMonth,
    BudgetYear,
)
from .ledger import _base_currency

router = APIRouter()

# Rows with no category still have to appear, or spend goes missing from the
# totals without explanation.
UNCATEGORISED = "__uncategorised__"


def _rows(response):
    return response.data or []


@router.get("/budget", response_model=BudgetMonth)
def get_budget(
    year: int = Query(ge=2000, le=2100),
    month: int = Query(ge=1, le=12),
    user: CurrentUser = Depends(get_current_user),
):
    """A month's envelopes joined to actual spend, one line per category."""
    allocations = _rows(
        user.client.table("budget_allocations")
        .select("id, category_id, allocated")
        .eq("year", year)
        .eq("month", month)
        .execute()
    )
    actuals = _rows(
        user.client.table("v_budget_actuals")
        .select("category_id, category_group, category_name, entry_type, total, entry_count")
        .eq("year", year)
        .eq("month", month)
        .execute()
    )
    # Every leaf category, not just the ones with spend or an existing
    # allocation. A budget is a plan for money you have not spent yet, so a
    # category you have never used is exactly the one you most need to be able
    # to budget for.
    categories = {
        c["id"]: c
        for c in _rows(
            user.client.table("expense_categories")
            .select("id, name, \"group\", parent_id, sort_order")
            .execute()
        )
        if c.get("parent_id") is not None
    }
    budget_rows = _rows(
        user.client.table("monthly_budgets")
        .select("total_income")
        .eq("year", year)
        .eq("month", month)
        .execute()
    )

    planned: dict[str, Decimal] = {
        a["category_id"] or UNCATEGORISED: Decimal(str(a["allocated"] or 0))
        for a in allocations
    }

    # Start from the full catalogue so every category is budgetable.
    lines: dict[str, BudgetLine] = {
        cid: BudgetLine(
            category_id=cid,
            category_name=c["name"],
            category_group=c.get("group") or "Other",
            allocated=planned.get(cid, Decimal("0")),
            actual=Decimal("0"),
        )
        for cid, c in categories.items()
    }

    # Then overlay actuals, which may also cover categories outside the
    # catalogue — uncategorised spend has to show somewhere.
    for row in actuals:
        key = row["category_id"] or UNCATEGORISED
        amount = Decimal(str(row["total"] or 0))
        line = lines.get(key)
        if line is None:
            lines[key] = BudgetLine(
                category_id=row["category_id"],
                category_name=row["category_name"] or "Uncategorised",
                category_group=row["category_group"] or "Other",
                entry_type=row.get("entry_type"),
                allocated=planned.get(key, Decimal("0")),
                actual=amount,
                entry_count=row.get("entry_count") or 0,
            )
        else:
            # The same category can appear under more than one entry type.
            line.actual += amount
            line.entry_count += row.get("entry_count") or 0

    # Finally, any allocation whose category has since been deleted, so a
    # budgeted amount never silently disappears from the totals.
    for key, amount in planned.items():
        if key in lines:
            continue
        category = categories.get(key)
        lines[key] = BudgetLine(
            category_id=None if key == UNCATEGORISED else key,
            category_name=(category or {}).get("name") or "Uncategorised",
            category_group=(category or {}).get("group") or "Other",
            allocated=amount,
            actual=Decimal("0"),
        )

    for line in lines.values():
        line.variance = line.allocated - line.actual
        # None, not 0: "nothing budgeted" is a different state from "0% used",
        # and the two must not render as the same bar.
        line.used_pct = (
            float(line.actual / line.allocated * 100) if line.allocated > 0 else None
        )

    ordered = sorted(
        lines.values(),
        key=lambda l: (
            l.category_group,
            -float(l.actual),
            -float(l.allocated),
            l.category_name,
        ),
    )
    total_allocated = sum((l.allocated for l in ordered), Decimal("0"))
    total_actual = sum((l.actual for l in ordered), Decimal("0"))
    income = Decimal(str(budget_rows[0]["total_income"])) if budget_rows else Decimal("0")

    return BudgetMonth(
        year=year,
        month=month,
        base_currency=_base_currency(user),
        total_income=income,
        total_allocated=total_allocated,
        total_actual=total_actual,
        unallocated=income - total_allocated,
        lines=ordered,
    )


@router.put("/budget/allocations", response_model=BudgetMonth)
def save_allocations(
    payload: BudgetAllocationsIn, user: CurrentUser = Depends(get_current_user)
):
    """Save a month's envelopes in one call.

    The grid saves as a unit rather than a request per row, so a half-saved
    month is not a state the user can end up in. A zero allocation is deleted
    rather than stored — an empty envelope is the absence of a budget, not a
    budget of nothing.
    """
    keep = [a for a in payload.allocations if Decimal(str(a.allocated)) > 0]
    drop = [a.category_id for a in payload.allocations if Decimal(str(a.allocated)) <= 0]

    if keep:
        user.client.table("budget_allocations").upsert(
            [
                {
                    "user_id": user.id,
                    "year": payload.year,
                    "month": payload.month,
                    "category_id": a.category_id,
                    "allocated": str(a.allocated),
                }
                for a in keep
            ],
            on_conflict="user_id,year,month,category_id",
        ).execute()

    if drop:
        user.client.table("budget_allocations").delete().eq("year", payload.year).eq(
            "month", payload.month
        ).in_("category_id", drop).execute()

    return get_budget(payload.year, payload.month, user)


@router.delete("/budget/allocations/{allocation_id}", status_code=204)
def delete_allocation(allocation_id: str, user: CurrentUser = Depends(get_current_user)):
    user.client.table("budget_allocations").delete().eq("id", allocation_id).execute()


@router.post("/budget/copy-from", response_model=BudgetMonth)
def copy_forward(
    from_year: int = Query(ge=2000, le=2100),
    from_month: int = Query(ge=1, le=12),
    to_year: int = Query(ge=2000, le=2100),
    to_month: int = Query(ge=1, le=12),
    user: CurrentUser = Depends(get_current_user),
):
    """Carry a month's envelopes forward.

    Re-typing twenty categories every month is the thing that kills envelope
    budgeting, so this is not a convenience — it is what makes the feature
    survive past the first month.
    """
    source = _rows(
        user.client.table("budget_allocations")
        .select("category_id, allocated")
        .eq("year", from_year)
        .eq("month", from_month)
        .execute()
    )
    if not source:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"No envelopes set for {from_month}/{from_year} to copy.",
        )

    user.client.table("budget_allocations").upsert(
        [
            {
                "user_id": user.id,
                "year": to_year,
                "month": to_month,
                "category_id": row["category_id"],
                "allocated": str(row["allocated"]),
            }
            for row in source
        ],
        on_conflict="user_id,year,month,category_id",
    ).execute()

    return get_budget(to_year, to_month, user)


@router.get("/budget/year", response_model=BudgetYear)
def get_budget_year(
    year: int = Query(ge=2000, le=2100),
    user: CurrentUser = Depends(get_current_user),
):
    """The whole year per category: allocated across all twelve months against
    what was actually spent.

    A month at a time answers "am I on track this month"; only the year answers
    "what does this category actually cost me", which is the number you budget
    from next time.
    """
    allocations = _rows(
        user.client.table("budget_allocations")
        .select("category_id, allocated")
        .eq("year", year)
        .execute()
    )
    actuals = _rows(
        user.client.table("v_budget_actuals")
        .select("category_id, category_group, category_name, total, entry_count")
        .eq("year", year)
        .execute()
    )
    categories = {
        c["id"]: c
        for c in _rows(
            user.client.table("expense_categories")
            .select('id, name, "group", parent_id')
            .execute()
        )
        if c.get("parent_id") is not None
    }

    lines: dict[str, BudgetLine] = {}

    def line_for(key: str, name: str, group: str) -> BudgetLine:
        if key not in lines:
            lines[key] = BudgetLine(
                category_id=None if key == UNCATEGORISED else key,
                category_name=name,
                category_group=group,
            )
        return lines[key]

    for row in allocations:
        key = row["category_id"] or UNCATEGORISED
        meta = categories.get(key, {})
        line = line_for(key, meta.get("name") or "Uncategorised", meta.get("group") or "Other")
        line.allocated += Decimal(str(row["allocated"] or 0))

    for row in actuals:
        key = row["category_id"] or UNCATEGORISED
        line = line_for(
            key,
            row["category_name"] or "Uncategorised",
            row["category_group"] or "Other",
        )
        line.actual += Decimal(str(row["total"] or 0))
        line.entry_count += row.get("entry_count") or 0

    for line in lines.values():
        line.variance = line.allocated - line.actual
        line.used_pct = (
            float(line.actual / line.allocated * 100) if line.allocated > 0 else None
        )

    ordered = sorted(
        lines.values(),
        key=lambda l: (-float(l.actual), -float(l.allocated), l.category_name),
    )
    return BudgetYear(
        year=year,
        base_currency=_base_currency(user),
        total_allocated=sum((l.allocated for l in ordered), Decimal("0")),
        total_actual=sum((l.actual for l in ordered), Decimal("0")),
        lines=ordered,
    )
