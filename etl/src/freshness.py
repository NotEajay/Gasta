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

from .slug_dates import normalize_bulletin_week_start

# DOE bulletin weeks run Tuesday–Monday. The PDF for that week is typically posted
# on the *following* Tuesday (the day the next week starts). Age and stale checks
# use that estimated post date so the app shows "1 day old" on Wednesday after a
# Tuesday upload, not "8 days old" measured from the week-start Tuesday.
DOE_POST_OFFSET_DAYS = 7

# How old the newest bulletin may be (days since estimated DOE post) before a run
# is considered stale.
#
# Measured from post date: 7 days ≡ the old 14-day threshold measured from week
# start (post = week_start + 7). That still tolerates DOE posting a week late
# while catching a real multi-week outage (the 2026-08-25 case).
MAX_BULLETIN_AGE_DAYS = 7


def most_recent_bulletin_week(today: date) -> date:
    """The Tuesday of the most recently started DOE bulletin week."""
    return normalize_bulletin_week_start(today)


def estimated_doe_posted_date(week_start: date) -> date:
    """When DOE typically posts the PDF for a Tuesday–Monday bulletin week."""
    return week_start + timedelta(days=DOE_POST_OFFSET_DAYS)


def bulletin_age_days(week_start: date, today: date) -> int:
    """Calendar days since the estimated DOE post date (may be negative before post day)."""
    return (today - estimated_doe_posted_date(week_start)).days


def is_bulletin_stale(week_start: date, today: date, *, max_age_days: int = MAX_BULLETIN_AGE_DAYS) -> bool:
    """True when `week_start` is too old for the app to be considered current.

    A week whose estimated post date is still in the future is never stale (we are
    still inside that bulletin week, or DOE is ahead of the local clock).
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
    posted = estimated_doe_posted_date(week_start)
    age = bulletin_age_days(week_start, today)
    if is_bulletin_stale(week_start, today, max_age_days=max_age_days):
        return (
            f"stale: newest bulletin {week_start.isoformat()} "
            f"(DOE post ~{posted.isoformat()}) is {age} days old "
            f"(threshold {max_age_days} days since post; "
            f"week starting {expected.isoformat()} was expected)"
        )
    return (
        f"current: newest bulletin {week_start.isoformat()} "
        f"(DOE post ~{posted.isoformat()}) is {age} days since post "
        f"(threshold {max_age_days} days)"
    )
