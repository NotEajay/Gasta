"""Backfill date bounds must apply to the PARSED week, not discovery metadata.

South Luzon publishes its current series as undated numbered PDFs
(`region-iv-a-calabarzon-9-pdf`). Those always pass `_select_documents`, so their real
week is only known once the PDF header is read -- and three of them resolve to a
"2026-12-29" week, three months in the future. Without bounding the grouped weeks,
`--since 2026-08-19` loaded 2025 rows and would have loaded a future bulletin.
"""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace

from src.backfill import apply_week_bounds

TODAY = date(2026, 9, 28)
SINCE = date(2026, 8, 19)


def _week(week: date, name: str = "doc.pdf") -> dict:
    """Minimal stand-in for a ParsedBulletin: only the week and source are read."""
    return {week: [SimpleNamespace(source_path=f"/tmp/{name}", source_url=None, bulletin_date=week)]}


# ---------- A/B/C: bounds against the parsed week ----------

def test_undated_doc_parsing_before_since_is_excluded() -> None:
    kept, before, after, future = apply_week_bounds(
        _week(date(2026, 8, 11)), since=SINCE, until=None, today=TODAY
    )
    assert kept == {}
    assert before == [date(2026, 8, 11)]
    assert after == []
    assert future == []


def test_undated_doc_parsing_exactly_at_since_is_included() -> None:
    kept, before, _after, _future = apply_week_bounds(
        _week(SINCE), since=SINCE, until=None, today=TODAY
    )
    assert kept and before == []


def test_undated_doc_parsing_after_since_is_included() -> None:
    kept, before, _after, _future = apply_week_bounds(
        _week(date(2026, 9, 15)), since=SINCE, until=None, today=TODAY
    )
    assert kept and before == []


# ---------- D: future weeks ----------

def test_future_week_is_rejected_never_kept() -> None:
    kept, _before, _after, future = apply_week_bounds(
        _week(date(2026, 12, 29)), since=SINCE, until=None, today=TODAY
    )
    assert kept == {}, "a future week must never reach the loader"
    assert future == [date(2026, 12, 29)]


def test_future_is_checked_before_since_and_until() -> None:
    """A far-future week must be reported as future, not as merely out of range."""
    kept, before, after, future = apply_week_bounds(
        _week(date(2027, 6, 1)),
        since=SINCE,
        until=date(2026, 9, 22),
        today=TODAY,
    )
    assert kept == {}
    assert future == [date(2027, 6, 1)]
    assert before == [] and after == []


def test_parsed_header_date_is_authoritative_and_not_rewritten() -> None:
    """Filenames may state any date; the grouped (header) week is what is bounded.

    The value itself is never modified -- a document whose header says 2026-09-15 is
    grouped under 2026-09-15 even if discovery had guessed something else.
    """
    weeks = _week(date(2026, 9, 15), name="region-iv-a-calabarzon-9-pdf")
    kept, before, _after, _future = apply_week_bounds(
        weeks, since=SINCE, until=None, today=TODAY
    )
    assert set(kept) == {date(2026, 9, 15)}
    assert before == []


# ---------- F: grouping is preserved ----------

def test_multiple_documents_grouped_into_one_week_are_all_kept() -> None:
    week = date(2026, 9, 15)
    weeks = {
        week: [
            SimpleNamespace(source_path="/tmp/calabarzon.pdf", source_url=None),
            SimpleNamespace(source_path="/tmp/mimaropa.pdf", source_url=None),
            SimpleNamespace(source_path="/tmp/bicol.pdf", source_url=None),
        ]
    }
    kept, _before, _after, _future = apply_week_bounds(
        weeks, since=SINCE, until=None, today=TODAY
    )
    assert kept[week] == weeks[week], "sub-region PDFs must stay grouped together"


def test_mixed_good_bad_weeks_split_correctly() -> None:
    weeks = {
        **_week(date(2026, 9, 15)),
        **_week(date(2025, 4, 22)),
        **_week(date(2026, 12, 29)),
    }
    kept, before, _after, future = apply_week_bounds(
        weeks, since=SINCE, until=None, today=TODAY
    )
    assert set(kept) == {date(2026, 9, 15)}
    assert before == [date(2025, 4, 22)]
    assert future == [date(2026, 12, 29)]


# ---------- --until applies to parsed weeks too ----------

def test_until_bounds_the_parsed_week() -> None:
    kept, _before, after, _future = apply_week_bounds(
        _week(date(2026, 9, 22)), since=None, until=date(2026, 9, 15), today=TODAY
    )
    assert kept == {}
    assert after == [date(2026, 9, 22)]


def test_no_bounds_keeps_everything_past_or_equal_today() -> None:
    weeks = {
        **_week(date(2026, 9, 15)),
        **_week(date(2024, 1, 2)),
        **_week(date(2026, 12, 29)),
    }
    kept, before, after, future = apply_week_bounds(
        weeks, since=None, until=None, today=TODAY
    )
    assert set(kept) == {date(2026, 9, 15), date(2024, 1, 2)}
    assert before == [] and after == []
    assert future == [date(2026, 12, 29)]


# ---------- preselection is still a valid optimisation ----------

def test_undated_documents_still_reach_parsing() -> None:
    """The fix must not short-circuit undated docs before their header is read.

    South Luzon's current weeks are exactly these, so discarding them up front would
    make the region permanently empty.
    """
    from src.backfill import _select_documents
    from src.discover import BulletinDocument

    docs = [
        BulletinDocument("SOUTH_LUZON", "region-iv-a-calabarzon-9-pdf", None, "CALABARZON", 9),
        BulletinDocument("SOUTH_LUZON", "region-v-bicol-12-pdf", None, "BICOL", 12),
    ]
    selected = _select_documents(
        docs, since=date(2026, 8, 19), until=None, loaded_weeks=set(), force=True
    )
    assert [d.slug for d in selected] == [
        "region-iv-a-calabarzon-9-pdf",
        "region-v-bicol-12-pdf",
    ], "undated docs must be parsed, then bounded on their header week"
