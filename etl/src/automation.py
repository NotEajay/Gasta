"""Automated weekly sync — discover, download, parse, and load DOE bulletins."""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone
from pathlib import Path

from .constants import ALL_REGION_KEYS, CORE_FUEL_CODES, REGION_KEY_BY_CODE
from .carry_forward import carry_forward_missing_areas, db_missing_areas_vs_prior
from .discover import DiscoveredBulletin, UpstreamUnavailableError, discover_latest_weeks
from .download import download_region_bulletins, normalize_region
from .freshness import describe_freshness, is_bulletin_stale
from .load_supabase import _client, load_bulletin, record_doe_website_fetch, touch_bulletin_fetched_at, try_record_etl_run
from .parse_bulletin import (
    BulletinDateUnknown,
    BulletinNotMachineReadable,
    missing_core_fuels,
    parse_region_pdfs,
)
from .pending_downloads import clear_pending_download, upsert_pending_download
from .region_results import (
    RegionRunResult,
    confirm_pending,
    new_region_results,
    region_results_payload,
)


@dataclass
class SyncResult:
    region_code: str
    week_start: str
    pdf_path: str
    price_rows: int
    companies: int
    skipped: bool = False
    message: str = ""
    # True when the newest week this region has -- either just resolved or already
    # stored -- is too old for the app to be considered current. A stale result must
    # fail the run even when it was "skipped", which is the silent pass that let NCR
    # sit on 2026-08-25 while every scheduled run reported success.
    stale: bool = False
    # True when DOE is not currently serving this region's page at all. This is a
    # property of the source, not of the pipeline: there is nothing to download,
    # parse, or load, so it is reported as a warning rather than a run failure. It is
    # never inferred from a region being old -- an old-but-real bulletin stays stale.
    upstream_unavailable: bool = False
    # Core fuels (RON_91, DIESEL_PLUS) absent after parse/load — Prices UI empty.
    missing_fuels: tuple[str, ...] = ()
    # A skipped PDF was downloaded successfully with its siblings, but its retry
    # queue row could not be persisted.
    pending_queue_error: bool = False

    @property
    def status(self) -> str:
        """Short status label used in the run's per-region log table."""
        if self.upstream_unavailable:
            return "UPSTREAM UNAVAILABLE"
        if self.stale:
            return "STALE"
        if self.pending_queue_error:
            return "ERROR"
        if "Failed" in self.message:
            return "ERROR"
        if self.missing_fuels:
            return "FUEL GAP"
        if not self.week_start:
            return "NO DATA"
        return "CURRENT"


def summarise_results(results: list[SyncResult]) -> str:
    """One-line overall verdict for a sync-all run.

    Semantics, in order:
      * any available region STALE, ERROR, or FUEL GAP -> FAILED
      * every region upstream unavailable     -> FAILED (no usable data source at all)
      * some unavailable, rest current        -> SUCCESS WITH N UPSTREAM-UNAVAILABLE
      * all current                           -> SUCCESS

    "Upstream unavailable" is deliberately not a blanket catch-all: it only downgrades
    a region that DOE is genuinely not serving, and it can never make a run pass when
    nothing usable was retrieved, nor when a reachable region is stale or broken.
    """
    if not results:
        return "FAILED (no regions processed)"
    unavailable = [r for r in results if r.upstream_unavailable]
    available = [r for r in results if not r.upstream_unavailable]
    broken = [
        r
        for r in available
        if r.stale or r.status == "ERROR" or r.missing_fuels or not r.week_start
    ]
    if broken:
        return "FAILED"
    if not available:
        return "FAILED (all regions upstream unavailable)"
    if unavailable:
        return f"SUCCESS WITH {len(unavailable)} UPSTREAM-UNAVAILABLE REGION"
    return "SUCCESS"



