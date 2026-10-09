"""Preview-first CLI. Run from etl: python -m stations.sync --limit 5."""
from __future__ import annotations

import argparse
import json
import time
from dataclasses import replace
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from urllib.robotparser import RobotFileParser

from .seaoil import SOURCE, Station, official_url, parse_fuels, parse_listing, sync_time

from .review import load_reviews, plan_import

USER_AGENT = "GasTaStationDirectory/1.0"
MAX_BYTES = 4_000_000


class PublicPages:
    def __init__(self, delay: float = 0.5):
        self.delay = delay
        self.last_request = 0.0
        self.robots = RobotFileParser()
        robots_url = "https://www.seaoil.com.ph/robots.txt"
        try:
            self.robots.parse(self._read(robots_url).splitlines())
        except HTTPError as error:
            if error.code != 404:
                raise RuntimeError("Cannot verify robots directives; no station fetch attempted") from error
            self.robots.parse([])

    def _read(self, url: str) -> str:
        official_url(url)
        time.sleep(max(0, self.delay - (time.monotonic() - self.last_request)))
        try:
            with urlopen(Request(url, headers={"User-Agent": USER_AGENT}), timeout=30) as response:
                official_url(response.geturl())
                if response.headers.get_content_type() not in {"text/html", "text/plain"}:
                    raise ValueError("Unexpected source content type")
                content = response.read(MAX_BYTES + 1)
                if len(content) > MAX_BYTES:
                    raise ValueError("Source document exceeds size limit")
                return content.decode(response.headers.get_content_charset() or "utf-8")
        finally:
            self.last_request = time.monotonic()

    def get(self, url: str) -> str:
        if not self.robots.can_fetch(USER_AGENT, url):
            raise RuntimeError("Source robots directives disallow this page")
        return self._read(url)


def collect(get, limit: int = 5, max_pages: int = 100) -> tuple[list[Station], dict]:
    """Keep listing evidence, plan quarantine, enrich only eligible source identities."""
    if limit < 0 or max_pages < 1:
        raise ValueError("Invalid collection bounds")
    registry = load_reviews()
    url = SOURCE
    visited: set[str] = set()
    inventory: dict[str, Station] = {}
    enriched: dict[str, Station] = {}
    listing_count = duplicate_count = 0

    def result(plan, complete):
        selected = [enriched[row.directory_key] for row in plan.eligible if row.directory_key in enriched]
        return selected, {"pages": len(visited), "listing_records_parsed": listing_count,
                          "enriched_records": len(selected), "duplicate_listings": duplicate_count,
                          "complete_directory": complete, "eligible_listings": len(plan.eligible),
                          "quarantined_records": len(plan.quarantined), "quarantine": plan.quarantined,
                          "duplicate_name_address_warnings": plan.warnings}

    while url:
        if url in visited or len(visited) >= max_pages:
            raise ValueError("Pagination loop or page limit reached")
        visited.add(url)
        rows, next_url = parse_listing(get(url), url)
        listing_count += len(rows)
        for row in rows:
            previous = inventory.get(row.directory_key)
            if previous:
                if previous != row:
                    raise ValueError("Conflicting station across directory pages")
                duplicate_count += 1
            else:
                inventory[row.directory_key] = row
        plan = plan_import(list(inventory.values()), registry)
        for row in plan.eligible:
            if row.directory_key not in enriched:
                fuels = parse_fuels(get(row.source_url), row.source_station_id)
                enriched[row.directory_key] = replace(row, fuel_types=fuels)
            if limit and sum(r.directory_key in enriched for r in plan.eligible) >= limit:
                return result(plan, False)
        url = next_url
    return result(plan_import(list(inventory.values()), registry), True)


def load_sample(client, rows: list[Station], timestamp: str, *, reviews=None, on_report=print) -> int:
    """Upsert eligible IDs only; report every exclusion before any database access."""
    plan = plan_import(rows, reviews)
    on_report(json.dumps({**plan.summary(), "quarantine": plan.quarantined, "warnings": plan.warnings}, ensure_ascii=False))
    if not plan.eligible:
        return 0
    companies = client.table("oil_companies").select("id").eq("slug", "seaoil").execute().data
    if len(companies or []) != 1:
        raise ValueError("Expected the existing seaoil company; no companies are created")
    payloads = [row.payload(companies[0]["id"], timestamp) for row in plan.eligible]
    client.table("fuel_stations").upsert(payloads, on_conflict="oil_company_id,directory_key", default_to_null=False).execute()
    return len(payloads)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=5, help="Enrich at most N stations; 0 explicitly walks the full directory")
    parser.add_argument("--max-pages", type=int, default=100)
    parser.add_argument("--write", action="store_true", help="Explicitly upsert collected records (default: preview only)")
    args = parser.parse_args()
    if args.limit < 0 or args.max_pages < 1:
        parser.error("limit must be nonnegative and max-pages must be positive")
    pages = PublicPages()
    rows, stats = collect(pages.get, args.limit, args.max_pages)
    timestamp = sync_time()
    print(json.dumps({**stats, "synced_at": timestamp, "stations": [row.preview() for row in rows]}, indent=2, ensure_ascii=False))
    if args.write:
        # Reuse credentials only, never call the DOE parser/loader.
        import os
        from pathlib import Path
        from dotenv import load_dotenv
        from supabase import create_client
        load_dotenv(Path(__file__).resolve().parents[1] / ".env")
        url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --write")
        written = load_sample(create_client(url, key), rows, timestamp)
        print(f"Upserted {written} official station directory records; no prices written.")


if __name__ == "__main__":
    main()
