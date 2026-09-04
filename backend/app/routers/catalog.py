"""Reference data the ledger grid needs: profile, currencies, categories, platforms.

Categories and platforms are a union of seeded global rows (`user_id is null`)
and the user's own additions — the RLS policies in 0002 do the filtering, so
these handlers stay thin.
"""

from __future__ import annotations

import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client

from ..deps import CurrentUser, get_current_user, get_service_client
from ..schemas import (
    CategoryIn,
    CategoryOut,
    CurrencyOut,
    FxRefreshOut,
    PlatformIn,
    PlatformOut,
    ProfileIn,
    ProfileOut,
)
from ..services import fx

router = APIRouter()


def _rows(response):
    return response.data or []


def _one(response, what: str):
    rows = _rows(response)
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found")
    return rows[0]


def _slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_") or "custom"


# ---------------------------------------------------------------- profile

@router.get("/me", response_model=ProfileOut)
def get_profile(user: CurrentUser = Depends(get_current_user)):
    return _one(
        user.client.table("users").select("*").eq("id", user.id).execute(), "Profile"
    )


@router.patch("/me", response_model=ProfileOut)
def update_profile(payload: ProfileIn, user: CurrentUser = Depends(get_current_user)):
    body = payload.model_dump(exclude_unset=True, exclude_none=True, mode="json")
    if "base_currency" in body:
        body["base_currency"] = body["base_currency"].upper()
    if "country_code" in body:
        body["country_code"] = body["country_code"].upper()
    if not body:
        return get_profile(user)

    updated = _one(
        user.client.table("users").update(body).eq("id", user.id).execute(), "Profile"
    )

    # Reporting converts from each row's native currency on read, so the views
    # are already correct. This just re-stamps the stored audit columns so they
    # agree with the new base currency too.
    if "base_currency" in body:
        try:
            user.client.rpc("reprice_transactions", {"p_user": user.id}).execute()
        except Exception:  # noqa: BLE001 - a stale audit column must not fail the switch
            pass

    return updated


# -------------------------------------------------------------- currencies

@router.get("/currencies", response_model=list[CurrencyOut])
def list_currencies(user: CurrentUser = Depends(get_current_user)):
    return _rows(user.client.table("currencies").select("*").order("code").execute())


@router.post("/fx/refresh", response_model=FxRefreshOut)
async def refresh_fx(
    on: date | None = None,
    user: CurrentUser = Depends(get_current_user),
    service: Client = Depends(get_service_client),
):
    """Pull the day's ECB reference rates. Safe to call repeatedly — it upserts."""
    try:
        return await fx.refresh_rates(service, base="USD", on=on)
    except Exception as exc:  # noqa: BLE001 - upstream outage shouldn't 500 opaquely
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"Rate provider unavailable: {exc}"
        ) from exc


# -------------------------------------------------------------- categories

@router.get("/categories", response_model=list[CategoryOut])
def list_categories(user: CurrentUser = Depends(get_current_user)):
    return _rows(
        user.client.table("expense_categories")
        .select("*")
        .order("sort_order")
        .order("name")
        .execute()
    )


@router.post("/categories", response_model=CategoryOut, status_code=201)
def create_category(payload: CategoryIn, user: CurrentUser = Depends(get_current_user)):
    body = {
        "slug": f"custom_{user.id[:8]}_{_slugify(payload.name)}",
        "name": payload.name,
        "parent_id": payload.parent_id,
        "group": payload.group,
        "icon": payload.icon,
        "is_system": False,
        "user_id": user.id,
        "sort_order": 500,
    }
    return _one(
        user.client.table("expense_categories").insert(body).execute(), "Category"
    )


@router.delete("/categories/{category_id}", status_code=204)
def delete_category(category_id: str, user: CurrentUser = Depends(get_current_user)):
    # RLS restricts the delete to the user's own custom rows.
    user.client.table("expense_categories").delete().eq("id", category_id).execute()


# --------------------------------------------------------------- platforms

@router.get("/platforms", response_model=list[PlatformOut])
def list_platforms(user: CurrentUser = Depends(get_current_user)):
    return _rows(
        user.client.table("investment_platforms").select("*").order("name").execute()
    )


@router.post("/platforms", response_model=PlatformOut, status_code=201)
def create_platform(payload: PlatformIn, user: CurrentUser = Depends(get_current_user)):
    body = payload.model_dump(mode="json") | {
        "slug": f"custom_{user.id[:8]}_{_slugify(payload.name)}",
        "is_system": False,
        "user_id": user.id,
    }
    return _one(
        user.client.table("investment_platforms").insert(body).execute(), "Platform"
    )


@router.delete("/platforms/{platform_id}", status_code=204)
def delete_platform(platform_id: str, user: CurrentUser = Depends(get_current_user)):
    user.client.table("investment_platforms").delete().eq("id", platform_id).execute()
