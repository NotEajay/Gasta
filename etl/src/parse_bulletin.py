"""Parse DOE weekly liquid fuels price monitoring PDF bulletins."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path

import pdfplumber

from .constants import (
    COMPANY_HEADER_ALIASES,
    COMPANY_NAMES,
    FUEL_TYPE_CODES,
    FUEL_TYPES,
    MAX_PRICE,
    MIN_PRICE,
    REGION_COMPANY_COLUMNS,
)
from .slug_dates import normalize_bulletin_week_start, parse_week_start_from_slug

WEEK_PATTERNS = [
    re.compile(r"For the week of\s+(.+?)(?:\)|\n|$)", re.IGNORECASE),
    re.compile(r"FOR THE PERIOD OF\s+(.+?)(?:\n|$)", re.IGNORECASE),
    re.compile(r"For the week:\s*(.+?)(?:\n|$)", re.IGNORECASE),
    # "(For the week: Tuesday - Monday) as of March 11 to March 17, 2025" — the week
    # follows a parenthetical, so the date has to be picked up from "as of" instead.
    re.compile(r"as of\s+(.+?)(?:\)|\n|$)", re.IGNORECASE),
]
PRICE_RE = re.compile(r"^\d+\.\d+$")
RANGE_RE = re.compile(r"^(\d+\.\d+)-(\d+\.\d+)$")
MISSING_TOKENS = frozenset({"#N/A", "N/A", "NONE", "NONE.", "-", "0.00"})


class BulletinDateUnknown(RuntimeError):
    """Raised when neither the PDF header nor its filename reveals the bulletin week."""


class BulletinNotMachineReadable(RuntimeError):
    """Raised when a bulletin is a scanned image with no extractable text.

    DOE occasionally publishes a week as page scans. Those carry no text layer, so no
    prices can be read without OCR; callers skip the week rather than store nothing.
    """


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
    source_url: str | None = None
    column_source: str = "region-default"
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "region_code": self.region_code,
            "bulletin_date": self.bulletin_date.isoformat(),
            "week_label": self.week_label,
            "source_path": self.source_path,
            "source_url": self.source_url,
            "column_source": self.column_source,
            "prices": [
                {
                    "company": p.company,
                    "fuel_type_code": p.fuel_type_code,
                    "price_per_liter": p.price_per_liter,
                }
                for p in self.prices
            ],
            "validation_errors": self.validation_errors,
            "warnings": self.warnings,
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


# Font-mapping failures show up as `(cid:NN)` placeholders. A handful can appear in an
# otherwise sound document, so only a run of them condemns the text layer.
MAX_CID_PLACEHOLDERS = 5
# Digits smeared together by a bad text layer read as prices with too many decimals
# ("87.488" where the page shows 87.48). A healthy bulletin stays under 1% of these.
MAX_MALFORMED_PRICE_RATIO = 0.05
MIN_PRICES_FOR_RATIO = 20

_DECIMAL_TOKEN_RE = re.compile(r"(?<![\d.])\d+\.(\d+)(?![\d.])")


def _reject_corrupt_text_layer(name: str, text: str) -> None:
    """Refuse a bulletin whose text layer is garbled OCR rather than real text.

    DOE sometimes publishes a scan carrying a machine-generated text layer. It looks
    parseable but the digits are smeared ("87.488 7.48" for a single 87.48 cell), so
    every price read from it would be wrong. Rejecting the whole document is the only
    safe response — there is no way to tell which of its numbers survived intact.
    """
    cid_markers = text.count("(cid:")
    if cid_markers > MAX_CID_PLACEHOLDERS:
        raise BulletinNotMachineReadable(
            f"{name} has a corrupt text layer ({cid_markers} unmapped glyphs); its "
            "prices cannot be trusted."
        )

    decimals = _DECIMAL_TOKEN_RE.findall(text)
    malformed = sum(1 for fraction in decimals if len(fraction) > 2)
    if (
        len(decimals) >= MIN_PRICES_FOR_RATIO
        and malformed / len(decimals) > MAX_MALFORMED_PRICE_RATIO
    ):
        raise BulletinNotMachineReadable(
            f"{name} has a corrupt text layer ({malformed} of {len(decimals)} numbers "
            "have more than two decimals); its prices cannot be trusted."
        )


def read_bulletin_week(pdf_path: str | Path) -> date | None:
    """The week a bulletin states in its own header, or None when it states none.

    Only the first page is read, so this stays cheap enough to identify the week of
    the undated files DOE numbers sequentially instead of dating.
    """
    path = Path(pdf_path)
    with pdfplumber.open(path) as pdf:
        if not pdf.pages:
            return None
        text = pdf.pages[0].extract_text() or ""
    _, week_start = _parse_week_label(text)
    if week_start is None:
        week_start = parse_week_start_from_slug(path.stem)
    return normalize_bulletin_week_start(week_start) if week_start else None


def _company_columns_for_region(region_code: str) -> list[str]:
    return REGION_COMPANY_COLUMNS.get(region_code, REGION_COMPANY_COLUMNS["NCR"])


ALIAS_TO_COMPANY: dict[str, str] = {
    alias: company
    for company, aliases in COMPANY_HEADER_ALIASES.items()
    for alias in aliases
}

ROW_TOLERANCE = 3.0


@dataclass(frozen=True)
class ColumnAnchor:
    """A header cell and the x position where its column starts."""

    x: float
    label: str
    company: str | None  # None for non-brand columns (AREA, OVERALL RANGE, …)


def _cluster_words_into_rows(words: list[dict]) -> list[list[dict]]:
    """Group words into visual table rows.

    A DOE row is not always one text line: the product label and its prices can sit a
    fraction of a point apart vertically, which splits them in plain text extraction.
    """
    rows: list[list[dict]] = []
    for word in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if rows and abs(word["top"] - rows[-1][0]["top"]) <= ROW_TOLERANCE:
            rows[-1].append(word)
        else:
            rows.append([word])
    return [sorted(row, key=lambda w: w["x0"]) for row in rows]


def _header_anchors(row: list[dict]) -> list[ColumnAnchor]:
    """Turn a header row into column anchors, merging two-word brand names."""
    anchors: list[ColumnAnchor] = []
    index = 0
    while index < len(row):
        text = row[index]["text"].upper().strip(":.,")
        pair = (
            f"{text} {row[index + 1]['text'].upper().strip(':.,')}"
            if index + 1 < len(row)
            else ""
        )
        if pair in ALIAS_TO_COMPANY:
            anchors.append(ColumnAnchor(row[index]["x0"], pair, ALIAS_TO_COMPANY[pair]))
            index += 2
            continue
        anchors.append(ColumnAnchor(row[index]["x0"], text, ALIAS_TO_COMPANY.get(text)))
        index += 1
    return anchors


def _find_header_anchors(rows: list[list[dict]]) -> list[ColumnAnchor] | None:
    """The row naming the most brands is the table header."""
    best: list[ColumnAnchor] | None = None
    best_brands = 0
    for row in rows:
        anchors = _header_anchors(row)
        brands = {a.company for a in anchors if a.company}
        if len(brands) >= 3 and len(brands) > best_brands:
            best = anchors
            best_brands = len(brands)
    return best


def detect_company_columns(anchors: list[ColumnAnchor]) -> list[str]:
    """Brand columns in left-to-right order."""
    seen: list[str] = []
    for anchor in anchors:
        if anchor.company and anchor.company not in seen:
            seen.append(anchor.company)
    return seen


# A price cell is centred on its header, so its left edge can sit a little left of the
# header's. This is how far left of the first brand header the price area still reaches.
CELL_LEFT_BLEED = 20.0


def _table_left_edge(anchors: list[ColumnAnchor]) -> float | None:
    """The x where the price area begins; label columns are everything left of it."""
    brand_xs = [a.x for a in anchors if a.company]
    return min(brand_xs) - CELL_LEFT_BLEED if brand_xs else None


def _row_fuel_label(
    row: list[dict], table_left: float
) -> tuple[str, list[dict]] | None:
    """Split a row into its product label and its price cells.

    The product name has its own column, but an area name can share the row
    ("Caloocan City RON 91 72.80 …"), so the fuel is matched at the end of the label
    text. Requiring the label to sit left of the price area also rejects the summary
    block DOE prints below the table, which repeats fuel names ("Diesel 77.00 97.50
    90.30") under different columns that have nothing to do with any brand.
    """
    label = " ".join(w["text"] for w in row if w["x0"] < table_left).upper()
    if not label:
        return None
    price_words = [
        w
        for w in row
        if w["x0"] >= table_left and _parse_price_token(w["text"]) is not None
    ]
    if not price_words:
        return None

    for fuel in sorted(FUEL_TYPES, key=len, reverse=True):
        if label.endswith(fuel):
            return fuel, price_words
    return None


def _assign_prices_by_column(
    row: list[dict], anchors: list[ColumnAnchor]
) -> tuple[str, dict[str, list[float]]] | None:
    """Map each price in a row to the brand whose column it sits under.

    DOE prints a low–high pair per brand plus overall-range and common-price columns,
    and omits brands that do not operate in an area — so a price's horizontal position
    is the only reliable indicator of which brand it belongs to.
    """
    table_left = _table_left_edge(anchors)
    if table_left is None:
        return None
    parsed = _row_fuel_label(row, table_left)
    if not parsed:
        return None
    fuel_label, price_words = parsed

    by_company: dict[str, list[float]] = {}
    for word in price_words:
        price = _parse_price_token(word["text"])
        if price is None:
            continue
        anchor = min(anchors, key=lambda a: abs(a.x - word["x0"]))
        if anchor.company:
            by_company.setdefault(anchor.company, []).append(price)
    return fuel_label, by_company


def _validate_document_structure(text: str, region_code: str) -> list[str]:
    """Validate that the PDF has expected structure for a DOE bulletin.

    The week header is deliberately not checked here. DOE has used many header
    wordings, and a bulletin whose week comes from its filename instead is still
    perfectly usable — a genuinely undatable bulletin raises `BulletinDateUnknown`.
    """
    errors = []

    # Check for fuel type headers
    found_fuels = set()
    for fuel in FUEL_TYPES:
        if fuel in text:
            found_fuels.add(fuel)
    
    if len(found_fuels) < 3:
        errors.append(f"Expected at least 3 fuel types, found {len(found_fuels)}: {found_fuels}")
    
    # Skip price pattern validation in text - parsing will catch if no prices are extracted
    # Company name check is now optional since PDFs may use abbreviations or different formats
    # The field-level validation will catch invalid company names during parsing
    
    return errors


def _validate_field_level(prices: list[ParsedPrice], company_columns: list[str]) -> list[str]:
    """Validate individual price fields for correctness."""
    errors = []
    
    # Check for valid fuel types
    valid_fuel_codes = set(FUEL_TYPE_CODES.values())
    for price in prices:
        if price.fuel_type_code not in valid_fuel_codes:
            errors.append(f"Invalid fuel type code: {price.fuel_type_code}")
    
    # Check for valid company names
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
    """Merge sub-region bulletins for one week into a single macro-region row set.

    DOE has published a macro-region as anywhere from one to five PDFs depending on the
    year (North Luzon as CAR plus Regions I–III, South Luzon as up to five provinces).
    Each brand/fuel keeps its lowest price across the sub-regions, matching how a single
    combined bulletin reports the regional low.
    """
    if not bulletins:
        raise ValueError("No bulletins to merge")
    if len(bulletins) == 1:
        return bulletins[0]

    region_code = bulletins[0].region_code
    bulletin_date = bulletins[0].bulletin_date

    for bulletin in bulletins[1:]:
        if bulletin.region_code != region_code:
            raise ValueError("Cannot merge bulletins from different regions")
        if bulletin.bulletin_date != bulletin_date:
            raise ValueError(
                f"{region_code} sub-region week mismatch: "
                f"{bulletin.bulletin_date} vs {bulletin_date}"
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

    week_label = next((b.week_label for b in bulletins if b.week_label), "")
    return ParsedBulletin(
        region_code=region_code,
        bulletin_date=bulletin_date,
        week_label=week_label,
        source_path="; ".join(b.source_path for b in bulletins),
        source_url="; ".join(b.source_url for b in bulletins if b.source_url) or None,
        column_source=",".join(sorted({b.column_source for b in bulletins})),
        prices=merged_prices,
        validation_errors=[e for b in bulletins for e in b.validation_errors],
        warnings=[w for b in bulletins for w in b.warnings],
        structure_valid=all(b.structure_valid for b in bulletins),
    )


def parse_bulletin_pdf(
    pdf_path: str | Path,
    region_code: str,
    *,
    fallback_week_start: date | None = None,
    source_url: str | None = None,
) -> ParsedBulletin:
    path = Path(pdf_path)
    if not path.exists():
        raise FileNotFoundError(path)

    full_text_parts: list[str] = []
    page_rows: list[list[list[dict]]] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            full_text_parts.append(page.extract_text() or "")
            page_rows.append(_cluster_words_into_rows(page.extract_words()))
    full_text = "\n".join(full_text_parts)

    if not full_text.strip():
        raise BulletinNotMachineReadable(
            f"{path.name} contains no text layer (scanned images); prices cannot be "
            "extracted without OCR."
        )
    _reject_corrupt_text_layer(path.name, full_text)

    # Document structure validation
    validation_errors = _validate_document_structure(full_text, region_code)
    structure_valid = len(validation_errors) == 0

    week_label, bulletin_date = _parse_week_label(full_text)
    if bulletin_date is None:
        bulletin_date = fallback_week_start or parse_week_start_from_slug(path.stem)
        if bulletin_date and not week_label:
            week_label = bulletin_date.isoformat()
    if bulletin_date is None:
        raise BulletinDateUnknown(
            f"Could not determine the bulletin week for {path.name}: no recognisable "
            "date header in the PDF and no date in its DOE filename."
        )
    # Always store the Tuesday that starts the DOE week, even when the PDF names a
    # mid-week "as of" day or a Monday end date.
    bulletin_date = normalize_bulletin_week_start(bulletin_date)

    warnings: list[str] = []
    buckets: dict[tuple[str, str], list[float]] = {}
    company_columns: list[str] = []
    column_source = "pdf-columns"
    anchors: list[ColumnAnchor] | None = None

    for rows in page_rows:
        page_anchors = _find_header_anchors(rows) or anchors
        if not page_anchors:
            continue
        anchors = page_anchors
        for company in detect_company_columns(anchors):
            if company not in company_columns:
                company_columns.append(company)

        for row in rows:
            assigned = _assign_prices_by_column(row, anchors)
            if not assigned:
                continue
            fuel_label, by_company = assigned
            fuel_code = FUEL_TYPE_CODES[fuel_label]
            for company_key, prices in by_company.items():
                company_name = COMPANY_NAMES[company_key]
                buckets.setdefault((company_name, fuel_code), []).extend(prices)

    if anchors is None:
        # No readable table header — fall back to reading prices positionally from the
        # text, which assumes one price per brand in the configured column order.
        column_source = "region-default"
        company_columns = _company_columns_for_region(region_code)
        warnings.append(
            f"{path.name}: no brand header row found; prices were mapped positionally "
            "using the configured column order and may be unreliable"
        )
        for line in full_text.splitlines():
            parsed = _parse_fuel_line(line)
            if not parsed:
                continue
            fuel_label, prices = parsed
            fuel_code = FUEL_TYPE_CODES[fuel_label]
            for idx, price in enumerate(prices[: len(company_columns)]):
                company_name = COMPANY_NAMES[company_columns[idx]]
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
    field_errors = _validate_field_level(parsed_prices, company_columns)
    validation_errors.extend(field_errors)
    structure_valid = structure_valid and len(field_errors) == 0

    return ParsedBulletin(
        region_code=region_code,
        bulletin_date=bulletin_date,
        week_label=week_label,
        source_path=str(path),
        source_url=source_url,
        column_source=column_source,
        prices=parsed_prices,
        validation_errors=validation_errors,
        warnings=warnings,
        structure_valid=structure_valid,
    )


def parse_region_pdfs(
    pdf_paths: list[Path],
    region_code: str,
    *,
    fallback_week_start: date | None = None,
    source_urls: list[str] | None = None,
) -> ParsedBulletin:
    """Parse one or more PDFs for a macro-region (merges when multiple)."""
    urls = source_urls or []
    parsed = [
        parse_bulletin_pdf(
            path,
            region_code,
            fallback_week_start=fallback_week_start,
            source_url=urls[index] if index < len(urls) else None,
        )
        for index, path in enumerate(pdf_paths)
    ]
    return merge_parsed_bulletins(parsed)
