"""Daily retry of DOE PDFs that weekly sync could not download."""

from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path

import urllib.error

from .constants import REGION_KEY_BY_CODE
from .download import _is_inaccessible, download_slug
from .pending_downloads import (
    clear_pending_download,
    list_pending_downloads,
    touch_pending_error,
)


@dataclass
class PendingRetryResult:
    region_code: str
    week_start: str
    slug: str
    status: str  # recovered | still_pending | idle | error
    message: str
    price_rows: int = 0


def retry_pending_downloads(
    *,
    dest_dir: str | Path = "data/bulletins",
    dry_run: bool = False,
) -> list[PendingRetryResult]:
    """Probe every pending PDF; load and clear when available.

    If the queue is empty the daily workflow should exit quietly — nothing to
    automate. Still-403 rows stay pending for the next day.
    """
    pending = list_pending_downloads()
    if not pending:
        return [
            PendingRetryResult(
                region_code="",
                week_start="",
                slug="",
                status="idle",
                message="No pending DOE downloads — daily retry idle.",
            )
        ]

    # Lazy imports keep the idle path free of Supabase / dotenv deps.
    from .load_supabase import merge_bulletin_prices, record_doe_website_fetch
    from .parse_bulletin import parse_bulletin_pdf

    results: list[PendingRetryResult] = []
    recovered_any = False
    dest = Path(dest_dir)

    for item in pending:
        region_key = REGION_KEY_BY_CODE.get(item.region_code)
        if not region_key:
            results.append(
                PendingRetryResult(
                    region_code=item.region_code,
                    week_start=item.bulletin_date.isoformat(),
                    slug=item.slug,
                    status="error",
                    message=f"Unknown region_code {item.region_code}",
                )
            )
            continue

        try:
            path = download_slug(
                item.region_code, item.slug, dest, item.source_url
            )
        except (urllib.error.HTTPError, RuntimeError) as exc:
            if _is_inaccessible(exc):
                if not dry_run:
                    touch_pending_error(item.id, str(exc))
                results.append(
                    PendingRetryResult(
                        region_code=item.region_code,
                        week_start=item.bulletin_date.isoformat(),
                        slug=item.slug,
                        status="still_pending",
                        message=f"Still unavailable: {exc}",
                    )
                )
                continue
            results.append(
                PendingRetryResult(
                    region_code=item.region_code,
                    week_start=item.bulletin_date.isoformat(),
                    slug=item.slug,
                    status="error",
                    message=str(exc),
                )
            )
            continue

        try:
            parsed = parse_bulletin_pdf(
                path,
                item.region_code,
                fallback_week_start=item.bulletin_date,
                source_url=item.source_url,
            )
            # Prefer the pending week's date so we merge into the right bulletin.
            if parsed.bulletin_date != item.bulletin_date:
                parsed = replace(parsed, bulletin_date=item.bulletin_date)

            stats = merge_bulletin_prices(parsed, dry_run=dry_run)
            if not dry_run:
                clear_pending_download(
                    region_code=item.region_code,
                    bulletin_date=item.bulletin_date,
                    slug=item.slug,
                )
            recovered_any = True
            results.append(
                PendingRetryResult(
                    region_code=item.region_code,
                    week_start=item.bulletin_date.isoformat(),
                    slug=item.slug,
                    status="recovered",
                    message=(
                        "Dry run — would merge."
                        if dry_run
                        else "Downloaded and merged into stored week."
                    ),
                    price_rows=int(stats.get("price_rows", 0)),
                )
            )
        except Exception as exc:  # noqa: BLE001 — keep other pending items moving
            if not dry_run:
                touch_pending_error(item.id, str(exc))
            results.append(
                PendingRetryResult(
                    region_code=item.region_code,
                    week_start=item.bulletin_date.isoformat(),
                    slug=item.slug,
                    status="error",
                    message=str(exc),
                )
            )

    if recovered_any and not dry_run:
        record_doe_website_fetch(trigger="pending-retry")

    return results
