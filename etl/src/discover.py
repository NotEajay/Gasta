"""Discover DOE bulletin PDFs published on doe.gov.ph.

Each macro-region has a retail pump prices archive page that server-renders a link to
every bulletin PDF DOE has published for that region. Fetching that page with a plain
HTTP request yields the whole archive, so discovery needs no headless browser.

NCR additionally exposes a predictable CMS slug (`ncr-price-monitoring-MMDDYYYY-pdf`),
which is probed directly because the archive page can lag a week or two behind the
files that are already live on the CMS.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

from .constants import (
    DOE_REGION_PAGE_URL,
    REGION_CODES,
    REGION_PAGE_SLUGS,
    REGION_SLUG_PATTERNS,
    REGION_SUBREGION_MARKERS,
    SLUG_REJECT_PATTERNS,
)
from .download import download_pdf, ncr_pdf_url, pdf_exists, read_url_text, slug_to_url
from .parse_bulletin import read_bulletin_week
from .slug_dates import MONTH_ALTERNATION, normalize_slug, parse_week_start_from_slug

GUEST_SLUG_RE = re.compile(r"documents/d/guest/([a-z0-9][a-z0-9\-_]*pdf)", re.I)
TRAILING_SEQUENCE_RE = re.compile(r"-(\d{1,3})$")
MONTH_IN_SLUG_RE = re.compile(rf"(?<![a-z])({MONTH_ALTERNATION})(?![a-z])")

# How many undated candidates per sub-region to open when looking for the latest week.
UNDATED_PROBE_LIMIT = 6


@dataclass(frozen=True)
class BulletinDocument:
    """One PDF on a DOE region archive page."""

    region_code: str
    slug: str
    week_start: date | None
    subregion: str | None
    sequence: int | None
    # Position on the DOE archive page, which lists the current series first.
    page_index: int = 0


@dataclass(frozen=True)
class DiscoveredBulletin:
    """One bulletin week for a macro-region, possibly spanning several sub-region PDFs."""

    region_code: str
    week_start: date
    slugs: tuple[str, ...]
    source: str = "doe-region-page"


def resolve_region_code(region_key: str) -> str:
    normalized = region_key.strip().lower().replace("-", "_")
    try:
        return REGION_CODES[normalized]
    except KeyError:
        raise ValueError(f"Unknown region: {region_key}") from None


def region_page_url(region_code: str) -> str:
    page_slug = REGION_PAGE_SLUGS[region_code]
    return DOE_REGION_PAGE_URL.format(page_slug=page_slug)


def fetch_region_page_slugs(region_code: str) -> list[str]:
    """Every guest-document slug linked from a region's archive page, in page order."""
    html = read_url_text(region_page_url(region_code))
    slugs: list[str] = []
    seen: set[str] = set()
    for match in GUEST_SLUG_RE.finditer(html):
        slug = match.group(1).lower()
        if slug not in seen:
            seen.add(slug)
            slugs.append(slug)
    return slugs


def is_bulletin_slug(region_code: str, slug: str) -> bool:
    """True when a slug looks like the region's weekly price-monitoring bulletin."""
    text = normalize_slug(slug)
    if not text:
        return False
    if any(re.search(pattern, text) for pattern in SLUG_REJECT_PATTERNS):
        return False
    return any(re.search(pattern, text) for pattern in REGION_SLUG_PATTERNS[region_code])


def subregion_for_slug(region_code: str, slug: str) -> str | None:
    """Sub-region a PDF covers, for regions DOE used to publish as separate files."""
    markers = REGION_SUBREGION_MARKERS.get(region_code)
    if not markers:
        return None
    text = normalize_slug(slug)
    for name, patterns in markers.items():
        if any(re.search(pattern, text) for pattern in patterns):
            return name
    return None


