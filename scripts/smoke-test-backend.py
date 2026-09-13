#!/usr/bin/env python3
"""Backend smoke test — Supabase data + schema checks for GasTa mobile."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "etl"))

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / "etl" / ".env")

from src.load_supabase import _client  # noqa: E402

REGIONS = ("NCR", "NORTH_LUZON", "SOUTH_LUZON", "VISAYAS", "MINDANAO")
MIN_PRICES_PER_REGION = 10


def ok(msg: str) -> None:
    print(f"  PASS  {msg}")


def fail(msg: str) -> None:
    print(f"  FAIL  {msg}")


def main() -> int:
    print("GasTa backend smoke test\n")
    errors = 0
    client = _client()

    # Regions
    regions_resp = client.table("regions").select("code").execute()
    codes = {r["code"] for r in (regions_resp.data or [])}
    missing_regions = set(REGIONS) - codes
    if missing_regions:
        fail(f"Missing regions: {sorted(missing_regions)}")
        errors += 1
    else:
        ok(f"All 5 regions present: {', '.join(REGIONS)}")

    # Latest bulletin
    bulletin_resp = (
        client.table("fuel_price_bulletins")
        .select("id, bulletin_date")
        .order("bulletin_date", desc=True)
        .limit(1)
        .maybe_single()
        .execute()
    )
    if not bulletin_resp or not bulletin_resp.data:
        fail("No fuel_price_bulletins rows")
        errors += 1
    else:
        latest_date = bulletin_resp.data["bulletin_date"]
        ok(f"Latest bulletin date: {latest_date}")

        region_ids = {
            r["code"]: r["id"]
            for r in (
                client.table("regions").select("id, code").in_("code", list(REGIONS)).execute().data
                or []
            )
        }

        for code in REGIONS:
            count_resp = (
                client.table("fuel_prices")
                .select("id", count="exact")
                .eq("bulletin_id", bulletin_resp.data["id"])
                .eq("region_id", region_ids[code])
                .execute()
            )
            count = count_resp.count or 0
            if count >= MIN_PRICES_PER_REGION:
                ok(f"{code}: {count} prices on latest bulletin")
            else:
                # Some regions may use a different latest week — check any bulletin
                any_resp = (
                    client.table("fuel_prices")
                    .select("id", count="exact")
                    .eq("region_id", region_ids[code])
                    .execute()
                )
                any_count = any_resp.count or 0
                if any_count >= MIN_PRICES_PER_REGION:
                    ok(f"{code}: {any_count} prices total (latest bulletin had {count})")
                else:
                    fail(f"{code}: only {any_count} fuel_prices rows (need >= {MIN_PRICES_PER_REGION})")
                    errors += 1

    # Fuel types + companies for filters
    fuels = client.table("fuel_types").select("code", count="exact").execute()
    if (fuels.count or 0) >= 7:
        ok(f"fuel_types: {fuels.count}")
    else:
        fail(f"fuel_types: expected >= 7, got {fuels.count}")
        errors += 1

    companies = client.table("oil_companies").select("slug", count="exact").execute()
    if (companies.count or 0) >= 5:
        ok(f"oil_companies: {companies.count}")
    else:
        fail(f"oil_companies: expected >= 5, got {companies.count}")
        errors += 1

    # Schema objects mobile needs
    for table in ("saved_trips", "trip_records", "vehicles", "fuel_budgets", "fuel_stations"):
        resp = client.table(table).select("*", count="exact").limit(0).execute()
        ok(f"table `{table}` readable ({resp.count or 0} rows)")

    stations = (
        client.table("fuel_stations")
        .select("id", count="exact")
        .execute()
    )
    if (stations.count or 0) >= 1:
        ok(f"fuel_stations seed: {stations.count} stations")
    else:
        fail("fuel_stations: no rows (community demo needs NCR seed)")
        errors += 1

    # Vehicle catalog for picker
    catalog = client.table("vehicle_catalog").select("id", count="exact").execute()
    if (catalog.count or 0) >= 1:
        ok(f"vehicle_catalog: {catalog.count} entries")
    else:
        fail("vehicle_catalog empty")
        errors += 1

    print()
    if errors:
        print(f"Result: {errors} check(s) failed")
        return 1
    print("Result: all backend checks passed")
    print("\nManual app smoke test (on device/emulator):")
    print("  1. Fuel Prices — switch all 5 regions, confirm prices load")
    print("  2. Sign in → Vehicles — add vehicle + last refill price")
    print("  3. Trip — run SAW → Save as template → Saved Trips")
    print("  4. Trip — Log to history → Trip History + Budget tab")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
