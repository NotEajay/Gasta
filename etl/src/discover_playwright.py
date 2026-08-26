"""Discover DOE bulletin PDFs using Playwright for the new Next.js website."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

from playwright.sync_api import sync_playwright

from .constants import REGION_CODES

# New DOE website structure
NEW_DOE_BASE_URL = "https://doe.gov.ph/data-and-prices/liquid-fuels/retail-pump-prices/{region_slug}"

# Region slugs for the new website structure
NEW_REGION_SLUGS = {
    "NCR": "ncr-pump-prices",
    "NORTH_LUZON": "north-luzon-pump-prices",
    "SOUTH_LUZON": "south-luzon-pump-prices",
    "VISAYAS": "visayas-pump-prices",
    "MINDANAO": "mindanao-pump-prices",
}

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
    source: str = "doe-playwright"


def parse_week_start_from_slug(slug: str) -> date | None:
    """Best-effort week-start date from a DOE CMS filename slug."""
    slug = slug.lower()

    # vfo-price-monitoring-080426_with-lgu-and-field-pdf  (MMDDYY)
    match = re.search(r"vfo-price-monitoring-(\d{2})(\d{2})(\d{2})", slug)
    if match:
        month, day, yy = (int(match.group(i)) for i in range(1, 4))
        return date(2000 + yy, month, day)

    # ncr-price-monitoring-08182026-pdf (MMDDYYYY)
    match = re.search(r"price-monitoring-(\d{2})(\d{2})(\d{4})", slug)
    if match:
        month, day, year = (int(match.group(i)) for i in range(1, 4))
        return date(year, month, day)

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

    # region-iv-a-calabarzon-20-pdf (number-based dating)
    # These are sequential numbers, not dates. For South Luzon, we'll use the latest one
    # and let the parser extract the actual date from the PDF content.
    match = re.search(r"region-[ivx]+-[a-z]+-(\d+)-pdf", slug)
    if match:
        # Return None to indicate we can't parse date from slug
        # The parser will extract it from PDF content
        return None

    return None


def extract_pdf_slugs_from_page(region_slug: str) -> list[str]:
    """Extract PDF slugs from a DOE region page using Playwright."""
    url = NEW_DOE_BASE_URL.format(region_slug=region_slug)
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        try:
            page.goto(url, timeout=30000)
            page.wait_for_timeout(5000)
            
            # Scroll to trigger lazy loading
            page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
            page.wait_for_timeout(3000)
            
            # Get all links
            links = page.locator('a').all()
            pdf_slugs = []
            
            for link in links:
                href = link.get_attribute('href') or ''
                
                # Extract slug from PDF URL
                if 'documents/d/guest/' in href and 'pdf' in href.lower():
                    match = re.search(r'/documents/d/guest/([a-z0-9\-_]+-pdf)', href, re.I)
                    if match:
                        slug = match.group(1).lower()
                        if slug not in pdf_slugs:
                            pdf_slugs.append(slug)
            
            return pdf_slugs
            
        finally:
            browser.close()


def discover_latest_region_playwright(region_key: str) -> DiscoveredBulletin:
    """Discover the latest bulletin slug(s) for a macro-region using Playwright."""
    normalized = region_key.strip().lower().replace("-", "_")
    region_code = REGION_CODES[normalized]
    
    region_slug = NEW_REGION_SLUGS.get(region_code)
    if not region_slug:
        raise RuntimeError(f"No Playwright discovery configured for {region_code}")
    
    slugs = extract_pdf_slugs_from_page(region_slug)
    
    if not slugs:
        # North Luzon and Mindanao may not have data on the new website yet
        if region_code in ["NORTH_LUZON", "MINDANAO"]:
            raise RuntimeError(
                f"No PDF slugs found on DOE page for {region_code}. "
                f"This region may not have data available on the new DOE website yet. "
                f"The page exists but contains no PDF downloads."
            )
        raise RuntimeError(
            f"No PDF slugs found on DOE page for {region_code}. "
            f"The page may be under construction or not yet migrated to the new website."
        )
    
    # Find the slug with the latest parseable date
    candidates: list[tuple[date, str]] = []
    for slug in slugs:
        week_start = parse_week_start_from_slug(slug)
        if week_start:
            candidates.append((week_start, slug))
    
    # Handle South Luzon (multiple sub-region PDFs with sequential numbers)
    if region_code == "SOUTH_LUZON":
        # Find all three sub-region PDFs for the same week
        subregion_prefixes = ["region-iv-a-calabarzon", "region-iv-b-mimaropa", "region-v-bicol"]
        matching_slugs = []
        
        for prefix in subregion_prefixes:
            matching = [s for s in slugs if s.startswith(prefix)]
            if matching:
                # Get the one with the highest number (latest)
                matching_slugs.append(max(matching, key=lambda s: int(re.search(r'-(\d+)-pdf$', s).group(1)) if re.search(r'-(\d+)-pdf$', s) else 0))
        
        if len(matching_slugs) == 3:
            # Use today's date as fallback - parser will extract actual date from PDF
            return DiscoveredBulletin(
                region_code=region_code,
                week_start=date.today(),
                slugs=tuple(matching_slugs),
                source="doe-playwright"
            )
        else:
            # Fallback to single slug if we can't find all three
            if matching_slugs:
                return DiscoveredBulletin(
                    region_code=region_code,
                    week_start=date.today(),
                    slugs=tuple(matching_slugs),
                    source="doe-playwright"
                )
            raise RuntimeError(f"Could not find all three South Luzon sub-region PDFs")
    
    # For other regions, use date-based selection
    if not candidates:
        raise RuntimeError(f"Could not parse week start from any slug for {region_code}")
    
    # Get the latest one
    latest_date, latest_slug = max(candidates, key=lambda item: item[0])
    
    return DiscoveredBulletin(
        region_code=region_code,
        week_start=latest_date,
        slugs=(latest_slug,),
        source="doe-playwright"
    )
