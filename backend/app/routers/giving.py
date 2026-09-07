"""The Giving & Partnership Engine."""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import date as date_cls
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status

from ..config import Settings, get_settings
from ..deps import CurrentUser, get_current_user
from ..giving import PledgeStatus
from ..schemas import (
    ArmRuleIn,
    ArmRuleOut,
    GivingByArm,
    GivingIn,
    GivingOut,
    GivingSummary,
)
from .ledger import _price_row

router = APIRouter()


def _rule_for(user: CurrentUser, arm: str) -> dict:
    """The rule governing an arm: the user's own definition, else the seeded one.

    Since 0011 the catalogue is per-user, so this cannot be a dict lookup on the
    Python ARM_RULES table any more — that only knows the seeded arms.
    """
    rows = (
        user.client.table("giving_arm_rules")
        .select("*")
        .eq("giving_arm", arm)
        .order("user_id", desc=True, nullsfirst=False)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Unknown giving arm '{arm}'. Create it first, or pick a seeded one.",
        )
    return rows[0]


def _deductible(rule: dict, charity_registration_number: str | None) -> bool:
    """Same rule the database trigger applies, kept in step deliberately."""
    if rule["requires_registered_charity"] and not (charity_registration_number or "").strip():
        return False
    return bool(rule["default_tax_deductible"])


def _giving_category_id(user: CurrentUser) -> str | None:
    """The 'Giving & Charity' group, so gifts roll up with the rest of spending."""
    rows = (
        user.client.table("expense_categories")
        .select("id")
        .eq("slug", "giving_offering")
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0]["id"] if rows else None

# CRA federal charitable donation tax credit, 2026 rates.
SEEDED_REALMS = (
    "core_covenant",
    "ministry_partnership",
    "seeds_special",
    "alms_compassion",
)

FIRST_TIER_CAP = Decimal("200")
FIRST_TIER_RATE = Decimal("0.15")
SECOND_TIER_RATE = Decimal("0.29")


@router.get("/giving/arms", response_model=list[ArmRuleOut])
def list_arms(user: CurrentUser = Depends(get_current_user)):
    """The catalogue: seeded arms plus any this user has defined.

    Read from the database rather than the Python ARM_RULES table, because since
    0011 the seeded arms are only part of the picture — a church outside
    Loveworld defines its own and they have to appear here.
    """
    rows = (
        user.client.table("giving_arm_rules")
        .select("*")
        .order("sort_order")
        .order("display_name")
        .execute()
        .data
        or []
    )
    return [
        ArmRuleOut(
            arm=row["giving_arm"],
            realm=row["realm"],
            display_name=row["display_name"],
            default_tax_deductible=row["default_tax_deductible"],
            requires_registered_charity=row["requires_registered_charity"],
            cra_note=row.get("cra_note"),
            is_system=row.get("is_system", True),
            sort_order=row.get("sort_order", 0),
        )
        for row in rows
    ]


@router.post("/giving/arms", response_model=ArmRuleOut, status_code=201)
def create_arm(payload: ArmRuleIn, user: CurrentUser = Depends(get_current_user)):
    """Define a giving arm for your own church."""
    slug = re.sub(r"[^a-z0-9]+", "_", payload.display_name.strip().lower()).strip("_")
    if not slug:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Name it something.")

    body = {
        "giving_arm": f"custom_{user.id[:8]}_{slug}",
        "realm": payload.realm,
        "display_name": payload.display_name.strip(),
        "default_tax_deductible": payload.default_tax_deductible,
        "requires_registered_charity": payload.requires_registered_charity,
        "cra_note": payload.note,
        "is_system": False,
        "user_id": user.id,
        "sort_order": 500,
    }
    result = user.client.table("giving_arm_rules").insert(body).execute()
    if not result.data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Could not create that arm")
    row = result.data[0]
    return ArmRuleOut(
        arm=row["giving_arm"],
        realm=row["realm"],
        display_name=row["display_name"],
        default_tax_deductible=row["default_tax_deductible"],
        requires_registered_charity=row["requires_registered_charity"],
        cra_note=row.get("cra_note"),
        is_system=False,
        sort_order=row.get("sort_order", 500),
    )


@router.delete("/giving/arms/{arm_id}", status_code=204)
def delete_arm(arm_id: str, user: CurrentUser = Depends(get_current_user)):
    """RLS restricts this to the user's own non-system arms."""
    user.client.table("giving_arm_rules").delete().eq("id", arm_id).execute()


