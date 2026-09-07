"""Regression tests for the logic where a silent error costs real money.

Deliberately narrow: the money maths, the sign convention, the OCR coercion
that decides tax treatment, and the upload validation that stands between an
uploaded file and the storage origin. All pure or stubbed — no database, no
network, no API keys — so this runs anywhere in under a second.
"""

from __future__ import annotations

import asyncio
from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.routers.ledger import _signed
from app.schemas import LedgerEntryType as T
from app.services import fx, uploads
from app.services.ocr import CATEGORY_SLUGS, _to_result

TODAY = date(2026, 9, 4)


# --------------------------------------------------------------- sign convention

@pytest.mark.parametrize(
    "entry_type,typed,expected",
    [
        (T.EXPENSE, 42, -42), (T.EXPENSE, -42, -42),      # outflow either way
        (T.GIVING, 42, -42), (T.SAVINGS, 42, -42), (T.INVESTMENT, 42, -42),
        (T.INCOME, 42, 42), (T.INCOME, -42, 42),          # inflow either way
        (T.TRANSFER, 42, 42),
    ],
)
def test_amount_sign_is_derived_from_entry_type(entry_type, typed, expected):
    """A user typing 42 or -42 for an expense means the same thing."""
    assert _signed(Decimal(typed), entry_type) == Decimal(expected)


# ------------------------------------------------------------------------- FX

@pytest.fixture
def rates(monkeypatch):
    """Stub the one-hop lookup; everything above it is the logic under test."""
    table = {("USD", "NGN"): Decimal("1324.79"), ("USD", "CAD"): Decimal("1.3793")}

    def fake_direct(_client, base, quote, _on):
        if base == quote:
            return Decimal(1)
        if (base, quote) in table:
            return table[(base, quote)]
        if (quote, base) in table:
            return Decimal(1) / table[(quote, base)]
        return None

    monkeypatch.setattr(fx, "_direct", fake_direct)
    fx._cache.clear()
    yield
    fx._cache.clear()


def test_same_currency_is_identity(rates):
    assert fx.get_rate(None, "CAD", "CAD", TODAY) == Decimal(1)


def test_direct_pair(rates):
    assert fx.get_rate(None, "USD", "NGN", TODAY) == Decimal("1324.79")


def test_inverse_pair(rates):
    got = fx.get_rate(None, "NGN", "USD", TODAY)
    assert got == pytest.approx(Decimal(1) / Decimal("1324.79"))


def test_cross_pair_triangulates_through_usd(rates):
    """NGN->CAD has no stored row; it must hop through the pivot.

    This is the app's most likely conversion and it silently returned 1:1
    before triangulation existed.
    """
    got = fx.get_rate(None, "NGN", "CAD", TODAY)
    expected = (Decimal(1) / Decimal("1324.79")) * Decimal("1.3793")
    assert got == pytest.approx(expected)
    assert got != Decimal(1), "cross-pair fell back to par"


def test_cross_pair_round_trips(rates):
    out = fx.get_rate(None, "NGN", "CAD", TODAY)
    back = fx.get_rate(None, "CAD", "NGN", TODAY)
    assert float(out * back) == pytest.approx(1.0, rel=1e-9)


def test_unknown_pair_falls_back_to_par_loudly(rates, caplog):
    """Par keeps the entry rather than losing it — but must never be silent."""
    assert fx.get_rate(None, "XXX", "YYY", TODAY) == Decimal(1)
    assert "No FX rate" in caplog.text


def test_convert_rounds_to_two_places(rates):
    amount, rate = fx.convert(None, Decimal("100000"), "NGN", "CAD", TODAY)
    assert amount == amount.quantize(Decimal("0.01"))
    assert rate != Decimal(1)


# ---------------------------------------------------------------------- OCR

def _raw(**over):
    return {"document_type": "receipt", "confidence": 0.9, **over}


def test_currency_is_normalised_to_upper():
    assert _to_result(_raw(currency="ngn")).currency == "NGN"


def test_hallucinated_category_slug_is_discarded():
    """The model must never invent a category that reaches the ledger."""
    assert _to_result(_raw(suggested_category_slug="totally_made_up")).suggested_category_slug is None


def test_real_category_slug_survives():
    result = _to_result(_raw(suggested_category_slug="food_groceries"))
    assert result.suggested_category_slug == "food_groceries"
    assert result.suggested_category_slug in CATEGORY_SLUGS


