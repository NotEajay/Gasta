"""Track DOE bulletin PDFs that weekly sync could not download.

A separate daily workflow (`retry-pending`) probes only these rows. When a file
becomes available it is merged into that week's region prices and the row is
removed so daily automation stops for that gap.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone

from typing import Any


@dataclass(frozen=True)
class PendingDownload:
    id: int
    region_code: str
    bulletin_date: date
    slug: str
    source_url: str
    last_error: str | None = None


def _client():
    from .load_supabase import _client as supabase_client

    return supabase_client()


def upsert_pending_download(
    *,
    region_code: str,
    bulletin_date: date,
    slug: str,
    source_url: str,
    last_error: str | None = None,
) -> None:
    """Remember a skipped PDF so the daily retry workflow can probe it."""
    client = _client()
    now = datetime.now(timezone.utc).isoformat()
    client.table("doe_pending_downloads").upsert(
        {
            "region_code": region_code,
            "bulletin_date": bulletin_date.isoformat(),
            "slug": slug,
            "source_url": source_url,
            "last_error": (last_error or "")[:500] or None,
            "updated_at": now,
        },
        on_conflict="region_code,bulletin_date,slug",
    ).execute()


def clear_pending_download(
    *, region_code: str, bulletin_date: date, slug: str
) -> None:
    """Remove a pending row after a successful download (weekly or daily retry)."""
    client = _client()
    (
        client.table("doe_pending_downloads")
        .delete()
        .eq("region_code", region_code)
        .eq("bulletin_date", bulletin_date.isoformat())
        .eq("slug", slug)
        .execute()
    )


def list_pending_downloads() -> list[PendingDownload]:
    """All open gaps, oldest first."""
    client = _client()
    response = (
        client.table("doe_pending_downloads")
        .select("id,region_code,bulletin_date,slug,source_url,last_error")
        .order("created_at", desc=False)
        .execute()
    )
    items: list[PendingDownload] = []
    for row in response.data or []:
        items.append(
            PendingDownload(
                id=int(row["id"]),
                region_code=row["region_code"],
                bulletin_date=date.fromisoformat(row["bulletin_date"]),
                slug=row["slug"],
                source_url=row["source_url"],
                last_error=row.get("last_error"),
            )
        )
    return items


def touch_pending_error(pending_id: int, last_error: str) -> None:
    """Update last_error / updated_at when a daily probe still fails."""
    client = _client()
    client.table("doe_pending_downloads").update(
        {
            "last_error": last_error[:500],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", pending_id).execute()


def update_pending_source_url(pending_id: int, source_url: str) -> None:
    """Record a newly discovered official URL for the same queued bulletin."""
    client = _client()
    client.table("doe_pending_downloads").update(
        {
            "source_url": source_url,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", pending_id).execute()


def pending_count() -> int:
    client = _client()
    response = (
        client.table("doe_pending_downloads").select("id", count="exact").execute()
    )
    if response.count is not None:
        return int(response.count)
    return len(response.data or [])
