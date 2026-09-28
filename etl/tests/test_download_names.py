"""Local filenames for downloaded bulletins (no network access)."""

from __future__ import annotations

from src.download import MAX_SLUG_CHARS, slug_filename


def test_keeps_the_whole_slug() -> None:
    """Truncating the head mangled the name and dropped the sub-region it identifies."""
    name = slug_filename(
        "NORTH_LUZON",
        "north-luzon-liquid-fuels-price-monitoring-report-for-21-27-july-2026-pdf",
    )

    assert name == (
        "north-luzon-north-luzon-liquid-fuels-price-monitoring-report-for-21-27-"
        "july-2026.pdf"
    )


def test_keeps_the_date_the_parser_falls_back_to() -> None:
    name = slug_filename("NCR", "ncr-price-monitoring-08182026-pdf")

    assert name == "ncr-ncr-price-monitoring-08182026.pdf"


def test_distinct_long_slugs_do_not_collide() -> None:
    shared = "x" * (MAX_SLUG_CHARS + 20)
    first = slug_filename("NCR", f"{shared}-week-one-pdf")
    second = slug_filename("NCR", f"{shared}-week-two-pdf")

    assert first != second
    assert len(first) < 200
