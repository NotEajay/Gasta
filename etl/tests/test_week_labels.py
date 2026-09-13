"""Week headers as DOE actually words them inside its bulletin PDFs."""

from __future__ import annotations

from datetime import date

import pytest

from src.parse_bulletin import _parse_week_label

# Header lines copied from real bulletins across regions and years.
HEADERS = [
    ("(For the week of August 18-24, 2026)", date(2026, 8, 18)),
    ("(For the week of June 30, 2026 - July 6, 2026)", date(2026, 6, 30)),
    ("FOR THE PERIOD OF July 7-13, 2026", date(2026, 7, 7)),
    # Luzon Field Office puts the week behind a parenthetical, so the date has to be
    # read from "as of" rather than from "for the week".
    (
        "(For the week: Tuesday - Monday) as of March 11 to March 17, 2025",
        date(2025, 3, 11),
    ),
    (
        "(For the week: Tuesday - Monday) as of April 1 to April 7, 2025",
        date(2025, 4, 1),
    ),
    ("PRICE MONITORING OF LIQUID FUEL as of August 26, 2025", date(2025, 8, 26)),
]

# After normalize_bulletin_week_start, mid-week "as of" days snap to that week's Tuesday.
NORMALIZED_HEADERS = [
    ("PRICE MONITORING OF LIQUID FUEL as of August 26, 2025", date(2025, 8, 26)),  # was Tue
    ("PRICE MONITORING OF LIQUID FUEL as of August 27, 2025", date(2025, 8, 26)),  # Wed -> Tue
]


@pytest.mark.parametrize(("header", "expected"), HEADERS)
def test_reads_the_week_start_from_the_header(header: str, expected: date) -> None:
    _, week_start = _parse_week_label(header)

    assert week_start == expected


@pytest.mark.parametrize(("header", "expected"), NORMALIZED_HEADERS)
def test_stored_week_is_always_tuesday(header: str, expected: date) -> None:
    from src.slug_dates import normalize_bulletin_week_start

    _, week_start = _parse_week_label(header)
    assert week_start is not None
    assert normalize_bulletin_week_start(week_start) == expected
    assert expected.weekday() == 1


def test_reports_no_week_when_the_header_states_none() -> None:
    _, week_start = _parse_week_label("PRICE MONITORING OF LIQUID FUEL\nNCR")

    assert week_start is None