"""The Omni-Ledger — every expense, income, saving, investment and gift.

One table (`transactions`) backs the whole grid. Two rules hold the design
together:

1. Every write goes through `_price_row`, so `base_amount` and `fx_rate` are
   always recomputed from the row's own date. Editing a row re-prices it, which
   is what makes correcting a mistake safe rather than merely possible.
2. A row of `entry_type = 'giving'` keeps a companion `kingdom_giving_records`
   row in step. That schema is untouched from 0001 — we only upsert into it — so
   the ministry reporting built on it keeps working while giving now also flows
   through cash-flow as a specialised outflow.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..deps import CurrentUser, get_current_user, get_service_client
from supabase import Client

from ..services import audit
from ..schemas import (
    BulkDeleteIn,
    LedgerEntryType,
    LedgerPage,
    LedgerRowIn,
    LedgerRowOut,
    LedgerRowPatch,
)

router = APIRouter()

LEDGER_COLUMNS = "*"

# Money leaves the account for these; the ledger stores outflows as negatives so
# the sign convention from 0001 (`amount < 0` = money out) is preserved.
OUTFLOW_TYPES = {
    LedgerEntryType.EXPENSE,
    LedgerEntryType.GIVING,
    LedgerEntryType.SAVINGS,
    LedgerEntryType.INVESTMENT,
}


def _rows(response):
    return response.data or []


def _one(response, what: str = "Ledger row"):
    rows = _rows(response)
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found")
    return rows[0]


def _base_currency(user: CurrentUser) -> str:
    rows = _rows(
        user.client.table("users").select("base_currency").eq("id", user.id).execute()
    )
    return (rows[0]["base_currency"] if rows else "CAD") or "CAD"


def _signed(amount: Decimal, entry_type: LedgerEntryType) -> Decimal:
    """Normalise the sign so the user can type 42 or -42 and mean the same thing."""
    magnitude = abs(amount)
    return -magnitude if entry_type in OUTFLOW_TYPES else magnitude


def _resolve_category(user: CurrentUser, slug: str | None) -> str | None:
    if not slug:
        return None
    rows = _rows(
        user.client.table("expense_categories").select("id").eq("slug", slug).limit(1).execute()
    )
    return rows[0]["id"] if rows else None


def _price_row(user: CurrentUser, body: dict, on: date) -> dict:
    """Fill in base_currency / fx_rate / base_amount for the row's own date."""
    from ..services import fx

    base = _base_currency(user)
    native = body.get("currency") or base
    amount = Decimal(str(body["amount"]))
    converted, rate = fx.convert(user.client, amount, native, base, on)

    body["currency"] = native
    body["base_currency"] = base
    body["base_amount"] = str(converted)
    body["fx_rate"] = str(rate)
    return body


def _fetch_row(user: CurrentUser, row_id: str) -> dict:
    return _one(
        user.client.table("v_ledger_rows").select(LEDGER_COLUMNS).eq("id", row_id).execute()
    )


# ----------------------------------------------------------- giving companion

def _sync_giving(user: CurrentUser, row: dict, payload) -> None:
    """Create/update/remove the kingdom_giving_records companion for a row."""
    is_giving = row["entry_type"] == LedgerEntryType.GIVING.value
    existing = _rows(
        user.client.table("kingdom_giving_records")
        .select("id")
        .eq("transaction_id", row["id"])
        .execute()
    )

    if not is_giving:
        if existing:
            user.client.table("kingdom_giving_records").delete().eq(
                "transaction_id", row["id"]
            ).execute()
        return

    arm = getattr(payload, "giving_arm", None)
    if arm is None and not existing:
        # A giving row without an arm is still a valid ledger entry; it simply has
        # no ministry record yet. The user picks the arm in the grid or on /giving.
        return

    body = {
        "user_id": user.id,
        "transaction_id": row["id"],
        "tax_year": int(str(row["date"])[:4]),
    }
    if arm is not None:
        body["giving_arm"] = arm.value
        # `realm` and `tax_deductible_flag` are overwritten by the
        # apply_giving_arm_defaults trigger; we send placeholders it will replace.
        body["realm"] = "core_covenant"
    for field, column in (
        ("giving_recipient", "recipient"),
        ("charity_registration_number", "charity_registration_number"),
        ("pledge_fulfilled_status", "pledge_fulfilled_status"),
        ("pledge_total", "pledge_total"),
    ):
        value = getattr(payload, field, None)
        if value is not None:
            body[column] = value.value if hasattr(value, "value") else str(value)

    if existing:
        user.client.table("kingdom_giving_records").update(body).eq(
            "id", existing[0]["id"]
        ).execute()
    else:
        user.client.table("kingdom_giving_records").insert(body).execute()


