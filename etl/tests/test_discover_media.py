"""DOE's current CloudFront media links, and legacy compatibility (no network access).

Regression cover for the outage where DOE moved bulletin hosting from
`prod-cms.doe.gov.ph/documents/d/guest/...` to a CloudFront `/api/media/file/` host.
Discovery matched only the legacy pattern, so it found zero links, fell back to the
frozen CMS slug probe, and served 2026-08-25 while every scheduled run reported
success. These tests read a captured fixture so the next hosting change fails CI
instead of silently staling the data.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from src.constants import DOE_CMS_GUEST_BASE
from src.discover import (
    GUEST_SLUG_RE,
    MEDIA_LINK_RE,
    BulletinDocument,
    discover_region_documents,
    is_bulletin_slug,
    split_media_url,
)
from src.download import slug_to_url
from src.slug_dates import parse_week_start_from_slug

FIXTURE = Path(__file__).parent / "fixtures" / "doe_ncr_pump_prices_2026-09-28.html"
PAGE_URL = "https://doe.gov.ph/data-and-prices/liquid-fuels/retail-pump-prices/ncr-pump-prices"
MEDIA_BASE = "https://d24qbtp4vooyzi.cloudfront.net/api/media/file/"

# filename -> expected week start, for every week in DOE's current NCR series
CURRENT_FILENAMES = {
    "NCR%20Price%20Monitoring%2009222026.pdf": date(2026, 9, 22),
    "NCR%20Price%20Monitoring%2015-21%20September%202026.pdf": date(2026, 9, 15),
    "NCR%20Price%20Monitoring%208-14%20Sep%202026.pdf": date(2026, 9, 8),
    "NCR%20Price%20Monitoring%20Sep%201-7%202026.pdf": date(2026, 9, 1),
    "List%20of%20NCR%20Pump%20Prices%20for%2025%20to%2031%20August%202026.pdf": date(2026, 8, 25),
}

EXPECTED_SLUGS = {
    "ncr-price-monitoring-09222026",
    "ncr-price-monitoring-15-21-september-2026",
    "ncr-price-monitoring-8-14-sep-2026",
    "ncr-price-monitoring-sep-1-7-2026",
    "list-of-ncr-pump-prices-for-25-to-31-august-2026",
}


def _fixture_html() -> str:
    return FIXTURE.read_text(encoding="utf-8")


def _media_links(html: str) -> list[tuple[str, str]]:
    """(download_url, slug) for every media link, in page order."""
    out = []
    for match in MEDIA_LINK_RE.finditer(html):
        split = split_media_url(match.group(1), PAGE_URL)
        assert split is not None
        out.append(split)
    return out


def test_fixture_exists() -> None:
    assert FIXTURE.is_file(), (
        "Discovery regression fixture is missing. If DOE changed its hosting again, "
        "re-capture the region archive page and update this file deliberately."
    )


def test_media_link_regex_finds_current_doe_links() -> None:
    assert len(_media_links(_fixture_html())) == 7


@pytest.mark.parametrize(("encoded", "expected"), CURRENT_FILENAMES.items())
def test_current_doe_filenames_resolve_to_the_right_week(encoded: str, expected: date) -> None:
    split = split_media_url(f"{MEDIA_BASE}{encoded}?prefix=dev%2Fmedia", PAGE_URL)
    assert split is not None
    assert parse_week_start_from_slug(split[1]) == expected


def test_discovery_recovers_the_sep_22_bulletin() -> None:
    """The week that was silently missing is now found and dated correctly."""
    slugs = {slug for _url, slug in _media_links(_fixture_html())}
    assert "ncr-price-monitoring-09222026" in slugs
    assert parse_week_start_from_slug("ncr-price-monitoring-09222026") == date(2026, 9, 22)


def test_download_url_preserves_query_and_encoding() -> None:
    """The real link must survive: query params and encoding are required by the CDN."""
    url = f"{MEDIA_BASE}NCR%20Price%20Monitoring%2009222026.pdf?prefix=dev%2Fmedia"
    download_url, _slug = split_media_url(url, PAGE_URL)
    assert download_url is not None
    assert download_url.startswith(MEDIA_BASE)
    assert download_url.endswith(".pdf?prefix=dev%2Fmedia")
    assert "%20" in download_url


def test_html_entities_in_href_are_unescaped() -> None:
    html = (
        '<a href="https://cdn.example/api/media/file/NCR%20Price%20Monitoring%2009222026.pdf'
        '?prefix=dev%2Fmedia&amp;x=1">x</a>'
    )
    raw = [m.group(1) for m in MEDIA_LINK_RE.finditer(html)]
    assert len(raw) == 1
    assert "&amp;" in raw[0], "the regex captures raw; split_media_url must unescape"
    split = split_media_url(raw[0], PAGE_URL)
    assert split is not None
    assert "&amp;" not in split[0]


def test_relative_media_link_is_resolved_against_the_page() -> None:
    split = split_media_url(
        "/api/media/file/NCR%20Price%20Monitoring%2009222026.pdf?prefix=dev%2Fmedia", PAGE_URL
    )
    assert split is not None
    assert split[0].startswith("https://doe.gov.ph/api/media/file/")
    assert split[1] == "ncr-price-monitoring-09222026"


def test_non_media_url_is_rejected() -> None:
    assert split_media_url(DOE_CMS_GUEST_BASE + "ncr-price-monitoring-08182026-pdf", PAGE_URL) is None


def test_media_slugs_classify_as_real_ncr_bulletins() -> None:
    for _url, slug in _media_links(_fixture_html()):
        if "logo" in slug or "liquid-petroleum" in slug:
            continue
        assert is_bulletin_slug("NCR", slug), slug


def test_non_bulletin_media_documents_are_rejected() -> None:
    slugs = {slug for _url, slug in _media_links(_fixture_html())}
    assert "doe-ph-logo" in slugs
    assert not is_bulletin_slug("NCR", "doe-ph-logo")
    assert not is_bulletin_slug("NCR", "liquid-petroleum-products-price-data-province-of-bohol")


def test_oimb_path_is_not_treated_as_a_guest_document() -> None:
    html = _fixture_html()
    assert "documents/d/oimb/petro_ncr_2023-aug-31-pdf" in html
    assert not any("oimb" in m.group(1) for m in GUEST_SLUG_RE.finditer(html))


def test_legacy_document_still_resolves_via_cms_base() -> None:
    legacy = BulletinDocument(
        region_code="NCR",
        slug="ncr-price-monitoring-08182026-pdf",
        week_start=date(2026, 8, 18),
        subregion=None,
        sequence=None,
        url=None,
    )
    assert legacy.download_url() == DOE_CMS_GUEST_BASE + "ncr-price-monitoring-08182026-pdf"


def test_end_to_end_discovery_against_fixture(monkeypatch: pytest.MonkeyPatch) -> None:
    """Full document discovery off the fixture: current weeks found, newest is Sep 22."""
    html = _fixture_html()
    monkeypatch.setattr("src.discover.read_url_text", lambda _url: html)

    documents = discover_region_documents("NCR")
    by_slug = {d.slug: d for d in documents}

    assert EXPECTED_SLUGS <= set(by_slug), sorted(EXPECTED_SLUGS - set(by_slug))

    newest = max((d for d in documents if d.week_start is not None), key=lambda d: d.week_start)
    assert newest.week_start == date(2026, 9, 22)
    assert newest.slug == "ncr-price-monitoring-09222026"
    # The real CloudFront link must be carried through, never a rebuilt CMS URL.
    assert newest.url is not None
    assert newest.url.startswith(MEDIA_BASE)
    assert newest.url.endswith(".pdf?prefix=dev%2Fmedia")
    assert newest.download_url() == newest.url
    assert "prod-cms.doe.gov.ph" not in newest.download_url()


def test_mixed_ncr_media_filename_dates_and_preserves_url(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    url = (
        f"{MEDIA_BASE}NCR%20Liquid%20Fuel%20Price%20Monitoring%2029%20Sep%20to"
        "%205%20Oct%202026.pdf?prefix=dev%2Fmedia"
    )
    html = f'<a href="{url}">September 29 to October 5</a>'
    monkeypatch.setattr("src.discover.read_url_text", lambda _url: html)
    documents = discover_region_documents("NCR")
    assert documents[0].week_start == date(2026, 9, 29)
    assert documents[0].url == url
    assert documents[0].download_url() == url
