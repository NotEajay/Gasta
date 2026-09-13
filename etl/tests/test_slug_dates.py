"""Slug date parsing, pinned against real DOE filenames.

Every slug below was taken from a live DOE retail pump price archive page. DOE renames
these files often, so this corpus is the regression net that keeps a rename from
silently dropping weeks out of the price history.
"""

from __future__ import annotations

from datetime import date

import pytest

from src.slug_dates import normalize_slug, parse_week_start_from_slug

# (slug, expected week start)
DATED_SLUGS: list[tuple[str, date]] = [
    # --- NCR -------------------------------------------------------------------
    ("ncr-price-monitoring-08182026-pdf", date(2026, 8, 18)),
    ("ncr-price-monitoring-07282026-pdf", date(2026, 7, 28)),
    ("ncr-price-monitoring-03102026n-pdf", date(2026, 3, 10)),
    ("ncr-price-monitoring-02102026-1-pdf", date(2026, 2, 10)),
    ("ncr-price-monitoring-for-june-30-july-6-2026-pdf", date(2026, 6, 30)),
    ("ncr-price-monitoring-for-june-2-8-2026-pdf", date(2026, 6, 2)),
    ("ncr-price-monitoring-07-01-2025-pdf", date(2025, 7, 1)),
    ("ncr-price-monitoring-12302025-pdf", date(2025, 12, 30)),
    ("petro_ncr_2025_apr-1-7-pdf", date(2025, 4, 1)),
    ("petro_ncr_2024-dec-3-9-pdf", date(2024, 12, 3)),
    ("petro_ncr_2025-jan-7-jan-13-pdf", date(2025, 1, 7)),
    ("petro_ncr_2025_feb-25-mar-3-pdf", date(2025, 2, 25)),
    ("petro_ncr_2025_jan-28-feb-3-pdf", date(2025, 1, 28)),
    ("petro_ncr_2024-dec-24-30-pdf", date(2024, 12, 24)),
    # --- North Luzon -----------------------------------------------------------
    ("lf-price-monitoring-for-june-30-2026-july-6-2026-pdf", date(2026, 6, 30)),
    ("lf-price-monitoring-for-july-7-13-2026-pdf", date(2026, 7, 7)),
    ("north-luzon-pump-prices-as-of-july-14-20-2026-pdf", date(2026, 7, 14)),
    (
        "north-luzon-liquid-fuels-price-monitoring-report-for-21-27-july-2026-pdf",
        date(2026, 7, 21),
    ),
    ("north-luzon-lf-price-monitoring-report-august-12-2026-pdf", date(2026, 8, 11)),
    ("lf-price-monitoring-for-may-26-june-1-2026-pdf", date(2026, 5, 26)),
    ("lf-price-monitoring-for-april-28-may-4-2026-pages-pdf", date(2026, 4, 28)),
    ("lf-price-monitoring-for-march-31-2026-to-april-6-2026-pages-pdf", date(2026, 3, 31)),
    ("april-21-27-2026-pdf", date(2026, 4, 21)),
    ("lf-price-monitoring-as-of-february-24-to-march-2-2026-pages-pdf", date(2026, 2, 24)),
    ("lf-price-monitoring-as-of-march-3-9-2026-pages-pdf", date(2026, 3, 3)),
    ("price-monitoring-for-lf-as-of-january-27-february-2-2026-pdf", date(2026, 1, 27)),
    ("lf-price-monitoring-as-of-february-3-2026-pdf", date(2026, 2, 3)),
    ("price-monitoring-for-lf-as-of-december-30-2025-pages-pdf", date(2025, 12, 30)),
    ("price-monitoring-lf-december-2-2025-2-16-pdf", date(2025, 12, 2)),
    ("price-monitoring-november-4-2025-10-16-pdf", date(2025, 11, 4)),
    ("price-monitoring-as-of-nov-11-2025-pages-pdf", date(2025, 11, 11)),
    ("lf-price-monitoring-as-of-november-25-2025-2-1-17-2-17-pdf", date(2025, 11, 25)),
    ("price-monitoring-for-lf-as-of-august-26-2025-car-pdf", date(2025, 8, 26)),
    (
        "price-monitoring-for-lf-as-of-september-9-to-september-15-2025-reg-ii-pdf",
        date(2025, 9, 9),
    ),
    ("price-monitoring-for-lf-as-of-july-8-to-july-14-2025-region-1-pdf", date(2025, 7, 8)),
    ("lf-price-monitoring-july-15-21-2025-pdf", date(2025, 7, 15)),
    ("price-monitoring-for-lf-may-13-to-may-19-2025-regii-pdf", date(2025, 5, 13)),
    ("nluz_car_apr-1-7_2025-pdf", date(2025, 4, 1)),
    ("nluz_feb-18-24_2025-pdf", date(2025, 2, 18)),
    ("nluz_regiii_jan-21-27_2025-pdf-pdf", date(2025, 1, 21)),
    ("nluz_car_dec-3-9_2024-pdf", date(2024, 12, 3)),
    # A Tuesday-to-Monday week that crosses new year: the "2025" in the name is the
    # year the week *ends*, so the week starts on 31 December 2024.
    ("nluz_regiii_dec-31-jan-06_2025-pdf", date(2024, 12, 31)),
    # --- South Luzon -----------------------------------------------------------
    ("region-iv-a-calabarzon-august-26-to-september-1-2025-pdf", date(2025, 8, 26)),
    ("petro_sluz_2025-mar-18-24_cavite-pdf", date(2025, 3, 18)),
    ("petro_sluz_2024-dec-31-jan-6_batangas-rizal-quezon-pdf", date(2024, 12, 31)),
    ("petro_sluz_2025-feb-11-17_mimaropa-pdf", date(2025, 2, 11)),
    # --- Visayas ---------------------------------------------------------------
    ("vfo-price-monitoring-072826_with-lgu-and-field-pdf", date(2026, 7, 28)),
    ("vfo-price-monitoring-081826_with-lgu-and-field-pdf", date(2026, 8, 18)),
    ("vfo-price-monitoring-063026_with-lgu-and-field-pdf", date(2026, 6, 30)),
    ("vfo-lf-price-monitoring-123025-pdf", date(2025, 12, 30)),
    ("vfo-lf-price-monitoring-090225-pdf", date(2025, 9, 2)),
    ("vfo-lf-price-monitoring-012726-1-pdf", date(2026, 1, 27)),
    ("visayas-lf-price-monitoring-for-june-2-8-2026-pdf", date(2026, 6, 2)),
    ("petro_vis_2025-mar-4-10-pdf", date(2025, 3, 4)),
    ("petro_vis_2024-dec-31-jan-6-pdf", date(2024, 12, 31)),
    # --- Mindanao --------------------------------------------------------------
    ("30-lfro-price-monitoring-july-28-2026-pdf", date(2026, 7, 28)),
    ("33-lfro-price-monitoring-august-18-24-2026-pdf", date(2026, 8, 18)),
    ("14-lfro-price-monitoring-april-07-2026-pdf", date(2026, 4, 7)),
    (
        "02-lfro-price-monitoring-january-13-2026-trial-new-template-pdf",
        date(2026, 1, 13),
    ),
    ("25-b-lfro-price-monitoring-june-26-2025-pdf", date(2025, 6, 24)),
    ("52-lfro-price-monitoring-december-30-2025-pdf", date(2025, 12, 30)),
    ("petro_min_2025_apr-1-4-pdf", date(2025, 4, 1)),
    ("petro_min_2024-dec-10-13-pdf", date(2024, 12, 10)),
    ("petro_min_2023-jan-02_0-pdf", date(2022, 12, 27)),
    ("petro_min_2018_january_08-pdf", date(2018, 1, 2)),
]

