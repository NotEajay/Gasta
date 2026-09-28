"""Upstream-unavailable regions must not fail a run, without hiding real problems.

DOE intermittently serves its "Page Not Found" body in place of a region page that is
actually up (Visayas, 2026-09-28, roughly one request in two). A scheduled run must
not turn that into a false failure, but "unavailable" must never become a blanket
catch-all that hides stale or broken regions.
"""

from __future__ import annotations

from pathlib import Path

from src.automation import SyncResult, summarise_results
from src.discover import (
    UpstreamUnavailableError,
    is_upstream_unavailable_page,
    page_title,
)

FIXTURES = Path(__file__).parent / "fixtures"
VALID_PAGE = FIXTURES / "doe_ncr_pump_prices_2026-09-28.html"
NOT_FOUND_PAGE = FIXTURES / "doe_page_not_found.html"
NO_LINKS_PAGE = FIXTURES / "doe_region_page_no_links.html"


# ---------- page classification ----------

def test_page_not_found_fixture_is_detected() -> None:
    assert is_upstream_unavailable_page(NOT_FOUND_PAGE.read_text(encoding="utf-8"))


def test_valid_region_page_is_not_flagged_unavailable() -> None:
    assert not is_upstream_unavailable_page(VALID_PAGE.read_text(encoding="utf-8"))


def test_valid_page_with_zero_links_is_not_unavailable() -> None:
    """Reachable-but-empty is a real finding, not an upstream outage.

    The source is up, so an empty archive must keep failing loudly rather than being
    quietly downgraded to a warning.
    """
    assert not is_upstream_unavailable_page(NO_LINKS_PAGE.read_text(encoding="utf-8"))


def test_embedded_404_strings_do_not_cause_false_positives() -> None:
    """A valid DOE page embeds 'Page Not Found' in its Next.js hydration payload.

    Detection is anchored to <title> for exactly this reason; a naive whole-body
    substring search would classify healthy pages as unavailable.
    """
    html = VALID_PAGE.read_text(encoding="utf-8")
    assert "Page Not Found" in html, "fixture should contain the trap string"
    assert not is_upstream_unavailable_page(html)


def test_empty_body_is_not_unavailable() -> None:
    assert not is_upstream_unavailable_page("")


def test_page_title_is_extracted() -> None:
    assert page_title(NOT_FOUND_PAGE.read_text(encoding="utf-8")).startswith("Page Not Found")
    assert page_title("<html><body>no title</body></html>") == ""


# ---------- result helpers ----------

def _current(region: str, week: str = "2026-09-22") -> SyncResult:
    return SyncResult(
        region_code=region,
        week_start=week,
        pdf_path="x.pdf",
        price_rows=100,
        companies=8,
        message="Loaded successfully.",
    )


def _stale(region: str, week: str = "2026-08-25") -> SyncResult:
    return SyncResult(
        region_code=region,
        week_start=week,
        pdf_path="",
        price_rows=0,
        companies=0,
        skipped=True,
        message=f"{region} already in Supabase - skipped. stale.",
        stale=True,
    )


def _unavailable(region: str = "VISAYAS") -> SyncResult:
    return SyncResult(
        region_code=region,
        week_start="",
        pdf_path="",
        price_rows=0,
        companies=0,
        message="Upstream unavailable: DOE served 'Page Not Found'.",
        upstream_unavailable=True,
    )


# ---------- aggregation ----------

def test_four_fresh_plus_one_unavailable_is_success() -> None:
    results = [
        _current("NCR"),
        _current("NORTH_LUZON"),
        _current("SOUTH_LUZON", "2026-09-15"),
        _current("MINDANAO"),
        _unavailable(),
    ]
    verdict = summarise_results(results)
    assert verdict == "SUCCESS WITH 1 UPSTREAM-UNAVAILABLE REGION"
    assert not verdict.startswith("FAILED")


def test_one_stale_region_among_fresh_still_fails() -> None:
    """3 fresh + 1 stale + 1 unavailable must fail: stale is never excusable."""
    results = [
        _current("NCR"),
        _current("NORTH_LUZON"),
        _current("MINDANAO"),
        _stale("SOUTH_LUZON"),
        _unavailable(),
    ]
    assert summarise_results(results) == "FAILED"


def test_all_regions_unavailable_fails() -> None:
    """No usable data source at all must not look healthy."""
    results = [
        _unavailable(r) for r in ("NCR", "NORTH_LUZON", "SOUTH_LUZON", "VISAYAS", "MINDANAO")
    ]
    verdict = summarise_results(results)
    assert verdict.startswith("FAILED")
    assert "all regions upstream unavailable" in verdict


def test_empty_result_set_fails() -> None:
    assert summarise_results([]).startswith("FAILED")


def test_all_fresh_is_plain_success() -> None:
    assert summarise_results([_current(r) for r in ("NCR", "VISAYAS", "MINDANAO")]) == "SUCCESS"


def test_error_region_fails_even_with_unavailable_others() -> None:
    broken = SyncResult(
        region_code="NCR",
        week_start="",
        pdf_path="",
        price_rows=0,
        companies=0,
        message="Failed: RuntimeError: boom",
        stale=True,
    )
    assert summarise_results([broken, _unavailable()]) == "FAILED"


def test_unavailable_never_masks_a_stale_old_bulletin() -> None:
    """A stale stored Visayas week must stay stale, not become 'unavailable'."""
    stale_visayas = _stale("VISAYAS")
    assert stale_visayas.upstream_unavailable is False
    assert stale_visayas.status == "STALE"
    assert summarise_results([_current("NCR"), stale_visayas]).startswith("FAILED")


def test_status_labels() -> None:
    assert _current("NCR").status == "CURRENT"
    assert _stale("NCR").status == "STALE"
    assert _unavailable().status == "UPSTREAM UNAVAILABLE"
    no_data = SyncResult("NCR", "", "", 0, 0, message="Loaded successfully.")
    assert no_data.status == "NO DATA"
    fuel_gap = SyncResult(
        region_code="NCR",
        week_start="2026-09-22",
        pdf_path="",
        price_rows=10,
        companies=3,
        message="Loaded successfully. Missing core fuels after parse: RON_91.",
        missing_fuels=("RON_91",),
    )
    assert fuel_gap.status == "FUEL GAP"
    assert summarise_results([_current("VISAYAS"), fuel_gap]) == "FAILED"


def test_region_becoming_available_again_needs_no_code_change() -> None:
    """Same region, same code: unavailable -> current once DOE serves the page."""
    before = summarise_results([_current("NCR"), _unavailable()])
    after = summarise_results([_current("NCR"), _current("VISAYAS", "2026-09-22")])
    assert before.startswith("SUCCESS")
    assert after == "SUCCESS"


def test_upstream_unavailable_error_is_its_own_type() -> None:
    """Must be catchable separately from generic discovery failures."""
    assert issubclass(UpstreamUnavailableError, RuntimeError)
    assert not issubclass(UpstreamUnavailableError, ValueError)

