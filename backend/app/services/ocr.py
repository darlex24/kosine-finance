"""Contextual global receipt / giving-statement OCR built on GPT-4o Vision.

The model is asked for structured JSON only. Whatever it returns about tax
treatment is treated as a *hint*: the authoritative deductibility decision is
re-derived locally from `giving.is_tax_deductible`, so a hallucinated flag can
never put a bad number on a CRA return.
"""

from __future__ import annotations

import base64
import json
from decimal import Decimal, InvalidOperation

from openai import AsyncOpenAI

from ..config import Settings
from ..giving import ARM_RULES, GivingArm, classify_text
from ..schemas import OcrLineItem, OcrResult

SYSTEM_PROMPT = """You read receipts, invoices and church giving statements from
anywhere in the world for a personal-finance app used by ministers and church
members. Documents may be in any language, currency, date format or script.

Return JSON only, matching this shape:
{
  "document_type": "receipt" | "giving_statement" | "unknown",
  "merchant": string | null,            // vendor, church, or ministry name
  "charity_registration_number": string | null,  // e.g. CRA BN 123456789RR0001, UK charity no.
  "date": "YYYY-MM-DD" | null,
  "total": number | null,
  "currency": "CAD" | "USD" | "NGN" | "GBP" | "EUR" | ...,  // ISO-4217
  "line_items": [{"description": string, "amount": number, "giving_arm": string | null}],
  "suggested_category": string | null,  // human label, e.g. "Groceries"
  "suggested_category_slug": string | null,
  "suggested_giving_arm": string | null,
  "notes": string | null,
  "confidence": number                  // 0..1
}

`giving_arm` must be one of: {arms}.
`suggested_category_slug` must be one of: {categories}.

Guidance:
- Currency: infer the ISO-4217 code from the printed symbol, tax wording (VAT,
  GST, IVA, TVA), language and address. "$" is ambiguous — use the country to
  decide between USD, CAD, AUD, SGD and so on. Only fall back to null if there is
  genuinely no signal.
- Dates: normalise to YYYY-MM-DD. Prefer the document's own locale to resolve
  DD/MM vs MM/DD ambiguity; note the ambiguity in `notes` when it is a coin toss.
- Amounts: report the grand total actually payable, after discounts, in the
  document's own currency. Never convert. Never invent a number — use null when
  a field is not legible, and lower `confidence` accordingly.
- A church or ministry statement is a "giving_statement". Map each line to the
  closest arm: "tithe", "firstfruit", partnership arms (Rhapsody, Healing School,
  InnerCity Mission, Loveworld, Campus, Foundation School), seeds, or alms.
- Only report `charity_registration_number` if it is actually printed.
- An honorarium or seed named for an individual minister is "prophet_seed".
"""

# Leaf categories the model may choose from. Kept in step with 0002 by slug; an
# unrecognised slug is discarded rather than written through.
CATEGORY_SLUGS = [
    "housing_rent", "housing_mortgage", "housing_property_tax", "housing_maintenance",
    "housing_furnishings", "housing_service_charge",
    "utilities_electricity", "utilities_water", "utilities_gas", "utilities_waste",
    "utilities_generator", "utilities_solar",
    "food_groceries", "food_dining", "food_delivery", "food_beverages", "food_hospitality",
    "transport_fuel", "transport_public", "transport_ride_hailing",
    "transport_maintenance", "transport_parking", "transport_licensing",
    "health_consultation", "health_pharmacy", "health_dental", "health_optical",
    "health_therapy", "health_fitness",
    "insurance_health", "insurance_life", "insurance_auto", "insurance_home",
    "insurance_travel",
    "education_tuition", "education_books", "education_courses", "education_conferences",
    "family_childcare", "family_school", "family_support", "family_activities",
    "personal_clothing", "personal_grooming", "personal_laundry", "personal_leisure",
    "ministry_travel", "ministry_materials", "ministry_hospitality",
    "ministry_equipment", "ministry_venue", "ministry_vestments",
    "giving_tithe", "giving_offering", "giving_partnership", "giving_seed", "giving_alms",
    "business_supplies", "business_software", "business_professional_fees",
    "business_marketing", "business_payroll",
    "taxes_income", "taxes_sales", "taxes_social", "taxes_permits",
    "debt_credit_card", "debt_personal_loan", "debt_student_loan", "debt_interest",
    "savings_emergency", "savings_deposit", "savings_retirement", "savings_brokerage",
    "savings_crypto", "savings_real_estate",
    "travel_flights", "travel_lodging", "travel_ground", "travel_visa", "travel_per_diem",
    "comms_mobile", "comms_internet", "comms_streaming", "comms_hardware",
    "fees_bank", "fees_transfer", "fees_platform", "fees_penalty",
    "gifts_personal", "gifts_celebration", "gifts_condolence",
    "income_salary", "income_honorarium", "income_business", "income_investment",
    "income_rental", "income_gift_received",
    "other_uncategorised",
]


