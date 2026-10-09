"""Official directory tests: no live source, Supabase, prices, or geocoding calls."""
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest

from stations.seaoil import SOURCE, clean, identity, official_url, parse_fuels, parse_listing
from stations.sync import collect, load_sample

FIXTURES = Path(__file__).parent / "fixtures" / "stations"
LISTING = (FIXTURES / "seaoil_listing.html").read_text()
DETAIL = (FIXTURES / "seaoil_detail.html").read_text()


def test_observed_listing_and_product_availability():
    rows, next_url = parse_listing(LISTING)
    assert len(rows) == 5
    assert next_url == SOURCE + "?1a2d56f2_page=2"
    assert rows[0].name == "1ST CRUMB ZONE 1 - DIGOS CITY"
    assert rows[0].operating_hours == "Open 24 hours"
    assert rows[0].source_url.startswith("https://www.seaoil.com.ph/stations/")
    assert all(row.latitude is None and row.longitude is None for row in rows)
    assert all(row.city is None and row.province is None for row in rows)
    assert parse_fuels(DETAIL, rows[0].source_station_id) == ["Extreme 95", "Extreme Diesel"]
    assert clean(" City  ,   Province\n") == "City, Province"
    assert clean(" \t ") is None


def test_identity_stable_despite_spacing_case_and_source_rename():
    assert identity(None, "  Station A ", " CITY\n Road ") == identity(None, "station a", "city road")
    assert identity("abc", "Old name", None) == identity("abc", "New name", "New address")
    with pytest.raises(ValueError):
        identity(None, "A", None)


def test_missing_address_is_unknown_not_fabricated():
    rows, _ = parse_listing(LISTING.replace('fs-cmsfilter-field="address"', 'data-no-address="address"'))
    assert rows[0].address is None
    assert rows[0].directory_key.startswith("source:")


@pytest.mark.parametrize("markup", ["", "<html><p>No stations</p></html>", LISTING.replace('fs-cmsfilter-field="name"', 'data-no-name="name"')])
def test_layout_drift_and_missing_name_fail_closed(markup):
    with pytest.raises(ValueError):
        parse_listing(markup)


def test_wrong_detail_and_unknown_fuel_fail_closed():
    with pytest.raises(ValueError):
        parse_fuels(DETAIL, "different-station")
    with pytest.raises(ValueError):
        parse_fuels(DETAIL.replace("Extreme 95", "Unknown fuel"), parse_listing(LISTING)[0][0].source_station_id)
    assert parse_fuels('<html data-wf-item-slug="a" data-wf-collection="b"><body></body></html>', "a") == []


@pytest.mark.parametrize("url", ["https://evil.invalid/x", "http://www.seaoil.com.ph/x", "//evil.invalid/x"])
def test_unexpected_hosts_rejected(url):
    with pytest.raises(ValueError):
        official_url(url)


def detail_for(row):
    return DETAIL.replace(parse_listing(LISTING)[0][0].source_station_id, row.source_station_id)


def test_sample_bound_and_paginated_full_walk():
    rows, next_url = parse_listing(LISTING)
    first = LISTING.replace('</body>', '</body>')
    last = '<html><body><div class="station-info-wrapper"><a href="/stations/last"><h4 fs-cmsfilter-field="name">Last</h4></a></div></body></html>'
    pages = {SOURCE: first, next_url: last, **{r.source_url: detail_for(r) for r in rows}, 'https://www.seaoil.com.ph/stations/last': detail_for(replace(rows[0], source_station_id="last"))}
    calls = []
    def get(url):
        calls.append(url)
        return pages[url]
    sample, stats = collect(get, limit=2)
    assert len(sample) == 2 and len(calls) == 3
    assert stats["listing_records_parsed"] == 5 and not stats["complete_directory"]
    full, stats = collect(get, limit=0)
    assert len(full) == 6 and stats["complete_directory"] and stats["pages"] == 2
    assert full[-1].address is None
    with pytest.raises(ValueError, match="page limit"):
        collect(get, limit=0, max_pages=1)


def test_duplicate_pages_deduplicate_or_detect_conflicts_and_loops():
    rows, next_url = parse_listing(LISTING)
    pages = {SOURCE: LISTING, next_url: LISTING.split('<a class="w-pagination-next"')[0] + '</body></html>', **{r.source_url: detail_for(r) for r in rows}}
    full, _ = collect(pages.__getitem__, limit=0)
    assert len(full) == 5
    pages[next_url] = pages[next_url].replace("1ST CRUMB ZONE 1", "Renamed branch")
    with pytest.raises(ValueError, match="Conflicting"):
        collect(pages.__getitem__, limit=0)
    pages[next_url] = LISTING
    with pytest.raises(ValueError, match="Pagination loop"):
        collect(pages.__getitem__, limit=0)


class Client:
    def __init__(self):
        self.records = {}
        self.calls = []
    def table(self, table):
        self.calls.append(table)
        self.current = table
        return self
    def select(self, columns):
        assert columns == "id"
        return self
    def eq(self, key, value):
        assert (key, value) == ("slug", "seaoil")
        return self
    def upsert(self, rows, on_conflict, default_to_null):
        assert on_conflict == "oil_company_id,directory_key"
        assert default_to_null is False
        for row in rows:
            key = (row["oil_company_id"], row["directory_key"])
            self.records[key] = {**self.records.get(key, {}), **row}
        return self
    def execute(self):
        return SimpleNamespace(data=[{"id": "company"}])


