"""Automated weekly sync — discover, download, parse, and load DOE bulletins."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path

from .constants import ALL_REGION_KEYS, REGION_KEY_BY_CODE, REGION_CODES
from .discover import DiscoveredBulletin, discover_latest_region, discover_latest_ncr_week
from .download import download_region_bulletins, normalize_region
from .load_supabase import _client, load_bulletin
from .parse_bulletin import parse_region_pdfs


@dataclass
class SyncResult:
    region_code: str
    week_start: str
    pdf_path: str
    price_rows: int
    companies: int
    skipped: bool = False
    message: str = ""


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


def _sync_discovered(
    discovered: DiscoveredBulletin,
    *,
    dest_dir: str | Path = "data/bulletins",
    dry_run: bool = False,
    force: bool = False,
) -> SyncResult:
    region_code = discovered.region_code
    region_key = REGION_KEY_BY_CODE[region_code]

    pdf_paths = download_region_bulletins(region_key, discovered.slugs, dest_dir)
    parsed = parse_region_pdfs(
        pdf_paths,
        region_code,
        fallback_week_start=discovered.week_start,
    )

    if not force and not dry_run and _region_already_loaded(parsed.bulletin_date, region_code):
        return SyncResult(
            region_code=region_code,
            week_start=parsed.bulletin_date.isoformat(),
            pdf_path="",
            price_rows=0,
            companies=0,
            skipped=True,
            message=(
                f"{region_code} prices for bulletin {parsed.bulletin_date.isoformat()} "
                "already in Supabase — skipped."
            ),
        )

    pdf_path_display = "; ".join(str(p) for p in pdf_paths)

    if dry_run:
        return SyncResult(
            region_code=region_code,
            week_start=parsed.bulletin_date.isoformat(),
            pdf_path=pdf_path_display,
            price_rows=len(parsed.prices),
            companies=len({p.company for p in parsed.prices}),
            message="Dry run — no database write.",
        )

    load_stats = load_bulletin(parsed)
    return SyncResult(
        region_code=region_code,
        week_start=parsed.bulletin_date.isoformat(),
        pdf_path=pdf_path_display,
        price_rows=load_stats["price_rows"],
        companies=load_stats["companies"],
        message="Loaded successfully.",
    )


def sync_latest_ncr(
    *,
    dest_dir: str | Path = "data/bulletins",
    dry_run: bool = False,
    force: bool = False,
) -> SyncResult:
    """Full automated pipeline for the latest NCR DOE bulletin."""
    week_start = discover_latest_ncr_week()
    discovered = DiscoveredBulletin(
        region_code="NCR",
        week_start=week_start,
        slugs=(f"ncr-price-monitoring-{week_start.strftime('%m%d%Y')}-pdf",),
        source="ncr-date-probe",
    )
    return _sync_discovered(discovered, dest_dir=dest_dir, dry_run=dry_run, force=force)


def sync_latest_region(
    region_key: str,
    *,
    dest_dir: str | Path = "data/bulletins",
    dry_run: bool = False,
    force: bool = False,
) -> SyncResult:
    """Discover, download, parse, and load the latest bulletin for one macro-region."""
    if region_key.strip().lower().replace("-", "_") == "ncr":
        return sync_latest_ncr(dest_dir=dest_dir, dry_run=dry_run, force=force)

    discovered = discover_latest_region(region_key)
    return _sync_discovered(discovered, dest_dir=dest_dir, dry_run=dry_run, force=force)


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
        except Exception as exc:
            region_code = normalize_region(region_key)
            error_msg = str(exc)
            
            # Check if this is a "no data available" error for North Luzon or Mindanao
            if "may not have data available on the new DOE website yet" in error_msg:
                # Treat as a skip rather than a failure
                results.append(
                    SyncResult(
                        region_code=region_code,
                        week_start="",
                        pdf_path="",
                        price_rows=0,
                        companies=0,
                        skipped=True,
                        message=f"Skipped: {region_code} data not available on DOE website yet. {error_msg}",
                    )
                )
            else:
                # Other errors are genuine failures
                results.append(
                    SyncResult(
                        region_code=region_code,
                        week_start="",
                        pdf_path="",
                        price_rows=0,
                        companies=0,
                        message=f"Failed: {exc}",
                    )
                )
    return results


def sync_result_to_json(result: SyncResult) -> str:
    return json.dumps(asdict(result), indent=2)