def sequence_for_slug(slug: str) -> int | None:
    """Trailing counter DOE uses for undated files (`region-v-bicol-33-pdf` → 33).

    Slugs that name a month end in a day instead of a counter
    (`region-iv-a-calabarzon-as-of-june-24-to-30`), and reading that 30 as a sequence
    would rank a June file above every later week.
    """
    text = normalize_slug(slug)
    if MONTH_IN_SLUG_RE.search(text):
        return None
    match = TRAILING_SEQUENCE_RE.search(text)
    return int(match.group(1)) if match else None


def discover_region_documents(region_code: str) -> list[BulletinDocument]:
    """All bulletin PDFs DOE currently publishes for a macro-region."""
    documents: list[BulletinDocument] = []
    for slug in fetch_region_page_slugs(region_code):
        if not is_bulletin_slug(region_code, slug):
            continue
        documents.append(
            BulletinDocument(
                region_code=region_code,
                slug=slug,
                week_start=parse_week_start_from_slug(slug),
                subregion=subregion_for_slug(region_code, slug),
                sequence=sequence_for_slug(slug),
                page_index=len(documents),
            )
        )
    return documents


def group_documents_by_week(
    documents: list[BulletinDocument],
) -> tuple[list[DiscoveredBulletin], list[BulletinDocument]]:
    """Split documents into datable weeks (newest first) and undatable leftovers.

    Undatable documents are not guesswork material: DOE numbers some files
    sequentially instead of dating them, and only the PDF header states their week.
    """
    weeks: dict[date, list[str]] = {}
    undated: list[BulletinDocument] = []

    for document in documents:
        if document.week_start is None:
            undated.append(document)
            continue
        weeks.setdefault(document.week_start, []).append(document.slug)

    region_code = documents[0].region_code if documents else ""
    bulletins = [
        DiscoveredBulletin(
            region_code=region_code,
            week_start=week_start,
            slugs=tuple(slugs),
        )
        for week_start, slugs in sorted(weeks.items(), reverse=True)
    ]
    return bulletins, undated


def discover_ncr_week_by_probe(week_start: date) -> bool:
    return pdf_exists(ncr_pdf_url(week_start))


