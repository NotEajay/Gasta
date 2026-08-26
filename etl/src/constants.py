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

DOE_LISTING_URL = (
    "https://doe.gov.ph/articles/group/liquid-fuels"
    "?display_type=Card&maincat=Retail+Pump+Prices&subcategory={subcategory}"
)

# DOE web listing subcategories (one page per macro-region)
REGION_DOE_SUBCATEGORIES = {
    "NCR": None,  # uses predictable CMS slug + date probe, not listing scrape
    "NORTH_LUZON": "North+Luzon+Pump+Prices",
    "SOUTH_LUZON": "South+Luzon+Pump+Prices",
    "VISAYAS": "Visayas+Pump+Prices",
    "MINDANAO": "Mindanao+Pump+Prices",
}

# South Luzon publishes three sub-region PDFs per week — merge into one macro-region.
SOUTH_LUZON_SUBREGION_SLUG_PREFIXES = (
    "region-iv-a-calabarzon-",
    "region-iv-b-mimaropa-",
    "region-v-bicol-",
)

# Preferred North Luzon combined bulletin slug (text-extractable; avoids garbled image PDFs).
NORTH_LUZON_PREFERRED_SLUG_PREFIXES = (
    "lf-price-monitoring-for-",
    "north-luzon-liquid-fuels-price-monitoring-report-for-",
)

MIN_PRICE = 40.0
MAX_PRICE = 250.0

ALL_REGION_KEYS = ("ncr", "north_luzon", "south_luzon", "visayas", "mindanao")

REGION_KEY_BY_CODE = {
    "NCR": "ncr",
    "NORTH_LUZON": "north_luzon",
    "SOUTH_LUZON": "south_luzon",
    "VISAYAS": "visayas",
    "MINDANAO": "mindanao",
}
