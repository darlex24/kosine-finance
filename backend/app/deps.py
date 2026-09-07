"""Request-scoped Supabase clients.

Every request carries the caller's Supabase access token. We build a client bound
to that token so PostgREST runs each query as the signed-in user and the RLS
policies in `0001_init.sql` — not application code — are what actually enforce
data isolation.

The token is verified **locally** against Supabase's published signing keys.
Calling `auth.get_user()` instead would put a network round-trip in front of
every single API request: a dashboard load fires five parallel calls, so that is
five extra hops to Supabase Auth per page view, and Auth's own rate limits
become the ceiling long before Postgres is troubled. Local verification is the
same guarantee — a signature check against the issuer's public key — without the
hop. The network path is kept only as a fallback for when the key set cannot be
fetched, so an outage degrades to slow rather than to broken.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass

import jwt
from fastapi import Depends, Header, HTTPException, status
from jwt import PyJWKClient
from supabase import Client, create_client

from .config import Settings, get_settings

logger = logging.getLogger(__name__)

# Supabase signs with ES256/RS256 and publishes the public keys; PyJWKClient
# caches them in-process and refetches on rotation.
_jwks_client: PyJWKClient | None = None
_jwks_lock = threading.Lock()

# One service-role client for the process. Its credentials never vary per
# request and nothing mutates its headers, so the connection pool is safe to
# share — unlike the per-user client below, where a shared pool would risk one
# request's bearer token bleeding into another's.
_service_client: Client | None = None
_service_lock = threading.Lock()


@dataclass
class CurrentUser:
    id: str
    email: str
    token: str
    client: Client


def _bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    return authorization.split(" ", 1)[1].strip()


def _jwks(settings: Settings) -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        with _jwks_lock:
            if _jwks_client is None:
                _jwks_client = PyJWKClient(
                    f"{settings.supabase_url}/auth/v1/.well-known/jwks.json",
                    cache_keys=True,
                    lifespan=3600,
                )
    return _jwks_client


def _claims(token: str, settings: Settings) -> dict | None:
    """Verify the token locally. Returns None only when verification could not be
    *attempted* — a bad signature raises rather than falling through."""
    try:
        algorithm = jwt.get_unverified_header(token).get("alg", "")
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Malformed token") from exc

    if algorithm == "HS256":
        # Legacy shared-secret projects.
        if not settings.supabase_jwt_secret:
            return None
        key: object = settings.supabase_jwt_secret
    else:
        try:
            key = _jwks(settings).get_signing_key_from_jwt(token).key
        except Exception as exc:  # noqa: BLE001 - unreachable JWKS, or rotated kid
            logger.warning("JWKS lookup failed, falling back to Auth API: %s", exc)
            return None

    try:
        return jwt.decode(
            token,
            key,
            algorithms=[algorithm],
            audience="authenticated",
            issuer=f"{settings.supabase_url}/auth/v1",
            options={"verify_exp": True},
        )
    except jwt.InvalidTokenError as exc:
        # Expired, wrong audience, bad signature — all genuinely unauthorised.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token") from exc


def get_current_user(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    token = _bearer(authorization)
    client = create_client(settings.supabase_url, settings.supabase_anon_key)
    # Bind the user's JWT so all subsequent PostgREST calls run under their RLS role.
    client.postgrest.auth(token)

    claims = _claims(token, settings)
    if claims is not None:
        user_id = claims.get("sub")
        if not user_id:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token carries no subject")
        return CurrentUser(
            id=user_id,
            email=claims.get("email") or "",
            token=token,
            client=client,
        )

    # Fallback: the key set could not be read. Costs a round-trip but still verifies.
    try:
        result = client.auth.get_user(token)
    except Exception as exc:  # noqa: BLE001 - surface any auth failure as 401
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token") from exc

    user = getattr(result, "user", None)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")

    return CurrentUser(id=user.id, email=user.email or "", token=token, client=client)


def get_service_client(settings: Settings = Depends(get_settings)) -> Client:
    """Service-role client. Bypasses RLS — use only for reference data and storage."""
    global _service_client
    if _service_client is None:
        with _service_lock:
            if _service_client is None:
                _service_client = create_client(
                    settings.supabase_url, settings.supabase_service_role_key
                )
    return _service_client
