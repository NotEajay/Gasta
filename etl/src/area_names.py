"""Normalize DOE area / city labels (no PDF or network deps)."""

from __future__ import annotations

import re

# Province / region prefixes DOE often prints before the city on the same label
# ("CAVITE TAGAYTAY CITY RON 91 …"). Longest-first so "Camarines Sur" wins over
# "Camarines".
_AREA_PROVINCE_PREFIXES = tuple(
    sorted(
        (
            "Camarines Norte",
            "Camarines Sur",
            "Oriental Mindoro",
            "Occidental Mindoro",
            "Metro Manila",
            "Camarines",
            "Catanduanes",
            "Marinduque",
            "Mindoro",
            "Palawan",
            "Romblon",
            "Sorsogon",
            "Masbate",
            "Batangas",
            "Laguna",
            "Cavite",
            "Quezon",
            "Rizal",
            "Albay",
            "Bicol",
            "Calabarzon",
            "Mimaropa",
            "Mountain Province",
            "Ilocos Norte",
            "Ilocos Sur",
            "La Union",
            "Pangasinan",
            "Cagayan",
            "Isabela",
            "Quirino",
            "Nueva Vizcaya",
            "Nueva Ecija",
            "North Luzon",
            "South Luzon",
            "Benguet",
            "Abra",
            "Apayao",
            "Ifugao",
            "Kalinga",
            "Aurora",
            "Bataan",
            "Bulacan",
            "Pampanga",
            "Tarlac",
            "Zambales",
        ),
        key=len,
        reverse=True,
    )
)


def normalize_area_name(raw: str) -> str:
    """Clean DOE area labels; drop OCR garbage that does not look like a city.

    Strips a leading province when the remainder is still a real place name so
    "Cavite Tagaytay City" becomes "Tagaytay City", while "Batangas City" stays
    intact (remainder would be only "City").
    """
    text = re.sub(r"[|{}\[\]_~=—]+", " ", raw.strip())
    text = re.sub(r"\s+", " ", text).strip(" -–—\t|/\\")
    text = re.sub(r"(?<=[a-z])City\b", " City", text, flags=re.IGNORECASE)
    text = re.sub(r"\bCty\b", "City", text, flags=re.IGNORECASE)
    text = text.replace("Para�aque", "Paranaque").replace("PARA�AQUE", "PARANAQUE")
    text = re.sub(r"Paraaque|ParaÃ±aque|ParaÑaque", "Paranaque", text, flags=re.IGNORECASE)
    if not text:
        return ""
    # Reject labels that are mostly non-letters (OCR smash-ups).
    letters = sum(1 for ch in text if ch.isalpha())
    if letters < 4 or letters / max(len(text), 1) < 0.55:
        return ""
    # Known OCR mash of Mandaluyong / overlapping city headers
    if "mcu" in text.lower() or "tioncluapna" in text.lower():
        return "Mandaluyong City"
    cleaned = text.title()
    cleaned = cleaned.replace("Paranaque", "Paranaque").replace("Paranáque", "Paranaque")
    cleaned = _strip_province_prefix(cleaned)
    return cleaned


def _strip_province_prefix(name: str) -> str:
    """Drop a leading province when a city name remains after it."""
    lower = name.lower()
    for province in _AREA_PROVINCE_PREFIXES:
        prefix = province.lower() + " "
        if not lower.startswith(prefix):
            continue
        rest = name[len(province) :].strip(" -–—\t|/\\")
        rest_lower = rest.lower()
        # "Batangas City" → remainder "City" — keep the original label.
        if not rest or rest_lower in {"city", "province", "area"}:
            return name
        return rest
    return name