def test_tithe_without_registration_number_is_not_receiptable():
    """Deductibility is re-derived locally; a missing charity number wins."""
    result = _to_result(_raw(document_type="giving_statement", suggested_giving_arm="tithe"))
    assert result.tax_deductible_flag is False


def test_tithe_with_registration_number_is_receiptable():
    result = _to_result(
        _raw(
            document_type="giving_statement",
            suggested_giving_arm="tithe",
            charity_registration_number="123456789RR0001",
        )
    )
    assert result.tax_deductible_flag is True


def test_honorarium_is_never_receiptable_even_with_a_number():
    """A personal gift to a minister is not a donation, whatever is printed."""
    result = _to_result(
        _raw(
            document_type="giving_statement",
            suggested_giving_arm="prophet_seed",
            charity_registration_number="123456789RR0001",
        )
    )
    assert result.tax_deductible_flag is False


def test_model_cannot_assert_deductibility_itself():
    result = _to_result(_raw(tax_deductible_flag=True, suggested_giving_arm="alms_to_the_poor"))
    assert result.tax_deductible_flag is False


# ------------------------------------------------------------------ uploads

class FakeUpload:
    """Only what read_validated touches."""

    def __init__(self, content: bytes, content_type: str):
        self._buf = bytearray(content)
        self.content_type = content_type

    async def read(self, size: int = -1) -> bytes:
        take = len(self._buf) if size < 0 else min(size, len(self._buf))
        chunk = bytes(self._buf[:take])
        del self._buf[:take]
        return chunk


PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
PDF = b"%PDF-1.7\n" + b"\x00" * 64
WEBP = b"RIFF" + b"\x00" * 4 + b"WEBP" + b"\x00" * 64


@pytest.mark.parametrize(
    "content,declared,expected",
    [(PNG, "image/png", "image/png"), (JPEG, "image/jpeg", "image/jpeg"),
     (PDF, "application/pdf", "application/pdf"), (WEBP, "image/webp", "image/webp")],
)
def test_real_files_are_accepted(content, declared, expected):
    got, ctype = asyncio.run(uploads.read_validated(FakeUpload(content, declared)))
    assert got == content and ctype == expected


def test_html_disguised_as_png_is_rejected():
    """The attack the sniffing exists to stop: script served from the storage origin."""
    payload = b"<html><script>alert(document.cookie)</script></html>"
    with pytest.raises(HTTPException) as err:
        asyncio.run(uploads.read_validated(FakeUpload(payload, "image/png")))
    assert err.value.status_code == 415


def test_declared_type_outside_the_allowlist_is_rejected():
    with pytest.raises(HTTPException) as err:
        asyncio.run(uploads.read_validated(FakeUpload(PNG, "text/html")))
    assert err.value.status_code == 415


def test_oversized_upload_is_rejected_before_being_buffered():
    big = PNG + b"\x00" * (uploads.MAX_BYTES + 1)
    with pytest.raises(HTTPException) as err:
        asyncio.run(uploads.read_validated(FakeUpload(big, "image/png")))
    assert err.value.status_code == 413


def test_empty_upload_is_rejected():
    with pytest.raises(HTTPException) as err:
        asyncio.run(uploads.read_validated(FakeUpload(b"", "image/png")))
    assert err.value.status_code == 400


def test_extension_comes_from_sniffed_type_not_the_filename():
    assert uploads.safe_extension("image/png") == "png"
    assert uploads.safe_extension("application/pdf") == "pdf"


# ------------------------------------------------------------ cache bounds

def test_fx_cache_evicts_and_stays_bounded(monkeypatch):
    """The cache key includes the row's date, so an unbounded dict would grow
    forever as historical rows are priced."""
    monkeypatch.setattr(fx, "MAX_CACHE_ENTRIES", 50)
    monkeypatch.setattr(fx, "_direct", lambda *_: Decimal("2"))
    fx._cache.clear()

    for day in range(200):
        fx.get_rate(None, "USD", "CAD", date(2020, 1, 1) + __import__("datetime").timedelta(days=day))

    assert len(fx._cache) <= 50
    fx._cache.clear()