def _region_already_loaded(bulletin_date: date, region_code: str) -> bool:
    client = _client()
    bulletin_resp = (
        client.table("fuel_price_bulletins")
        .select("id")
        .eq("bulletin_date", bulletin_date.isoformat())
        .maybe_single()
        .execute()
    )
    if not bulletin_resp or not bulletin_resp.data:
        return False

    bulletin_id = bulletin_resp.data["id"]
    region_resp = (
        client.table("regions").select("id").eq("code", region_code).maybe_single().execute()
    )
    if not region_resp or not region_resp.data:
        return False

    region_id = region_resp.data["id"]
    prices_resp = (
        client.table("fuel_prices")
        .select("id")
        .eq("bulletin_id", bulletin_id)
        .eq("region_id", region_id)
        .limit(1)
        .execute()
    )
    rows = prices_resp.data if prices_resp else []
    return bool(rows)


def _missing_core_fuels_in_db(bulletin_date: date, region_code: str) -> list[str]:
    """Which CORE_FUEL_CODES are absent for this region/week in Supabase.

    Every scheduled ETL run uses this so a week that was stored without RON 91 or
    Diesel Plus (bad parse / old loader) is reloaded instead of skipped.
    """
    client = _client()
    bulletin_resp = (
        client.table("fuel_price_bulletins")
        .select("id")
        .eq("bulletin_date", bulletin_date.isoformat())
        .maybe_single()
        .execute()
    )
    if not bulletin_resp or not bulletin_resp.data:
        return list(CORE_FUEL_CODES)

    region_resp = (
        client.table("regions").select("id").eq("code", region_code).maybe_single().execute()
    )
    if not region_resp or not region_resp.data:
        return list(CORE_FUEL_CODES)

    fuel_resp = (
        client.table("fuel_types").select("id, code").in_("code", list(CORE_FUEL_CODES)).execute()
    )
    fuel_rows = fuel_resp.data if fuel_resp else []
    if not fuel_rows:
        return list(CORE_FUEL_CODES)

    bulletin_id = bulletin_resp.data["id"]
    region_id = region_resp.data["id"]
    missing: list[str] = []
    for fuel in fuel_rows:
        prices_resp = (
            client.table("fuel_prices")
            .select("id")
            .eq("bulletin_id", bulletin_id)
            .eq("region_id", region_id)
            .eq("fuel_type_id", fuel["id"])
            .limit(1)
            .execute()
        )
        rows = prices_resp.data if prices_resp else []
        if not rows:
            missing.append(fuel["code"])
    # Preserve CORE_FUEL_CODES order for stable logs.
    order = {code: index for index, code in enumerate(CORE_FUEL_CODES)}
    return sorted(missing, key=lambda code: order.get(code, 99))


def _newest_stored_week(region_code: str) -> date | None:
    """Newest bulletin week that actually has prices for a region."""
    client = _client()
    response = (
        client.table("region_bulletin_weeks")
        .select("bulletin_date")
        .eq("region_code", region_code)
        .order("bulletin_date", desc=True)
        .limit(1)
        .execute()
    )
    rows = response.data if response else []
    if not rows:
        return None
    return date.fromisoformat(rows[0]["bulletin_date"])


def _sync_discovered(
    discovered: DiscoveredBulletin,
    *,
    dest_dir: str | Path = "data/bulletins",
    dry_run: bool = False,
    force: bool = False,
    today: date | None = None,
    region_result: RegionRunResult | None = None,
) -> SyncResult:
    observation = region_result or RegionRunResult(discovered.region_code)
    observation.start("read stored bulletin")
    observation.week_start = discovered.week_start.isoformat()
    observation.slug = None
    observation.retry_queued = None
    observation.retry_checked_at = None
    try:
        result = _sync_discovered_bulletin(
            discovered, dest_dir=dest_dir, dry_run=dry_run, force=force,
            today=today, region_result=observation,
        )
    except Exception as exc:
        observation.failed(exc)
        raise
    observation.week_start = result.week_start or observation.week_start
    observation.price_rows = result.price_rows
    observation.companies = result.companies
    return result


