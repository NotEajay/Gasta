"""Fill gaps when a multi-PDF region is missing a sub-region this week.

South Luzon publishes Calabarzon / Mimaropa / Bicol as separate PDFs. When one
media object is 403 (or absent), the newest week would otherwise drop those
cities from the app. This module copies city rows from the previous stored week
for any area_name that the new parse does not cover.
"""

from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .parse_bulletin import ParsedBulletin, ParsedPrice


def _client():
    # Lazy import so unit tests can exercise pure helpers without Supabase deps.
    from .load_supabase import _client as supabase_client

    return supabase_client()


def _parsed_price(
    company: str, fuel_type_code: str, price_per_liter: float, area_name: str
) -> Any:
    from .parse_bulletin import ParsedPrice

    return ParsedPrice(
        company=company,
        fuel_type_code=fuel_type_code,
        price_per_liter=price_per_liter,
        area_name=area_name,
    )


def _prior_bulletin_date(region_code: str, before: date) -> date | None:
    """Newest stored week for the region that is strictly older than `before`."""
    client = _client()
    response = (
        client.table("region_bulletin_weeks")
        .select("bulletin_date")
        .eq("region_code", region_code)
        .lt("bulletin_date", before.isoformat())
        .order("bulletin_date", desc=True)
        .limit(1)
        .execute()
    )
    rows = response.data if response else []
    if not rows:
        return None
    return date.fromisoformat(rows[0]["bulletin_date"])


def fetch_region_prices_for_week(region_code: str, week_start: date) -> list[Any]:
    """Price rows already stored for one region/week, as ParsedPrice values."""
    client = _client()
    bulletin_resp = (
        client.table("fuel_price_bulletins")
        .select("id")
        .eq("bulletin_date", week_start.isoformat())
        .maybe_single()
        .execute()
    )
    if not bulletin_resp or not bulletin_resp.data:
        return []

    region_resp = (
        client.table("regions").select("id").eq("code", region_code).maybe_single().execute()
    )
    if not region_resp or not region_resp.data:
        return []

    response = (
        client.table("fuel_prices")
        .select(
            "price_per_liter,area_name,"
            "oil_companies(name),fuel_types(code)"
        )
        .eq("bulletin_id", bulletin_resp.data["id"])
        .eq("region_id", region_resp.data["id"])
        .execute()
    )
    prices: list[Any] = []
    for row in response.data or []:
        company = (row.get("oil_companies") or {}).get("name")
        fuel = (row.get("fuel_types") or {}).get("code")
        if not company or not fuel:
            continue
        prices.append(
            _parsed_price(
                company,
                fuel,
                float(row["price_per_liter"]),
                row.get("area_name") or "",
            )
        )
    return prices


def areas_present(prices: list[Any]) -> set[str]:
    """Non-empty city/area labels covered by a price list."""
    return {p.area_name for p in prices if p.area_name}


def carry_forward_missing_areas(parsed: ParsedBulletin) -> list[str]:
    """Append prior-week city rows for areas the new parse does not cover.

    Region-wide rows (`area_name == ""`) are never carried: the new week's
    aggregates already reflect whatever sub-regions downloaded successfully.

    Returns the sorted list of area names that were filled in (empty if none).
    """
    prior_week = _prior_bulletin_date(parsed.region_code, parsed.bulletin_date)
    if prior_week is None:
        return []

    prior_prices = fetch_region_prices_for_week(parsed.region_code, prior_week)
    if not prior_prices:
        return []

    current_areas = areas_present(parsed.prices)
    carried_areas: set[str] = set()
    for price in prior_prices:
        if not price.area_name or price.area_name in current_areas:
            continue
        parsed.prices.append(
            _parsed_price(
                price.company,
                price.fuel_type_code,
                price.price_per_liter,
                price.area_name,
            )
        )
        carried_areas.add(price.area_name)

    if carried_areas:
        names = ", ".join(sorted(carried_areas)[:8])
        more = "" if len(carried_areas) <= 8 else f" (+{len(carried_areas) - 8} more)"
        parsed.warnings.append(
            f"Carried forward {len(carried_areas)} area(s) from "
            f"{prior_week.isoformat()} (missing this week): {names}{more}"
        )
    return sorted(carried_areas)


def db_missing_areas_vs_prior(parsed: ParsedBulletin) -> list[str]:
    """Areas the prior week had that the already-stored current week still lacks.

    Used so a week that was loaded without Bicol is reloaded once carry-forward
    can fill those cities, instead of being skipped forever.
    """
    prior_week = _prior_bulletin_date(parsed.region_code, parsed.bulletin_date)
    if prior_week is None:
        return []
    prior_areas = areas_present(
        fetch_region_prices_for_week(parsed.region_code, prior_week)
    )
    current_in_db = areas_present(
        fetch_region_prices_for_week(parsed.region_code, parsed.bulletin_date)
    )
    return sorted(prior_areas - current_in_db)