def discover_latest_ncr_week(*, lookback_days: int = 28) -> date:
    """Most recent NCR bulletin Tuesday, probing the predictable CMS slug."""
    today = date.today()
    # Walk back Tuesday by Tuesday; DOE weeks start on Tuesday.
    days_since_tuesday = (today.weekday() - 1) % 7
    candidate = today - timedelta(days=days_since_tuesday)
    for _ in range((lookback_days // 7) + 2):
        if discover_ncr_week_by_probe(candidate):
            return candidate
        candidate -= timedelta(days=7)
    raise RuntimeError(
        f"No NCR DOE bulletin found in the last {lookback_days} days. "
        "Check DOE site availability or the CMS slug pattern."
    )


def discover_region_bulletins(region_key: str) -> list[DiscoveredBulletin]:
    """Datable bulletin weeks for a region, newest first."""
    region_code = resolve_region_code(region_key)
    bulletins, _ = group_documents_by_week(discover_region_documents(region_code))
    return bulletins


def discover_latest_weeks(
    region_key: str,
    *,
    limit: int = 4,
    probe_dir: str | Path = "data/bulletins",
) -> list[DiscoveredBulletin]:
    """Candidate bulletin weeks for a macro-region, newest first.

    More than one candidate is returned because the newest week is not always usable:
    DOE sometimes publishes a week as page scans, which carry no prices to read. The
    caller walks the list until a week parses.

    For NCR the predictable CMS slug is probed as well, because the archive page is
    often a week or two behind the files already published on the CMS. Regions whose
    newest filenames carry no date need their PDFs opened to find their week, which
    is what `probe_dir` caches.
    """
    region_code = resolve_region_code(region_key)
    documents = discover_region_documents(region_code)
    bulletins, undated = group_documents_by_week(documents)

    candidates: list[DiscoveredBulletin] = []

    if region_code == "NCR":
        probed = discover_latest_ncr_week()
        if not bulletins or probed > bulletins[0].week_start:
            candidates.append(
                DiscoveredBulletin(
                    region_code=region_code,
                    week_start=probed,
                    slugs=(f"ncr-price-monitoring-{probed.strftime('%m%d%Y')}-pdf",),
                    source="ncr-date-probe",
                )
            )

    # DOE stopped dating some regions' filenames, so an undated PDF can be newer than
    # every dated one. Its week is only known once the PDF header is read.
    if undated:
        latest_undated = _latest_undated_group(region_code, undated, probe_dir=probe_dir)
        if latest_undated:
            candidates.append(latest_undated)

    candidates.extend(bulletins)

    if not candidates:
        raise RuntimeError(
            f"No bulletin PDFs found for {region_code} on "
            f"{region_page_url(region_code)}. The DOE page layout or slug naming may "
            "have changed."
        )

    ordered: list[DiscoveredBulletin] = []
    seen: set[date] = set()
    for candidate in sorted(candidates, key=lambda c: c.week_start, reverse=True):
        if candidate.week_start not in seen:
            seen.add(candidate.week_start)
            ordered.append(candidate)
    return ordered[:limit]


def discover_latest_region(
    region_key: str, *, probe_dir: str | Path = "data/bulletins"
) -> DiscoveredBulletin:
    """Latest bulletin week for a macro-region."""
    return discover_latest_weeks(region_key, limit=1, probe_dir=probe_dir)[0]


def _undated_rank(document: BulletinDocument) -> tuple[int, int]:
    """Sort key putting the likeliest-newest undated candidate first.

    DOE's current undated uploads are the numbered ones, and the archive page lists
    that series before the older files whose names carry a month but no year. Those
    year-less names are not a usable ordering signal: `...as-of-june-24-to-30` is a
    2025 bulletin sitting on the same page as this year's numbered files.
    """
    return (
        -(document.sequence if document.sequence is not None else -1),
        document.page_index,
    )


def _latest_undated_group(
    region_code: str,
    undated: list[BulletinDocument],
    *,
    probe_dir: str | Path = "data/bulletins",
) -> DiscoveredBulletin | None:
    """Newest week among the undated PDFs, read from the PDFs' own headers.

    DOE numbers its current South Luzon uploads (`region-v-bicol-37-pdf`) instead of
    dating them, and the counters restart per sub-region — so they cannot be compared
    across sub-regions. Only the header inside each PDF states its week, so the newest
    few candidates per sub-region are opened and grouped by what they say.
    """
    if not undated:
        return None

    by_subregion: dict[str, list[BulletinDocument]] = {}
    for document in undated:
        key = document.subregion or "MAIN"
        by_subregion.setdefault(key, []).append(document)

    dest = Path(probe_dir)
    weeks: dict[date, dict[str, str]] = {}
    for subregion, documents in by_subregion.items():
        for document in sorted(documents, key=_undated_rank)[:UNDATED_PROBE_LIMIT]:
            try:
                path = download_pdf(
                    slug_to_url(document.slug), dest / f"{document.slug}.pdf"
                )
                week_start = read_bulletin_week(path)
            except Exception:  # noqa: BLE001 — a bad candidate must not end the probe
                continue
            if week_start:
                weeks.setdefault(week_start, {}).setdefault(subregion, document.slug)

    if not weeks:
        return None

    # Among the weeks with the widest sub-region coverage, take the newest: a week
    # missing half its sub-regions would understate that half of the macro-region.
    widest = max(len(subregions) for subregions in weeks.values())
    best_week = max(week for week, subregions in weeks.items() if len(subregions) == widest)

    return DiscoveredBulletin(
        region_code=region_code,
        week_start=best_week,
        slugs=tuple(sorted(weeks[best_week].values())),
        source="doe-region-page-pdf-header",
    )
