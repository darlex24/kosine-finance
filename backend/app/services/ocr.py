"""Contextual receipt / giving-statement OCR built on GPT-4o Vision.

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

SYSTEM_PROMPT = """You read Canadian receipts and church giving statements for a
personal-finance app used by ministers and church members.

Return JSON only, matching this shape:
{
  "document_type": "receipt" | "giving_statement" | "unknown",
  "merchant": string | null,            // vendor, church, or ministry name
  "charity_registration_number": string | null,  // CRA BN like 123456789RR0001
  "date": "YYYY-MM-DD" | null,
  "total": number | null,
  "currency": "CAD" | "USD" | ...,
  "line_items": [{"description": string, "amount": number, "giving_arm": string | null}],
  "suggested_category": string | null,  // for ordinary spending, e.g. "groceries"
  "suggested_giving_arm": string | null,
  "notes": string | null,
  "confidence": number                  // 0..1
}

`giving_arm` must be one of: {arms}.

Guidance:
- A church or ministry statement is a "giving_statement". Map each line to the
  closest arm: "tithe", "firstfruit", partnership arms (Rhapsody, Healing School,
  InnerCity Mission, Loveworld, Campus, Foundation School), seeds, or alms.
- Only report `charity_registration_number` if it is actually printed.
- An honorarium or seed named for an individual minister is "prophet_seed".
- Never invent amounts. Use null when a field is not legible.
"""


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
            {"role": "system", "content": SYSTEM_PROMPT.replace("{arms}", arms)},
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

    return OcrResult(
        document_type=doc_type,
        merchant=merchant,
        charity_registration_number=bn,
        date=date_value,
        total=_decimal(raw.get("total")),
        currency=raw.get("currency") or "CAD",
        line_items=items,
        suggested_category=raw.get("suggested_category"),
        suggested_giving_arm=arm,
        tax_deductible_flag=deductible,
        confidence=float(raw.get("confidence") or 0.0),
        notes=note,
    )