# ------------------------------------------------------------------- read

@router.get("/ledger", response_model=LedgerPage)
def list_ledger(
    limit: int = Query(default=100, ge=1, le=500),
    cursor: str | None = Query(default=None, description="`<date>|<id>` from next_cursor"),
    date_from: date | None = None,
    date_to: date | None = None,
    entry_type: LedgerEntryType | None = None,
    category_id: str | None = None,
    platform_id: str | None = None,
    account_id: str | None = None,
    currency: str | None = None,
    q: str | None = Query(default=None, description="Free text over merchant and memo"),
    user: CurrentUser = Depends(get_current_user),
):
    query = user.client.table("v_ledger_rows").select(LEDGER_COLUMNS)

    if date_from:
        query = query.gte("date", date_from.isoformat())
    if date_to:
        query = query.lte("date", date_to.isoformat())
    if entry_type:
        query = query.eq("entry_type", entry_type.value)
    if category_id:
        query = query.eq("category_id", category_id)
    if platform_id:
        query = query.eq("platform_id", platform_id)
    if account_id:
        query = query.eq("account_id", account_id)
    if currency:
        query = query.eq("currency", currency.upper())
    if q:
        needle = q.replace(",", " ").strip()
        query = query.or_(f"merchant.ilike.%{needle}%,memo.ilike.%{needle}%")
    if cursor:
        cursor_date, _, cursor_id = cursor.partition("|")
        # Keyset, not offset: the grid stays stable while rows are being edited.
        query = query.or_(
            f"date.lt.{cursor_date},and(date.eq.{cursor_date},id.lt.{cursor_id})"
        )

    rows = _rows(
        query.order("date", desc=True).order("id", desc=True).limit(limit + 1).execute()
    )

    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        next_cursor = f"{last['date']}|{last['id']}"

    return LedgerPage(rows=rows, next_cursor=next_cursor)


@router.get("/ledger/{row_id}", response_model=LedgerRowOut)
def get_ledger_row(row_id: str, user: CurrentUser = Depends(get_current_user)):
    return _fetch_row(user, row_id)


# ------------------------------------------------------------------ write

def _insert(
    user: CurrentUser, payload: LedgerRowIn, *, trusted_receipt: bool = False
) -> dict:
    category_id = payload.category_id or _resolve_category(user, payload.category_slug)
    # Receipt fields are set only by /ocr/commit, which uploaded the file itself
    # and passes trusted_receipt. Taking them from a request body would let a
    # client point a row at any URL the UI then renders, or at another user's
    # storage path — and `source` is client-settable, so it cannot be the gate.
    if not trusted_receipt:
        payload.receipt_image_url = None
        payload.receipt_storage_path = None
    body = {
        "user_id": user.id,
        "date": payload.date.isoformat(),
        "entry_type": payload.entry_type.value,
        "amount": str(_signed(payload.amount, payload.entry_type)),
        "currency": (payload.currency or "CAD").upper(),
        "category_id": category_id,
        "platform_id": payload.platform_id,
        "account_id": payload.account_id,
        "budget_id": payload.budget_id,
        "merchant": payload.merchant,
        "memo": payload.memo,
        "tags": payload.tags,
        "source": payload.source.value,
        "receipt_image_url": payload.receipt_image_url,
        "receipt_storage_path": payload.receipt_storage_path,
        "ocr_confidence": payload.ocr_confidence,
        # Legacy free-text column, still NOT NULL from 0001.
        "category": payload.category_slug or payload.entry_type.value,
    }
    body = _price_row(user, body, payload.date)
    row = _one(user.client.table("transactions").insert(body).execute())
    _sync_giving(user, row, payload)
    return _fetch_row(user, row["id"])


