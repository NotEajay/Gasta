"""South Luzon week-heading discovery (undated nested sub-region PDFs)."""

from __future__ import annotations

from datetime import date
from pathlib import Path

from src.discover import (
    discover_weeks_from_page_headings,
    parse_week_label,
)

FIXTURE = Path(__file__).parent / "fixtures" / "doe_south_luzon_pump_prices_sept_weeks.html"
PAGE_URL = (
    "https://doe.gov.ph/data-and-prices/liquid-fuels/retail-pump-prices/"
    "south-luzon-pump-prices"
)


def test_parse_week_label_same_month() -> None:
    assert parse_week_label("September 22 to 28", 2026) == date(2026, 9, 22)


def test_parse_week_label_cross_month() -> None:
    assert parse_week_label("July 28 to August 3", 2026) == date(2026, 7, 28)


def test_south_luzon_fixture_resolves_sept_22_undated_pdfs() -> None:
    html = FIXTURE.read_text(encoding="utf-8")
    weeks = discover_weeks_from_page_headings(html, PAGE_URL, "SOUTH_LUZON")
    by_date = {week.week_start: week for week in weeks}

    assert date(2026, 9, 22) in by_date
    sept22 = by_date[date(2026, 9, 22)]
    assert sept22.source == "doe-region-page-week-heading"
    slugs = set(sept22.slugs)
    assert "region-iv-a-calabarzon" in slugs
    assert "region-iv-b-mimaropa" in slugs
    assert "region-v-bicol" in slugs
    assert all(url for url in sept22.urls)

    assert date(2026, 9, 15) in by_date
    assert any("15-21-sep-2026" in slug for slug in by_date[date(2026, 9, 15)].slugs)