def _sync_discovered_bulletin(
    discovered: DiscoveredBulletin,
    *,
    dest_dir: str | Path,
    dry_run: bool,
    force: bool,
    today: date | None,
    region_result: RegionRunResult,
) -> SyncResult:
    region_code = discovered.region_code
    region_key = REGION_KEY_BY_CODE[region_code]
    today = today or date.today()
    # Freshness is judged on the newest week this region has, whether just resolved or
    # already stored. Judging only the resolved week would let a re-parse of an old
    # week look stale even when the database is current, and judging only the stored
    # week would hide a fresh week that failed to load.
    newest_known = _newest_stored_week(region_code)
    judged_week = max(
        (w for w in (discovered.week_start, newest_known) if w is not None),
        default=discovered.week_start,
    )
    stale = is_bulletin_stale(judged_week, today)
    if stale:
        region_result.step = "freshness check"
        region_result.issue("outdated", describe_freshness(judged_week, today))

    region_result.step = "PDF download"
    downloaded = download_region_bulletins(
        region_key, discovered.slugs, dest_dir, discovered.urls
    )
    for _ in downloaded.paths:
        region_result.downloaded(True)
    skipped_issues = {}
    for skip in downloaded.skipped:
        region_result.downloaded(False)
        skipped_issues[skip.slug] = region_result.issue("not_fetched", skip.error, slug=skip.slug)
    pending_queue_errors: list[str] = []
    # Queue inaccessible PDFs for the daily pending-retry workflow; clear any
    # that succeeded this run so daily automation stops for those gaps. Queue
    # failures are retained until the result is built so valid sibling PDFs still
    # parse/load, while the run is explicitly marked unsuccessful.
    if not dry_run:
        for skip in downloaded.skipped:
            region_result.step = "pending-download queue"
            try:
                pending_row = upsert_pending_download(
                    region_code=region_code,
                    bulletin_date=discovered.week_start,
                    slug=skip.slug,
                    source_url=skip.url,
                    last_error=skip.error,
                )
                queued, checked_at = confirm_pending(
                    pending_row, region_code=region_code,
                    week_start=discovered.week_start.isoformat(), slug=skip.slug,
                )
                skipped_issues[skip.slug].update(
                    retry_queued=queued, retry_checked_at=checked_at
                )
            except Exception as exc:  # noqa: BLE001 — surface queue loss in result
                pending_queue_errors.append(
                    f"{skip.slug}: {type(exc).__name__}: {exc}"
                )
                region_result.issue("error", str(exc), slug=skip.slug)
        skipped_slugs = {item.slug for item in downloaded.skipped}
        for slug in discovered.slugs:
            if slug not in skipped_slugs:
                region_result.step = "pending queue cleanup"
                region_result.slug = slug
                clear_pending_download(
                    region_code=region_code,
                    bulletin_date=discovered.week_start,
                    slug=slug,
                )
        region_result.slug = None

    pdf_paths = downloaded.paths
    region_result.step = "PDF parse"
    region_result.parse_input_available = bool(pdf_paths)
    parsed = parse_region_pdfs(
        pdf_paths,
        region_code,
        fallback_week_start=discovered.week_start,
        source_urls=list(downloaded.urls),
    )
    # When a sub-region PDF is 403/missing, keep showing those cities using the
    # previous week's rows for any area_name the new parse does not cover.
    region_result.step = "carry forward prices"
    carried_areas = carry_forward_missing_areas(parsed)

    freshness_note = describe_freshness(judged_week, today)
    region_result.step = "validation"
    parsed_missing = tuple(missing_core_fuels(parsed.prices))
    if parsed_missing:
        region_result.issue("missing_prices", ", ".join(parsed_missing))
    coverage_note = ""
    if downloaded.skipped:
        coverage_note += (
            f" Skipped {len(downloaded.skipped)} inaccessible PDF(s): "
            + "; ".join(downloaded.skip_notes[:3])
            + "."
        )
    if carried_areas:
        coverage_note += (
            f" Carried forward {len(carried_areas)} area(s) from the prior week."
        )
    if parsed_missing:
        coverage_note += (
            f" Missing core fuels after parse: {', '.join(parsed_missing)}."
        )
    if parsed.warnings:
        coverage_note += " " + "; ".join(parsed.warnings[:3])
    if pending_queue_errors:
        coverage_note += (
            " Failed to persist pending-download queue row(s): "
            + "; ".join(pending_queue_errors[:3])
            + "."
        )

    # Check for validation errors
    if parsed.validation_errors:
        if not force:
            region_result.issue("error", "; ".join(parsed.validation_errors))
            return SyncResult(
                region_code=region_code,
                week_start=parsed.bulletin_date.isoformat(),
                pdf_path="; ".join(str(p) for p in pdf_paths),
                price_rows=len(parsed.prices),
                companies=len({p.company for p in parsed.prices}),
                skipped=True,
                message=f"Validation errors: {'; '.join(parsed.validation_errors)}",
                stale=stale,
                missing_fuels=parsed_missing,
                pending_queue_error=bool(pending_queue_errors),
            )

    region_result.step = "read existing prices"
    already = (
        not force
        and not dry_run
        and _region_already_loaded(parsed.bulletin_date, region_code)
    )
    if already:
        db_missing = _missing_core_fuels_in_db(parsed.bulletin_date, region_code)
        gaps = db_missing_areas_vs_prior(parsed) if not dry_run else []
        if not db_missing and not gaps and not carried_areas:
            region_result.step = "bulletin fetch state"
            touch_bulletin_fetched_at(parsed.bulletin_date)
            return SyncResult(
                region_code=region_code,
                week_start=parsed.bulletin_date.isoformat(),
                pdf_path="",
                price_rows=0,
                companies=0,
                skipped=True,
                message=(
                    f"{region_code} prices for bulletin {parsed.bulletin_date.isoformat()} "
                    f"already in Supabase - skipped. {freshness_note}."
                    + coverage_note
                ),
                stale=stale,
                pending_queue_error=bool(pending_queue_errors),
            )
        # Week was stored without RON 91 / Diesel Plus — reload on every ETL trigger.
        # Also reload when prior-week cities (e.g. Bicol) were never written.
        extra = []
        if db_missing:
            extra.append(f"missing {', '.join(db_missing)}")
        if gaps or carried_areas:
            extra.append(
                f"filling {len(gaps or carried_areas)} area(s) from prior week"
            )
        coverage_note = f" Reloading: {'; '.join(extra)}." + coverage_note

    pdf_path_display = "; ".join(str(p) for p in pdf_paths)

    if dry_run:
        return SyncResult(
            region_code=region_code,
            week_start=parsed.bulletin_date.isoformat(),
            pdf_path=pdf_path_display,
            price_rows=len(parsed.prices),
            companies=len({p.company for p in parsed.prices}),
            message="Dry run - no database write." + coverage_note,
            stale=stale,
            missing_fuels=parsed_missing,
            pending_queue_error=bool(pending_queue_errors),
        )

    region_result.step = "price load"
    load_stats = load_bulletin(parsed)
    region_result.price_rows = load_stats["price_rows"]
    region_result.companies = load_stats["companies"]
    message = "Loaded successfully." + coverage_note
    if load_stats.get("duplicates_skipped", 0) > 0:
        message += f" Skipped {load_stats['duplicates_skipped']} duplicate price entries."

    return SyncResult(
        region_code=region_code,
        week_start=parsed.bulletin_date.isoformat(),
        pdf_path=pdf_path_display,
        price_rows=load_stats["price_rows"],
        companies=load_stats["companies"],
        message=message,
        stale=stale,
        missing_fuels=parsed_missing,
        pending_queue_error=bool(pending_queue_errors),
    )


