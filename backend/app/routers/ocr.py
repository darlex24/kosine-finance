"""Receipt and giving-statement capture."""

from __future__ import annotations

import logging
import time
import uuid
from collections import defaultdict

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from openai import (
    APIConnectionError,
    APIError,
    APITimeoutError,
    AuthenticationError,
    RateLimitError,
)
from pydantic import ValidationError
from supabase import Client

from ..config import Settings, get_settings
from ..deps import CurrentUser, get_current_user, get_service_client
from ..schemas import EntrySource, LedgerRowIn, LedgerRowOut, OcrResult
from ..services import ocr as ocr_service
from ..services import uploads
from .ledger import _insert as insert_ledger_row

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_BYTES = uploads.MAX_BYTES
ALLOWED_TYPES = uploads.ALLOWED_TYPES

# Each scan is a paid vision call. Without a ceiling, one signed-in user — or a
# stolen token — can drain the OpenAI account. Per-user, in-process; a
# multi-worker deployment should move this to Redis.
SCANS_PER_HOUR = 60
_scan_log: dict[str, list[float]] = defaultdict(list)

# Receipt links are bearer credentials: anyone holding one reads the object,
# with no session and no further check. A week was far longer than any legitimate
# use — the link is followed moments after it is issued — and long enough for a
# forwarded email or a screenshot to stay live. One hour, re-signed on demand by
# GET /api/ledger/{id}/receipt-url.
SIGNED_URL_TTL = 60 * 60


def _prune_scan_log(now: float) -> None:
    """Drop users with nothing in the window.

    Without this the dict keeps one entry per user that has ever scanned, for
    the life of the process — a slow leak that grows with the user base.
    """
    stale = [uid for uid, hits in _scan_log.items() if not any(now - t < 3600 for t in hits)]
    for uid in stale:
        del _scan_log[uid]


def _enforce_scan_quota(user_id: str) -> None:
    now = time.monotonic()
    if len(_scan_log) > 1000:
        _prune_scan_log(now)
    recent = [t for t in _scan_log[user_id] if now - t < 3600]
    if len(recent) >= SCANS_PER_HOUR:
        oldest = min(recent)
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Scan limit reached ({SCANS_PER_HOUR}/hour). "
            f"Try again in {int((3600 - (now - oldest)) / 60) + 1} minutes.",
        )
    recent.append(now)
    _scan_log[user_id] = recent


@router.post("/ocr/scan", response_model=OcrResult)
async def scan_document(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    """Read a receipt or church giving statement and return structured fields.

    Nothing is written here — the client reviews the extraction, then posts to
    /transactions or /giving.
    """
    if not settings.openai_api_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "OCR is not configured")
    _enforce_scan_quota(user.id)
    content, content_type = await uploads.read_validated(file)

    # Anything raised past here would become an unhandled 500, and Starlette's
    # error handler sits OUTSIDE CORSMiddleware — so the response reaches the
    # browser without CORS headers and the caller sees a bare "Failed to fetch"
    # instead of the reason. Every failure below is turned into a real response.
    try:
        return await ocr_service.extract(content, content_type, settings)
    except AuthenticationError as exc:
        logger.error("OpenAI rejected the API key: %s", exc)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "The OpenAI API key was rejected. Check OPENAI_API_KEY in backend/.env.",
        ) from exc
    except RateLimitError as exc:
        detail = str(exc)  # inspected locally only; never returned verbatim
        if "insufficient_quota" in detail or "credit" in detail.lower():
            message = (
                "The OpenAI account has no credits remaining, so the receipt "
                "could not be read. Add credits, then scan again — or enter the "
                "entry by hand in the ledger."
            )
        else:
            message = "OpenAI is rate limiting requests. Wait a moment and scan again."
        logger.error("OpenAI rate limit / quota: %s", exc)
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, message) from exc
    except APITimeoutError as exc:
        logger.error("OpenAI timed out: %s", exc)
        raise HTTPException(
            status.HTTP_504_GATEWAY_TIMEOUT,
            "Reading the document timed out. Try a smaller or clearer image.",
        ) from exc
    except (APIConnectionError, APIError) as exc:
        # Full detail to the log, none to the caller: provider errors quote
        # request URLs and headers.
        logger.error("OpenAI call failed: %s", exc)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Could not reach the document-reading service. Try again shortly.",
        ) from exc
    except (ValueError, KeyError, TypeError) as exc:
        # Malformed JSON back from the model, or a shape we did not expect.
        logger.error("Could not parse the OCR response: %s", exc)
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "The document was read but could not be understood. Try a clearer image.",
        ) from exc


@router.post("/ocr/upload")
async def upload_receipt(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    service: Client = Depends(get_service_client),
):
    """Store the image in Supabase Storage under the user's own prefix."""
    content, content_type = await uploads.read_validated(file)
    # Extension and stored type both come from the sniffed bytes, never from the
    # client's filename or header.
    path = f"{user.id}/{uuid.uuid4()}.{uploads.safe_extension(content_type)}"

    bucket = service.storage.from_(settings.supabase_receipt_bucket)
    bucket.upload(path, content, {"content-type": content_type, "upsert": "false"})
    signed = bucket.create_signed_url(path, SIGNED_URL_TTL)
    return {"path": path, "signed_url": signed.get("signedURL") or signed.get("signedUrl")}


@router.post("/ocr/commit", response_model=LedgerRowOut, status_code=201)
async def commit_scan(
    file: UploadFile | None = File(default=None),
    row: str = Form(...),
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    service: Client = Depends(get_service_client),
):
    """Store the receipt image and write the reviewed extraction into the ledger.

    `row` is the JSON the user confirmed in the scan preview — their corrections
    win over anything the model read. One round trip: image up, row in the grid.
    """
    try:
        payload = LedgerRowIn.model_validate_json(row)
    except ValidationError as exc:
        # Field names and messages only — the raw error carries input values.
        detail = "; ".join(
            f"{'.'.join(str(p) for p in e.get('loc', []))}: {e.get('msg')}"
            for e in exc.errors()
        )
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail) from exc

    payload.source = EntrySource.OCR
    # Server-controlled: a client must not be able to point a ledger row at an
    # arbitrary URL, since the UI renders it, nor at another user's storage path.
    payload.receipt_image_url = None
    payload.receipt_storage_path = None

    if file is not None:
        content, content_type = await uploads.read_validated(file)
        path = f"{user.id}/{uuid.uuid4()}.{uploads.safe_extension(content_type)}"
        try:
            bucket = service.storage.from_(settings.supabase_receipt_bucket)
            bucket.upload(path, content, {"content-type": content_type, "upsert": "false"})
            signed = bucket.create_signed_url(path, SIGNED_URL_TTL)
            payload.receipt_storage_path = path
            payload.receipt_image_url = signed.get("signedURL") or signed.get("signedUrl")
        except Exception as exc:  # noqa: BLE001
            # Storage is misconfigured (missing bucket, bad service-role key) or
            # unreachable. The extraction the user just reviewed is the valuable
            # part — keep the entry rather than losing it over the image, and
            # note why the receipt is not attached.
            logger.warning("Receipt upload failed, saving entry without image: %s", exc)
            payload.memo = " · ".join(
                filter(None, [payload.memo, "receipt image not stored"])
            )

    # trusted: the URL and path just above were produced by this handler.
    return insert_ledger_row(user, payload, trusted_receipt=True)
