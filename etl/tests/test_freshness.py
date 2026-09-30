"""Freshness is measured from the estimated DOE post date (week start + 7)."""

from __future__ import annotations

from datetime import date

import pytest

from src.freshness import (
    DOE_POST_OFFSET_DAYS,
    MAX_BULLETIN_AGE_DAYS,
    bulletin_age_days,
    describe_freshness,
    estimated_doe_posted_date,
    is_bulletin_stale,
    most_recent_bulletin_week,
)

# Wednesday 2026-09-30: Sep 22 week was typically posted Tuesday 2026-09-29.
TODAY = date(2026, 9, 30)
THIS_WEEK = date(2026, 9, 22)
LAST_WEEK = date(2026, 9, 15)
TWO_WEEKS_BACK = date(2026, 9, 8)
THE_OUTAGE = date(2026, 8, 25)


def test_threshold_is_seven_days_since_post() -> None:
    assert DOE_POST_OFFSET_DAYS == 7
    assert MAX_BULLETIN_AGE_DAYS == 7


def test_post_date_is_the_following_tuesday() -> None:
    assert estimated_doe_posted_date(THIS_WEEK) == date(2026, 9, 29)


def test_most_recent_bulletin_week_snaps_back_to_tuesday() -> None:
    assert most_recent_bulletin_week(TODAY) == date(2026, 9, 29)
    assert most_recent_bulletin_week(date(2026, 9, 22)) == date(2026, 9, 22)
    assert most_recent_bulletin_week(date(2026, 9, 27)) == THIS_WEEK


def test_age_is_measured_from_estimated_post_date() -> None:
    # Posted Sep 29 → 1 day old on Sep 30 (not 8 from week start).
    assert bulletin_age_days(THIS_WEEK, TODAY) == 1
    assert bulletin_age_days(THE_OUTAGE, TODAY) == (TODAY - date(2026, 9, 1)).days


@pytest.mark.parametrize(
    "week,today",
    [
        (THIS_WEEK, TODAY),
        (LAST_WEEK, date(2026, 9, 29)),
    ],
    ids=["posted-yesterday", "one-week-late-grace-on-day-7"],
)
def test_current_and_late_but_acceptable_weeks_are_not_stale(week: date, today: date) -> None:
    assert not is_bulletin_stale(week, today)


def test_one_week_late_turns_stale_on_day_eight() -> None:
    assert is_bulletin_stale(LAST_WEEK, TODAY)


@pytest.mark.parametrize(
    "week",
    [TWO_WEEKS_BACK, THE_OUTAGE],
    ids=["two-weeks-behind", "the-august-outage"],
)
def test_genuinely_old_weeks_are_stale(week: date) -> None:
    assert is_bulletin_stale(week, TODAY)


def test_a_week_late_is_exactly_within_the_threshold() -> None:
    """Post for Sep 15 is Sep 22; on Sep 29 that is 7 days — still current."""
    age = bulletin_age_days(LAST_WEEK, date(2026, 9, 29))
    assert age == 7
    assert age <= MAX_BULLETIN_AGE_DAYS
    assert not is_bulletin_stale(LAST_WEEK, date(2026, 9, 29))


def test_before_post_day_is_not_stale() -> None:
    """Still inside the Tue–Mon week, before the following Tuesday upload."""
    assert bulletin_age_days(THIS_WEEK, date(2026, 9, 28)) == -1
    assert not is_bulletin_stale(THIS_WEEK, date(2026, 9, 28))


def test_future_week_is_never_stale() -> None:
    assert not is_bulletin_stale(date(2026, 10, 6), TODAY)


def test_describe_freshness_explains_both_outcomes() -> None:
    assert "current" in describe_freshness(THIS_WEEK, TODAY)
    assert "stale" in describe_freshness(THE_OUTAGE, TODAY)
    assert "DOE post" in describe_freshness(THIS_WEEK, TODAY)
    assert "no bulletin week resolved" in describe_freshness(None, TODAY)


def test_threshold_is_configurable_for_callers() -> None:
    assert is_bulletin_stale(TWO_WEEKS_BACK, TODAY, max_age_days=30) is False
    assert is_bulletin_stale(THIS_WEEK, TODAY, max_age_days=0) is True
