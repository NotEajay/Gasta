"""Parse SEAOIL's published Webflow CMS pages; never infer price or coordinates."""
from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse

from lxml import html

SOURCE = "https://www.seaoil.com.ph/station-locations"
FUEL_PRODUCTS = {"Extreme Diesel", "Extreme 91", "Extreme 95", "Extreme 97", "Extreme 105", "Kerosene", "SEAGAS LPG"}


def clean(value: str | None) -> str | None:
    value = re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value or "")).strip()
    return re.sub(r"\s+([,;])", r"\1", value) or None


def official_url(value: str, base: str = SOURCE) -> str:
    result = urljoin(base, value)
    parsed = urlparse(result)
    if parsed.scheme != "https" or parsed.netloc != "www.seaoil.com.ph" or parsed.fragment:
        raise ValueError("Unexpected SEAOIL source URL")
    return result


def identity(source_id: str | None, name: str, address: str | None) -> str:
    if source_id:
        return "source:" + source_id
    if not clean(address):
        raise ValueError("A station without a source ID needs an address for a stable key")
    normalized = f"{clean(name).casefold()}\n{clean(address).casefold()}"
    return "address:" + hashlib.sha256(normalized.encode()).hexdigest()


@dataclass(frozen=True)
class Station:
    name: str
    address: str | None
    source_url: str
    source_station_id: str
    directory_key: str
    operating_hours: str | None
    fuel_types: list[str] | None = None
    city: str | None = None
    province: str | None = None
    region: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    source_type: str = "official_directory"

    def preview(self) -> dict:
        return {"company": "Seaoil", **asdict(self)}

    def payload(self, company_id: str, synced_at: str) -> dict:
        row = asdict(self)
        row["directory_region"] = row.pop("region")  # Not a DOE macro-region foreign key.
        # A later approved geocoding step must survive source refreshes. New rows
        # still receive NULL defaults when coordinates are absent.
        for coordinate in ("latitude", "longitude"):
            if row[coordinate] is None:
                row.pop(coordinate)
        return {**row, "oil_company_id": company_id, "last_synced_at": synced_at}


def _document(content: str):
    if not content.strip():
        raise ValueError("Empty station document")
    return html.fromstring(content)


def _text(node, field: str) -> str | None:
    values = node.xpath('.//*[@fs-cmsfilter-field=$field]', field=field)
    return clean(values[0].text_content()) if values else None


def parse_listing(content: str, page_url: str = SOURCE) -> tuple[list[Station], str | None]:
    root = _document(content)
    cards = root.xpath('//*[contains(concat(" ", normalize-space(@class), " "), " station-info-wrapper ")]')
    if not cards:
        raise ValueError("No SEAOIL station cards found; source layout may have changed")
    rows: list[Station] = []
    identities: dict[str, Station] = {}
    for card in cards:
        name = _text(card, "name")
        links = card.xpath('.//a[starts-with(@href, "/stations/")]/@href')
        if not name or len(links) != 1:
            raise ValueError("Station card is missing a name or unambiguous detail link")
        url = official_url(links[0], page_url)
        slug = urlparse(url).path.removeprefix("/stations/").rstrip("/")
        if not slug or urlparse(url).query:
            raise ValueError("Invalid station slug")
        hours = card.xpath('.//*[contains(concat(" ", normalize-space(@class), " "), " hours-info ")]')
        row = Station(name=name, address=_text(card, "address"), source_url=url,
                      source_station_id=slug, directory_key=identity(slug, name, _text(card, "address")),
                      operating_hours=clean(hours[0].text_content()) if hours else None)
        if row.directory_key in identities and identities[row.directory_key] != row:
            raise ValueError("Conflicting duplicate station IDs")
        identities[row.directory_key] = row
        rows.append(row)  # Retain every listing; deduplication must be reported.
    next_links = root.xpath('//a[contains(concat(" ", normalize-space(@class), " "), " w-pagination-next ")]/@href')
    if len(next_links) > 1:
        raise ValueError("Ambiguous pagination")
    next_url = official_url(next_links[0], page_url) if next_links else None
    if next_url and urlparse(next_url).path != urlparse(SOURCE).path:
        raise ValueError("Pagination left the station directory")
    return rows, next_url


def parse_fuels(content: str, expected_slug: str) -> list[str]:
    root = _document(content)
    if root.get("data-wf-item-slug") != expected_slug:
        raise ValueError("Unexpected station detail page; refusing to infer products")
    # Empty Webflow collections may omit the collection wrapper entirely.
    if not root.get("data-wf-collection"):
        raise ValueError("Missing station collection marker")
    values = root.xpath('//*[@fs-cmsfilter-field="fuels"]')
    products = sorted({clean(node.text_content()) for node in values} - {None})
    unknown = set(products) - FUEL_PRODUCTS - {"SEAOIL Lubricants", "Lubeserv", "LubeServ"}
    if unknown:
        raise ValueError(f"Unrecognized fuel/product labels: {sorted(unknown)}")
    return [product for product in products if product in FUEL_PRODUCTS]


def sync_time() -> str:
    return datetime.now(timezone.utc).isoformat()
