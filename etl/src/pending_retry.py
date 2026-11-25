"""Daily retry of DOE PDFs that weekly sync could not download."""

from __future__ import annotations

import time
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path

import urllib.error

from .constants import REGION_KEY_BY_CODE
from .discover import (
    discover_region_documents,
    discover_weeks_from_page_headings,
    fetch_region_page_html,
    group_documents_by_week,
    subregion_for_slug,
)
from .download import _is_inaccessible, download_slug
from .region_results import (
    RegionRunResult,
    confirm_pending,
    new_region_results,
    region_results_payload,
)
from .pending_downloads import (
    PendingDownload,
    clear_pending_download,
    list_pending_downloads,
    touch_pending_error,
    update_pending_source_url,
)


@dataclass
class PendingRetryResult:
    region_code: str
    week_start: str
    slug: str
    status: str  # recovered | still_pending | idle | error
    message: str
    price_rows: int = 0
    failed_step: str | None = None


def _rediscover_same_week_url(item: PendingDownload) -> str | None:
    """Find a current official media URL for the queued region/week/sub-region."""
    if item.region_code == "NCR":
        documents = discover_region_documents(item.region_code)
        bulletins, _ = group_documents_by_week(documents)
        for bulletin in bulletins:
            if bulletin.week_start != item.bulletin_date:
                continue
            return next((url for url in bulletin.urls if url), None)
        return None
    if item.region_code != "SOUTH_LUZON":
        return None

    page_url, html_text = fetch_region_page_html(item.region_code)
    target_subregion = subregion_for_slug(item.region_code, item.slug)
    if not target_subregion:
        return None

    for bulletin in discover_weeks_from_page_headings(
        html_text,
        page_url,
        item.region_code,
    ):
        if bulletin.week_start != item.bulletin_date:
            continue
        for slug, url in zip(bulletin.slugs, bulletin.urls):
            if (
                url
                and subregion_for_slug(item.region_code, slug) == target_subregion
            ):
                return url
    return None


def _retry_failure_details(
    results: list[PendingRetryResult],
) -> tuple[str | None, str | None]:
    failures = [r for r in results if r.status in {"still_pending", "error"}]
    if not failures:
        return None, None
    reason = "; ".join(
        f"{r.region_code}/{r.slug}: {r.message}" for r in failures
    )
    steps = dict.fromkeys(r.failed_step for r in failures if r.failed_step)
    return reason, "; ".join(steps) or None


