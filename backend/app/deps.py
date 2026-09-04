"""Request-scoped Supabase clients.

Every request carries the caller's Supabase access token. We build a client bound
to that token so PostgREST runs each query as the signed-in user and the RLS
policies in `0001_init.sql` — not application code — are what actually enforce
data isolation.
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, status
from supabase import Client, create_client

from .config import Settings, get_settings


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


def get_current_user(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    token = _bearer(authorization)
    client = create_client(settings.supabase_url, settings.supabase_anon_key)
    # Bind the user's JWT so all subsequent PostgREST calls run under their RLS role.
    client.postgrest.auth(token)

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
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
