"""Derive a bulletin week-start date from a DOE CMS document slug.

DOE has renamed its weekly bulletin files many times since 2024, so a single slug
may look like any of these:

    ncr-price-monitoring-08182026-pdf
    ncr-price-monitoring-for-june-30-july-6-2026-pdf
    petro_ncr_2024-dec-3-9-pdf
    nluz_regiii_dec-31-jan-06_2025-pdf
    33-lfro-price-monitoring-august-18-24-2026-pdf
    vfo-price-monitoring-072826_with-lgu-and-field-pdf

A slug date is only ever a *hint*: the authoritative week comes from the PDF's own
header (see `parse_bulletin`). Slug dates let the pipeline group sub-region PDFs and
skip weeks that are already loaded without downloading them first, so returning
``None`` when a slug carries no date is always safe.
"""

from __future__ import annotations

import re
from datetime import date, timedelta

from .constants import BULLETIN_WEEKDAY

MONTHS: dict[str, int] = {
    "january": 1,
    "jan": 1,
    "february": 2,
    "feb": 2,
    "march": 3,
    "mar": 3,
    "april": 4,
    "apr": 4,
    "may": 5,
    "june": 6,
    "jun": 6,
    "july": 7,
    "jul": 7,
    "august": 8,
    "aug": 8,
    "september": 9,
    "sept": 9,
    "sep": 9,
    "october": 10,
    "oct": 10,
    "november": 11,
    "nov": 11,
    "december": 12,
    "dec": 12,
}

MONTH_ALTERNATION = "|".join(sorted(MONTHS, key=len, reverse=True))

MIN_YEAR = 2015
MAX_YEAR = 2100

_YEAR_FIRST_RE = re.compile(rf"(?<!\d)(20\d{{2}})-({MONTH_ALTERNATION})-(\d{{1,2}})(?!\d)")
_MONTH_FIRST_RE = re.compile(rf"(?<![a-z])({MONTH_ALTERNATION})-(\d{{1,2}})(?!\d)")
_DAY_FIRST_RE = re.compile(rf"(?<!\d)(\d{{1,2}})-\d{{1,2}}-({MONTH_ALTERNATION})-(20\d{{2}})(?!\d)")
_YMD_RE = re.compile(r"(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)")
_MDY8_RE = re.compile(r"(?<!\d)(\d{2})(\d{2})(20\d{2})(?!\d)")
_MDY_DASHED_RE = re.compile(r"(?<!\d)(\d{1,2})-(\d{1,2})-(20\d{2})(?!\d)")
_MDY6_RE = re.compile(r"monitoring-(?:.*?-)??(?<!\d)(\d{2})(\d{2})(\d{2})(?!\d)")
_YEAR_RE = re.compile(r"(?<!\d)(20\d{2})(?!\d)")


def normalize_bulletin_week_start(value: date) -> date:
    """Snap a date to the Tuesday that starts its DOE bulletin week.

    DOE weeks run Tuesday–Monday. Headers and filenames sometimes name a mid-week
    "as of" day or a Monday end date; those must still store as that week's Tuesday so
    every bulletin lands on the publication day.
    """
    offset = (value.weekday() - BULLETIN_WEEKDAY) % 7
    return value - timedelta(days=offset)


def normalize_slug(slug: str) -> str:
    """Lowercase a slug and flatten its separators, dropping trailing `-pdf` markers."""
    text = slug.strip().lower().replace("_", "-")
    text = re.sub(r"-+", "-", text).strip("-")
    while text.endswith("-pdf"):
        text = text[: -len("-pdf")]
    if text == "pdf":
        return ""
    return text


def _safe_date(year: int, month: int, day: int) -> date | None:
    if not MIN_YEAR <= year <= MAX_YEAR:
        return None
    if not 1 <= month <= 12 or not 1 <= day <= 31:
        return None
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _year_for_month_first(text: str, match: re.Match[str], month: int) -> int | None:
    """Resolve the calendar year for a `month-day` match that has its year trailing.

    Slugs describe a Tuesday–Monday range, so a December start can be followed by a
    January end date whose year is the one written in the slug
    (``dec-31-jan-06-2025`` is the week starting 31 December **2024**).
    """
    tail = text[match.end() :]
    year_match = _YEAR_RE.search(tail)
    if not year_match:
        return None

    year = int(year_match.group(1))
    between = tail[: year_match.start()]
    for other in re.finditer(rf"(?<![a-z])({MONTH_ALTERNATION})(?![a-z])", between):
        if MONTHS[other.group(1)] < month:
            return year - 1
    return year


def parse_week_start_from_slug(slug: str) -> date | None:
    """Best-effort Tuesday week-start for a DOE bulletin slug, or None when undatable."""
    text = normalize_slug(slug)
    if not text:
        return None

    # A slug names the week's *start* first, so when several date shapes match, the
    # earliest one in the string is the week start. `for-june-30-2026-july-6-2026`
    # would otherwise read its end date, because "2026-july-6" also looks year-first.
    candidates: list[tuple[int, date]] = []

    # petro_vis_2025-mar-4-10 / petro_min_2018_january_08
    match = _YEAR_FIRST_RE.search(text)
    if match:
        parsed = _safe_date(int(match.group(1)), MONTHS[match.group(2)], int(match.group(3)))
        if parsed:
            candidates.append((match.start(), parsed))

    # august-18-24-2026 / dec-31-jan-06-2025 / september-9-to-september-15-2025
    for match in _MONTH_FIRST_RE.finditer(text):
        month = MONTHS[match.group(1)]
        year = _year_for_month_first(text, match, month)
        if year is None:
            continue
        parsed = _safe_date(year, month, int(match.group(2)))
        if parsed:
            candidates.append((match.start(), parsed))
            break

    # report-for-21-27-july-2026
    match = _DAY_FIRST_RE.search(text)
    if match:
        parsed = _safe_date(int(match.group(3)), MONTHS[match.group(2)], int(match.group(1)))
        if parsed:
            candidates.append((match.start(), parsed))

    if candidates:
        return normalize_bulletin_week_start(min(candidates)[1])

    # 20260818
    match = _YMD_RE.search(text)
    if match:
        parsed = _safe_date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
        if parsed:
            return normalize_bulletin_week_start(parsed)

    # 08182026
    match = _MDY8_RE.search(text)
    if match:
        parsed = _safe_date(int(match.group(3)), int(match.group(1)), int(match.group(2)))
        if parsed:
            return normalize_bulletin_week_start(parsed)

    # 07-01-2025
    match = _MDY_DASHED_RE.search(text)
    if match:
        parsed = _safe_date(int(match.group(3)), int(match.group(1)), int(match.group(2)))
        if parsed:
            return normalize_bulletin_week_start(parsed)

    # vfo-price-monitoring-072826 (MMDDYY, only right after the monitoring marker so
    # that page-range suffixes like "-2-17" are never read as dates)
    match = _MDY6_RE.search(text)
    if match:
        parsed = _safe_date(
            2000 + int(match.group(3)), int(match.group(1)), int(match.group(2))
        )
        if parsed:
            return normalize_bulletin_week_start(parsed)

    return None
