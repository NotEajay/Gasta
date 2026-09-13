"""Slug classification for DOE region archive pages (no network access)."""

from __future__ import annotations

import pytest

from datetime import date

from src.discover import (
    _sequence_anchor,
    _undated_rank,
    cms_probe_slugs,
    discover_cms_weeks,
    group_documents_by_week,
    is_bulletin_slug,
    leading_sequence_for_slug,
    sequence_for_slug,
    subregion_for_slug,
)
from src.discover import BulletinDocument
from src.slug_dates import parse_week_start_from_slug

BULLETIN_SLUGS = [
    ("NCR", "ncr-price-monitoring-08182026-pdf"),
    ("NCR", "petro_ncr_2024-dec-3-9-pdf"),
    ("NORTH_LUZON", "lf-price-monitoring-for-july-7-13-2026-pdf"),
    ("NORTH_LUZON", "nluz_car_apr-1-7_2025-pdf"),
    ("NORTH_LUZON", "april-21-27-2026-pdf"),
    ("SOUTH_LUZON", "region-iv-a-calabarzon-20-pdf"),
    ("SOUTH_LUZON", "petro_sluz_2025-mar-18-24_cavite-pdf"),
    ("VISAYAS", "vfo-price-monitoring-081826_with-lgu-and-field-pdf"),
    ("VISAYAS", "petro_vis_2025-mar-4-10-pdf"),
    ("MINDANAO", "33-lfro-price-monitoring-august-18-24-2026-pdf"),
    ("MINDANAO", "petro_min_2025_apr-1-4-pdf"),
]

NON_BULLETIN_SLUGS = [
    ("VISAYAS", "liquid-petroleum-products-price-data-pdf"),
    (
        "VISAYAS",
        "liquid-petroleum-products-price-data-province-of-bohol-10272025-pdf",
    ),
    ("NCR", "doe-ph-logo-pdf"),
    ("NCR", "bagong_ph-pdf"),
    ("NCR", "vfo-price-monitoring-081826_with-lgu-and-field-pdf"),
]


@pytest.mark.parametrize(("region_code", "slug"), BULLETIN_SLUGS)
def test_accepts_region_bulletin_slugs(region_code: str, slug: str) -> None:
    assert is_bulletin_slug(region_code, slug)


@pytest.mark.parametrize(("region_code", "slug"), NON_BULLETIN_SLUGS)
def test_rejects_non_bulletin_slugs(region_code: str, slug: str) -> None:
    assert not is_bulletin_slug(region_code, slug)


@pytest.mark.parametrize(
    ("slug", "expected"),
    [
        ("price-monitoring-for-lf-as-of-august-26-2025-car-pdf", "CAR"),
        ("nluz_car_apr-1-7_2025-pdf", "CAR"),
        ("price-monitoring-for-lf-as-of-july-29-2025-region-i-pdf", "REGION_I"),
        ("price-monitoring-for-lf-as-of-august-12-2025-reg-ii-pdf", "REGION_II"),
        ("price-monitoring-for-lf-as-of-august-19-2025-reg-iii-pdf", "REGION_III"),
        ("lf-price-monitoring-for-july-7-13-2026-pdf", None),
    ],
)
def test_north_luzon_subregions(slug: str, expected: str | None) -> None:
    assert subregion_for_slug("NORTH_LUZON", slug) == expected


@pytest.mark.parametrize(
    ("slug", "expected"),
    [
        ("region-iv-a-calabarzon-20-pdf", "CALABARZON"),
        ("petro_sluz_2025-mar-18-24_cavite-pdf", "CALABARZON"),
        ("region-iv-b-mimaropa-22-pdf", "MIMAROPA"),
        ("region-v-bicol-33-pdf", "BICOL"),
    ],
)
def test_south_luzon_subregions(slug: str, expected: str) -> None:
    assert subregion_for_slug("SOUTH_LUZON", slug) == expected


@pytest.mark.parametrize(
    ("slug", "expected"),
    [
        ("region-v-bicol-33-pdf", 33),
        ("region-iv-a-calabarzon-1-pdf", 1),
        ("region-v-bicol-pdf", None),
        # A day-of-month is not a sequence counter. Reading these as 30 and 28 ranked
        # last year's bulletins above the numbered files DOE publishes now.
        ("region-iv-a-calabarzon-as-of-june-24-to-30-pdf", None),
        ("region-iv-b-mimaropa-july-22-to-28-pdf", None),
        ("region-v-bicol-as-of-july-15-21-pdf", None),
    ],
)
def test_sequence_numbers(slug: str, expected: int | None) -> None:
    assert sequence_for_slug(slug) == expected


def test_undated_rank_puts_numbered_series_first() -> None:
    """DOE's numbered uploads are the current series; year-less names are older."""
    slugs = [
        "region-v-bicol-35-pdf",
        "region-v-bicol-as-of-june-24-to-30-pdf",
        "region-v-bicol-37-pdf",
        "region-v-bicol-july-22-to-28-pdf",
    ]
    documents = [
        BulletinDocument(
            region_code="SOUTH_LUZON",
            slug=slug,
            week_start=None,
            subregion="BICOL",
            sequence=sequence_for_slug(slug),
            page_index=index,
        )
        for index, slug in enumerate(slugs)
    ]

    ordered = [d.slug for d in sorted(documents, key=_undated_rank)]

    assert ordered[:2] == ["region-v-bicol-37-pdf", "region-v-bicol-35-pdf"]


def test_group_documents_by_week_separates_undated_files() -> None:
    slugs = [
        "region-iv-a-calabarzon-august-26-to-september-1-2025-pdf",
        "region-iv-b-mimaropa-august-26-to-september-1-2025-pdf",
        "region-v-bicol-august-26-to-september-1-2025-pdf",
        "region-iv-a-calabarzon-20-pdf",
    ]
    documents = [
        BulletinDocument(
            region_code="SOUTH_LUZON",
            slug=slug,
            week_start=parse_week_start_from_slug(slug),
            subregion=subregion_for_slug("SOUTH_LUZON", slug),
            sequence=sequence_for_slug(slug),
        )
        for slug in slugs
    ]

    weeks, undated = group_documents_by_week(documents)

    assert len(weeks) == 1
    assert len(weeks[0].slugs) == 3
    assert weeks[0].week_start.isoformat() == "2025-08-26"
    assert [d.slug for d in undated] == ["region-iv-a-calabarzon-20-pdf"]


def test_cms_probe_slugs_include_september_week_variants() -> None:
    week = date(2026, 9, 1)
    ncr = cms_probe_slugs("NCR", week)
    assert "ncr-price-monitoring-09012026-pdf" in ncr
    assert "ncr-price-monitoring-for-september-1-7-2026-pdf" in ncr

    visayas = cms_probe_slugs("VISAYAS", week)
    assert "vfo-price-monitoring-090126_with-lgu-and-field-pdf" in visayas

    north = cms_probe_slugs("NORTH_LUZON", week)
    assert "lf-price-monitoring-for-september-1-7-2026-pdf" in north
