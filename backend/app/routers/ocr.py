"""Receipt and giving-statement capture."""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import ValidationError
from supabase import Client

from ..config import Settings, get_settings
from ..deps import CurrentUser, get_current_user, get_service_client
from ..schemas import EntrySource, LedgerRowIn, LedgerRowOut, OcrResult
from ..services import ocr as ocr_service
from .ledger import _insert as insert_ledger_row

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_BYTES = 10 * 1024 * 1024
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"}


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
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, f"Unsupported type {file.content_type}"
        )
    content = await file.read()
    if len(content) > MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File over 10 MB")
    if not settings.openai_api_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "OCR is not configured")

    return await ocr_service.extract(content, file.content_type, settings)


@router.post("/ocr/upload")
async def upload_receipt(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    service: Client = Depends(get_service_client),
):
    """Store the image in Supabase Storage under the user's own prefix."""
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, f"Unsupported type {file.content_type}"
        )
    content = await file.read()
    suffix = (file.filename or "").rsplit(".", 1)[-1].lower() or "jpg"
    path = f"{user.id}/{uuid.uuid4()}.{suffix}"

    service.storage.from_(settings.supabase_receipt_bucket).upload(
        path, content, {"content-type": file.content_type, "upsert": "false"}
    )
    signed = service.storage.from_(settings.supabase_receipt_bucket).create_signed_url(
        path, 60 * 60 * 24 * 365
    )
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
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, exc.errors()) from exc

    payload.source = EntrySource.OCR

    if file is not None:
        if file.content_type not in ALLOWED_TYPES:
            raise HTTPException(
                status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                f"Unsupported type {file.content_type}",
            )
        content = await file.read()
        if len(content) > MAX_BYTES:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File over 10 MB")

        suffix = (file.filename or "").rsplit(".", 1)[-1].lower() or "jpg"
        path = f"{user.id}/{uuid.uuid4()}.{suffix}"
        try:
            bucket = service.storage.from_(settings.supabase_receipt_bucket)
            bucket.upload(
                path, content, {"content-type": file.content_type, "upsert": "false"}
            )
            signed = bucket.create_signed_url(path, 60 * 60 * 24 * 365)
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

    return insert_ledger_row(user, payload)
