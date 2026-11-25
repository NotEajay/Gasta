"""Load parsed DOE bulletin rows into Supabase."""

from __future__ import annotations

import json
import os
import sys
from decimal import Decimal
from datetime import date, datetime, timezone
from dataclasses import replace
from functools import lru_cache
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from supabase import Client, create_client

from .constants import FUEL_TYPE_CODES, REGION_CODES
from .freshness import estimated_doe_posted_date
from .parse_bulletin import ParsedBulletin, ParsedPrice, slugify_company

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


@lru_cache(maxsize=1)
def _client() -> Client:
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        raise RuntimeError(
            "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in etl/.env "
            "(Dashboard > Settings > API > service_role key)."
        )
    return create_client(url, key)


HISTORY_MIGRATION = "supabase/migrations/20240812000007_bulletin_history.sql"


@lru_cache(maxsize=1)
def require_history_schema() -> None:
    """Fail early when the price-history migration has not been applied.

    Without it the loader has nowhere to record per-region provenance and the app has
    no week list to read, and PostgREST reports both as bare "column does not exist"
    errors that say nothing about the cause.
    """
    client = _client()
    missing: list[str] = []
    try:
        client.table("fuel_price_bulletins").select("source_urls").limit(1).execute()
    except Exception:  # noqa: BLE001 — any failure here means the column is unusable
        missing.append("fuel_price_bulletins.source_urls")
    try:
        client.table("region_bulletin_weeks").select("bulletin_date").limit(1).execute()
    except Exception:  # noqa: BLE001 — as above, for the view
        missing.append("region_bulletin_weeks view")

    if missing:
        raise RuntimeError(
            f"Supabase is missing {' and '.join(missing)}. Apply {HISTORY_MIGRATION} "
            "in the Supabase SQL editor, then re-run."
        )


def _first_row(response: Any) -> dict[str, Any]:
    data = response.data
    if isinstance(data, dict):
        return data
    if isinstance(data, list) and data:
        return data[0]
    raise RuntimeError("Expected at least one row from Supabase response")


def _fetch_id_map(client: Client, table: str, code_col: str) -> dict[str, str]:
    response = client.table(table).select(f"id,{code_col}").execute()
    rows: list[dict[str, Any]] = response.data or []
    return {row[code_col]: row["id"] for row in rows}


def _upsert_bulletin(client: Client, parsed: ParsedBulletin) -> str:
    """Insert or refresh the bulletin week row and return its id.

    `bulletin_date` is unique across regions, so several regions share one row. Each
    region records its own source PDF under `source_urls` so provenance survives.
    """
    bulletin_date = parsed.bulletin_date.isoformat()
    load_date = datetime.now(timezone.utc)
    # Age vs estimated DOE post day (week_start + 7), not the Tuesday week start.
    posted = estimated_doe_posted_date(parsed.bulletin_date)
    posted_datetime = datetime.combine(posted, datetime.min.time()).replace(
        tzinfo=timezone.utc
    )
    days_old = (load_date - posted_datetime).days
    source = parsed.source_url or parsed.source_path

    existing = (
        client.table("fuel_price_bulletins")
        .select("id,source_urls")
        .eq("bulletin_date", bulletin_date)
        .execute()
    )

    if existing.data:
        bulletin_id = existing.data[0]["id"]
        source_urls = existing.data[0].get("source_urls") or {}
        source_urls[parsed.region_code] = source
        client.table("fuel_price_bulletins").update(
            {
                "data_freshness_days": days_old,
                "last_loaded_at": load_date.isoformat(),
                "source_urls": source_urls,
            }
        ).eq("id", bulletin_id).execute()
        return bulletin_id

    inserted = (
        client.table("fuel_price_bulletins")
        .insert(
            {
                "bulletin_date": bulletin_date,
                "source_pdf_url": source,
                "source_urls": {parsed.region_code: source},
                "notes": f"ETL import - {parsed.week_label}",
                "data_freshness_days": days_old,
                "last_loaded_at": load_date.isoformat(),
            }
        )
        .select("id")
        .execute()
    )
    return _first_row(inserted)["id"]


def _ensure_oil_companies(client: Client, names: set[str]) -> dict[str, str]:
    """Resolve every company name to an id in one round trip, creating what's missing."""
    existing = _fetch_id_map(client, "oil_companies", "slug")
    ids = {name: existing[slugify_company(name)] for name in names if slugify_company(name) in existing}

    missing = [name for name in sorted(names) if name not in ids]
    if missing:
        client.table("oil_companies").upsert(
            [{"name": name, "slug": slugify_company(name)} for name in missing],
            on_conflict="slug",
        ).execute()
        refreshed = _fetch_id_map(client, "oil_companies", "slug")
        for name in missing:
            ids[name] = refreshed[slugify_company(name)]
    return ids