def retry_pending_downloads(
    *,
    dest_dir: str | Path = "data/bulletins",
    dry_run: bool = False,
) -> list[PendingRetryResult]:
    """Probe every pending PDF; load and clear when available.

    If the queue is empty the daily workflow should exit quietly — nothing to
    automate. Still-403 rows stay pending for the next day.
    """
    started_at = datetime.now(timezone.utc)
    t_start = time.monotonic()

    from .load_supabase import (
        merge_bulletin_prices,
        record_doe_website_fetch,
        try_record_etl_run,
    )
    from .parse_bulletin import parse_bulletin_pdf

    results: list[PendingRetryResult] = []
    region_results = new_region_results()
    observation: RegionRunResult | None = None
    recovered_any = False
    current_step = "load pending queue"

    try:
        pending = list_pending_downloads()
        queued_regions = {item.region_code for item in pending}
        for region in region_results.values():
            if region.region_code not in queued_regions:
                region.status = "no_work"
        if not pending:
            results.append(
                PendingRetryResult(
                    region_code="",
                    week_start="",
                    slug="",
                    status="idle",
                    message="No pending DOE downloads — daily retry idle.",
                )
            )
        else:
            dest = Path(dest_dir)

            for item in pending:
                observation = region_results.get(item.region_code)
                current_step = "region validation"
                region_key = REGION_KEY_BY_CODE.get(item.region_code)
                if not region_key:
                    results.append(
                        PendingRetryResult(
                            region_code=item.region_code,
                            week_start=item.bulletin_date.isoformat(),
                            slug=item.slug,
                            status="error",
                            message=f"Unknown region_code {item.region_code}",
                            failed_step=current_step,
                        )
                    )
                    continue

                observation.start("PDF download")
                observation.week_start = item.bulletin_date.isoformat()
                observation.slug = item.slug
                observation.retry_queued = None
                observation.retry_checked_at = None
                source_url = item.source_url
                current_step = "PDF download"
                try:
                    path = download_slug(item.region_code, item.slug, dest, source_url)
                except (urllib.error.HTTPError, RuntimeError) as exc:
                    if _is_inaccessible(exc):
                        try:
                            current_step = "PDF URL rediscovery"
                            rediscovered_url = _rediscover_same_week_url(item)
                        except Exception as rediscovery_exc:  # noqa: BLE001
                            rediscovered_url = None
                            rediscovery_error = (
                                f" Archive rediscovery failed: "
                                f"{type(rediscovery_exc).__name__}: {rediscovery_exc}."
                            )
                        else:
                            rediscovery_error = ""

                        current_step = "PDF download"
                        if rediscovered_url and rediscovered_url != source_url:
                            try:
                                path = download_slug(
                                    item.region_code,
                                    item.slug,
                                    dest,
                                    rediscovered_url,
                                )
                                source_url = rediscovered_url
                                if not dry_run:
                                    current_step = "pending URL update"
                                    update_pending_source_url(item.id, rediscovered_url)
                            except (urllib.error.HTTPError, RuntimeError) as retry_exc:
                                exc = retry_exc
                            else:
                                pass
                        else:
                            path = None

                        if path is None:
                            message = f"Still unavailable: {exc}.{rediscovery_error}"
                            observation.step = "PDF download"
                            observation.downloaded(False)
                            issue = observation.issue("not_fetched", message)
                            if not dry_run:
                                current_step = "pending error update"
                                pending_row = touch_pending_error(item.id, message)
                                queued, checked_at = confirm_pending(
                                    pending_row, region_code=item.region_code,
                                    week_start=item.bulletin_date.isoformat(), slug=item.slug,
                                )
                                issue.update(retry_queued=queued, retry_checked_at=checked_at)
                            results.append(
                                PendingRetryResult(
                                    region_code=item.region_code,
                                    week_start=item.bulletin_date.isoformat(),
                                    slug=item.slug,
                                    status="still_pending",
                                    message=message,
                                    failed_step="PDF download",
                                )
                            )
                            continue
                    else:
                        observation.failed(exc)
                        results.append(
                            PendingRetryResult(
                                region_code=item.region_code,
                                week_start=item.bulletin_date.isoformat(),
                                slug=item.slug,
                                status="error",
                                message=str(exc),
                                failed_step="PDF download",
                            )
                        )
                        continue

                observation.downloaded(True)
                observation.parse_input_available = True
                item_failed_step = "PDF parse"
                try:
                    current_step = item_failed_step
                    observation.step = item_failed_step
                    parsed = parse_bulletin_pdf(
                        path,
                        item.region_code,
                        fallback_week_start=item.bulletin_date,
                        source_url=source_url,
                    )
                    # Prefer the pending week's date so we merge into the right bulletin.
                    if parsed.bulletin_date != item.bulletin_date:
                        parsed = replace(parsed, bulletin_date=item.bulletin_date)

                    item_failed_step = "price merge"
                    current_step = item_failed_step
                    observation.step = item_failed_step
                    stats = merge_bulletin_prices(parsed, dry_run=dry_run)
                    observation.price_rows += int(stats.get("price_rows", 0))
                    if "companies" in stats:
                        observation.companies = (observation.companies or 0) + int(stats["companies"])
                    if not dry_run:
                        item_failed_step = "pending queue cleanup"
                        current_step = item_failed_step
                        observation.step = item_failed_step
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
                    observation.step = item_failed_step
                    observation.failed(exc)
                    if not dry_run:
                        current_step = "pending error update"
                        pending_row = touch_pending_error(item.id, str(exc))
                        queued, checked_at = confirm_pending(
                            pending_row, region_code=item.region_code,
                            week_start=item.bulletin_date.isoformat(), slug=item.slug,
                        )
                        observation.issues[-1].update(
                            retry_queued=queued, retry_checked_at=checked_at
                        )
                    results.append(
                        PendingRetryResult(
                            region_code=item.region_code,
                            week_start=item.bulletin_date.isoformat(),
                            slug=item.slug,
                            status="error",
                            message=str(exc),
                            failed_step=item_failed_step,
                        )
                    )

            observation = None
            if recovered_any and not dry_run:
                current_step = "latest DOE fetch state"
                record_doe_website_fetch(trigger="pending-retry")
    except Exception as exc:
        if observation is not None:
            observation.step = current_step
            observation.failed(exc)
        if not dry_run:
            ended_at = datetime.now(timezone.utc)
            recovered = [r for r in results if r.status == "recovered"]
            still_pending = [r for r in results if r.status == "still_pending"]
            errors = [r for r in results if r.status == "error"]
            try_record_etl_run(
                workflow="pending-retry",
                status="failed",
                started_at=started_at,
                ended_at=ended_at,
                regions_ok=len(recovered),
                regions_failed=len(errors),
                regions_skipped=len(still_pending),
                duration_s=time.monotonic() - t_start,
                failure_reason=f"{type(exc).__name__}: {exc}",
                failed_step=current_step,
                region_results=region_results_payload(region_results),
            )
        raise

    if not dry_run:
        ended_at = datetime.now(timezone.utc)
        recovered = [r for r in results if r.status == "recovered"]
        still_pending = [r for r in results if r.status == "still_pending"]
        errors = [r for r in results if r.status == "error"]
        if errors:
            status = "partial" if recovered else "failed"
        elif still_pending:
            status = "partial"
        else:
            status = "success"
        failure_reason, failed_step = _retry_failure_details(results)
        try_record_etl_run(
            workflow="pending-retry",
            status=status,
            started_at=started_at,
            ended_at=ended_at,
            regions_ok=len(recovered),
            regions_failed=len(errors),
            regions_skipped=len(still_pending),
            duration_s=time.monotonic() - t_start,
            failure_reason=failure_reason,
            failed_step=failed_step,
            region_results=region_results_payload(region_results),
        )

    return results

