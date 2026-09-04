"""Accounts, budgets and transactions — thin CRUD over RLS-protected tables."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..deps import CurrentUser, get_current_user
from ..schemas import (
    AccountIn,
    AccountOut,
    BudgetIn,
    BudgetOut,
    TransactionIn,
    TransactionOut,
)
from .ledger import _price_row

router = APIRouter()


def _rows(response):
    return response.data or []


def _one(response, what: str):
    rows = _rows(response)
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found")
    return rows[0]


# ----------------------------------------------------------------- accounts

@router.get("/accounts", response_model=list[AccountOut])
def list_accounts(user: CurrentUser = Depends(get_current_user)):
    return _rows(
        user.client.table("accounts")
        .select("*")
        .eq("is_archived", False)
        .order("created_at")
        .execute()
    )


@router.post("/accounts", response_model=AccountOut, status_code=201)
def create_account(payload: AccountIn, user: CurrentUser = Depends(get_current_user)):
    body = payload.model_dump(mode="json") | {"user_id": user.id}
    return _one(user.client.table("accounts").insert(body).execute(), "Account")


@router.patch("/accounts/{account_id}", response_model=AccountOut)
def update_account(
    account_id: str, payload: AccountIn, user: CurrentUser = Depends(get_current_user)
):
    body = payload.model_dump(mode="json", exclude_unset=True)
    return _one(
        user.client.table("accounts").update(body).eq("id", account_id).execute(),
        "Account",
    )


# ----------------------------------------------------------------- budgets

@router.get("/budgets", response_model=list[BudgetOut])
def list_budgets(year: int | None = None, user: CurrentUser = Depends(get_current_user)):
    query = user.client.table("monthly_budgets").select("*")
    if year:
        query = query.eq("year", year)
    return _rows(query.order("year", desc=True).order("month", desc=True).execute())


@router.put("/budgets", response_model=BudgetOut)
def upsert_budget(payload: BudgetIn, user: CurrentUser = Depends(get_current_user)):
    body = payload.model_dump(mode="json") | {"user_id": user.id}
    return _one(
        user.client.table("monthly_budgets")
        .upsert(body, on_conflict="user_id,year,month")
        .execute(),
        "Budget",
    )


# ------------------------------------------------------------ transactions

@router.get("/transactions", response_model=list[TransactionOut])
def list_transactions(
    limit: int = Query(default=100, le=500),
    budget_id: str | None = None,
    user: CurrentUser = Depends(get_current_user),
):
    query = user.client.table("transactions").select("*")
    if budget_id:
        query = query.eq("budget_id", budget_id)
    return _rows(query.order("date", desc=True).limit(limit).execute())


@router.post("/transactions", response_model=TransactionOut, status_code=201)
def create_transaction(
    payload: TransactionIn, user: CurrentUser = Depends(get_current_user)
):
    """Legacy single-transaction insert. New clients should use POST /api/ledger,
    which also resolves the category and keeps giving records in step."""
    body = payload.model_dump(mode="json") | {"user_id": user.id}
    # base_amount / base_currency / fx_rate are NOT NULL from migration 0003.
    body = _price_row(user, body, payload.date)
    return _one(user.client.table("transactions").insert(body).execute(), "Transaction")


@router.delete("/transactions/{transaction_id}", status_code=204)
def delete_transaction(transaction_id: str, user: CurrentUser = Depends(get_current_user)):
    user.client.table("transactions").delete().eq("id", transaction_id).execute()
