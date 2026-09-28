"""How current is a bulletin week, and is a sync allowed to call itself fresh?

The weekly sync used to be able to end "successfully" while serving a month-old
bulletin: discovery found an old week, that week was already in Supabase, so the
result was marked `skipped`, `run.py` saw no failure, and the run went green while
`doe_etl_state` was bumped to "just fetched DOE".

This module turns freshness into an explicit, testable predicate so a stale
discovery fails loudly instead of passing quietly. It is pure date arithmetic and
takes an explicit `today`, so it is deterministic and needs no clock or network.
"""

from __future__ import annotations

from datetime import date, timedelta

from .constants import BULLETIN_WEEKDAY
from .slug_dates import normalize_bulletin_week_start

# How old the newest bulletin may be before a run is considered stale.
#
# DOE weeks run Tuesday-Monday, so the most recently started week is at most 6 days
# old on the Tuesday itself. The weekly workflow's own comment records that "DOE
# regularly uploads a week's bulletin several days late (sometimes not until the
# following week)", i.e. a legitimately one-week-late DOE is 13 days old. 14 days
# therefore tolerates that full week of publication delay while still catching a
# real outage, which is the case this guard exists for: 2026-08-25 was 34 days old.
#
# A 10-day threshold was considered and rejected: it would fail the run on exactly
# the normal, expected one-week-late publication it is supposed to tolerate.
MAX_BULLETIN_AGE_DAYS = 14


def most_recent_bulletin_week(today: date) -> date:
    """The Tuesday of the most recently started DOE bulletin week."""
    return normalize_bulletin_week_start(today)


def bulletin_age_days(week_start: date, today: date) -> int:
    return (today - week_start).days


def is_bulletin_stale(week_start: date, today: date, *, max_age_days: int = MAX_BULLETIN_AGE_DAYS) -> bool:
    """True when `week_start` is too old for the app to be considered current.

    A week in the future is never stale (it means DOE is simply ahead of the local
    clock); only age is considered.
    """
    return bulletin_age_days(week_start, today) > max_age_days


def describe_freshness(
    week_start: date | None, today: date, *, max_age_days: int = MAX_BULLETIN_AGE_DAYS
) -> str:
    """Human-readable freshness sentence used in ETL output and failure messages."""
    expected = most_recent_bulletin_week(today)
    if week_start is None:
        return (
            f"no bulletin week resolved; the week starting {expected.isoformat()} was expected"
        )
    age = bulletin_age_days(week_start, today)
    if is_bulletin_stale(week_start, today, max_age_days=max_age_days):
        return (
            f"stale: newest bulletin {week_start.isoformat()} is {age} days old "
            f"(threshold {max_age_days} days; week starting {expected.isoformat()} was expected)"
        )
    return (
        f"current: newest bulletin {week_start.isoformat()} is {age} days old "
        f"(threshold {max_age_days} days)"
    )