def _source_price_map(parsed: ParsedBulletin) -> dict[tuple[str, str, str], Decimal]:
    """Only prices present in this week's source may belong to this bulletin."""
    prices: dict[tuple[str, str, str], Decimal] = {}
    for price in parsed.prices:
        value = Decimal(str(price.price_per_liter))
        if not value.is_finite() or value <= 0:
            raise ValueError("Source prices must be finite positive numbers")
        identity = (slugify_company(price.company), price.fuel_type_code, price.area_name or "")
        if identity in prices:
            raise ValueError(f"Duplicate source price identity: {identity}")
        prices[identity] = value
    if not prices:
        raise ValueError("Refusing to replace a bulletin with no source prices")
    return prices


def _stored_price_map(rows: list[dict]) -> dict[tuple[str, str, str], Decimal]:
    return {
        (row["oil_companies"]["slug"], row["fuel_types"]["code"], row.get("area_name") or ""):
        Decimal(str(row["price_per_liter"]))
        for row in rows
    }


def _read_region_prices(client: Client, bulletin_id: str, region_id: str) -> list[dict]:
    """Read the whole scope; a region can exceed PostgREST's first-page limit."""
    rows: list[dict] = []
    page_size = 500
    for offset in range(0, 1_000_000, page_size):
        response = (client.table("fuel_prices")
            .select("id,area_name,price_per_liter,oil_companies(name,slug),fuel_types(code)")
            .eq("bulletin_id", bulletin_id).eq("region_id", region_id)
            .order("id").range(offset, offset + page_size - 1).execute())
        page = response.data or []
        rows.extend(page)
        if len(page) < page_size:
            return rows
    raise RuntimeError("Price scope exceeded the pagination safety limit")


def stored_prices_match(parsed: ParsedBulletin) -> bool:
    """Detect missing prices, changed source values, and old carried-forward rows."""
    expected = _source_price_map(parsed)
    client = _client()
    bulletin = (client.table("fuel_price_bulletins").select("id")
        .eq("bulletin_date", parsed.bulletin_date.isoformat()).maybe_single().execute())
    region = (client.table("regions").select("id")
        .eq("code", parsed.region_code).maybe_single().execute())
    if not bulletin or not bulletin.data or not region or not region.data:
        return False
    return _stored_price_map(_read_region_prices(client, bulletin.data["id"], region.data["id"])) == expected


def load_bulletin(parsed: ParsedBulletin, *, dry_run: bool = False) -> dict[str, int]:
    if parsed.region_code not in REGION_CODES.values():
        raise ValueError(f"Unknown region code: {parsed.region_code}")
    expected = _source_price_map(parsed)
    if parsed.validation_errors:
        raise ValueError("Source validation failed: " + "; ".join(parsed.validation_errors))

    if dry_run:
        return {
            "bulletin_date": parsed.bulletin_date.isoformat(),
            "price_rows": len(parsed.prices),
            "companies": len({p.company for p in parsed.prices}),
            "duplicates_skipped": 0,
            "dry_run": 1,
        }

    client = _client()
    require_history_schema()
    region_ids = _fetch_id_map(client, "regions", "code")
    fuel_type_ids = _fetch_id_map(client, "fuel_types", "code")
    region_id = region_ids[parsed.region_code]
    unknown = {price.fuel_type_code for price in parsed.prices} - fuel_type_ids.keys()
    if unknown:
        raise ValueError(f"Unknown source fuel types: {sorted(unknown)}")

    bulletin_id = _upsert_bulletin(client, parsed)
    company_ids = _ensure_oil_companies(client, {p.company for p in parsed.prices})

    rows_to_upsert = []
    for price in parsed.prices:
        company_id = company_ids[price.company]
        fuel_type_id = fuel_type_ids[price.fuel_type_code]
        rows_to_upsert.append(
            {
                "bulletin_id": bulletin_id,
                "region_id": region_id,
                "oil_company_id": company_id,
                "fuel_type_id": fuel_type_id,
                "area_name": price.area_name or "",
                "price_per_liter": price.price_per_liter,
            }
        )

    duplicates_skipped = 0
    # Verify every source row exists before removing obsolete rows. A failed
    # upload must never empty a region/week that was already serving prices.
    for offset in range(0, len(rows_to_upsert), 500):
        client.table("fuel_prices").upsert(
            rows_to_upsert[offset:offset + 500],
            on_conflict="bulletin_id,region_id,oil_company_id,fuel_type_id,area_name",
        ).execute()

    stored = _read_region_prices(client, bulletin_id, region_id)
    actual = _stored_price_map(stored)
    if any(actual.get(identity) != value for identity, value in expected.items()):
        raise RuntimeError("Source price verification failed; obsolete rows were retained")
    stale_ids = [row["id"] for row in stored if next(iter(_stored_price_map([row]))) not in expected]
    for offset in range(0, len(stale_ids), 250):
        (client.table("fuel_prices").delete().eq("bulletin_id", bulletin_id)
            .eq("region_id", region_id).in_("id", stale_ids[offset:offset + 250]).execute())
    if stale_ids and _stored_price_map(_read_region_prices(client, bulletin_id, region_id)) != expected:
        raise RuntimeError("Stored prices still differ from the source after reconciliation")

    return {
        "bulletin_date": parsed.bulletin_date.isoformat(),
        "price_rows": len(rows_to_upsert),
        "companies": len(company_ids),
        "duplicates_skipped": duplicates_skipped,
    }


