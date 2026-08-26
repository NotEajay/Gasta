"""Parse DOE weekly liquid fuels price monitoring PDF bulletins."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path

import pdfplumber

from .constants import (
    COMPANY_NAMES,
    FUEL_TYPE_CODES,
    FUEL_TYPES,
    MAX_PRICE,
    MIN_PRICE,
    REGION_COMPANY_COLUMNS,
)

WEEK_PATTERNS = [
    re.compile(r"For the week of\s+(.+?)(?:\)|\n|$)", re.IGNORECASE),
    re.compile(r"FOR THE PERIOD OF\s+(.+?)(?:\n|$)", re.IGNORECASE),
    re.compile(r"For the week:\s*(.+?)(?:\n|$)", re.IGNORECASE),
]
PRICE_RE = re.compile(r"^\d+\.\d+$")
RANGE_RE = re.compile(r"^(\d+\.\d+)-(\d+\.\d+)$")
MISSING_TOKENS = frozenset({"#N/A", "N/A", "NONE", "NONE.", "-", "0.00"})


@dataclass
class ParsedPrice:
    company: str
    fuel_type_code: str
    price_per_liter: float


@dataclass
class ParsedBulletin:
    region_code: str
    bulletin_date: date
    week_label: str
    source_path: str
    prices: list[ParsedPrice] = field(default_factory=list)
    validation_errors: list[str] = field(default_factory=list)
    structure_valid: bool = True

    def to_dict(self) -> dict:
        return {
            "region_code": self.region_code,
            "bulletin_date": self.bulletin_date.isoformat(),
            "week_label": self.week_label,
            "source_path": self.source_path,
            "prices": [
                {
                    "company": p.company,
                    "fuel_type_code": p.fuel_type_code,
                    "price_per_liter": p.price_per_liter,
                }
                for p in self.prices
            ],
            "validation_errors": self.validation_errors,
            "structure_valid": self.structure_valid,
        }


def slugify_company(name: str) -> str:
    return name.lower().replace(" ", "-")


def _parse_price_token(token: str) -> float | None:
    upper = token.strip().upper()
    if upper in MISSING_TOKENS:
        return None

    range_match = RANGE_RE.match(token.strip())
    if range_match:
        low = float(range_match.group(1))
        high = float(range_match.group(2))
        value = min(low, high)
        return value if MIN_PRICE < value < MAX_PRICE else None

    if PRICE_RE.fullmatch(token.strip()):
        value = float(token)
        return value if MIN_PRICE < value < MAX_PRICE else None

    return None


def _extract_prices_from_line(line: str) -> list[float]:
    values: list[float] = []
    for token in line.split():
        parsed = _parse_price_token(token)
        if parsed is not None:
            values.append(parsed)
    return values


def _parse_fuel_line(line: str) -> tuple[str, list[float]] | None:
    stripped = line.strip()
    upper = stripped.upper()
    for fuel in FUEL_TYPES:
        prefix = fuel + " "
        if upper.startswith(prefix):
            prices = _extract_prices_from_line(stripped[len(fuel) :].strip())
            if len(prices) >= 3:
                return fuel, prices
    return None


def _parse_week_start_from_label(label: str) -> date | None:
    """Parse bulletin week start from a DOE header date range string."""
    cleaned = label.strip().rstrip(")")
    cleaned = re.sub(r"^Tuesday\s*-\s*Monday\s*/\s*", "", cleaned, flags=re.I)
    cleaned = re.sub(r"^Tuesday\s*Monday\s*/\s*", "", cleaned, flags=re.I)

    # July 7-13, 2026
    match = re.search(
        r"([A-Za-z]+)\s+(\d{1,2})\s*-\s*(\d{1,2}),?\s*(\d{4})",
        cleaned,
        re.I,
    )
    if match:
        month_name, start_day, _, year = match.groups()
        try:
            month = datetime.strptime(month_name[:3], "%b").month
        except ValueError:
            try:
                month = datetime.strptime(month_name, "%B").month
            except ValueError:
                month = None
        if month:
            return date(int(year), month, int(start_day))

    # August 4 to August 10, 2026  |  JULY 28 - AUGUST 3, 2026  |  April 28 - May 4, 2026
    parts = cleaned.split(",")
    if len(parts) >= 2:
        year = int(parts[-1].strip())
        range_part = parts[0].strip()
        if " to " in range_part.lower():
            start_raw = re.split(r"\s+to\s+", range_part, flags=re.I)[0].strip()
        elif " - " in range_part:
            start_raw = range_part.split(" - ")[0].strip()
        elif "-" in range_part:
            start_raw = range_part.split("-")[0].strip()
        else:
            start_raw = range_part

        for fmt in ("%B %d %Y", "%B %d, %Y"):
            try:
                start_with_year = f"{start_raw} {year}".replace("  ", " ")
                return datetime.strptime(start_with_year, fmt).date()
            except ValueError:
                continue

    return None


def _parse_week_label(text: str) -> tuple[str, date | None]:
    for pattern in WEEK_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        if match:
            label = match.group(1).strip().rstrip(")")
            bulletin_date = _parse_week_start_from_label(label)
            if bulletin_date:
                return label, bulletin_date
    return "", None


def _company_columns_for_region(region_code: str) -> list[str]:
    return REGION_COMPANY_COLUMNS.get(region_code, REGION_COMPANY_COLUMNS["NCR"])


def _validate_document_structure(text: str, region_code: str) -> list[str]:
    """Validate that the PDF has expected structure for a DOE bulletin."""
    errors = []
    
    # Check for week/date header
    has_week_header = any(pattern.search(text) for pattern in WEEK_PATTERNS)
    if not has_week_header:
        errors.append("Missing week/date header pattern (e.g., 'For the week of...')")
    
    # Check for fuel type headers
    found_fuels = set()
    for fuel in FUEL_TYPES:
        if fuel in text:
            found_fuels.add(fuel)
    
    if len(found_fuels) < 3:
        errors.append(f"Expected at least 3 fuel types, found {len(found_fuels)}: {found_fuels}")
    
    # Check for company names
    company_columns = _company_columns_for_region(region_code)
    found_companies = set()
    for company_key in company_columns:
        company_name = COMPANY_NAMES.get(company_key, "")
        if company_name and company_name in text:
            found_companies.add(company_name)
    
    if len(found_companies) < len(company_columns) // 2:
        errors.append(f"Expected {len(company_columns)} companies, found {len(found_companies)}: {found_companies}")
    
    # Check for price patterns
    price_count = len(PRICE_RE.findall(text))
    if price_count < 10:
        errors.append(f"Expected at least 10 price values, found {price_count}")
    
    return errors


def _validate_field_level(prices: list[ParsedPrice], region_code: str) -> list[str]:
    """Validate individual price fields for correctness."""
    errors = []
    
    # Check for valid fuel types
    valid_fuel_codes = set(FUEL_TYPE_CODES.values())
    for price in prices:
        if price.fuel_type_code not in valid_fuel_codes:
            errors.append(f"Invalid fuel type code: {price.fuel_type_code}")
    
    # Check for valid company names
    company_columns = _company_columns_for_region(region_code)
    valid_companies = set(COMPANY_NAMES.get(key, "") for key in company_columns)
    for price in prices:
        if price.company not in valid_companies:
            errors.append(f"Invalid company name: {price.company}")
    
    # Check for price anomalies (extreme values)
    for price in prices:
        if price.price_per_liter <= 0:
            errors.append(f"Non-positive price for {price.company}/{price.fuel_type_code}: {price.price_per_liter}")
        elif price.price_per_liter > 200:  # Unreasonably high
            errors.append(f"Suspiciously high price for {price.company}/{price.fuel_type_code}: {price.price_per_liter}")
    
    # Check for duplicate company/fuel combinations
    seen = set()
    for price in prices:
        key = (price.company, price.fuel_type_code)
        if key in seen:
            errors.append(f"Duplicate price entry for {price.company}/{price.fuel_type_code}")
        seen.add(key)
    
    return errors


def merge_parsed_bulletins(bulletins: list[ParsedBulletin]) -> ParsedBulletin:
    """Merge multiple parsed bulletins (e.g. South Luzon sub-regions) into one macro-region."""
    if not bulletins:
        raise ValueError("No bulletins to merge")

    region_code = bulletins[0].region_code
    bulletin_date = bulletins[0].bulletin_date
    week_label = bulletins[0].week_label
    source_path = "; ".join(b.source_path for b in bulletins)

    for bulletin in bulletins[1:]:
        if bulletin.region_code != region_code:
            raise ValueError("Cannot merge bulletins from different regions")
        if bulletin.bulletin_date != bulletin_date:
            raise ValueError(
                f"South Luzon sub-region week mismatch: {bulletin.bulletin_date} vs {bulletin_date}"
            )

    buckets: dict[tuple[str, str], list[float]] = {}
    for bulletin in bulletins:
        for price in bulletin.prices:
            key = (price.company, price.fuel_type_code)
            buckets.setdefault(key, []).append(price.price_per_liter)

    merged_prices = [
        ParsedPrice(company=company, fuel_type_code=fuel_code, price_per_liter=round(min(values), 2))
        for (company, fuel_code), values in sorted(buckets.items())
    ]

    return ParsedBulletin(
        region_code=region_code,
        bulletin_date=bulletin_date,
        week_label=week_label,
        source_path=source_path,
        prices=merged_prices,
    )


def parse_bulletin_pdf(
    pdf_path: str | Path,
    region_code: str,
    *,
    fallback_week_start: date | None = None,
) -> ParsedBulletin:
    path = Path(pdf_path)
    if not path.exists():
        raise FileNotFoundError(path)

    full_text_parts: list[str] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            full_text_parts.append(page.extract_text() or "")
    full_text = "\n".join(full_text_parts)

    # Document structure validation
    validation_errors = _validate_document_structure(full_text, region_code)
    structure_valid = len(validation_errors) == 0

    week_label, bulletin_date = _parse_week_label(full_text)
    if bulletin_date is None and fallback_week_start is not None:
        bulletin_date = fallback_week_start
        if not week_label:
            week_label = fallback_week_start.isoformat()
    if bulletin_date is None:
        validation_errors.append(f"Could not parse bulletin week from {path.name}")
        structure_valid = False

    company_columns = _company_columns_for_region(region_code)
    buckets: dict[tuple[str, str], list[float]] = {}

    for line in full_text.splitlines():
        parsed = _parse_fuel_line(line)
        if not parsed:
            continue
        fuel_label, prices = parsed
        fuel_code = FUEL_TYPE_CODES[fuel_label]
        for idx, price in enumerate(prices[: len(company_columns)]):
            company_key = company_columns[idx]
            company_name = COMPANY_NAMES[company_key]
            buckets.setdefault((company_name, fuel_code), []).append(price)

    parsed_prices: list[ParsedPrice] = []
    for (company_name, fuel_code), values in sorted(buckets.items()):
        parsed_prices.append(
            ParsedPrice(
                company=company_name,
                fuel_type_code=fuel_code,
                price_per_liter=round(min(values), 2),
            )
        )

    # Field-level validation
    field_errors = _validate_field_level(parsed_prices, region_code)
    validation_errors.extend(field_errors)
    structure_valid = structure_valid and len(field_errors) == 0

    return ParsedBulletin(
        region_code=region_code,
        bulletin_date=bulletin_date,
        week_label=week_label,
        source_path=str(path),
        prices=parsed_prices,
        validation_errors=validation_errors,
        structure_valid=structure_valid,
    )


def parse_region_pdfs(
    pdf_paths: list[Path],
    region_code: str,
    *,
    fallback_week_start: date | None = None,
) -> ParsedBulletin:
    """Parse one or more PDFs for a macro-region (merges when multiple)."""
    parsed = [
        parse_bulletin_pdf(path, region_code, fallback_week_start=fallback_week_start)
        for path in pdf_paths
    ]
    if len(parsed) == 1:
        return parsed[0]
    return merge_parsed_bulletins(parsed)
