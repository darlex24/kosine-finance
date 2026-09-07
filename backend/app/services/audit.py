"""Audit trail for destructive actions.

Written with the service role, never the caller's client: an audit entry a user
can delete is not an audit entry. RLS lets them read their own history and write
none of it.

Failing to log must never fail the action itself — losing the record is bad,
refusing a deletion the user asked for because logging broke is worse.
"""

from __future__ import annotations

import logging

from supabase import Client

logger = logging.getLogger(__name__)


def record(
    service: Client,
    *,
    user_id: str | None,
    actor_email: str | None,
    action: str,
    entity: str | None = None,
    entity_count: int | None = None,
    detail: dict | None = None,
) -> None:
    """Log one event. Deliberately records that something happened, not what was
    in it — storing the contents of a deletion would defeat the deletion."""
    try:
        service.table("audit_log").insert(
            {
                "user_id": user_id,
                "actor_email": actor_email,
                "action": action,
                "entity": entity,
                "entity_count": entity_count,
                "detail": detail,
            }
        ).execute()
    except Exception as exc:  # noqa: BLE001
        logger.error("Could not write audit entry for %s/%s: %s", user_id, action, exc)