def sync_latest_region(
    region_key: str,
    *,
    dest_dir: str | Path = "data/bulletins",
    dry_run: bool = False,
    force: bool = False,
    fallback_weeks: int = 3,
    region_result: RegionRunResult | None = None,
) -> SyncResult:
    """Discover, download, parse, and load the latest usable bulletin for one region.

    DOE occasionally publishes a week as page scans, which hold no readable prices. So
    that the app still shows this region's most recent prices rather than an error, the
    next-newest weeks are tried in turn.
    """
    observation = region_result or RegionRunResult(normalize_region(region_key))
    observation.start("discovery")
    try:
        candidates = discover_latest_weeks(
            region_key, limit=1 + max(fallback_weeks, 0), probe_dir=dest_dir
        )
    except Exception as exc:
        observation.failed(exc)
        raise

    skipped: list[str] = []
    for discovered in candidates:
        try:
            result = _sync_discovered(
                discovered, dest_dir=dest_dir, dry_run=dry_run, force=force,
                region_result=observation,
            )
        except (BulletinNotMachineReadable, BulletinDateUnknown) as exc:
            skipped.append(f"{discovered.week_start}: {exc}")
            continue
        if skipped:
            result.message = (
                f"{result.message} Newer weeks were unusable - "
                f"{'; '.join(skipped)}"
            )
        return result

    observation.step = None if skipped else "discovery"
    raise RuntimeError(
        f"No usable bulletin for {normalize_region(region_key)} in the last "
        f"{len(candidates)} published weeks: {'; '.join(skipped)}"
    )


