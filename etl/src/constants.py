"""DOE bulletin constants aligned with mobile/constants and Supabase seed data."""

from __future__ import annotations

FUEL_TYPES = [
    "RON 100",
    "RON 97",
    "RON 95",
    "RON 91",
    "DIESEL",
    "DIESEL PLUS",
    "KEROSENE",
]

FUEL_TYPE_CODES = {
    "RON 100": "RON_100",
    "RON 97": "RON_97",
    "RON 95": "RON_95",
    "RON 91": "RON_91",
    "DIESEL": "DIESEL",
    "DIESEL PLUS": "DIESEL_PLUS",
    "KEROSENE": "KEROSENE",
}

# Default column order in DOE NCR / South Luzon monitoring tables (left to right)
COMPANY_COLUMNS = [
    "PETRON",
    "SHELL",
    "CALTEX",
    "PHOENIX",
    "TOTAL",
    "FLYING V",
    "UNIOIL",
    "SEAOIL",
    "PTT",
]

# Region-specific company columns when the PDF header differs from NCR.
REGION_COMPANY_COLUMNS: dict[str, list[str]] = {
    "NCR": COMPANY_COLUMNS,
    "NORTH_LUZON": ["PETRON", "SHELL", "CALTEX", "TOTAL", "SEAOIL", "CLEAN FUEL"],
    "SOUTH_LUZON": COMPANY_COLUMNS,
    "VISAYAS": ["PETRON", "SHELL", "CALTEX", "PHOENIX", "TOTAL", "FLYING V", "SEAOIL", "JETTI"],
    "MINDANAO": ["PETRON", "SHELL", "CALTEX", "PHOENIX", "FLYING V", "SEAOIL", "JETTI", "MY GAS"],
}

# Header spellings DOE uses for each company, longest first so that multi-word
# labels win over their prefixes ("FLYING V" before "FLYING").
COMPANY_HEADER_ALIASES: dict[str, tuple[str, ...]] = {
    "PETRON": ("PETRON",),
    "SHELL": ("PILIPINAS SHELL", "SHELL"),
    "CALTEX": ("CHEVRON", "CALTEX"),
    "PHOENIX": ("PHOENIX PETROLEUM", "PHOENIX"),
    "TOTAL": ("TOTALENERGIES", "TOTAL ENERGIES", "TOTAL"),
    "FLYING V": ("FLYING V", "FLYINGV"),
    "UNIOIL": ("UNIOIL",),
    "SEAOIL": ("SEAOIL", "SEA OIL"),
    "PTT": ("PTT",),
    "JETTI": ("JETTI",),
    "CLEAN FUEL": ("CLEAN FUEL", "CLEANFUEL"),
    "MY GAS": ("MY GAS", "MYGAS"),
}

# Map DOE company labels to display names stored in oil_companies.name
COMPANY_NAMES = {
    "PETRON": "Petron",
    "SHELL": "Shell",
    "CALTEX": "Caltex",
    "PHOENIX": "Phoenix",
    "TOTAL": "Total",
    "FLYING V": "Flying V",
    "UNIOIL": "Unioil",
    "SEAOIL": "Seaoil",
    "PTT": "PTT",
    "JETTI": "Jetti",
    "CLEAN FUEL": "Clean Fuel",
    "MY GAS": "My Gas",
}

REGION_CODES = {
    "ncr": "NCR",
    "north_luzon": "NORTH_LUZON",
    "north-luzon": "NORTH_LUZON",
    "south_luzon": "SOUTH_LUZON",
    "south-luzon": "SOUTH_LUZON",
    "visayas": "VISAYAS",
    "mindanao": "MINDANAO",
}

DOE_CMS_GUEST_BASE = "https://prod-cms.doe.gov.ph/documents/d/guest/"

# NCR PDF URL pattern on prod-cms.doe.gov.ph (week start date MMDDYYYY)
NCR_PDF_URL_TEMPLATE = DOE_CMS_GUEST_BASE + "ncr-price-monitoring-{mmddyyyy}-pdf"