@router.post("/ledger", response_model=LedgerRowOut, status_code=201)
def create_ledger_row(payload: LedgerRowIn, user: CurrentUser = Depends(get_current_user)):
    return _insert(user, payload)


@router.post("/ledger/bulk", response_model=list[LedgerRowOut], status_code=201)
def create_ledger_rows(
    payload: list[LedgerRowIn], user: CurrentUser = Depends(get_current_user)
):
    """Paste a block of rows into the grid in one round trip."""
    if len(payload) > 200:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Max 200 rows per call")
    return [_insert(user, row) for row in payload]


@router.patch("/ledger/{row_id}", response_model=LedgerRowOut)
def update_ledger_row(
    row_id: str, payload: LedgerRowPatch, user: CurrentUser = Depends(get_current_user)
):
    current = _fetch_row(user, row_id)
    changes = payload.model_dump(exclude_unset=True, mode="json")

    entry_type = LedgerEntryType(changes.get("entry_type") or current["entry_type"])
    body: dict = {}
    for column in (
        "date", "merchant", "memo", "tags", "category_id",
        "platform_id", "account_id", "receipt_image_url",
    ):
        if column in changes:
            body[column] = changes[column]
    if "entry_type" in changes:
        body["entry_type"] = entry_type.value
    if "currency" in changes and changes["currency"]:
        body["currency"] = str(changes["currency"]).upper()
    if "amount" in changes or "entry_type" in changes:
        amount = Decimal(str(changes.get("amount", current["amount"])))
        body["amount"] = str(_signed(amount, entry_type))

    # Any change to amount, currency or date re-prices the row.
    if {"amount", "currency", "date", "entry_type"} & set(changes):
        body.setdefault("amount", str(current["amount"]))
        body.setdefault("currency", current["currency"])
        on = date.fromisoformat(str(body.get("date") or current["date"]))
        body = _price_row(user, body, on)

    if body:
        _one(user.client.table("transactions").update(body).eq("id", row_id).execute())

    row = _fetch_row(user, row_id)
    _sync_giving(user, row, payload)
    return _fetch_row(user, row_id)


@router.delete("/ledger/{row_id}", status_code=204)
def delete_ledger_row(row_id: str, user: CurrentUser = Depends(get_current_user)):
    # kingdom_giving_records cascades on transaction delete (see 0001).
    user.client.table("transactions").delete().eq("id", row_id).execute()


@router.post("/ledger/bulk-delete", status_code=204)
def delete_ledger_rows(
    payload: BulkDeleteIn,
    user: CurrentUser = Depends(get_current_user),
    service: Client = Depends(get_service_client),
):
    if not payload.ids:
        return
    user.client.table("transactions").delete().in_("id", payload.ids).execute()
    # How many and when, not what: the rows were just deleted on purpose.
    audit.record(
        service,
        user_id=user.id,
        actor_email=user.email,
        action="ledger.bulk_delete",
        entity="transaction",
        entity_count=len(payload.ids),
    )


@router.get("/ledger/{row_id}/receipt-url")
def receipt_url(
    row_id: str,
    user: CurrentUser = Depends(get_current_user),
    service: Client = Depends(get_service_client),
):
    """A fresh signed link for this row's receipt.

    Links expire in an hour, so they cannot be stored and re-shared. The row is
    read through the caller's own client first, so RLS decides whether they may
    see it — the service role is used only to sign, after ownership is settled.
    """
    from ..config import get_settings

    row = _fetch_row(user, row_id)
    path = row.get("receipt_storage_path")
    if not path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No receipt on this entry")

    settings = get_settings()
    try:
        signed = service.storage.from_(settings.supabase_receipt_bucket).create_signed_url(
            path, 60 * 60
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "Could not produce a receipt link."
        ) from exc
    return {"url": signed.get("signedURL") or signed.get("signedUrl")}