def sync_latest_ncr(
    *,
    dest_dir: str | Path = "data/bulletins",
    dry_run: bool = False,
    force: bool = False,
) -> SyncResult:
    """Full automated pipeline for the latest NCR DOE bulletin."""
    return sync_latest_region("ncr", dest_dir=dest_dir, dry_run=dry_run, force=force)


def _weekly_failure_details(results: list[SyncResult]) -> tuple[str | None, str | None]:
    """Summarise the existing per-region outcome without changing sync semantics."""
    issues: list[str] = []
    failed_steps: list[str] = []
    for result in results:
        if result.upstream_unavailable:
            issues.append(f"{result.region_code}: {result.message}")
            failed_steps.append("discovery")
        elif result.pending_queue_error:
            issues.append(f"{result.region_code}: {result.message}")
            failed_steps.append("pending-download queue")
        elif "Failed" in result.message:
            issues.append(f"{result.region_code}: {result.message}")
            failed_steps.append("region sync")
        elif result.stale:
            issues.append(
                f"{result.region_code}: stale bulletin {result.week_start or 'not resolved'}"
            )
            failed_steps.append("freshness check")
        elif result.status == "ERROR":
            issues.append(f"{result.region_code}: {result.message}")
        elif result.missing_fuels:
            issues.append(
                f"{result.region_code}: missing core fuels {', '.join(result.missing_fuels)}"
            )
            failed_steps.append("validation")
        elif not result.week_start:
            issues.append(f"{result.region_code}: no bulletin data resolved")
            failed_steps.append("discovery")

    if not issues:
        return None, None
    failed_step = "; ".join(dict.fromkeys(failed_steps)) or None
    return "; ".join(issues), failed_step


def _weekly_history_counts(
    results: list[SyncResult],
) -> tuple[list[SyncResult], list[SyncResult], list[SyncResult]]:
    skipped = [r for r in results if r.upstream_unavailable]
    failed = [
        r
        for r in results
        if not r.upstream_unavailable
        and (r.stale or r.status == "ERROR" or bool(r.missing_fuels) or not r.week_start)
    ]
    ok = [r for r in results if r not in failed and r not in skipped]
    return ok, failed, skipped