def merge_bulletin_prices(parsed: ParsedBulletin, *, dry_run: bool = False) -> dict[str, int]:
    """Merge a recovered same-week source and recompute all regional minima.

    Sibling sub-regions remain under the same original week. A partial source's
    regional summary must never overwrite the minima of the complete region.
    """
    _source_price_map(parsed)
    if dry_run:
        return {**load_bulletin(parsed, dry_run=True), "merged": 1}
    client = _client()
    bulletin = (client.table("fuel_price_bulletins").select("id,source_urls")
        .eq("bulletin_date", parsed.bulletin_date.isoformat()).maybe_single().execute())
    region = (client.table("regions").select("id")
        .eq("code", parsed.region_code).maybe_single().execute())
    areas = {price.area_name for price in parsed.prices if price.area_name}
    if not bulletin or not bulletin.data or not region or not region.data or not areas:
        return {**load_bulletin(parsed), "merged": 1}
    existing = _read_region_prices(client, bulletin.data["id"], region.data["id"])
    prices = [ParsedPrice(row["oil_companies"]["name"], row["fuel_types"]["code"],
                          float(row["price_per_liter"]), row["area_name"])
              for row in existing if row.get("area_name") and row["area_name"] not in areas]
    prices.extend(price for price in parsed.prices if price.area_name)
    minima: dict[tuple[str, str], float] = {}
    for price in prices:
        identity = price.company, price.fuel_type_code
        minima[identity] = min(minima.get(identity, price.price_per_liter), price.price_per_liter)
    prices.extend(ParsedPrice(company, fuel, value) for (company, fuel), value in minima.items())
    previous_sources = (bulletin.data.get("source_urls") or {}).get(parsed.region_code, "")
    sources = dict.fromkeys(source.strip() for source in
        [*previous_sources.split(";"), *(parsed.source_url or "").split(";")] if source.strip())
    combined = replace(parsed, prices=prices, source_url="; ".join(sources) or parsed.source_url)
    return {**load_bulletin(combined), "merged": 1}


def touch_bulletin_fetched_at(bulletin_date: date) -> None:
    """Record that ETL successfully fetched this week from DOE (even if prices were skipped)."""
    client = _client()
    client.table("fuel_price_bulletins").update(
        {"last_loaded_at": datetime.now(timezone.utc).isoformat()}
    ).eq("bulletin_date", bulletin_date.isoformat()).execute()


def record_doe_website_fetch(*, trigger: str | None = None, run_id: str | None = None) -> None:
    """Upsert the singleton timestamp shown in the app as 'Latest DOE fetch'."""
    client = _client()
    now = datetime.now(timezone.utc).isoformat()
    payload: dict[str, Any] = {
        "id": 1,
        "last_website_fetch_at": now,
        "updated_at": now,
        "last_trigger": (trigger or os.environ.get("ETL_TRIGGER") or "cli").strip() or "cli",
        "last_run_id": (run_id or os.environ.get("GITHUB_RUN_ID") or "").strip() or None,
    }
    client.table("doe_etl_state").upsert(payload, on_conflict="id").execute()