# Retail pump price archive pages. Each page server-renders links to every bulletin
# PDF that DOE has published for that macro-region (currently back to Dec 2024).
DOE_REGION_PAGE_URL = (
    "https://doe.gov.ph/data-and-prices/liquid-fuels/retail-pump-prices/{page_slug}"
)

REGION_PAGE_SLUGS = {
    "NCR": "ncr-pump-prices",
    "NORTH_LUZON": "north-luzon-pump-prices",
    "SOUTH_LUZON": "south-luzon-pump-prices",
    "VISAYAS": "visayas-pump-prices",
    "MINDANAO": "mindanao-pump-prices",
}

# Slug shapes that identify a genuine weekly price-monitoring bulletin for a region.
# DOE has renamed these files many times, so each region accepts several families.
REGION_SLUG_PATTERNS: dict[str, tuple[str, ...]] = {
    "NCR": (
        r"ncr-price-monitoring",
        r"^petro[-_]ncr",
    ),
    "NORTH_LUZON": (
        r"price-monitoring",
        r"^nluz[-_]",
        r"^[a-z]+-\d{1,2}-\d{1,2}-\d{4}$",  # april-21-27-2026
    ),
    "SOUTH_LUZON": (
        r"^region-iv-a-calabarzon",
        r"^region-iv-b-mimaropa",
        r"^region-v-bicol",
        r"^petro[-_]sluz",
    ),
    "VISAYAS": (
        r"^vfo[-_].*price-monitoring",
        r"visayas.*price-monitoring",
        r"^petro[-_]vis",
    ),
    "MINDANAO": (
        r"lfro-price-monitoring",
        r"^petro[-_]min",
    ),
}

# Documents that live on a region page but are not the weekly regional bulletin.
SLUG_REJECT_PATTERNS: tuple[str, ...] = (
    r"^doe-ph-logo",
    r"^bagong[-_]ph",
    r"province-of",
    r"liquid-petroleum-products-price-data",
)

# Sub-region markers. Older DOE bulletins split a macro-region into one PDF per
# sub-region; those PDFs must be merged back into a single macro-region row set.
REGION_SUBREGION_MARKERS: dict[str, dict[str, tuple[str, ...]]] = {
    "NORTH_LUZON": {
        # Roman numerals must be matched whole: "reg-iii" must not also read as "reg-i".
        "REGION_III": (r"(?:^|[-_])(?:reg|region)[-_]?(?:iii|3)(?:$|[-_])",),
        "REGION_II": (r"(?:^|[-_])(?:reg|region)[-_]?(?:ii|2)(?:$|[-_])",),
        "REGION_I": (r"(?:^|[-_])(?:reg|region)[-_]?(?:i|1)(?:$|[-_])",),
        "CAR": (r"(?:^|[-_])car(?:$|[-_])",),
    },
    "SOUTH_LUZON": {
        "MIMAROPA": (r"mimaropa",),
        "BICOL": (r"bicol",),
        "CALABARZON": (r"calabarzon", r"batangas", r"cavite", r"laguna", r"rizal", r"quezon"),
    },
}

# South Luzon publishes several sub-region PDFs per week — merge into one macro-region.
SOUTH_LUZON_SUBREGION_SLUG_PREFIXES = (
    "region-iv-a-calabarzon-",
    "region-iv-b-mimaropa-",
    "region-v-bicol-",
)

MIN_PRICE = 40.0
MAX_PRICE = 250.0

# DOE fronts its site with a CDN that rejects unrecognised clients.
HTTP_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 GasTa-ETL/2.0"
)
HTTP_TIMEOUT_SECONDS = 60
HTTP_MAX_RETRIES = 3

# DOE weekly bulletin weeks run Tuesday–Monday.
BULLETIN_WEEKDAY = 1  # Monday=0 … Tuesday=1

# Oldest bulletin currently published on the DOE region archive pages.
ARCHIVE_START_DATE = "2024-12-01"

ALL_REGION_KEYS = ("ncr", "north_luzon", "south_luzon", "visayas", "mindanao")

REGION_KEY_BY_CODE = {
    "NCR": "ncr",
    "NORTH_LUZON": "north_luzon",
    "SOUTH_LUZON": "south_luzon",
    "VISAYAS": "visayas",
    "MINDANAO": "mindanao",
}