def _decimal(value) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


async def extract(image_bytes: bytes, mime_type: str, settings: Settings) -> OcrResult:
    client = AsyncOpenAI(api_key=settings.openai_api_key)
    data_url = f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode()}"
    arms = ", ".join(a.value for a in GivingArm)

    response = await client.chat.completions.create(
        model=settings.openai_vision_model,
        response_format={"type": "json_object"},
        temperature=0,
        messages=[
            {
                "role": "system",
                "content": SYSTEM_PROMPT.replace("{arms}", arms).replace(
                    "{categories}", ", ".join(CATEGORY_SLUGS)
                ),
            },
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Extract this document."},
                    {"type": "image_url", "image_url": {"url": data_url, "detail": "high"}},
                ],
            },
        ],
    )

    raw = json.loads(response.choices[0].message.content or "{}")
    return _to_result(raw)


def _coerce_arm(value: str | None, fallback_text: str = "") -> GivingArm | None:
    if value:
        try:
            return GivingArm(value)
        except ValueError:
            pass
    return classify_text(f"{value or ''} {fallback_text}") or None


def _to_result(raw: dict) -> OcrResult:
    items: list[OcrLineItem] = []
    for item in raw.get("line_items") or []:
        amount = _decimal(item.get("amount"))
        if amount is None:
            continue
        description = str(item.get("description") or "")
        items.append(
            OcrLineItem(
                description=description,
                amount=amount,
                suggested_giving_arm=_coerce_arm(item.get("giving_arm"), description),
            )
        )

    doc_type = raw.get("document_type") or "unknown"
    merchant = raw.get("merchant")
    arm = _coerce_arm(raw.get("suggested_giving_arm"), merchant or "")
    if arm is None and doc_type == "giving_statement" and items:
        arm = items[0].suggested_giving_arm

    bn = (raw.get("charity_registration_number") or "").strip() or None

    # Authoritative CRA decision, made locally rather than trusted from the model.
    deductible = False
    note = raw.get("notes")
    if arm is not None:
        rule = ARM_RULES[arm]
        deductible = rule.default_tax_deductible and not (
            rule.requires_registered_charity and bn is None
        )
        if rule.requires_registered_charity and bn is None:
            note = (
                "No CRA registration number found on this document — flagged as "
                "non-receiptable until you add one."
            )
        elif rule.cra_note:
            note = rule.cra_note

    date_value = raw.get("date") or None

    # Only accept a slug we actually seeded; anything else is dropped so a
    # hallucinated category can never be written through to the ledger.
    slug = (raw.get("suggested_category_slug") or "").strip() or None
    if slug not in CATEGORY_SLUGS:
        slug = None
    if slug is None and arm is not None:
        slug = "giving_tithe" if arm.value == "tithe" else "giving_offering"

    currency = (raw.get("currency") or "").strip().upper() or None

    return OcrResult(
        document_type=doc_type,
        merchant=merchant,
        charity_registration_number=bn,
        date=date_value,
        total=_decimal(raw.get("total")),
        currency=currency or "CAD",
        line_items=items,
        suggested_category=raw.get("suggested_category"),
        suggested_category_slug=slug,
        suggested_giving_arm=arm,
        tax_deductible_flag=deductible,
        confidence=float(raw.get("confidence") or 0.0),
        notes=note,
    )
