"""Upload validation.

Two things a client says about a file cannot be trusted: its size and its type.

Size, because `await file.read()` pulls the whole body into memory before any
check can run — a large upload is a memory exhaustion attack, and the check that
follows it is too late to matter.

Type, because `UploadFile.content_type` is simply the Content-Type header the
client chose to send. A file uploaded as `image/png` but containing HTML is
stored with that declared type and later served from the Supabase Storage
origin through a signed URL. A browser that sniffs it, or a stored type of
`text/html`, turns an uploaded "receipt" into script running on that origin. So
the bytes are checked against known magic numbers and the declared type is
discarded in favour of what the file actually is.
"""

from __future__ import annotations

from fastapi import HTTPException, UploadFile, status

MAX_BYTES = 10 * 1024 * 1024
CHUNK = 64 * 1024

# Declared type -> the signatures that type must actually start with.
SIGNATURES: dict[str, tuple[bytes, ...]] = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/webp": (b"RIFF",),          # plus "WEBP" at offset 8, checked below
    "image/heic": (b"\x00\x00\x00",),  # ISO-BMFF box; "ftyp" at offset 4
    "application/pdf": (b"%PDF-",),
}

ALLOWED_TYPES = frozenset(SIGNATURES)


def _sniff(head: bytes) -> str | None:
    """The type the bytes actually are, ignoring what the client claimed."""
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"RIFF") and head[8:12] == b"WEBP":
        return "image/webp"
    if head[4:8] == b"ftyp" and head[8:12] in (b"heic", b"heix", b"hevc", b"mif1", b"msf1"):
        return "image/heic"
    if head.startswith(b"%PDF-"):
        return "application/pdf"
    return None


async def read_validated(file: UploadFile, max_bytes: int = MAX_BYTES) -> tuple[bytes, str]:
    """Stream the upload with a hard cap, then verify its real type.

    Returns (content, verified_content_type). The returned type comes from the
    file's own bytes and is what should be stored — never the client's header.
    """
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            f"Unsupported file type. Accepted: {', '.join(sorted(ALLOWED_TYPES))}",
        )

    # Read incrementally and stop the moment the cap is passed, so an oversized
    # upload never gets fully buffered.
    buffer = bytearray()
    while chunk := await file.read(CHUNK):
        buffer.extend(chunk)
        if len(buffer) > max_bytes:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                f"File is larger than {max_bytes // (1024 * 1024)} MB.",
            )

    if not buffer:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The uploaded file was empty.")

    actual = _sniff(bytes(buffer[:16]))
    if actual is None:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            "That file is not a readable image or PDF.",
        )
    if actual != file.content_type:
        # Not necessarily an attack — browsers mislabel HEIC routinely — but the
        # sniffed type is the one we trust and store.
        pass

    return bytes(buffer), actual


def safe_extension(content_type: str) -> str:
    """Extension derived from the verified type, never from the client's filename.

    A filename is attacker-controlled and can carry traversal segments or a
    second extension; deriving it from the sniffed type sidesteps both.
    """
    return {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/heic": "heic",
        "application/pdf": "pdf",
    }[content_type]