def record_etl_run(
    *,
    workflow: str,
    status: str,
    started_at: datetime,
    ended_at: datetime,
    regions_ok: int = 0,
    regions_failed: int = 0,
    regions_skipped: int = 0,
    duration_s: float | None = None,
    failure_reason: str | None = None,
    failed_step: str | None = None,
    region_results: dict[str, Any] | None = None,
) -> None:
    """Save one bounded workflow-history row through the database transaction."""
    client = _client()
    trigger = (os.environ.get("ETL_TRIGGER") or "cli").strip() or "cli"
    github_run_id = (os.environ.get("GITHUB_RUN_ID") or "").strip() or None
    github_run_attempt = max(1, int(os.environ.get("GITHUB_RUN_ATTEMPT") or "1"))
    elapsed = duration_s
    if elapsed is None:
        elapsed = max(0.0, (ended_at - started_at).total_seconds())
    payload = {
        "p_workflow": workflow,
        "p_status": status,
        "p_started_at": started_at.isoformat(),
        "p_ended_at": ended_at.isoformat(),
        "p_trigger_source": trigger,
        "p_github_run_id": github_run_id,
        "p_github_run_attempt": github_run_attempt,
        "p_regions_ok": regions_ok,
        "p_regions_failed": regions_failed,
        "p_regions_skipped": regions_skipped,
        "p_duration_s": round(elapsed, 1),
        "p_failure_reason": failure_reason,
        "p_failed_step": failed_step,
    }
    if region_results is not None:
        payload["p_region_results"] = region_results
    client.rpc("save_doe_etl_run", payload).execute()


def _publish_etl_history_output(kwargs: dict[str, Any]) -> None:
    payload = {
        key: value.isoformat() if isinstance(value, datetime) else value
        for key, value in kwargs.items()
    }
    serialized = json.dumps(payload, separators=(",", ":"), ensure_ascii=True)
    # Log first so a missing/unwritable GitHub output file cannot lose the snapshot.
    try:
        print(f"DOE_ETL_HISTORY_PAYLOAD={serialized}", file=sys.stderr, flush=True)
    except Exception:  # noqa: BLE001 — a broken log stream must not block the handoff
        pass
    output_path = (os.environ.get("GITHUB_OUTPUT") or "").strip()
    if output_path:
        with open(output_path, "a", encoding="utf-8") as output:
            output.write(f"history_payload={serialized}\n")


def try_record_etl_run(**kwargs: Any) -> bool:
    """Best-effort telemetry must never change the ETL command's outcome."""
    try:
        _publish_etl_history_output(kwargs)
    except Exception as exc:  # noqa: BLE001 — output handoff is also telemetry
        try:
            print(
                f"WARNING: failed to publish DOE ETL history output: {type(exc).__name__}: {exc}",
                file=sys.stderr,
            )
        except Exception:  # noqa: BLE001 — logging must not affect the ETL outcome
            pass
    try:
        record_etl_run(**kwargs)
    except Exception as exc:  # noqa: BLE001 — history is secondary to ETL behavior
        try:
            print(
                f"WARNING: failed to save DOE ETL run history: {type(exc).__name__}: {exc}",
                file=sys.stderr,
            )
        except Exception:  # noqa: BLE001 — logging must not affect the ETL outcome
            pass
        return False
    return True


def fetch_loaded_weeks(region_code: str) -> set[str]:
    """Bulletin dates that already have prices for a region — one query, used to skip."""
    client = _client()
    region_resp = (
        client.table("regions").select("id").eq("code", region_code).maybe_single().execute()
    )
    if not region_resp or not region_resp.data:
        return set()

    response = (
        client.table("fuel_price_bulletins")
        .select("bulletin_date,fuel_prices!inner(region_id)")
        .eq("fuel_prices.region_id", region_resp.data["id"])
        .execute()
    )
    return {row["bulletin_date"] for row in response.data or []}


def validate_reference_data(client: Client | None = None) -> None:
    client = client or _client()
    regions = _fetch_id_map(client, "regions", "code")
    fuels = _fetch_id_map(client, "fuel_types", "code")
    missing_regions = set(REGION_CODES.values()) - set(regions)
    missing_fuels = set(FUEL_TYPE_CODES.values()) - set(fuels)
    if missing_regions or missing_fuels:
        raise RuntimeError(
            f"Supabase reference data incomplete. Missing regions={missing_regions}, fuels={missing_fuels}. "
            "Run supabase/apply_all.sql first."
        )
