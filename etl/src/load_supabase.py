"""Load parsed DOE bulletin rows into Supabase."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from supabase import Client, create_client

from .constants import FUEL_TYPE_CODES, REGION_CODES
from .parse_bulletin import ParsedBulletin, slugify_company

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def _client() -> Client:
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        raise RuntimeError(
            "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in etl/.env "
            "(Dashboard → Settings → API → service_role key)."
        )
    return create_client(url, key)


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


def _ensure_oil_company(client: Client, name: str, cache: dict[str, str]) -> str:
    slug = slugify_company(name)
    if slug in cache:
        return cache[slug]

    existing = (
        client.table("oil_companies")
        .select("id,slug")
        .eq("slug", slug)
        .maybe_single()
        .execute()
    )
    if existing and existing.data:
        cache[slug] = existing.data["id"]
        return cache[slug]

    inserted = (
        client.table("oil_companies")
        .insert({"name": name, "slug": slug})
        .select("id,slug")
        .execute()
    )
    row = _first_row(inserted)
    cache[slug] = row["id"]
    return cache[slug]


def load_bulletin(parsed: ParsedBulletin, *, dry_run: bool = False) -> dict[str, int]:
    if parsed.region_code not in REGION_CODES.values():
        raise ValueError(f"Unknown region code: {parsed.region_code}")

    if dry_run:
        return {
            "bulletin_date": parsed.bulletin_date.isoformat(),
            "price_rows": len(parsed.prices),
            "dry_run": 1,
        }

    client = _client()
    region_ids = _fetch_id_map(client, "regions", "code")
    fuel_type_ids = _fetch_id_map(client, "fuel_types", "code")
    company_ids: dict[str, str] = {}

    region_id = region_ids[parsed.region_code]
    bulletin_date = parsed.bulletin_date.isoformat()

    # Check for duplicate bulletin (same date and region)
    existing_bulletin = (
        client.table("fuel_price_bulletins")
        .select("id")
        .eq("bulletin_date", bulletin_date)
        .execute()
    )
    
    # Calculate data freshness (days between bulletin date and load date)
    load_date = datetime.now(timezone.utc)
    bulletin_datetime = datetime.combine(parsed.bulletin_date, datetime.min.time()).replace(tzinfo=timezone.utc)
    days_old = (load_date - bulletin_datetime).days
    
    if existing_bulletin.data:
        # Bulletin exists, get its ID for upsert
        bulletin_id = existing_bulletin.data[0]["id"]
        # Update freshness indicator
        client.table("fuel_price_bulletins").update({
            "data_freshness_days": days_old,
            "last_loaded_at": load_date.isoformat(),
        }).eq("id", bulletin_id).execute()
    else:
        # Create new bulletin with freshness indicator
        bulletin_resp = (
            client.table("fuel_price_bulletins")
            .insert(
                {
                    "bulletin_date": bulletin_date,
                    "source_pdf_url": parsed.source_path,
                    "notes": f"ETL import — {parsed.week_label}",
                    "data_freshness_days": days_old,
                    "last_loaded_at": load_date.isoformat(),
                }
            )
            .select("id")
            .execute()
        )
        bulletin_id = _first_row(bulletin_resp)["id"]

    rows_to_upsert = []
    duplicates_skipped = 0
    
    for price in parsed.prices:
        if price.fuel_type_code not in fuel_type_ids:
            continue
        company_id = _ensure_oil_company(client, price.company, company_ids)
        
        # Check for duplicate price entry
        existing_price = (
            client.table("fuel_prices")
            .select("id,price_per_liter")
            .eq("bulletin_id", bulletin_id)
            .eq("region_id", region_id)
            .eq("oil_company_id", company_id)
            .eq("fuel_type_id", fuel_type_ids[price.fuel_type_code])
            .maybe_single()
            .execute()
        )
        
        if existing_price and existing_price.data:
            # Check if price is different
            if abs(existing_price.data["price_per_liter"] - price.price_per_liter) < 0.01:
                duplicates_skipped += 1
                continue  # Skip duplicate with same price
        
        rows_to_upsert.append(
            {
                "bulletin_id": bulletin_id,
                "region_id": region_id,
                "oil_company_id": company_id,
                "fuel_type_id": fuel_type_ids[price.fuel_type_code],
                "price_per_liter": price.price_per_liter,
            }
        )

    if rows_to_upsert:
        client.table("fuel_prices").upsert(
            rows_to_upsert,
            on_conflict="bulletin_id,region_id,oil_company_id,fuel_type_id",
        ).execute()

    return {
        "bulletin_date": bulletin_date,
        "price_rows": len(rows_to_upsert),
        "companies": len(company_ids),
        "duplicates_skipped": duplicates_skipped,
    }


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
