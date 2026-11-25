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


def test_current_attributed_lists_keep_all_three_subregions_and_archive_years() -> None:
    html = '''<strong>2026</strong><ul><li value="4">November 17 to 23 </li>
      <li class="nestedListItem" style="list-style-type:none" value="5"><ul class="files">
      <li><a href="https://cdn.test/api/media/file/Region%20IV-A%20CALABARZON%2011-23-26.pdf?prefix=dev%2Fmedia">Calabarzon</a></li>
      <li><a href="https://cdn.test/api/media/file/Region%20IV-B%20MIMAROPA%2011-23-26.pdf?prefix=dev%2Fmedia">Mimaropa</a></li>
      <li><a href="https://cdn.test/api/media/file/Region%20V%20BICOL%2011-23-26.pdf?prefix=dev%2Fmedia">Bicol</a></li>
      </ul></li></ul><strong>2025</strong>''' + (' ' * 5000) + '''
      <li value="1">November 25 to December 1</li><li class="nestedListItem"><ul>
      <li><a href="https://prod-cms.doe.gov.ph/documents/d/guest/region-v-bicol-1-pdf">Bicol</a></li>
      </ul></li>'''
    weeks = discover_weeks_from_page_headings(html, PAGE_URL, "SOUTH_LUZON", today=date(2026, 11, 25))
    assert weeks[0].week_start == date(2026, 11, 17)
    assert len(weeks[0].urls) == 3
    assert all(weeks[0].urls)
    assert weeks[1].week_start == date(2025, 11, 25)
