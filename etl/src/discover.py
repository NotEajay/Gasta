"""Discover the latest available DOE bulletin PDFs on prod-cms.doe.gov.ph / doe.gov.ph."""

from __future__ import annotations

import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import date, timedelta

from .constants import (
    DOE_CMS_GUEST_BASE,
    DOE_LISTING_URL,
    NCR_PDF_URL_TEMPLATE,
    REGION_CODES,
    REGION_DOE_SUBCATEGORIES,
    SOUTH_LUZON_SUBREGION_SLUG_PREFIXES,
)
from .download import ncr_pdf_url

USER_AGENT = "GasTa-ETL/1.0"
GUEST_SLUG_RE = re.compile(r"/documents/d/guest/([a-z0-9][a-z0-9\-_]*pdf)", re.I)

MONTHS = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
}


@dataclass(frozen=True)
class DiscoveredBulletin:
    region_code: str
    week_start: date
    slugs: tuple[str, ...]
    source: str = "doe-cms"


def pdf_exists(url: str) -> bool:
    request = urllib.request.Request(url, method="GET", headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            content_type = response.headers.get("Content-Type", "")
            return response.status == 200 and (
                "pdf" in content_type.lower() or url.endswith("-pdf")
            )
    except (urllib.error.HTTPError, urllib.error.URLError):
        return False


def ncr_pdf_exists(week_start: date) -> bool:
    return pdf_exists(ncr_pdf_url(week_start))


def discover_latest_ncr_week(*, lookback_days: int = 28) -> date:
    """Walk backward from today to find the most recent published NCR bulletin."""
    today = date.today()
    for offset in range(lookback_days + 1):
        candidate = today - timedelta(days=offset)
        if ncr_pdf_exists(candidate):
            return candidate
    raise RuntimeError(
        f"No NCR DOE bulletin found in the last {lookback_days} days. "
        "Check DOE site availability or URL pattern."
    )


def scrape_guest_slugs(subcategory: str) -> list[str]:
    """Return guest document slugs from a DOE retail pump prices listing page."""
    url = DOE_LISTING_URL.format(subcategory=subcategory)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        html = response.read().decode("utf-8", errors="replace")

    slugs: list[str] = []
    seen: set[str] = set()
    for match in GUEST_SLUG_RE.finditer(html):
        slug = match.group(1).lower()
        if slug in seen or slug.startswith(("doe-ph-logo", "bagong_ph")):
            continue
        seen.add(slug)
        slugs.append(slug)
    return slugs


def parse_week_start_from_slug(slug: str) -> date | None:
    """Best-effort week-start date from a DOE CMS filename slug."""
    slug = slug.lower()

    # vfo-price-monitoring-080426_with-lgu-and-field-pdf  (MMDDYY)
    match = re.search(r"vfo-price-monitoring-(\d{2})(\d{2})(\d{2})", slug)
    if match:
        month, day, yy = (int(match.group(i)) for i in range(1, 4))
        return date(2000 + yy, month, day)

    # 31-lfro-price-monitoring-august-4-2026-pdf
    match = re.search(r"lfro-price-monitoring-([a-z]+)-(\d+)-(\d{4})", slug)
    if match:
        month = MONTHS.get(match.group(1))
        if month:
            return date(int(match.group(3)), month, int(match.group(2)))

    # lf-price-monitoring-for-june-30-2026-july-6-2026-pdf (cross-month range)
    match = re.search(
        r"lf-price-monitoring-for-([a-z]+)-(\d+)-(\d{4})-([a-z]+)-(\d+)-(\d{4})",
        slug,
    )
    if match:
        month = MONTHS.get(match.group(1))
        if month:
            return date(int(match.group(3)), month, int(match.group(2)))

    # lf-price-monitoring-for-july-7-13-2026-pdf
    match = re.search(
        r"lf-price-monitoring-for-([a-z]+)-(\d+)-(\d+)-(\d{4})",
        slug,
    )
    if match:
        month = MONTHS.get(match.group(1))
        if month:
            return date(int(match.group(4)), month, int(match.group(2)))

    # north-luzon-liquid-fuels-price-monitoring-report-for-21-27-july-2026-pdf
    match = re.search(
        r"price-monitoring-report-for-(\d+)-(\d+)-([a-z]+)-(\d{4})",
        slug,
    )
    if match:
        month = MONTHS.get(match.group(3))
        if month:
            return date(int(match.group(4)), month, int(match.group(1)))

    # north-luzon-pump-prices-as-of-july-14-20-2026-pdf
    match = re.search(r"as-of-([a-z]+)-(\d+)-(\d+)-(\d{4})", slug)
    if match:
        month = MONTHS.get(match.group(1))
        if month:
            return date(int(match.group(4)), month, int(match.group(2)))

    return None


def _pick_best_slug(slugs: list[str], prefixes: tuple[str, ...]) -> str | None:
    """Pick the slug with the latest parseable week-start date."""
    candidates: list[tuple[date, str]] = []
    for slug in slugs:
        if not any(prefix in slug for prefix in prefixes):
            continue
        week_start = parse_week_start_from_slug(slug)
        if week_start:
            candidates.append((week_start, slug))
    if not candidates:
        return None
    return max(candidates, key=lambda item: item[0])[1]


def _pick_north_luzon_slug(slugs: list[str]) -> str | None:
    # Text-extractable combined CAR+I+II+III bulletin only (avoid garbled image PDFs).
    return _pick_best_slug(slugs, ("lf-price-monitoring-for-",))


def _pick_south_luzon_slugs(slugs: list[str]) -> tuple[str, str, str] | None:
    picks: list[str] = []
    for prefix in SOUTH_LUZON_SUBREGION_SLUG_PREFIXES:
        found = next((s for s in slugs if s.startswith(prefix)), None)
        if not found:
            return None
        picks.append(found)
    return tuple(picks)  # type: ignore[return-value]


def _pick_visayas_slug(slugs: list[str]) -> str | None:
    slug = _pick_best_slug(slugs, ("vfo-price-monitoring-",))
    if slug:
        return slug
    for slug in slugs:
        if "visayas" in slug and "price-monitoring" in slug:
            if parse_week_start_from_slug(slug):
                return slug
    return None


def _pick_mindanao_slug(slugs: list[str]) -> str | None:
    return _pick_best_slug(slugs, ("lfro-price-monitoring-",))


def discover_latest_region(region_key: str) -> DiscoveredBulletin:
    """Discover the latest bulletin slug(s) for a macro-region."""
    normalized = region_key.strip().lower().replace("-", "_")
    region_code = REGION_CODES[normalized]

    if region_code == "NCR":
        week_start = discover_latest_ncr_week()
        mmddyyyy = week_start.strftime("%m%d%Y")
        return DiscoveredBulletin(
            region_code=region_code,
            week_start=week_start,
            slugs=(f"ncr-price-monitoring-{mmddyyyy}-pdf",),
            source="ncr-date-probe",
        )

    # Try Playwright discovery first for non-NCR regions
    try:
        from .discover_playwright import discover_latest_region_playwright
        return discover_latest_region_playwright(region_key)
    except Exception as e:
        # Fall back to old method if Playwright fails
        print(f"Playwright discovery failed for {region_code}, falling back to old method: {e}")
        
        subcategory = REGION_DOE_SUBCATEGORIES[region_code]
        if not subcategory:
            raise RuntimeError(f"No DOE listing configured for {region_code}")

        slugs = scrape_guest_slugs(subcategory)
        if not slugs:
            # If both methods fail, the region may not have data available
            raise RuntimeError(
                f"No PDF slugs found on DOE listing for {region_code}. "
                f"This region may not have data available on the new DOE website yet."
            )

        if region_code == "NORTH_LUZON":
            slug = _pick_north_luzon_slug(slugs)
            if not slug:
                raise RuntimeError("Could not find a North Luzon bulletin slug on DOE listing")
            week_start = parse_week_start_from_slug(slug)
            if week_start is None:
                raise RuntimeError(f"Could not parse week start from slug: {slug}")
            return DiscoveredBulletin(region_code=region_code, week_start=week_start, slugs=(slug,))

        if region_code == "SOUTH_LUZON":
            triple = _pick_south_luzon_slugs(slugs)
            if not triple:
                raise RuntimeError("Could not find all three South Luzon sub-region PDFs on DOE listing")
            week_start = parse_week_start_from_slug(triple[0])  # unreliable — resolved at parse time
            return DiscoveredBulletin(
                region_code=region_code,
                week_start=week_start or date.today(),
                slugs=triple,
            )

        if region_code == "VISAYAS":
            slug = _pick_visayas_slug(slugs)
            if not slug:
                raise RuntimeError("Could not find a Visayas bulletin slug on DOE listing")
            week_start = parse_week_start_from_slug(slug)
            if week_start is None:
                raise RuntimeError(f"Could not parse week start from slug: {slug}")
            return DiscoveredBulletin(region_code=region_code, week_start=week_start, slugs=(slug,))

        if region_code == "MINDANAO":
            slug = _pick_mindanao_slug(slugs)
            if not slug:
                raise RuntimeError("Could not find a Mindanao bulletin slug on DOE listing")
            week_start = parse_week_start_from_slug(slug)
            if week_start is None:
                raise RuntimeError(f"Could not parse week start from slug: {slug}")
            return DiscoveredBulletin(region_code=region_code, week_start=week_start, slugs=(slug,))

        raise RuntimeError(f"Unsupported region: {region_key}")