@router.post("/giving", response_model=GivingOut, status_code=201)
def record_giving(payload: GivingIn, user: CurrentUser = Depends(get_current_user)):
    """Record a gift, creating its transaction when one is not supplied."""
    transaction_id = payload.transaction_id

    if transaction_id is None:
        if payload.amount is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Provide either transaction_id or amount",
            )
        rule = _rule_for(user, payload.giving_arm)
        given_on = payload.date or date_cls.today()
        body = {
            "user_id": user.id,
            "account_id": payload.account_id,
            # Giving leaves the account, so it is stored as money out.
            "amount": str(-abs(payload.amount)),
            "currency": (payload.currency or "").upper() or None,
            "category": "kingdom_giving",
            "category_id": _giving_category_id(user),
            # V2: giving is a first-class ledger band, not an unlabelled expense.
            "entry_type": "giving",
            "date": given_on.isoformat(),
            "merchant": payload.recipient,
            "memo": rule["display_name"],
            "receipt_image_url": payload.receipt_image_url,
        }
        # Fills base_currency / base_amount / fx_rate, which 0003 makes NOT NULL.
        body = _price_row(user, body, given_on)
        tx = user.client.table("transactions").insert(body).execute()
        if not tx.data:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Could not create transaction")
        transaction_id = tx.data[0]["id"]
        tax_year = given_on.year
    else:
        rows = (
            user.client.table("transactions")
            .select("date")
            .eq("id", transaction_id)
            .execute()
            .data
        )
        if not rows:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Transaction not found")
        tax_year = int(rows[0]["date"][:4])

    record = {
        "user_id": user.id,
        "transaction_id": transaction_id,
        "giving_arm": payload.giving_arm,
        "realm": _rule_for(user, payload.giving_arm)["realm"],
        "recipient": payload.recipient,
        "charity_registration_number": payload.charity_registration_number,
        "pledge_fulfilled_status": payload.pledge_fulfilled_status.value,
        "pledge_total": float(payload.pledge_total) if payload.pledge_total else None,
        # The DB trigger recomputes this from the arm's rule; we send our own
        # value so the API is correct even against a database without it.
        "tax_deductible_flag": _deductible(
            _rule_for(user, payload.giving_arm), payload.charity_registration_number
        ),
        "tax_year": tax_year,
    }
    result = user.client.table("kingdom_giving_records").insert(record).execute()
    if not result.data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Could not record giving")
    return result.data[0]


@router.get("/giving", response_model=list[GivingOut])
def list_giving(
    tax_year: int | None = None,
    giving_arm: str | None = None,
    user: CurrentUser = Depends(get_current_user),
):
    query = user.client.table("kingdom_giving_records").select("*")
    if tax_year:
        query = query.eq("tax_year", tax_year)
    if giving_arm:
        query = query.eq("giving_arm", giving_arm)
    return query.order("created_at", desc=True).execute().data or []


@router.patch("/giving/{record_id}/receipt", response_model=GivingOut)
def mark_receipt_received(
    record_id: str, received: bool = True, user: CurrentUser = Depends(get_current_user)
):
    result = (
        user.client.table("kingdom_giving_records")
        .update({"official_receipt_received": received})
        .eq("id", record_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Giving record not found")
    return result.data[0]


def _federal_credit(receiptable: Decimal) -> Decimal:
    """Federal charitable donation tax credit: 15% on the first $200, 29% above."""
    if receiptable <= 0:
        return Decimal("0")
    first = min(receiptable, FIRST_TIER_CAP)
    rest = max(receiptable - FIRST_TIER_CAP, Decimal("0"))
    return (first * FIRST_TIER_RATE + rest * SECOND_TIER_RATE).quantize(Decimal("0.01"))


@router.get("/giving/summary", response_model=GivingSummary)
def giving_summary(
    tax_year: int | None = None,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    """Year-to-date stewardship picture, split by CRA receiptability."""
    year = tax_year or settings.current_tax_year
    rows = (
        user.client.table("kingdom_giving_records")
        .select("*, transactions(amount, base_amount)")
        .eq("tax_year", year)
        .execute()
        .data
        or []
    )

    by_arm: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    by_realm: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    receiptable = Decimal("0")
    non_receiptable = Decimal("0")
    outstanding = Decimal("0")

    for row in rows:
        tx = row.get("transactions") or {}
        # Sum in the user's base currency so a year of multi-currency giving adds up.
        amount = abs(Decimal(str(tx.get("base_amount") or tx.get("amount") or 0)))
        by_arm[row["giving_arm"]] += amount
        by_realm[row["realm"]] += amount
        if row["tax_deductible_flag"]:
            receiptable += amount
        else:
            non_receiptable += amount
        if row["pledge_fulfilled_status"] in (
            PledgeStatus.OUTSTANDING.value,
            PledgeStatus.PARTIAL.value,
        ):
            pledge_total = Decimal(str(row.get("pledge_total") or 0))
            outstanding += max(pledge_total - amount, Decimal("0"))

    return GivingSummary(
        tax_year=year,
        total_given=receiptable + non_receiptable,
        receiptable_total=receiptable,
        non_receiptable_total=non_receiptable,
        by_arm=dict(by_arm),
        # The four seeded realms always appear so the dashboard keeps a stable
        # shape, plus any others a custom arm introduced.
        by_realm={realm: by_realm.get(realm, Decimal("0")) for realm in SEEDED_REALMS}
        | {k: v for k, v in by_realm.items() if k not in SEEDED_REALMS},
        estimated_federal_credit=_federal_credit(receiptable),
        outstanding_pledges=outstanding,
    )


@router.get("/giving/by-arm", response_model=list[GivingByArm])
def giving_by_arm(
    year: int | None = None, user: CurrentUser = Depends(get_current_user)
):
    """Monthly giving per arm, for the breakdown chart.

    /giving/summary gives a year total per arm with no trend, and v_category_spend
    only knows the generic "Giving & Charity" group. This reads v_giving_by_arm,
    which joins the arm catalogue so custom arms appear by their display name.
    """
    query = user.client.table("v_giving_by_arm").select("*")
    if year:
        query = query.eq("year", year)
    return query.order("year").order("month").order("total", desc=True).execute().data or []