def test_fx_cache_evicts_least_recently_used(monkeypatch):
    monkeypatch.setattr(fx, "MAX_CACHE_ENTRIES", 3)
    monkeypatch.setattr(fx, "_direct", lambda *_: Decimal("2"))
    fx._cache.clear()
    import datetime as dt

    days = [date(2020, 1, 1) + dt.timedelta(days=i) for i in range(3)]
    for d in days:
        fx.get_rate(None, "USD", "CAD", d)

    fx.get_rate(None, "USD", "CAD", days[0])          # touch the oldest
    fx.get_rate(None, "USD", "CAD", date(2021, 6, 1))  # force one eviction

    assert fx._key("USD", "CAD", days[0]) in fx._cache, "recently used entry was evicted"
    assert fx._key("USD", "CAD", days[1]) not in fx._cache
    fx._cache.clear()


def test_scan_log_prunes_users_outside_the_window():
    """Otherwise the dict keeps one entry per user who ever scanned, forever."""
    from app.routers import ocr as ocr_router

    ocr_router._scan_log.clear()
    ocr_router._scan_log["stale-user"] = [0.0]           # far outside the hour
    ocr_router._scan_log["recent-user"] = [1e9 - 10.0]   # inside it

    ocr_router._prune_scan_log(1e9)

    assert "stale-user" not in ocr_router._scan_log
    assert "recent-user" in ocr_router._scan_log
    ocr_router._scan_log.clear()


def test_scan_quota_blocks_past_the_ceiling():
    from app.routers import ocr as ocr_router

    ocr_router._scan_log.clear()
    for _ in range(ocr_router.SCANS_PER_HOUR):
        ocr_router._enforce_scan_quota("u1")

    with pytest.raises(HTTPException) as err:
        ocr_router._enforce_scan_quota("u1")
    assert err.value.status_code == 429

    ocr_router._enforce_scan_quota("u2")  # per-user, not global
    ocr_router._scan_log.clear()


# --------------------------------------------------------- budget envelopes

def _line(allocated, actual):
    """Apply the same derivation get_budget does, on one line."""
    from app.schemas import BudgetLine

    line = BudgetLine(
        category_name="Groceries", category_group="Food",
        allocated=Decimal(str(allocated)), actual=Decimal(str(actual)),
    )
    line.variance = line.allocated - line.actual
    line.used_pct = (
        float(line.actual / line.allocated * 100) if line.allocated > 0 else None
    )
    return line


def test_under_budget_leaves_a_positive_variance():
    line = _line(300, 220)
    assert line.variance == Decimal("80")
    assert line.used_pct == pytest.approx(73.33, abs=0.01)


def test_over_budget_is_a_negative_variance():
    """Overspend must read as negative, not as an absolute miss."""
    line = _line(300, 340)
    assert line.variance == Decimal("-40")
    assert line.used_pct == pytest.approx(113.33, abs=0.01)


def test_unbudgeted_spend_reports_no_percentage():
    """Nothing budgeted is a different state from 0% used, and the two must not
    render as the same bar."""
    line = _line(0, 120)
    assert line.used_pct is None
    assert line.variance == Decimal("-120")


def test_budgeted_but_unspent_is_zero_percent_not_none():
    line = _line(300, 0)
    assert line.used_pct == 0.0
    assert line.variance == Decimal("300")


# ------------------------------------------------------- account deletion

class _FakeUser:
    def __init__(self, email):
        self.id = "user-1"
        self.email = email
        self.client = None


def _delete_with(typed, account_email="owner@example.com"):
    from app.routers.catalog import delete_account
    from app.schemas import DeleteAccountIn

    return delete_account(
        DeleteAccountIn(confirm_email=typed),
        user=_FakeUser(account_email),
        settings=None,
        service=None,
    )


@pytest.mark.parametrize("typed", ["", "   ", "someone@else.com", "owner@example.co"])
def test_delete_refuses_without_the_right_email(typed):
    """Nothing destructive may run before the confirmation matches."""
    with pytest.raises(HTTPException) as err:
        _delete_with(typed)
    assert err.value.status_code == 400


def test_delete_confirmation_ignores_case_and_padding():
    """It gets typed by hand; a stray space should not block a real intent.

    This still fails at the storage step because the fakes are None — which is
    the point: it proves the guard let a correct email through.
    """
    with pytest.raises(HTTPException) as err:
        _delete_with("  Owner@Example.COM  ")
    assert err.value.status_code != 400