def test_repeated_import_updates_existing_rows_and_never_touches_prices():
    rows, _ = parse_listing(LISTING)
    client = Client()
    assert load_sample(client, rows, "2026-10-09T00:00:00+00:00") == 5
    key = ("company", rows[0].directory_key)
    client.records[key]["latitude"] = 14.1  # Future explicitly approved geocoding.
    load_sample(client, [replace(rows[0], name="Updated station"), *rows[1:]], "2026-10-10T00:00:00+00:00")
    assert len(client.records) == 5
    assert client.records[key]["name"] == "Updated station"
    assert client.records[key]["latitude"] == 14.1
    assert client.records[key]["last_synced_at"].startswith("2026-10-10")
    assert set(client.calls) == {"oil_companies", "fuel_stations"}
    assert all("region_id" not in row and "price" not in row for row in client.records.values())
    with pytest.raises(ValueError, match="Duplicate import"):
        load_sample(client, [rows[0], rows[0]], "now")


def test_detail_failure_stops_collection_before_a_write_can_be_requested():
    def get(url):
        if url == SOURCE:
            return LISTING
        raise RuntimeError("Source temporarily unavailable")
    with pytest.raises(RuntimeError, match="Source temporarily unavailable"):
        collect(get)


def test_robots_denial_prevents_read(monkeypatch):
    from stations.sync import PublicPages
    calls = []
    def read(self, url):
        calls.append(url)
        return "User-agent: *\nDisallow: /stations/\n"
    monkeypatch.setattr(PublicPages, "_read", read)
    pages = PublicPages()
    with pytest.raises(RuntimeError, match="disallow"):
        pages.get("https://www.seaoil.com.ph/stations/a")
    assert calls == ["https://www.seaoil.com.ph/robots.txt"]


def test_same_page_duplicate_listing_is_counted_not_silently_discarded():
    from lxml import html, etree
    card = html.fromstring(LISTING).xpath('//*[@class="station-info-wrapper"]')[0]
    markup = LISTING.replace('</body>', etree.tostring(card, encoding='unicode') + '</body>')
    rows, _ = parse_listing(markup)
    assert len(rows) == 6 and len({r.directory_key for r in rows}) == 5
    markup = markup.split('<a class="w-pagination-next"')[0] + etree.tostring(card, encoding='unicode') + '</body></html>'
    # Raw audit also retains duplicate cards independently of strict parser.
    from stations.audit import inspect_listing, summarize
    raw, _, page = inspect_listing(markup, SOURCE)
    result = summarize(raw, [page])
    assert result['raw_listings'] == 6
    assert result['duplicate_listings'] == 1
    assert result['unique_stations'] == 5


def test_unreviewed_distinct_ids_with_identical_name_address_are_quarantined():
    rows, _ = parse_listing(LISTING)
    alias = replace(rows[0], source_station_id='alias', directory_key='source:alias', source_url='https://www.seaoil.com.ph/stations/alias', name='  '+rows[0].name.lower()+' ')
    client = Client()
    reports = []
    assert load_sample(client, [rows[0], alias], '2026-10-09T00:00:00+00:00', on_report=reports.append) == 0
    assert client.calls == []
    import json
    result = json.loads(reports[0])
    assert result['quarantined_records'] == 2
    assert len(result['quarantine']) == 2
    assert result['duplicate_name_address_warnings'] == 1


def test_audit_retains_missing_detail_and_reports_key_collision_without_dropping():
    from stations.audit import inspect_listing, summarize, certification
    markup = LISTING.replace('/stations/ata-seaoil-gas-up-and-service-center-1st-crumb-digos-city', '/not-a-detail')
    raw, _, page = inspect_listing(markup, SOURCE)
    assert len(raw) == 5 and raw[0]['issues'] == ['missing_detail_url']
    result = summarize(raw, [page])
    assert result['raw_listings'] == 5 and result['detail_urls_missing'] == 1
    assert certification(result, [])['safe_to_import'] == 'NO'
    valid, _, page = inspect_listing(LISTING, SOURCE)
    alias = {**valid[0], 'address': 'Different address'}
    result = summarize([*valid, alias], [page])
    assert result['import_key_collisions'] == 1
    assert len(result['collision_groups'][0]['records']) == 2
    assert certification(result, [])['safe_to_import'] == 'NO'


def test_audit_sample_covers_different_addresses_and_catches_bad_detail():
    from stations.audit import inspect_listing, sample_records, enrich_sample
    raw, _, _ = inspect_listing(LISTING, SOURCE)
    selected = sample_records(raw, 3)
    assert len(selected) == 3 and len({r['directory_key'] for r in selected}) == 3
    detail = DETAIL.replace(raw[0]['source_station_id'], selected[0]['source_station_id'])
    enriched = enrich_sample(lambda url: detail, raw, 3)
    assert len(enriched) == 3
    assert any(r['detail_error'] for r in enriched)  # Deliberately mismatched slugs.
    assert sum(r['identity_matches'] for r in enriched) == 1
