"""Complete listing audit plus bounded detail sample. No database-write interface.

Run from etl: python -m stations.audit --output data/stations/seaoil-full-preview.json
Raw records and anomalies are retained, including duplicate listings and bad URLs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urlparse

from .seaoil import SOURCE, _document, _text, clean, identity, official_url, parse_fuels, sync_time
from .sync import PublicPages
from .review import plan_import


def inspect_listing(content: str, page_url: str) -> tuple[list[dict], str | None, dict]:
    root = _document(content)
    cards = root.xpath('//*[contains(concat(" ", normalize-space(@class), " "), " station-info-wrapper ")]')
    if not cards:
        raise ValueError("No SEAOIL station cards found; refusing to certify pagination")
    records = []
    for index, card in enumerate(cards):
        name, address = _text(card, "name"), _text(card, "address")
        links = card.xpath('.//a/@href')
        detail_links = [link for link in links if "/stations/" in link]
        hours = card.xpath('.//*[contains(concat(" ", normalize-space(@class), " "), " hours-info ")]')
        record = {"listing_page": page_url, "listing_index": index + 1,
                  "name": name, "address": address, "detail_links": detail_links,
                  "source_url": None, "source_station_id": None, "directory_key": None,
                  "operating_hours": clean(hours[0].text_content()) if hours else None, "issues": []}
        if not name:
            record["issues"].append("missing_name")
        if not detail_links:
            record["issues"].append("missing_detail_url")
        elif len(detail_links) != 1:
            record["issues"].append("ambiguous_detail_urls")
        else:
            try:
                url = official_url(detail_links[0], page_url)
                parsed = urlparse(url)
                slug = parsed.path.removeprefix("/stations/").rstrip("/")
                if not parsed.path.startswith("/stations/") or not slug or "/" in slug or parsed.query:
                    raise ValueError("Invalid detail URL slug")
                record.update(source_url=url, source_station_id=slug, directory_key=identity(slug, name or "", address))
            except ValueError:
                record["issues"].append("invalid_detail_url")
        records.append(record)
    links = root.xpath('//a[contains(concat(" ", normalize-space(@class), " "), " w-pagination-next ")]/@href')
    if len(links) > 1:
        raise ValueError("Ambiguous pagination")
    next_url = official_url(links[0], page_url) if links else None
    if next_url and urlparse(next_url).path != urlparse(SOURCE).path:
        raise ValueError("Pagination left the station directory")
    counts = root.xpath('//*[contains(concat(" ", normalize-space(@class), " "), " w-page-count ")]/text()')
    return records, next_url, {"url": page_url, "raw_records": len(records), "next_url": next_url,
                               "published_page_count": [clean(value) for value in counts],
                               "html_sha256": hashlib.sha256(content.encode()).hexdigest()}


def crawl_listings(get, max_pages: int = 100, progress=lambda message: None) -> tuple[list[dict], list[dict]]:
    records, pages, visited = [], [], set()
    url = SOURCE
    while url:
        if url in visited or len(visited) >= max_pages:
            raise ValueError("Pagination loop or page limit reached; full audit incomplete")
        visited.add(url)
        rows, next_url, page = inspect_listing(get(url), url)
        records.extend(rows)
        pages.append(page)
        progress(f"Listing page {len(pages)}: {len(rows)} records; total {len(records)}")
        url = next_url
    return records, pages


def summarize(records: list[dict], pages: list[dict]) -> dict:
    keys, pairs = defaultdict(list), defaultdict(list)
    for record in records:
        if record["directory_key"]:
            keys[record["directory_key"]].append(record)
        if record["name"] and record["address"]:
            pairs[(clean(record["name"]).casefold(), clean(record["address"]).casefold())].append(record)
    collisions = []
    duplicates = []
    for key, rows in keys.items():
        if len(rows) > 1:
            group = {"key": key, "records": rows}
            duplicates.append(group)
            signatures = {(r["name"], r["address"], r["source_url"], r["operating_hours"]) for r in rows}
            if len(signatures) != 1:
                collisions.append(group)
    pair_duplicates = [{"normalized_name": pair[0], "normalized_address": pair[1], "records": rows}
                       for pair, rows in pairs.items() if len(rows) > 1]
    return {"pages": len(pages), "raw_listings": len(records), "unique_stations": len(keys),
            "duplicate_listings": sum(len(rows) - 1 for rows in keys.values()),
            "missing_addresses": sum(not r["address"] for r in records),
            "detail_urls_available": sum(bool(r["source_url"]) for r in records),
            "detail_urls_missing": sum(not r["detail_links"] for r in records),
            "invalid_or_ambiguous_detail_urls": sum(bool(r["detail_links"]) and not r["source_url"] for r in records),
            "invalid_records": sum(bool(r["issues"]) for r in records),
            "import_key_collisions": len(collisions), "collision_groups": collisions,
            "duplicate_key_groups": duplicates,
            "duplicate_normalized_name_address_groups": len(pair_duplicates),
            "records_with_duplicate_normalized_name_address": sum(len(g["records"]) for g in pair_duplicates),
            "normalized_duplicate_groups": pair_duplicates,
            "unique_normalized_name_address_pairs": len(pairs),
            "listing_hours_available": sum(bool(r["operating_hours"]) for r in records),
            "addresses_without_commas": sum(bool(r["address"]) and "," not in r["address"] for r in records)}


# Sampling strata only: labels are NOT written into city/province/region fields.
# Explicit address terms select geographic variety; remaining slots span the list.
SAMPLE_TERMS = ["ILOCOS", "ISABELA", "BENGUET", "PANGASINAN", "PAMPANGA", "QUEZON CITY",
                "MAKATI", "TAGUIG", "BATANGAS", "CAVITE", "LAGUNA", "PALAWAN", "CAMARINES",
                "ALBAY", "CEBU", "ILOILO", "NEGROS", "BOHOL", "LEYTE", "SAMAR", "ZAMBOANGA",
                "BUKIDNON", "DAVAO", "COTABATO", "AGUSAN", "MISAMIS"]


def sample_records(records: list[dict], size: int) -> list[dict]:
    valid = [r for r in records if not r["issues"]]
    selected, seen = [], set()
    def add(record):
        if record["directory_key"] not in seen and len(selected) < size:
            selected.append(record)
            seen.add(record["directory_key"])
    for term in SAMPLE_TERMS:
        match = next((r for r in valid if term in (r["address"] or "").upper() and r["directory_key"] not in seen), None)
        if match:
            add(match)
    if valid:
        for index in range(size):
            add(valid[round(index * (len(valid) - 1) / max(1, size - 1))])
        for record in valid:
            add(record)
    return selected


def enrich_sample(get, records: list[dict], size: int = 30, progress=lambda message: None) -> list[dict]:
    enriched = []
    for index, record in enumerate(sample_records(records, size)):
        result = {**record, "fuel_types": None, "identity_matches": False, "detail_error": None}
        try:
            content = get(record["source_url"])
            result["fuel_types"] = parse_fuels(content, record["source_station_id"])
            result["identity_matches"] = True
        except Exception as error:
            result["detail_error"] = f"{type(error).__name__}: {error}"
        enriched.append(result)
        progress(f"Detail {index + 1}: {'OK' if not result['detail_error'] else 'FAILED'} — {record['name']}")
    return enriched


def certification(summary: dict, enriched: list[dict], records: list[dict] | None = None) -> dict:
    summary = {**summary, "sample_enriched": len(enriched),
               "sample_identity_matches": sum(r["identity_matches"] for r in enriched),
               "sample_detail_errors": sum(bool(r["detail_error"]) for r in enriched),
               "sample_with_fuels": sum(bool(r["fuel_types"]) for r in enriched),
               "sample_with_hours": sum(bool(r["operating_hours"]) for r in enriched),
               "fuel_product_counts": dict(Counter(f for r in enriched for f in r["fuel_types"] or []))}
    if records is not None and summary["invalid_records"] == 0 and summary["import_key_collisions"] == 0:
        plan = plan_import(records)
        summary.update(plan.summary())
        summary["quarantine"] = plan.quarantined
        summary["safe_subset_ready"] = bool(plan.eligible and enriched and summary["sample_detail_errors"] == 0)
        summary["safe_to_import"] = "YES" if summary["safe_subset_ready"] and not plan.quarantined else "NO"
    else:
        summary["safe_subset_ready"] = False
        summary["safe_to_import"] = "YES" if (summary["invalid_records"] == 0
            and summary["import_key_collisions"] == 0
            and summary["duplicate_normalized_name_address_groups"] == 0
            and enriched and summary["sample_detail_errors"] == 0) else "NO"
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("data/stations/seaoil-full-preview.json"))
    parser.add_argument("--sample-size", type=int, default=30)
    parser.add_argument("--max-pages", type=int, default=100)
    args = parser.parse_args()
    if args.sample_size < 1 or args.max_pages < 1:
        parser.error("sample-size and max-pages must be positive")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    cache = args.output.parent / "seaoil-audit-html"
    cache.mkdir(exist_ok=True)
    pages = PublicPages()
    def get(url):
        content = pages.get(url)
        (cache / (hashlib.sha256(url.encode()).hexdigest() + ".html")).write_text(content)
        return content
    records, listing_pages = crawl_listings(get, args.max_pages, lambda s: print(s, flush=True))
    summary = summarize(records, listing_pages)
    report = {"source_url": SOURCE, "audited_at": sync_time(), "summary": summary,
              "listing_pages": listing_pages, "raw_records": records, "enriched_sample": []}
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print("LISTING AUDIT (before detail requests):", json.dumps({k: v for k, v in summary.items() if not k.endswith('groups')}, ensure_ascii=False), flush=True)
    enriched = enrich_sample(get, records, args.sample_size, lambda s: print(s, flush=True))
    report["enriched_sample"] = enriched
    report["summary"] = certification(summary, enriched, records)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print("SEAOIL FULL PREVIEW", json.dumps({k: v for k, v in report["summary"].items() if not k.endswith('groups')}, indent=2), flush=True)
    print(f"Full records/anomalies retained in {args.output}; no database writes.", flush=True)


if __name__ == "__main__":
    main()
