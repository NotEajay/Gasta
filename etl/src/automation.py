"""Automated weekly sync — discover, download, parse, and load DOE bulletins."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path

from .constants import ALL_REGION_KEYS, CORE_FUEL_CODES, REGION_KEY_BY_CODE
from .discover import DiscoveredBulletin, UpstreamUnavailableError, discover_latest_weeks
from .download import download_region_bulletins, normalize_region
from .freshness import describe_freshness, is_bulletin_stale
from .load_supabase import _client, load_bulletin, record_doe_website_fetch, touch_bulletin_fetched_at
from .parse_bulletin import (
    BulletinDateUnknown,
    BulletinNotMachineReadable,
    missing_core_fuels,
    parse_region_pdfs,
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

    @property
    def status(self) -> str:
        """Short status label used in the run's per-region log table."""
        if self.upstream_unavailable:
            return "UPSTREAM UNAVAILABLE"
        if self.stale:
            return "STALE"
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

    downloaded = download_region_bulletins(
        region_key, discovered.slugs, dest_dir, discovered.urls
    )
    pdf_paths = downloaded.paths
    parsed = parse_region_pdfs(
        pdf_paths,
        region_code,
        fallback_week_start=discovered.week_start,
        source_urls=list(downloaded.urls),
    )

    freshness_note = describe_freshness(judged_week, today)
    parsed_missing = tuple(missing_core_fuels(parsed.prices))
    coverage_note = ""
    if downloaded.skipped:
        coverage_note += (
            f" Skipped {len(downloaded.skipped)} inaccessible PDF(s): "
            + "; ".join(downloaded.skipped[:3])
            + "."
        )
    if parsed_missing:
        coverage_note += (
            f" Missing core fuels after parse: {', '.join(parsed_missing)}."
        )
    if parsed.warnings:
        coverage_note += " " + "; ".join(parsed.warnings[:3])

    # Check for validation errors
    if parsed.validation_errors:
        if not force:
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
            )

    already = (
        not force
        and not dry_run
        and _region_already_loaded(parsed.bulletin_date, region_code)
    )
    if already:
        db_missing = _missing_core_fuels_in_db(parsed.bulletin_date, region_code)
        if not db_missing:
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
                ),
                stale=stale,
            )
        # Week was stored without RON 91 / Diesel Plus — reload on every ETL trigger.
        coverage_note = (
            f" Reloading: stored week is missing {', '.join(db_missing)}."
            + coverage_note
        )

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
        )

    load_stats = load_bulletin(parsed)
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
    )


def sync_latest_region(
    region_key: str,
    *,
    dest_dir: str | Path = "data/bulletins",
    dry_run: bool = False,
    force: bool = False,
    fallback_weeks: int = 3,
) -> SyncResult:
    """Discover, download, parse, and load the latest usable bulletin for one region.

    DOE occasionally publishes a week as page scans, which hold no readable prices. So
    that the app still shows this region's most recent prices rather than an error, the
    next-newest weeks are tried in turn.
    """
    candidates = discover_latest_weeks(
        region_key, limit=1 + max(fallback_weeks, 0), probe_dir=dest_dir
    )

    skipped: list[str] = []
    for discovered in candidates:
        try:
            result = _sync_discovered(
                discovered, dest_dir=dest_dir, dry_run=dry_run, force=force
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


def sync_all_regions(
    *,
    dest_dir: str | Path = "data/bulletins",
    dry_run: bool = False,
    force: bool = False,
) -> list[SyncResult]:
    """Sync all five macro-regions. Failures for one region do not stop the others."""
    results: list[SyncResult] = []
    for region_key in ALL_REGION_KEYS:
        try:
            results.append(
                sync_latest_region(
                    region_key,
                    dest_dir=dest_dir,
                    dry_run=dry_run,
                    force=force,
                )
            )
        except UpstreamUnavailableError as exc:
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
    if not dry_run and all_available_current:
        record_doe_website_fetch()
    return results


def sync_result_to_json(result: SyncResult) -> str:
    return json.dumps(asdict(result), indent=2)