# DOE numbers these instead of dating them; only the PDF header states the week.
UNDATABLE_SLUGS = [
    "region-iv-a-calabarzon-20-pdf",
    "region-iv-b-mimaropa-22-pdf",
    "region-v-bicol-33-pdf",
    "region-iv-a-calabarzon-pdf",
    "region-v-bicol-pdf",
    "lf-price-monitoring-pdf",
    "nluz_car_mar-11-17-pdf",
    "liquid-petroleum-products-price-data-pdf",
]


@pytest.mark.parametrize(("slug", "expected"), DATED_SLUGS, ids=[s for s, _ in DATED_SLUGS])
def test_parses_real_doe_slug_dates(slug: str, expected: date) -> None:
    assert parse_week_start_from_slug(slug) == expected


@pytest.mark.parametrize("slug", UNDATABLE_SLUGS)
def test_undatable_slugs_return_none(slug: str) -> None:
    assert parse_week_start_from_slug(slug) is None


def test_page_range_suffixes_are_not_read_as_dates() -> None:
    """`-2-17` is a page range in the DOE filename, not a February date."""
    assert parse_week_start_from_slug("price-monitoring-as-of-january-6-2026-2-17-pdf") == date(
        2026, 1, 6
    )


def test_normalize_slug_strips_repeated_pdf_suffixes() -> None:
    assert normalize_slug("nluz_regiii_jan-21-27_2025-pdf-pdf") == "nluz-regiii-jan-21-27-2025"


def test_every_dated_slug_lands_on_a_tuesday() -> None:
    """DOE weeks run Tuesday–Monday; every stored week start must be a Tuesday."""
    for slug, _expected in DATED_SLUGS:
        parsed = parse_week_start_from_slug(slug)
        assert parsed is not None, slug
        assert parsed.weekday() == 1, f"{slug} -> {parsed} ({parsed.strftime('%A')})"


@pytest.mark.parametrize(
    ("raw", "tuesday"),
    [
        (date(2026, 9, 1), date(2026, 9, 1)),  # already Tuesday
        (date(2026, 9, 2), date(2026, 9, 1)),  # Wednesday "as of" -> prior Tuesday
        (date(2026, 9, 7), date(2026, 9, 1)),  # Monday end of week -> that week's Tuesday
        (date(2026, 9, 8), date(2026, 9, 8)),  # next Tuesday
    ],
)
def test_normalize_bulletin_week_start(raw: date, tuesday: date) -> None:
    from src.slug_dates import normalize_bulletin_week_start

    assert normalize_bulletin_week_start(raw) == tuesday
