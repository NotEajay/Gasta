"""The stale-bulletin guard that turns a silent pass into a loud failure (no network).

Before this guard the weekly sync could exit 0 while serving a month-old bulletin:
discovery found an old week, that week was already stored, so the result was
`skipped` and `run.py` counted no failure. These tests pin the threshold and the
cases that must and must not fail.
"""

from __future__ import annotations

from datetime import date

import pytest

from src.freshness import (
    MAX_BULLETIN_AGE_DAYS,
    bulletin_age_days,
    describe_freshness,
    is_bulletin_stale,
    most_recent_bulletin_week,
)

# "Now" for the scenarios below: Monday 2026-09-28. The most recently started DOE
# week is Tuesday 2026-09-22.
TODAY = date(2026, 9, 28)
THIS_WEEK = date(2026, 9, 22)
LAST_WEEK = date(2026, 9, 15)
TWO_WEEKS_BACK = date(2026, 9, 8)
THE_OUTAGE = date(2026, 8, 25)  # what the app was actually serving


def test_threshold_is_documented_as_fourteen_days() -> None:
    assert MAX_BULLETIN_AGE_DAYS == 14


def test_most_recent_bulletin_week_snaps_back_to_tuesday() -> None:
    assert most_recent_bulletin_week(TODAY) == THIS_WEEK
    # On the Tuesday itself it is that week, not the previous one.
    assert most_recent_bulletin_week(date(2026, 9, 22)) == date(2026, 9, 22)
    # A Sunday still belongs to the week that started on the 22nd.
    assert most_recent_bulletin_week(date(2026, 9, 27)) == THIS_WEEK


def test_age_is_measured_from_the_week_start() -> None:
    assert bulletin_age_days(THIS_WEEK, TODAY) == 6
    assert bulletin_age_days(THE_OUTAGE, TODAY) == 34


@pytest.mark.parametrize(
    "week",
    [THIS_WEEK, LAST_WEEK],
    ids=["this-week", "one-week-late-grace"],
)
def test_current_and_late_but_acceptable_weeks_are_not_stale(week: date) -> None:
    """A week is 6 days old on its Tuesday; DOE routinely publishes the next one late."""
    assert not is_bulletin_stale(week, TODAY)


@pytest.mark.parametrize(
    "week",
    [TWO_WEEKS_BACK, THE_OUTAGE],
    ids=["two-weeks-behind", "the-august-outage"],
)
def test_genuinely_old_weeks_are_stale(week: date) -> None:
    assert is_bulletin_stale(week, TODAY)


def test_a_week_late_is_exactly_within_the_threshold() -> None:
    """13 days is the documented 'published the following week' case and must pass."""
    age = bulletin_age_days(LAST_WEEK, TODAY)
    assert age == 13
    assert age <= MAX_BULLETIN_AGE_DAYS


def test_future_week_is_never_stale() -> None:
    """DOE being ahead of the local clock must not fail a run."""
    assert not is_bulletin_stale(date(2026, 10, 6), TODAY)


def test_describe_freshness_explains_both_outcomes() -> None:
    assert "current" in describe_freshness(THIS_WEEK, TODAY)
    assert "stale" in describe_freshness(THE_OUTAGE, TODAY)
    assert "34 days" in describe_freshness(THE_OUTAGE, TODAY)
    assert "no bulletin week resolved" in describe_freshness(None, TODAY)


def test_threshold_is_configurable_for_callers() -> None:
    assert is_bulletin_stale(TWO_WEEKS_BACK, TODAY, max_age_days=30) is False
    assert is_bulletin_stale(THIS_WEEK, TODAY, max_age_days=3) is True