def sync_all_regions(
    *,
    dest_dir: str | Path = "data/bulletins",
    dry_run: bool = False,
    force: bool = False,
) -> list[SyncResult]:
    """Sync all five macro-regions. Failures for one region do not stop the others."""
    started_at = datetime.now(timezone.utc)
    t_start = time.monotonic()
    results: list[SyncResult] = []
    region_results = new_region_results()
    failed_step = "region sync"

    try:
        for region_key in ALL_REGION_KEYS:
            observation = region_results[normalize_region(region_key)]
            try:
                result = sync_latest_region(
                    region_key,
                    dest_dir=dest_dir,
                    dry_run=dry_run,
                    force=force,
                    region_result=observation,
                )
                observation.status = "processed"
                observation.week_start = result.week_start or observation.week_start
                observation.price_rows = result.price_rows
                observation.companies = result.companies
                results.append(result)
            except UpstreamUnavailableError as exc:
                observation.status = "processed"
                if not observation.issues:
                    observation.step = "discovery"
                    observation.failed(exc)
                # DOE is not serving this region right now. Reported, but non-fatal: the
                # other regions are still ingested normally, and nothing is loaded or
                # faked for this one.
                results.append(
                    SyncResult(
                        region_code=normalize_region(region_key),
                        week_start="",
                        pdf_path="",
                        price_rows=0,
                        companies=0,
                        message=f"Upstream unavailable: {exc}",
                        upstream_unavailable=True,
                    )
                )
            except Exception as exc:  # noqa: BLE001 — one region must not stop the rest
                observation.status = "processed"
                if observation.step is not None or not observation.issues:
                    observation.failed(exc)
                results.append(
                    SyncResult(
                        region_code=normalize_region(region_key),
                        week_start="",
                        pdf_path="",
                        price_rows=0,
                        companies=0,
                        message=f"Failed: {type(exc).__name__}: {exc}",
                        # A region that could not be resolved at all is by definition not current.
                        stale=True,
                    )
                )

        # The UI-facing "latest DOE fetch" timestamp means "we hold current data", not
        # "we reached the website". Bumping it after a run whose newest week is stale is
        # exactly what let the app show a fresh timestamp beside a month-old bulletin.
        #
        # Regions DOE is not serving are excluded from the judgement: they contribute no
        # data, so they cannot make the stored dataset stale, and they must not stop the
        # remaining regions from being recorded as refreshed. A run that retrieved nothing,
        # or in which any *available* region was stale or broken, records nothing.
        available = [r for r in results if not r.upstream_unavailable]
        all_available_current = bool(available) and all(
            not r.stale and r.week_start and "Failed" not in r.message for r in available
        )
        failed_step = "latest DOE fetch state"
        if not dry_run and all_available_current:
            record_doe_website_fetch()
    except Exception as exc:
        if not dry_run:
            ended_at = datetime.now(timezone.utc)
            ok, failed, skipped = _weekly_history_counts(results)
            try_record_etl_run(
                workflow="weekly",
                status="failed",
                started_at=started_at,
                ended_at=ended_at,
                regions_ok=len(ok),
                regions_failed=len(failed),
                regions_skipped=len(skipped),
                duration_s=time.monotonic() - t_start,
                failure_reason=f"{type(exc).__name__}: {exc}",
                failed_step=failed_step,
                region_results=region_results_payload(region_results),
            )
        raise

    if not dry_run:
        ended_at = datetime.now(timezone.utc)
        ok, failed, skipped = _weekly_history_counts(results)
        verdict = summarise_results(results)
        failure_reason, result_failed_step = _weekly_failure_details(results)
        if verdict.startswith("FAILED"):
            status = "partial" if ok else "failed"
            failure_reason = failure_reason or verdict
        else:
            status = "success"
            failure_reason = None
            result_failed_step = None
        try_record_etl_run(
            workflow="weekly",
            status=status,
            started_at=started_at,
            ended_at=ended_at,
            regions_ok=len(ok),
            regions_failed=len(failed),
            regions_skipped=len(skipped),
            duration_s=time.monotonic() - t_start,
            failure_reason=failure_reason,
            failed_step=result_failed_step,
            region_results=region_results_payload(region_results),
        )

    return results


def sync_result_to_json(result: SyncResult) -> str:
    return json.dumps(asdict(result), indent=2)
