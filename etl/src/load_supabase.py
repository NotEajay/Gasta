"""Load parsed DOE bulletin rows into Supabase."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from supabase import Client, create_client

from .constants import FUEL_TYPE_CODES, REGION_CODES
from .parse_bulletin import ParsedBulletin, slugify_company

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
    bulletin_datetime = datetime.combine(
        parsed.bulletin_date, datetime.min.time()
    ).replace(tzinfo=timezone.utc)
    days_old = (load_date - bulletin_datetime).days
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


def load_bulletin(parsed: ParsedBulletin, *, dry_run: bool = False) -> dict[str, int]:
    if parsed.region_code not in REGION_CODES.values():
        raise ValueError(f"Unknown region code: {parsed.region_code}")

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

    bulletin_id = _upsert_bulletin(client, parsed)
    company_ids = _ensure_oil_companies(client, {p.company for p in parsed.prices})

    existing_prices = (
        client.table("fuel_prices")
        .select("oil_company_id,fuel_type_id,price_per_liter")
        .eq("bulletin_id", bulletin_id)
        .eq("region_id", region_id)
        .execute()
    )
    current = {
        (row["oil_company_id"], row["fuel_type_id"]): float(row["price_per_liter"])
        for row in existing_prices.data or []
    }

    rows_to_upsert = []
    duplicates_skipped = 0

    for price in parsed.prices:
        if price.fuel_type_code not in fuel_type_ids:
            continue
        company_id = company_ids[price.company]
        fuel_type_id = fuel_type_ids[price.fuel_type_code]

        previous = current.get((company_id, fuel_type_id))
        if previous is not None and abs(previous - price.price_per_liter) < 0.01:
            duplicates_skipped += 1
            continue

        rows_to_upsert.append(
            {
                "bulletin_id": bulletin_id,
                "region_id": region_id,
                "oil_company_id": company_id,
                "fuel_type_id": fuel_type_id,
                "price_per_liter": price.price_per_liter,
            }
        )

    if rows_to_upsert:
        client.table("fuel_prices").upsert(
            rows_to_upsert,
            on_conflict="bulletin_id,region_id,oil_company_id,fuel_type_id",
        ).execute()

    return {
        "bulletin_date": parsed.bulletin_date.isoformat(),
        "price_rows": len(rows_to_upsert),
        "companies": len(company_ids),
        "duplicates_skipped": duplicates_skipped,
    }


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
