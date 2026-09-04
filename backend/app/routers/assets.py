"""Assets and liabilities — the inputs to the net-worth engine."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from ..deps import CurrentUser, get_current_user
from ..schemas import (
    AssetIn,
    AssetOut,
    AssetPatch,
    LiabilityIn,
    LiabilityOut,
    LiabilityPatch,
)

router = APIRouter()


def _rows(response):
    return response.data or []


def _one(response, what: str):
    rows = _rows(response)
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found")
    return rows[0]


def _body(payload, user_id: str, partial: bool) -> dict:
    # exclude_none throughout: a null `as_of` must fall through to the column
    # default rather than violating NOT NULL.
    body = payload.model_dump(mode="json", exclude_unset=partial, exclude_none=True)
    body.pop("id", None)
    if "currency" in body and body["currency"]:
        body["currency"] = body["currency"].upper()
    if not partial:
        body["user_id"] = user_id
    return body


# ----------------------------------------------------------------- assets

@router.get("/assets", response_model=list[AssetOut])
def list_assets(
    include_archived: bool = False, user: CurrentUser = Depends(get_current_user)
):
    query = user.client.table("assets").select("*")
    if not include_archived:
        query = query.eq("is_archived", False)
    return _rows(query.order("asset_class").order("name").execute())


@router.post("/assets", response_model=AssetOut, status_code=201)
def create_asset(payload: AssetIn, user: CurrentUser = Depends(get_current_user)):
    return _one(
        user.client.table("assets").insert(_body(payload, user.id, False)).execute(), "Asset"
    )


@router.patch("/assets/{asset_id}", response_model=AssetOut)
def update_asset(
    asset_id: str, payload: AssetPatch, user: CurrentUser = Depends(get_current_user)
):
    return _one(
        user.client.table("assets")
        .update(_body(payload, user.id, True))
        .eq("id", asset_id)
        .execute(),
        "Asset",
    )


@router.delete("/assets/{asset_id}", status_code=204)
def delete_asset(asset_id: str, user: CurrentUser = Depends(get_current_user)):
    user.client.table("assets").delete().eq("id", asset_id).execute()


# ------------------------------------------------------------- liabilities

@router.get("/liabilities", response_model=list[LiabilityOut])
def list_liabilities(
    include_archived: bool = False, user: CurrentUser = Depends(get_current_user)
):
    query = user.client.table("liabilities").select("*")
    if not include_archived:
        query = query.eq("is_archived", False)
    return _rows(query.order("liability_kind").order("name").execute())


@router.post("/liabilities", response_model=LiabilityOut, status_code=201)
def create_liability(payload: LiabilityIn, user: CurrentUser = Depends(get_current_user)):
    return _one(
        user.client.table("liabilities").insert(_body(payload, user.id, False)).execute(),
        "Liability",
    )


@router.patch("/liabilities/{liability_id}", response_model=LiabilityOut)
def update_liability(
    liability_id: str, payload: LiabilityPatch, user: CurrentUser = Depends(get_current_user)
):
    return _one(
        user.client.table("liabilities")
        .update(_body(payload, user.id, True))
        .eq("id", liability_id)
        .execute(),
        "Liability",
    )


@router.delete("/liabilities/{liability_id}", status_code=204)
def delete_liability(liability_id: str, user: CurrentUser = Depends(get_current_user)):
    user.client.table("liabilities").delete().eq("id", liability_id).execute()
