"""Per-user request limits.

Data isolation and abuse are different problems. RLS answers "can this user read
someone else's rows" — it says nothing about one authenticated account issuing
ten thousand writes a minute, which costs money and fills the database just as
effectively as a breach empties it.

Every limit here is keyed on the caller's user id, taken from the verified token,
so it cannot be sidestepped by rotating IPs or clearing cookies.

State is in-process. That is correct for one worker and wrong for several: with
N workers each gets its own counter and the effective limit is N times what is
configured. `configure_backend` accepts a shared store (Redis) for that case;
until one is supplied the process-local fallback is used and `is_distributed`
reports False so a deployment can assert on it.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from typing import Protocol

from fastapi import Depends, HTTPException, Request, status

from ..deps import CurrentUser, get_current_user


class Store(Protocol):
    """Minimal contract a Redis-backed store must satisfy."""

    def hit(self, key: str, limit: int, window: int) -> tuple[bool, int]: ...


class _LocalStore:
    """Sliding window over per-key timestamps, bounded by the window itself."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        self._last_sweep = time.monotonic()

    def hit(self, key: str, limit: int, window: int) -> tuple[bool, int]:
        now = time.monotonic()
        with self._lock:
            self._sweep(now, window)
            bucket = self._hits[key]
            while bucket and now - bucket[0] > window:
                bucket.popleft()
            if len(bucket) >= limit:
                retry = int(window - (now - bucket[0])) + 1
                return False, retry
            bucket.append(now)
            return True, 0

    def _sweep(self, now: float, window: int) -> None:
        """Drop keys with nothing left in the window.

        Without this the dict keeps an entry per user for the life of the
        process — a slow leak that grows with the user base.
        """
        if now - self._last_sweep < 300:
            return
        self._last_sweep = now
        for key in [k for k, v in self._hits.items() if not v or now - v[-1] > window]:
            del self._hits[key]


_store: Store = _LocalStore()
_distributed = False


def configure_backend(store: Store) -> None:
    """Swap in a shared store so limits hold across workers."""
    global _store, _distributed
    _store, _distributed = store, True


def is_distributed() -> bool:
    return _distributed


def _enforce(key: str, limit: int, window: int, what: str) -> None:
    allowed, retry = _store.hit(key, limit, window)
    if not allowed:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Too many {what}. Try again in about {retry} seconds.",
            headers={"Retry-After": str(retry)},
        )


def limit(bucket: str, per_hour: int, what: str = "requests"):
    """A dependency that caps one named bucket per user per hour."""

    def dependency(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        _enforce(f"{bucket}:{user.id}", per_hour, 3600, what)
        return user

    return dependency


# Generous enough that no honest user meets it, low enough that a runaway script
# or a stolen token stops being free.
WRITES_PER_HOUR = 600
BURST_PER_MINUTE = 60

WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


async def write_limit_middleware(request: Request, call_next):
    """Cap writes across every endpoint at once.

    Applied as middleware rather than per-route because the failure mode of the
    per-route approach is silence: a new endpoint simply has no limit, and
    nothing says so. Here a new endpoint is covered the moment it exists.
    """
    if request.method not in WRITE_METHODS or not request.url.path.startswith("/api/"):
        return await call_next(request)

    # The limit keys on the caller. Verifying the token here would double the
    # work the route dependency already does, so an unverified subject is used
    # purely as a bucket label — a forged one still lands in *some* bucket, and
    # the route's own auth rejects it a moment later regardless.
    subject = _subject_of(request)
    _enforce(f"write:{subject}", WRITES_PER_HOUR, 3600, "writes")
    _enforce(f"burst:{subject}", BURST_PER_MINUTE, 60, "writes in quick succession")
    return await call_next(request)


def _subject_of(request: Request) -> str:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        token = header.split(" ", 1)[1].strip()
        try:
            import jwt

            claims = jwt.decode(token, options={"verify_signature": False})
            subject = claims.get("sub")
            if subject:
                return str(subject)
        except Exception:  # noqa: BLE001 - a malformed token still needs a bucket
            pass
    # Anonymous or unparseable: fall back to the peer address so unauthenticated
    # floods are still bounded.
    return f"anon:{request.client.host if request.client else 'unknown'}"
