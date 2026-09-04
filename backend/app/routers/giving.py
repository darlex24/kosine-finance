"""The Giving & Partnership Engine."""

from __future__ import annotations

from collections import defaultdict
from datetime import date as date_cls
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status

from ..config import Settings, get_settings
from ..deps import CurrentUser, get_current_user
from ..giving import ARM_RULES, GivingArm, PledgeStatus, Realm, is_tax_deductible
from ..schemas import ArmRuleOut, GivingIn, GivingOut, GivingSummary
from .ledger import _price_row

router = APIRouter()


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
FIRST_TIER_CAP = Decimal("200")
FIRST_TIER_RATE = Decimal("0.15")
SECOND_TIER_RATE = Decimal("0.29")


@router.get("/giving/arms", response_model=list[ArmRuleOut])
def list_arms():
    """The full catalogue of giving arms, grouped client-side by realm."""
    return [
        ArmRuleOut(
            arm=rule.arm,
            realm=rule.realm,
            display_name=rule.display_name,
            default_tax_deductible=rule.default_tax_deductible,
            requires_registered_charity=rule.requires_registered_charity,
            cra_note=rule.cra_note,
        )
        for rule in ARM_RULES.values()
    ]


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
        rule = ARM_RULES[payload.giving_arm]
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
            "memo": rule.display_name,
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
        "giving_arm": payload.giving_arm.value,
        "realm": ARM_RULES[payload.giving_arm].realm.value,
        "recipient": payload.recipient,
        "charity_registration_number": payload.charity_registration_number,
        "pledge_fulfilled_status": payload.pledge_fulfilled_status.value,
        "pledge_total": float(payload.pledge_total) if payload.pledge_total else None,
        # The DB trigger recomputes this; we send our own value so the API is
        # correct even when called against a database without the trigger.
        "tax_deductible_flag": is_tax_deductible(
            payload.giving_arm, payload.charity_registration_number
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
    giving_arm: GivingArm | None = None,
    user: CurrentUser = Depends(get_current_user),
):
    query = user.client.table("kingdom_giving_records").select("*")
    if tax_year:
        query = query.eq("tax_year", tax_year)
    if giving_arm:
        query = query.eq("giving_arm", giving_arm.value)
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
        by_realm={realm.value: by_realm.get(realm.value, Decimal("0")) for realm in Realm},
        estimated_federal_credit=_federal_credit(receiptable),
        outstanding_pledges=outstanding,
    )
