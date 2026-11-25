"""RSS-first fuel-news ingestion for GasTa.

The importer deliberately consumes publisher feeds only. It does not fetch article
pages, copy images, or retain full article bodies. Feed values are untrusted: XML and
field sizes are bounded, HTML is reduced to plain text, URLs are allow-listed per
publisher, and only deterministic parse results are persisted.

Supabase contract
-----------------
The database migration is maintained outside this ETL module. This client expects the
following normalized tables and conflict keys:

* fuel_news_articles
  - id, source_key, publisher, source_guid, canonical_url, headline, excerpt,
    published_at, fetched_at, classification, parse_status, is_feed_visible,
    dedup_hash (unique), content_hash, parse_result (jsonb)
* fuel_news_events
  - id, event_hash (unique), classification, direction, effective_at,
    effective_timezone, effective_precision, coverage, confidence, parse_status,
    discrepancy, published_at, last_seen_at
* fuel_news_adjustments
  - event_id, fuel_type, amount_centavos, confidence
    (unique on event_id, fuel_type)
* fuel_news_event_articles
  - event_id, article_id (article_id unique so a reparsed article can move events)
* fuel_news_source_state
  - source_key (unique), publisher, feed_url, etag, last_modified, last_polled_at,
    last_success_at, last_error_at, status, http_status, error_message, last_error,
    consecutive_failures, items_seen, candidates_seen, articles_written,
    events_written

Signed ``amount_centavos`` values are positive for hikes and negative for rollbacks.
An absent fuel has no adjustment row. Every retained article receives an event, even
when its safe fallback classification is ``news_update`` and it has no adjustments.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import ipaddress
import json
import logging
import os
import re
import socket
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, time as datetime_time, timedelta, timezone
from decimal import Decimal, InvalidOperation
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from typing import Any, Callable, Iterable, Sequence

try:
    from zoneinfo import ZoneInfo

    MANILA_TZ = ZoneInfo("Asia/Manila")
except Exception:  # pragma: no cover - Windows without a zoneinfo database
    # The Philippines has used UTC+08:00 without daylight saving since 1978. News
    # dates handled by this importer are contemporary, so this is a safe fallback.
    MANILA_TZ = timezone(timedelta(hours=8), name="Asia/Manila")

LOGGER = logging.getLogger("fuel_news")

USER_AGENT = (
    "GasTaFuelNewsImporter/1.0 "
    "(+https://github.com/eajay/Gasta; RSS polling for source attribution)"
)
HTTP_TIMEOUT_SECONDS = 15
MAX_FETCH_ATTEMPTS = 3
MAX_FEED_BYTES = 2_000_000
MAX_FEED_ITEMS = 250
MAX_HEADLINE_CHARS = 300
MAX_EXCERPT_CHARS = 500
MAX_GUID_CHARS = 500
MAX_URL_CHARS = 2_048
MAX_ERROR_CHARS = 300
MAX_API_RESPONSE_BYTES = 1_000_000
EXTRACTION_VERSION = 1
MAX_FUTURE_PUBLICATION_AGE = timedelta(hours=48)
MAX_PAST_PUBLICATION_YEARS = 10

TRANSIENT_HTTP_STATUSES = frozenset({408, 425, 429, 500, 502, 503, 504})
TRACKING_QUERY_KEYS = frozenset(
    {
        "fbclid",
        "gclid",
        "mc_cid",
        "mc_eid",
        "ref",
        "source",
    }
)


@dataclass(frozen=True)
class NewsSource:
    key: str
    publisher: str
    feed_url: str
    allowed_hosts: tuple[str, ...]


SOURCES: tuple[NewsSource, ...] = (
    NewsSource(
        key="gma_money",
        publisher="GMA News Money",
        feed_url="https://data.gmanetwork.com/gno/rss/money/feed.xml",
        allowed_hosts=("gmanetwork.com",),
    ),
    NewsSource(
        key="inquirer_business",
        publisher="Inquirer Business",
        feed_url="https://business.inquirer.net/feed",
        allowed_hosts=("inquirer.net",),
    ),
    NewsSource(
        key="philstar_business",
        publisher="Philstar Business",
        feed_url="https://www.philstar.com/rss/business",
        allowed_hosts=("philstar.com",),
    ),
)

SOURCE_BY_KEY = {source.key: source for source in SOURCES}


@dataclass(frozen=True)
class FeedItem:
    guid: str | None
    canonical_url: str
    headline: str
    excerpt: str
    published_at: datetime | None
    categories: tuple[str, ...] = ()


@dataclass(frozen=True)
class FuelAdjustment:
    fuel_type: str
    amount_centavos: int
    confidence: str = "high"


@dataclass(frozen=True)
class EffectiveTime:
    value: datetime
    precision: str
    confidence: str = "high"


@dataclass(frozen=True)
class ParsedArticle:
    source: NewsSource
    item: FeedItem
    fetched_at: datetime
    classification: str
    parse_status: str
    direction: str
    adjustments: tuple[FuelAdjustment, ...]
    effective_time: EffectiveTime | None
    dedup_hash: str
    content_hash: str
    event_hash: str
    extraction_conflicts: tuple[str, ...] = ()
    coverage: str | None = None

    @property
    def parse_result(self) -> dict[str, Any]:
        return {
            "version": EXTRACTION_VERSION,
            "direction": self.direction,
            "effective_at": (
                _iso_utc(self.effective_time.value) if self.effective_time else None
            ),
            "effective_precision": (
                self.effective_time.precision if self.effective_time else None
            ),
            "adjustments": [
                {
                    "fuel_type": adjustment.fuel_type,
                    "amount_centavos": adjustment.amount_centavos,
                    "confidence": adjustment.confidence,
                }
                for adjustment in self.adjustments
            ],
            "conflicts": list(self.extraction_conflicts),
        }


@dataclass(frozen=True)
class SourceState:
    etag: str | None = None
    last_modified: str | None = None
    last_success_at: str | None = None
    last_error_at: str | None = None
    last_error: str | None = None
    consecutive_failures: int = 0


@dataclass(frozen=True)
class FetchResult:
    status: int
    content: bytes | None
    etag: str | None
    last_modified: str | None
    final_url: str


@dataclass
class PollResult:
    source_key: str
    status: str
    http_status: int | None = None
    items_seen: int = 0
    candidates_seen: int = 0
    articles_written: int = 0
    events_written: int = 0
    item_errors: int = 0
    error: str | None = None

    @property
    def succeeded(self) -> bool:
        return self.status in {"success", "not_modified", "dry_run"}


@dataclass
class ImportSummary:
    sources: list[PollResult] = field(default_factory=list)

    @property
    def successful_sources(self) -> int:
        return sum(result.succeeded for result in self.sources)

    @property
    def failed_sources(self) -> int:
        return sum(not result.succeeded for result in self.sources)

    def to_dict(self) -> dict[str, Any]:
        return {
            "successful_sources": self.successful_sources,
            "failed_sources": self.failed_sources,
            "sources": [asdict(result) for result in self.sources],
        }


class FeedError(RuntimeError):
    """A bounded, source-safe feed failure."""

    def __init__(self, message: str, *, http_status: int | None = None) -> None:
        super().__init__(message)
        self.http_status = http_status


class _PlainTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._ignored_depth = 0

    def handle_starttag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        del attrs
        if tag.casefold() in {"script", "style", "noscript"}:
            self._ignored_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.casefold() in {"script", "style", "noscript"}:
            self._ignored_depth = max(0, self._ignored_depth - 1)
        elif not self._ignored_depth and tag.casefold() in {
            "p",
            "br",
            "div",
            "li",
        }:
            self.parts.append(" ")

    def handle_data(self, data: str) -> None:
        if not self._ignored_depth:
            self.parts.append(data)


def _bounded_text(value: str | None, limit: int) -> str:
    """Collapse untrusted text, remove controls, and cap it at a word boundary."""
    if not value:
        return ""
    extractor = _PlainTextExtractor()
    try:
        extractor.feed(html.unescape(value))
        extractor.close()
        value = " ".join(extractor.parts)
    except Exception:
        # Malformed feed HTML should not gain special handling. Strip tags and keep a
        # bounded plain-text fallback.
        value = re.sub(r"<[^>]{0,500}>", " ", html.unescape(value))

    cleaned = "".join(
        character
        for character in value
        if unicodedata.category(character) not in {"Cc", "Cf"}
        or character in {"\t", "\n", "\r"}
    )
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if len(cleaned) <= limit:
        return cleaned
    if limit <= 0:
        return ""
    if limit == 1:
        return "…"
    shortened = cleaned[:limit]
    boundary = shortened.rfind(" ", 0, limit - 1)
    if boundary >= max(1, limit - 80):
        shortened = shortened[:boundary]
    else:
        shortened = shortened[: limit - 1]
    return shortened.rstrip(" ,.;:-") + "…"


def _safe_error(error: object) -> str:
    text = _bounded_text(str(error), MAX_ERROR_CHARS)
    for secret_name in ("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"):
        secret = os.environ.get(secret_name, "")
        if secret:
            text = text.replace(secret, "[redacted]")
    return text or type(error).__name__


def _host_allowed(hostname: str | None, allowed_hosts: Sequence[str]) -> bool:
    host = (hostname or "").rstrip(".").casefold()
    return any(
        host == suffix.casefold() or host.endswith("." + suffix.casefold())
        for suffix in allowed_hosts
    )


def canonicalize_url(url: str | None, source: NewsSource) -> str:
    """Return a safe publisher URL with fragments and tracking parameters removed."""
    raw = _bounded_text(url, MAX_URL_CHARS)
    if not raw:
        raise ValueError("feed item has no article URL")
    parsed = urllib.parse.urlsplit(raw)
    if parsed.scheme.casefold() != "https":
        raise ValueError("article URL is not HTTPS")
    if parsed.username or parsed.password:
        raise ValueError("article URL contains user information")
    if not _host_allowed(parsed.hostname, source.allowed_hosts):
        raise ValueError("article URL host does not match publisher")
    if parsed.port not in {None, 443}:
        raise ValueError("article URL uses an unexpected port")

    host = (parsed.hostname or "").casefold()
    path = re.sub(r"/{2,}", "/", parsed.path or "/")
    if path != "/":
        path = path.rstrip("/")

    kept_query: list[tuple[str, str]] = []
    for key, value in urllib.parse.parse_qsl(
        parsed.query, keep_blank_values=True, strict_parsing=False
    ):
        folded = key.casefold()
        if folded.startswith("utm_") or folded in TRACKING_QUERY_KEYS:
            continue
        kept_query.append((key, value))
    kept_query.sort(key=lambda pair: (pair[0].casefold(), pair[1]))
    query = urllib.parse.urlencode(kept_query, doseq=True)
    canonical = urllib.parse.urlunsplit(("https", host, path, query, ""))
    if len(canonical) > MAX_URL_CHARS:
        raise ValueError("canonical article URL is too long")
    return canonical


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].casefold()


def _child_text(element: ET.Element, names: Iterable[str]) -> str | None:
    wanted = {name.casefold() for name in names}
    for child in element:
        if _local_name(child.tag) in wanted:
            text = "".join(child.itertext()).strip()
            if text:
                return text
    return None


def _item_link(element: ET.Element) -> str | None:
    # RSS normally uses element text. Atom uses href on rel=alternate.
    fallback: str | None = None
    for child in element:
        if _local_name(child.tag) != "link":
            continue
        text = "".join(child.itertext()).strip()
        if text:
            return text
        href = (child.attrib.get("href") or "").strip()
        rel = (child.attrib.get("rel") or "alternate").casefold()
        if href and rel == "alternate":
            return href
        if href and fallback is None:
            fallback = href
    return fallback


def _parse_feed_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    value = value.strip()
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError, OverflowError):
        parsed = None
    if parsed is None:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except (ValueError, OverflowError):
            return None
    try:
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=MANILA_TZ)
        return parsed.astimezone(timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def _plausible_publication_date(
    published_at: datetime | None, poll_time: datetime | None
) -> datetime | None:
    if published_at is None or poll_time is None:
        return published_at
    try:
        reference = poll_time
        if reference.tzinfo is None:
            reference = reference.replace(tzinfo=timezone.utc)
        reference = reference.astimezone(timezone.utc)
        earliest_year = max(datetime.min.year, reference.year - MAX_PAST_PUBLICATION_YEARS)
        try:
            earliest = reference.replace(year=earliest_year)
        except ValueError:
            # February 29 has no representation in every comparison year.
            earliest = reference.replace(year=earliest_year, day=28)
        if published_at > reference + MAX_FUTURE_PUBLICATION_AGE:
            return None
        if published_at < earliest:
            return None
    except (OverflowError, OSError, ValueError):
        return None
    return published_at


def parse_feed(
    xml_bytes: bytes,
    source: NewsSource,
    *,
    poll_time: datetime | None = None,
) -> list[FeedItem]:
    """Parse bounded RSS/Atom metadata without consuming full-content feed fields."""
    if len(xml_bytes) > MAX_FEED_BYTES:
        raise FeedError(f"feed exceeds {MAX_FEED_BYTES} bytes")
    lowered_prefix = xml_bytes[:4096].lower()
    if b"<!doctype" in lowered_prefix or b"<!entity" in lowered_prefix:
        raise FeedError("feed contains a disallowed document type or entity declaration")
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        raise FeedError(f"invalid XML: {_safe_error(exc)}") from exc

    item_elements = [
        element
        for element in root.iter()
        if _local_name(element.tag) in {"item", "entry"}
    ]
    items: list[FeedItem] = []
    for element in item_elements[:MAX_FEED_ITEMS]:
        headline = _bounded_text(_child_text(element, {"title"}), MAX_HEADLINE_CHARS)
        if not headline:
            continue
        try:
            canonical_url = canonicalize_url(_item_link(element), source)
        except ValueError:
            continue
        guid = _bounded_text(
            _child_text(element, {"guid", "id"}), MAX_GUID_CHARS
        ) or None
        # Intentionally ignore content:encoded/content. A short RSS description or Atom
        # summary is enough for candidate filtering and factual extraction.
        excerpt = _bounded_text(
            _child_text(element, {"description", "summary"}), MAX_EXCERPT_CHARS
        )
        published_at = _plausible_publication_date(
            _parse_feed_datetime(
                _child_text(element, {"pubdate", "published", "updated", "date"})
            ),
            poll_time,
        )
        categories: list[str] = []
        for child in element:
            if _local_name(child.tag) != "category":
                continue
            category = _bounded_text(
                (child.attrib.get("term") or "".join(child.itertext())), 80
            )
            if category and category not in categories:
                categories.append(category)
        items.append(
            FeedItem(
                guid=guid,
                canonical_url=canonical_url,
                headline=headline,
                excerpt=excerpt,
                published_at=published_at,
                categories=tuple(categories[:20]),
            )
        )
    return items


_SPECIFIC_FUEL_RE = re.compile(r"\b(?:gasoline|petrol|diesel|kerosene)\b", re.I)
_DIRECT_FUEL_PRICE_RE = re.compile(
    r"\b(?:fuel|pump|gasoline|diesel|kerosene|petrol)\s+prices?\b", re.I
)
_OIL_PRICE_RE = re.compile(r"\boil\s+prices?\b", re.I)
_PRICE_CONTEXT_RE = re.compile(
    r"(?:\bprices?\b|\bper\s+lit(?:er|re)\b|/\s*l(?:it(?:er|re))?\b|"
    r"[₱]\s*\d|(?<![A-Za-z])P(?:HP)?\s*\d)",
    re.I,
)
_LOCAL_ADJUSTMENT_RE = re.compile(
    r"\b(?:rollback|roll\s+back|hike|price\s+cut|price\s+adjustment|"
    r"increase|decrease|raise|reduce|slash|pump|per\s+lit(?:er|re)|"
    r"oil\s+(?:firms?|companies))\b",
    re.I,
)


def is_fuel_news_candidate(item: FeedItem) -> bool:
    """Conservatively retain local retail-fuel price items, not generic oil news."""
    # Headline/excerpt drive retention. Categories can carry generic tags such as
    # "oil prices" on an unrelated opinion column and therefore are not sufficient.
    text = " ".join((item.headline, item.excerpt))
    has_price_context = bool(_PRICE_CONTEXT_RE.search(text))
    if _DIRECT_FUEL_PRICE_RE.search(text):
        return has_price_context
    if _SPECIFIC_FUEL_RE.search(text):
        return has_price_context
    if _OIL_PRICE_RE.search(text):
        return bool(_LOCAL_ADJUSTMENT_RE.search(text))
    return False


FUEL_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("GASOLINE", re.compile(r"\b(?:gasoline|petrol)\b", re.I)),
    ("DIESEL", re.compile(r"\bdiesel\b", re.I)),
    ("KEROSENE", re.compile(r"\bkerosene\b", re.I)),
)

_POSITIVE_DIRECTION_RE = re.compile(
    r"\b(?:hike(?:d|s)?|increase(?:d|s)?|raise(?:d|s)?|raised|"
    r"go(?:es|ing)?\s+up|went\s+up|rise(?:s|n)?|rose|"
    r"upward\s+adjustment|add(?:ed|s)?)\b",
    re.I,
)
_NEGATIVE_DIRECTION_RE = re.compile(
    r"\b(?:rollback|roll(?:ed|s|ing)?\s+back|decrease(?:d|s)?|"
    r"reduce(?:d|s)?|cut(?:s|ting)?|slash(?:ed|es)?|drop(?:ped|s)?|"
    r"decline(?:d|s)?|fall(?:s|ing)?|fell|lower(?:ed|s)?|"
    r"go(?:es|ing)?\s+down|went\s+down|"
    r"downward\s+adjustment)\b",
    re.I,
)
_AMOUNT_RE = re.compile(
    r"(?<![A-Za-z0-9])(?:₱|PHP\.?|P)\s*"
    r"(?P<amount>\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)",
    re.I,
)
_PER_LITER_RE = re.compile(
    r"(?:\bper\s+lit(?:er|re)\b|/\s*l(?:it(?:er|re))?\b|\ba\s+liter\b)",
    re.I,
)
_HISTORICAL_TOTAL_RE = re.compile(
    r"\b(?:year[ -]to[ -]date|ytd|cumulative|cumulatively|total(?:ed|ing)?|"
    r"net\s+(?:increase|decrease)|so\s+far\s+this\s+year|since\s+(?:january|"
    r"the\s+start\s+of\s+the\s+year)|previous(?:ly)?|last\s+(?:week|month|year)|"
    r"earlier\s+(?:this\s+|in\s+the\s+)?(?:week|month|year)|to\s+date)\b",
    re.I,
)
_FORECAST_RE = re.compile(
    r"\b(?:forecast|estimated?|expected|projected|preliminary|indicative|"
    r"possible|possibly|likely|might|could|seen\s+to|anticipated?|"
    r"brace\s+for|looming)\b",
    re.I,
)
_CONFIRMED_RE = re.compile(
    r"\b(?:announc(?:e|ed|es)|implement(?:ed|s)?|effective|starting|"
    r"takes?\s+effect|will\s+(?:hike|increase|raise|roll\s+back|decrease|"
    r"reduce|cut|slash|lower)|price\s+(?:hike|rollback|cut|increase|decrease)|"
    r"rollback\s+of|(?:increase|decrease)\s+(?:of|by))\b",
    re.I,
)


@dataclass(frozen=True)
class _Mention:
    start: int
    end: int
    value: Any


def _sentences(text: str) -> list[str]:
    protected = re.sub(r"\b([ap])\.m\.", r"\1m", text, flags=re.I)
    protected = re.sub(r"\b(PHP|P)(\d+)\.(\d+)\b", r"\1\2·\3", protected)
    parts = re.split(r"(?<=[!?;])\s+|(?<=\.)\s+(?=[A-Z₱])", protected)
    return [part.replace("·", ".").strip() for part in parts if part.strip()]


def _fuel_mentions(sentence: str) -> list[_Mention]:
    mentions: list[_Mention] = []
    for fuel_type, pattern in FUEL_PATTERNS:
        mentions.extend(
            _Mention(match.start(), match.end(), fuel_type)
            for match in pattern.finditer(sentence)
        )
    return sorted(mentions, key=lambda mention: mention.start)


def _direction_mentions(sentence: str) -> list[_Mention]:
    mentions = [
        *(
            _Mention(match.start(), match.end(), 1)
            for match in _POSITIVE_DIRECTION_RE.finditer(sentence)
        ),
        *(
            _Mention(match.start(), match.end(), -1)
            for match in _NEGATIVE_DIRECTION_RE.finditer(sentence)
        ),
    ]
    return sorted(mentions, key=lambda mention: mention.start)


def _amount_mentions(sentence: str) -> list[_Mention]:
    mentions: list[_Mention] = []
    for match in _AMOUNT_RE.finditer(sentence):
        try:
            pesos = Decimal(match.group("amount").replace(",", ""))
            centavos_decimal = pesos * 100
            if centavos_decimal != centavos_decimal.to_integral_value():
                continue
            centavos = int(centavos_decimal)
        except (InvalidOperation, ValueError):
            continue
        # Retail adjustments outside this range are almost certainly a pump price,
        # cumulative total, or another unrelated monetary figure.
        if 0 < centavos <= 2_000:
            mentions.append(_Mention(match.start(), match.end(), centavos))
    return mentions


def _distance(left: _Mention, right: _Mention) -> int:
    if left.end < right.start:
        return right.start - left.end
    if right.end < left.start:
        return left.start - right.end
    return 0


def _sign_for_pair(
    fuel: _Mention, amount: _Mention, directions: Sequence[_Mention]
) -> int | None:
    if not directions:
        return None
    unique_signs = {int(direction.value) for direction in directions}
    if len(unique_signs) == 1:
        return unique_signs.pop()
    pair_start = min(fuel.start, amount.start)
    pair_end = max(fuel.end, amount.end)
    ranked = sorted(
        directions,
        key=lambda direction: (
            0 if pair_start - 30 <= direction.start <= pair_end + 30 else 1,
            min(abs(direction.end - pair_start), abs(direction.start - pair_end)),
        ),
    )
    if len(ranked) > 1:
        first_distance = min(
            abs(ranked[0].end - pair_start), abs(ranked[0].start - pair_end)
        )
        second_distance = min(
            abs(ranked[1].end - pair_start), abs(ranked[1].start - pair_end)
        )
        if first_distance == second_distance and ranked[0].value != ranked[1].value:
            return None
    return int(ranked[0].value)


def _compact_fuel_group(
    sentence: str, fuels: Sequence[_Mention], amount: _Mention
) -> list[_Mention]:
    nearby = [fuel for fuel in fuels if _distance(fuel, amount) <= 90]
    if not nearby:
        return []
    group_start = min(fuel.start for fuel in nearby)
    group_end = max(fuel.end for fuel in nearby)
    between_group = sentence[group_start:group_end]
    # Multiple fuels share one amount only when they form a compact list rather than
    # unrelated mentions elsewhere in the sentence.
    if len(nearby) > 1 and not re.fullmatch(
        r"[A-Za-z\s,&/\-]+", between_group
    ):
        nearest = min(nearby, key=lambda fuel: _distance(fuel, amount))
        return [nearest]
    return nearby


def _pairs_for_sentence(
    sentence: str,
    fuels: Sequence[_Mention],
    amounts: Sequence[_Mention],
) -> list[tuple[_Mention, _Mention]]:
    unique_fuels: list[_Mention] = []
    seen_fuels: set[str] = set()
    for fuel in fuels:
        if fuel.value not in seen_fuels:
            unique_fuels.append(fuel)
            seen_fuels.add(str(fuel.value))

    if len(amounts) == 1:
        return [
            (fuel, amounts[0])
            for fuel in _compact_fuel_group(sentence, unique_fuels, amounts[0])
        ]

    if len(unique_fuels) == len(amounts):
        # Publisher prose consistently lists corresponding fuel names and amounts in
        # the same order, both for "gasoline by P..." and "P... for gasoline" forms.
        return list(zip(unique_fuels, amounts, strict=True))

    pairs: list[tuple[_Mention, _Mention]] = []
    clauses = [
        clause
        for clause in re.split(
            r"\s*(?:;|,|\bwhile\b|\bwhereas\b|\bbut\b)\s*", sentence, flags=re.I
        )
        if clause
    ]
    offset = 0
    for clause in clauses:
        clause_start = sentence.find(clause, offset)
        if clause_start < 0:
            continue
        clause_end = clause_start + len(clause)
        offset = clause_end
        clause_fuels = [
            fuel for fuel in unique_fuels if clause_start <= fuel.start < clause_end
        ]
        clause_amounts = [
            amount for amount in amounts if clause_start <= amount.start < clause_end
        ]
        if len(clause_amounts) == 1 and clause_fuels:
            pairs.extend((fuel, clause_amounts[0]) for fuel in clause_fuels)
    return pairs


def _extract_adjustments_with_conflicts(
    text: str,
) -> tuple[tuple[FuelAdjustment, ...], tuple[str, ...]]:
    extracted: dict[str, set[int]] = {}
    for sentence in _sentences(text):
        if _HISTORICAL_TOTAL_RE.search(sentence):
            continue
        if not _PER_LITER_RE.search(sentence):
            continue
        fuels = _fuel_mentions(sentence)
        amounts = _amount_mentions(sentence)
        directions = _direction_mentions(sentence)
        if not fuels or not amounts or not directions:
            continue
        for fuel, amount in _pairs_for_sentence(sentence, fuels, amounts):
            sign = _sign_for_pair(fuel, amount, directions)
            if sign is None:
                continue
            extracted.setdefault(str(fuel.value), set()).add(sign * int(amount.value))

    conflicts = tuple(
        sorted(fuel_type for fuel_type, values in extracted.items() if len(values) > 1)
    )
    adjustments = tuple(
        FuelAdjustment(fuel_type=fuel_type, amount_centavos=next(iter(values)))
        for fuel_type, values in sorted(extracted.items())
        if len(values) == 1
    )
    return adjustments, conflicts


def extract_adjustments(text: str) -> tuple[FuelAdjustment, ...]:
    """Extract only explicit, per-liter, unambiguous current adjustments."""
    adjustments, _ = _extract_adjustments_with_conflicts(text)
    return adjustments


_MONTHS = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}
_WEEKDAYS = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}
_EFFECTIVE_CUE_RE = re.compile(
    r"\b(?:effective|starting|beginning|takes?\s+effect|implemented?|"
    r"implementation)\b",
    re.I,
)
_MONTH_DATE_RE = re.compile(
    r"\b(?P<month>Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|"
    r"Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|"
    r"Nov(?:ember)?|Dec(?:ember)?)\.?\s+"
    r"(?P<day>\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(?P<year>20\d{2}))?\b",
    re.I,
)
_WEEKDAY_RE = re.compile(
    r"\b(?P<next>next\s+)?(?P<weekday>Monday|Tuesday|Wednesday|Thursday|"
    r"Friday|Saturday|Sunday)\b",
    re.I,
)
_TIME_RE = re.compile(
    r"\b(?P<hour>\d{1,2})(?::(?P<minute>\d{2}))?\s*"
    r"(?P<meridiem>a\.?m\.?|p\.?m\.?)\b",
    re.I,
)


def _nearest_year(month: int, day: int, published_date: date) -> int:
    candidate = date(published_date.year, month, day)
    if candidate < published_date - timedelta(days=183):
        return published_date.year + 1
    if candidate > published_date + timedelta(days=183):
        return published_date.year - 1
    return published_date.year


def _parse_clock(context: str) -> tuple[datetime_time, str]:
    lowered = context.casefold()
    if re.search(r"\bmidnight\b", lowered):
        return datetime_time(0, 0), "minute"
    if re.search(r"\bnoon\b", lowered):
        return datetime_time(12, 0), "minute"
    match = _TIME_RE.search(context)
    if not match:
        return datetime_time(0, 0), "date"
    hour = int(match.group("hour"))
    minute = int(match.group("minute") or "0")
    if hour < 1 or hour > 12 or minute > 59:
        return datetime_time(0, 0), "date"
    meridiem = match.group("meridiem").casefold().replace(".", "")
    if meridiem == "pm" and hour != 12:
        hour += 12
    elif meridiem == "am" and hour == 12:
        hour = 0
    return datetime_time(hour, minute), "minute"


def extract_effective_time(
    text: str, published_at: datetime | None
) -> EffectiveTime | None:
    """Extract a cue-bound effective date and local time in Asia/Manila."""
    if published_at is None:
        return None
    local_published = published_at.astimezone(MANILA_TZ)
    for cue in _EFFECTIVE_CUE_RE.finditer(text):
        context_start = max(0, cue.start() - 60)
        context_end = min(len(text), cue.end() + 180)
        context = text[context_start:context_end]

        date_value: date | None = None
        month_match = _MONTH_DATE_RE.search(context)
        if month_match:
            month_key = month_match.group("month").casefold().rstrip(".")
            month = _MONTHS[month_key]
            day = int(month_match.group("day"))
            year = (
                int(month_match.group("year"))
                if month_match.group("year")
                else _nearest_year(month, day, local_published.date())
            )
            try:
                date_value = date(year, month, day)
            except ValueError:
                continue
        elif re.search(r"\btomorrow\b", context, re.I):
            date_value = local_published.date() + timedelta(days=1)
        else:
            weekday_match = _WEEKDAY_RE.search(context)
            if weekday_match:
                target = _WEEKDAYS[weekday_match.group("weekday").casefold()]
                days_ahead = (target - local_published.weekday()) % 7
                if weekday_match.group("next") and days_ahead == 0:
                    days_ahead = 7
                date_value = local_published.date() + timedelta(days=days_ahead)

        if date_value is None:
            continue
        clock, precision = _parse_clock(context)
        effective = datetime.combine(date_value, clock, tzinfo=MANILA_TZ)
        return EffectiveTime(value=effective, precision=precision)
    return None


def classify_article(text: str, adjustments: Sequence[FuelAdjustment]) -> str:
    if _FORECAST_RE.search(text):
        return "forecast"
    if _CONFIRMED_RE.search(text) or adjustments:
        return "confirmed"
    return "news_update"


def _direction_from(
    text: str, adjustments: Sequence[FuelAdjustment], classification: str
) -> str:
    signs = {1 if adjustment.amount_centavos > 0 else -1 for adjustment in adjustments}
    if not signs and classification != "news_update":
        signs = {int(mention.value) for mention in _direction_mentions(text)}
    if signs == {1}:
        return "hike"
    if signs == {-1}:
        return "rollback"
    if signs == {1, -1}:
        return "mixed"
    return "news_update"


def _sha256(*parts: str) -> str:
    canonical = "\x1f".join(parts).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def article_dedup_hash(source: NewsSource, item: FeedItem) -> str:
    # Canonical URL is preferred over GUID because several RSS engines regenerate GUIDs
    # while retaining the same article URL.
    identity = item.canonical_url or item.guid or item.headline.casefold()
    return _sha256("article-v1", source.key, identity)


def article_content_hash(source: NewsSource, item: FeedItem) -> str:
    return _sha256(
        "content-v1",
        source.key,
        item.canonical_url,
        item.headline.casefold(),
        item.excerpt.casefold(),
    )


def _iso_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def event_dedup_hash(
    classification: str,
    effective_time: EffectiveTime | None,
    adjustments: Sequence[FuelAdjustment],
    article_hash: str,
) -> str:
    """Group only exact, confirmed event facts; keep every other event article-local."""
    if classification == "confirmed" and effective_time and adjustments:
        adjustment_facts = ",".join(
            f"{item.fuel_type}:{item.amount_centavos}"
            for item in sorted(adjustments, key=lambda item: item.fuel_type)
        )
        return _sha256(
            "confirmed-event-v1",
            _iso_utc(effective_time.value),
            effective_time.precision,
            adjustment_facts,
        )
    return _sha256("article-event-v1", article_hash)


def parse_article(
    source: NewsSource,
    item: FeedItem,
    *,
    fetched_at: datetime | None = None,
) -> ParsedArticle:
    fetched_at = fetched_at or datetime.now(timezone.utc)
    text = f"{item.headline}. {item.excerpt}".strip()
    adjustments, conflicts = _extract_adjustments_with_conflicts(text)
    classification = classify_article(text, adjustments)
    effective_time = extract_effective_time(text, item.published_at)
    direction = _direction_from(text, adjustments, classification)
    if conflicts:
        parse_status = "conflict"
    elif adjustments:
        parse_status = "structured"
    else:
        parse_status = "unstructured"
    dedup_hash = article_dedup_hash(source, item)
    return ParsedArticle(
        source=source,
        item=item,
        fetched_at=fetched_at,
        classification=classification,
        parse_status=parse_status,
        direction=direction,
        adjustments=adjustments,
        effective_time=effective_time,
        dedup_hash=dedup_hash,
        content_hash=article_content_hash(source, item),
        event_hash=event_dedup_hash(
            classification, effective_time, adjustments, dedup_hash
        ),
        extraction_conflicts=conflicts,
    )


def _safe_header(value: str | None) -> str | None:
    if not value or "\r" in value or "\n" in value:
        return None
    return value.strip()[:500] or None


def request_headers(state: SourceState | None = None) -> dict[str, str]:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9",
        "Accept-Language": "en-PH,en;q=0.8",
    }
    state = state or SourceState()
    etag = _safe_header(state.etag)
    modified = _safe_header(state.last_modified)
    if etag:
        headers["If-None-Match"] = etag
    if modified:
        headers["If-Modified-Since"] = modified
    return headers


def _retry_delay(headers: Any, attempt: int) -> float:
    retry_after = _safe_header(headers.get("Retry-After") if headers else None)
    if retry_after and retry_after.isdigit():
        return min(float(retry_after), 10.0)
    return float(min(2 ** (attempt - 1), 4))


class _RejectRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Turn every redirect into a terminal error before urllib issues another request."""

    def redirect_request(
        self,
        req: urllib.request.Request,
        fp: Any,
        code: int,
        msg: str,
        headers: Any,
        newurl: str,
    ) -> urllib.request.Request | None:
        del req, fp, msg, headers, newurl
        raise FeedError("feed redirects are not allowed", http_status=code)


def _validate_feed_url(
    url: str,
    source: NewsSource,
    *,
    resolve: bool,
    resolver: Callable[..., Any] = socket.getaddrinfo,
) -> urllib.parse.SplitResult:
    if not isinstance(url, str):
        raise FeedError("feed URL is malformed")
    try:
        parsed = urllib.parse.urlsplit(url)
        port = parsed.port
        hostname = parsed.hostname
    except (TypeError, ValueError) as exc:
        raise FeedError("feed URL is malformed") from exc
    if parsed.scheme.casefold() != "https":
        raise FeedError("feed URL is not HTTPS")
    if parsed.username is not None or parsed.password is not None:
        raise FeedError("feed URL contains user information")
    if port not in {None, 443}:
        raise FeedError("feed URL uses an unexpected port")
    if not hostname or not _host_allowed(hostname, source.allowed_hosts):
        raise FeedError("feed URL host does not match its approved publisher")
    if parsed.fragment:
        raise FeedError("feed URL contains a fragment")

    if resolve:
        try:
            answers = resolver(
                hostname,
                443,
                type=socket.SOCK_STREAM,
            )
        except (OSError, socket.gaierror) as exc:
            raise FeedError("feed host could not be resolved") from exc
        addresses: set[str] = set()
        for answer in answers:
            try:
                addresses.add(str(answer[4][0]))
            except (IndexError, TypeError):
                continue
        if not addresses:
            raise FeedError("feed host resolved to no addresses")
        for address in addresses:
            try:
                ip = ipaddress.ip_address(address.split("%", 1)[0])
            except ValueError as exc:
                raise FeedError("feed host resolved to an invalid address") from exc
            if (
                ip.is_private
                or ip.is_loopback
                or ip.is_link_local
                or ip.is_reserved
                or ip.is_multicast
                or ip.is_unspecified
                or not ip.is_global
            ):
                raise FeedError("feed host resolved to a non-public address")
    return parsed


def _validate_approved_source(source: NewsSource) -> None:
    approved = SOURCE_BY_KEY.get(source.key)
    if approved is None or source != approved:
        raise FeedError("production fetch is limited to fixed approved feed URLs")


def fetch_feed(
    source: NewsSource,
    state: SourceState | None = None,
    *,
    opener: Callable[..., Any] | None = None,
    resolver: Callable[..., Any] = socket.getaddrinfo,
    sleep: Callable[[float], None] = time.sleep,
) -> FetchResult:
    """Fetch one fixed feed with SSRF checks, no redirects, and bounded retries."""
    production_call = opener is None
    if production_call:
        _validate_approved_source(source)
        resolver = socket.getaddrinfo
    _validate_feed_url(
        source.feed_url,
        source,
        resolve=production_call,
        resolver=resolver,
    )
    if opener is None:
        opener = urllib.request.build_opener(_RejectRedirectHandler()).open

    request = urllib.request.Request(
        source.feed_url, headers=request_headers(state), method="GET"
    )
    state = state or SourceState()
    last_error: BaseException | None = None
    for attempt in range(1, MAX_FETCH_ATTEMPTS + 1):
        try:
            with opener(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
                status = int(getattr(response, "status", response.getcode()))
                final_url = response.geturl()
                _validate_feed_url(
                    final_url,
                    source,
                    resolve=production_call,
                    resolver=resolver,
                )
                if final_url != source.feed_url:
                    raise FeedError(
                        "feed response URL differs from its fixed configured URL",
                        http_status=status,
                    )
                if 300 <= status < 400 and status != 304:
                    raise FeedError("feed redirects are not allowed", http_status=status)
                if status == 304:
                    return FetchResult(
                        status=304,
                        content=None,
                        etag=_safe_header(response.headers.get("ETag")) or state.etag,
                        last_modified=(
                            _safe_header(response.headers.get("Last-Modified"))
                            or state.last_modified
                        ),
                        final_url=final_url,
                    )
                if status != 200:
                    raise FeedError(
                        f"unexpected HTTP status {status}", http_status=status
                    )
                content_type = (
                    response.headers.get("Content-Type") or ""
                ).casefold()
                content = response.read(MAX_FEED_BYTES + 1)
                if len(content) > MAX_FEED_BYTES:
                    raise FeedError(
                        f"feed exceeds {MAX_FEED_BYTES} bytes", http_status=status
                    )
                prefix = content[:1024].lstrip().lower()
                if b"<html" in prefix or "text/html" in content_type:
                    raise FeedError(
                        "feed endpoint returned HTML instead of RSS/Atom",
                        http_status=status,
                    )
                return FetchResult(
                    status=status,
                    content=content,
                    etag=_safe_header(response.headers.get("ETag")),
                    last_modified=_safe_header(response.headers.get("Last-Modified")),
                    final_url=final_url,
                )
        except urllib.error.HTTPError as exc:
            if exc.code == 304:
                return FetchResult(
                    status=304,
                    content=None,
                    etag=_safe_header(exc.headers.get("ETag")) or state.etag,
                    last_modified=(
                        _safe_header(exc.headers.get("Last-Modified"))
                        or state.last_modified
                    ),
                    final_url=source.feed_url,
                )
            last_error = exc
            if 300 <= exc.code < 400:
                raise FeedError(
                    "feed redirects are not allowed", http_status=exc.code
                ) from exc
            if exc.code not in TRANSIENT_HTTP_STATUSES or attempt == MAX_FETCH_ATTEMPTS:
                raise FeedError(
                    f"feed returned HTTP {exc.code}", http_status=exc.code
                ) from exc
            sleep(_retry_delay(exc.headers, attempt))
        except (urllib.error.URLError, TimeoutError, socket.timeout) as exc:
            last_error = exc
            if attempt == MAX_FETCH_ATTEMPTS:
                raise FeedError("feed request timed out or was unavailable") from exc
            sleep(float(min(2 ** (attempt - 1), 4)))
        except FeedError:
            raise
    raise FeedError(f"feed fetch failed: {_safe_error(last_error or 'unknown error')}")


class _PostgrestClient:
    """Minimal authenticated PostgREST client for the dependency-free import command."""

    def __init__(
        self,
        url: str,
        key: str,
        *,
        opener: Callable[..., Any] | None = None,
    ) -> None:
        base_url = url.rstrip("/")
        try:
            base = urllib.parse.urlsplit(base_url)
            port = base.port
            hostname = base.hostname
        except ValueError as exc:
            raise RuntimeError("SUPABASE_URL is malformed") from exc
        if base.scheme.casefold() != "https" or not hostname:
            raise RuntimeError("SUPABASE_URL must be an HTTPS origin")
        if base.username is not None or base.password is not None or port not in {
            None,
            443,
        }:
            raise RuntimeError("SUPABASE_URL contains unsupported authority data")
        if base.path not in {"", "/"}:
            raise RuntimeError("SUPABASE_URL must not contain a path")
        if base.query or base.fragment:
            raise RuntimeError("SUPABASE_URL must not contain a query or fragment")
        self.origin = urllib.parse.urlunsplit(
            ("https", base.netloc.casefold(), "", "", "")
        )
        self.rest_url = self.origin + "/rest/v1"
        self.key = key
        self.opener = opener or urllib.request.build_opener(_RejectRedirectHandler()).open

    def request(
        self,
        method: str,
        path: str,
        *,
        query: Sequence[tuple[str, str]] = (),
        payload: Any | None = None,
        prefer: str | None = None,
    ) -> Any:
        url = self.rest_url + "/" + path.lstrip("/")
        if query:
            url += "?" + urllib.parse.urlencode(query, safe="*,()")
        body = None
        headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        }
        if payload is not None:
            body = json.dumps(
                payload,
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if prefer:
            headers["Prefer"] = prefer
        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with self.opener(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
                try:
                    final = urllib.parse.urlsplit(response.geturl())
                    final_port = final.port
                except (TypeError, ValueError) as exc:
                    raise RuntimeError("Supabase response URL is malformed") from exc
                final_origin = urllib.parse.urlunsplit(
                    (
                        final.scheme.casefold(),
                        final.netloc.casefold(),
                        "",
                        "",
                        "",
                    )
                )
                if (
                    final_origin != self.origin
                    or final.username is not None
                    or final.password is not None
                    or final_port not in {None, 443}
                ):
                    raise RuntimeError("Supabase response left its configured HTTPS origin")
                raw = response.read(MAX_API_RESPONSE_BYTES + 1)
                if len(raw) > MAX_API_RESPONSE_BYTES:
                    raise RuntimeError("Supabase response exceeded its size limit")
        except urllib.error.HTTPError as exc:
            if 300 <= exc.code < 400:
                raise RuntimeError("Supabase redirects are not allowed") from exc
            detail = ""
            try:
                detail = _safe_error(
                    exc.read(MAX_ERROR_CHARS).decode("utf-8", errors="replace")
                )
            except Exception:
                pass
            message = f"Supabase request failed with HTTP {exc.code}"
            if detail:
                message += f": {detail}"
            raise RuntimeError(message) from exc
        except (urllib.error.URLError, TimeoutError, socket.timeout) as exc:
            raise RuntimeError("Supabase request timed out or was unavailable") from exc
        if not raw:
            return None
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RuntimeError("Supabase returned invalid JSON") from exc


class SupabaseNewsRepository:
    """Dependency-free PostgREST repository for fuel-news writes and source state."""

    def __init__(
        self,
        client: Any | None = None,
        *,
        url: str | None = None,
        key: str | None = None,
        opener: Callable[..., Any] | None = None,
    ) -> None:
        if client is not None:
            self.client = client
            return
        url = (url if url is not None else os.environ.get("SUPABASE_URL", "")).strip()
        key = (
            key
            if key is not None
            else os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        ).strip()
        if not url or not key:
            raise RuntimeError(
                "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for fuel-news import"
            )
        self.client = _PostgrestClient(url, key, opener=opener)

    def _request(self, *args: Any, **kwargs: Any) -> Any:
        request = getattr(self.client, "request", None)
        if callable(request):
            return request(*args, **kwargs)
        rpc = getattr(self.client, "rpc", None)
        if callable(rpc) and len(args) >= 2 and str(args[1]).startswith("rpc/"):
            if args[0] != "POST" or "payload" not in kwargs:
                raise TypeError("injected RPC clients support POST payloads only")
            response = rpc(str(args[1]).removeprefix("rpc/"), kwargs["payload"]).execute()
            return response.data if response else None
        raise TypeError("repository client must provide request()")

    def get_source_state(self, source_key: str) -> SourceState:
        rows = self._request(
            "GET",
            "fuel_news_source_state",
            query=(
                (
                    "select",
                    "etag,last_modified,last_success_at,last_error_at,last_error,"
                    "consecutive_failures",
                ),
                ("source_key", f"eq.{source_key}"),
                ("limit", "1"),
            ),
        )
        row = rows[0] if isinstance(rows, list) and rows else None
        if not isinstance(row, dict):
            return SourceState()
        return SourceState(
            etag=_safe_header(row.get("etag")),
            last_modified=_safe_header(row.get("last_modified")),
            last_success_at=row.get("last_success_at"),
            last_error_at=row.get("last_error_at"),
            last_error=row.get("last_error"),
            consecutive_failures=max(0, int(row.get("consecutive_failures") or 0)),
        )

    def write_article(self, parsed: ParsedArticle) -> tuple[str, str]:
        item = parsed.item
        article_payload = {
            "source_key": parsed.source.key,
            "publisher": parsed.source.publisher,
            "source_guid": item.guid,
            "canonical_url": item.canonical_url,
            "headline": item.headline,
            "excerpt": item.excerpt or None,
            "published_at": _iso_utc(item.published_at) if item.published_at else None,
            "fetched_at": _iso_utc(parsed.fetched_at),
            "classification": parsed.classification,
            "parse_status": parsed.parse_status,
            "is_feed_visible": True,
            "dedup_hash": parsed.dedup_hash,
            "content_hash": parsed.content_hash,
            "parse_result": parsed.parse_result,
        }
        event_payload = {
            "event_hash": parsed.event_hash,
            "classification": parsed.classification,
            "direction": parsed.direction,
            "effective_at": (
                _iso_utc(parsed.effective_time.value)
                if parsed.effective_time
                else None
            ),
            "effective_timezone": "Asia/Manila",
            "effective_precision": (
                parsed.effective_time.precision if parsed.effective_time else None
            ),
            "coverage": parsed.coverage,
            "summary": None,
            "confidence": "high" if parsed.adjustments else "low",
            "parse_status": parsed.parse_status,
            "discrepancy": bool(parsed.extraction_conflicts),
            "published_at": (
                _iso_utc(item.published_at) if item.published_at else None
            ),
            "last_seen_at": _iso_utc(parsed.fetched_at),
        }
        adjustment_payloads = [
            {
                "fuel_type": adjustment.fuel_type,
                "amount_centavos": adjustment.amount_centavos,
                "confidence": adjustment.confidence,
            }
            for adjustment in parsed.adjustments
        ]
        rows = self._request(
            "POST",
            "rpc/import_fuel_news_article",
            payload={
                "article_payload": article_payload,
                "event_payload": event_payload,
                "adjustment_payloads": adjustment_payloads,
            },
        )
        row = rows[0] if isinstance(rows, list) and rows else rows
        if not isinstance(row, dict) or not row.get("article_id") or not row.get(
            "event_id"
        ):
            raise RuntimeError("fuel-news import RPC did not return article/event ids")
        return str(row["article_id"]), str(row["event_id"])

    def record_poll(
        self,
        source: NewsSource,
        *,
        prior_state: SourceState,
        status: str,
        polled_at: datetime,
        http_status: int | None,
        etag: str | None,
        last_modified: str | None,
        items_seen: int,
        candidates_seen: int,
        articles_written: int,
        events_written: int,
        error_message: str | None = None,
        successful: bool = False,
    ) -> None:
        # The migration trigger advances failures and resets successes. Supplying the
        # prior value keeps INSERT semantics valid without double-incrementing UPDATEs.
        payload: dict[str, Any] = {
            "source_key": source.key,
            "publisher": source.publisher,
            "feed_url": source.feed_url,
            "last_polled_at": _iso_utc(polled_at),
            "status": status,
            "http_status": http_status,
            "error_message": error_message,
            "last_error": error_message if error_message else prior_state.last_error,
            "last_error_at": (
                _iso_utc(polled_at) if error_message else prior_state.last_error_at
            ),
            "consecutive_failures": prior_state.consecutive_failures,
            "items_seen": items_seen,
            "candidates_seen": candidates_seen,
            "articles_written": articles_written,
            "events_written": events_written,
        }
        if etag is not None:
            payload["etag"] = etag
        if last_modified is not None:
            payload["last_modified"] = last_modified
        if successful:
            payload["last_success_at"] = _iso_utc(polled_at)
        elif prior_state.last_success_at is not None:
            payload["last_success_at"] = prior_state.last_success_at
        self._request(
            "POST",
            "fuel_news_source_state",
            query=(("on_conflict", "source_key"),),
            payload=payload,
            prefer="resolution=merge-duplicates,return=minimal,missing=default",
        )


def _poll_source(
    source: NewsSource,
    *,
    repository: SupabaseNewsRepository | None,
    state: SourceState,
    dry_run: bool,
    fetcher: Callable[[NewsSource, SourceState | None], FetchResult],
    now: datetime,
    max_items: int,
) -> PollResult:
    result = PollResult(source_key=source.key, status="error")
    fetched = fetcher(source, state)
    result.http_status = fetched.status
    if fetched.status not in {200, 304}:
        raise FeedError(
            f"fetcher returned unexpected HTTP status {fetched.status}",
            http_status=fetched.status,
        )
    fetched_etag = fetched.etag or state.etag
    fetched_last_modified = fetched.last_modified or state.last_modified

    if fetched.status == 304:
        result.status = "not_modified" if not dry_run else "dry_run"
        if not dry_run:
            repository.record_poll(  # type: ignore[union-attr]
                source,
                prior_state=state,
                status="not_modified",
                polled_at=now,
                http_status=304,
                etag=fetched_etag,
                last_modified=fetched_last_modified,
                items_seen=0,
                candidates_seen=0,
                articles_written=0,
                events_written=0,
                successful=True,
            )
        return result

    items = parse_feed(fetched.content or b"", source, poll_time=now)
    result.items_seen = len(items)
    candidates = [item for item in items if is_fuel_news_candidate(item)][:max_items]
    result.candidates_seen = len(candidates)

    for item in candidates:
        try:
            parsed = parse_article(source, item, fetched_at=now)
            if not dry_run:
                repository.write_article(parsed)  # type: ignore[union-attr]
                result.articles_written += 1
                result.events_written += 1
        except Exception as exc:  # noqa: BLE001 - one bad item must not block its feed
            result.item_errors += 1
            LOGGER.warning(
                "source=%s item_write=failed error=%s",
                source.key,
                _safe_error(exc),
            )

    if dry_run:
        result.status = "dry_run"
        return result

    result.status = "partial" if result.item_errors else "success"
    checkpoint_etag = state.etag if result.item_errors else fetched_etag
    checkpoint_last_modified = (
        state.last_modified if result.item_errors else fetched_last_modified
    )
    repository.record_poll(  # type: ignore[union-attr]
        source,
        prior_state=state,
        status=result.status,
        polled_at=now,
        http_status=fetched.status,
        etag=checkpoint_etag,
        last_modified=checkpoint_last_modified,
        items_seen=result.items_seen,
        candidates_seen=result.candidates_seen,
        articles_written=result.articles_written,
        events_written=result.events_written,
        error_message=(
            f"{result.item_errors} candidate item(s) failed" if result.item_errors else None
        ),
        successful=not result.item_errors,
    )
    return result


def import_fuel_news(
    *,
    sources: Sequence[NewsSource] = SOURCES,
    repository: SupabaseNewsRepository | None = None,
    dry_run: bool = False,
    fetcher: Callable[[NewsSource, SourceState | None], FetchResult] = fetch_feed,
    now: datetime | None = None,
    max_items: int = 100,
) -> ImportSummary:
    """Poll sources independently and return bounded operational summaries."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    if not dry_run and repository is None:
        repository = SupabaseNewsRepository()

    summary = ImportSummary()
    for source in sources:
        LOGGER.info("source=%s fetch=start", source.key)
        state = SourceState()
        try:
            if not dry_run:
                state = repository.get_source_state(source.key)  # type: ignore[union-attr]
            result = _poll_source(
                source,
                repository=repository,
                state=state,
                dry_run=dry_run,
                fetcher=fetcher,
                now=now,
                max_items=max_items,
            )
        except Exception as exc:  # noqa: BLE001 - sources are intentionally isolated
            http_status = exc.http_status if isinstance(exc, FeedError) else None
            error_message = _safe_error(exc)
            result = PollResult(
                source_key=source.key,
                status="error",
                http_status=http_status,
                error=error_message,
            )
            if not dry_run and repository is not None:
                try:
                    repository.record_poll(
                        source,
                        prior_state=state,
                        status="error",
                        polled_at=now,
                        http_status=http_status,
                        etag=state.etag,
                        last_modified=state.last_modified,
                        items_seen=0,
                        candidates_seen=0,
                        articles_written=0,
                        events_written=0,
                        error_message=error_message,
                        successful=False,
                    )
                except Exception as state_exc:  # noqa: BLE001 - preserve root failure
                    LOGGER.warning(
                        "source=%s state_write=failed error=%s",
                        source.key,
                        _safe_error(state_exc),
                    )
        summary.sources.append(result)
        LOGGER.info(
            "source=%s status=%s http=%s items=%d candidates=%d articles=%d "
            "events=%d item_errors=%d",
            result.source_key,
            result.status,
            result.http_status if result.http_status is not None else "-",
            result.items_seen,
            result.candidates_seen,
            result.articles_written,
            result.events_written,
            result.item_errors,
        )
    return summary


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Poll approved publisher RSS feeds and import fuel news to Supabase"
    )
    parser.add_argument(
        "--source",
        action="append",
        choices=tuple(SOURCE_BY_KEY),
        help="Poll only this source (repeatable); default: all approved feeds",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and parse feeds without reading or writing Supabase",
    )
    parser.add_argument(
        "--max-items",
        type=int,
        default=100,
        help="Maximum retained candidates per source (default: 100)",
    )
    parser.add_argument(
        "--log-level",
        choices=("DEBUG", "INFO", "WARNING", "ERROR"),
        default="INFO",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not 1 <= args.max_items <= MAX_FEED_ITEMS:
        raise SystemExit(f"--max-items must be between 1 and {MAX_FEED_ITEMS}")
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    selected_sources = (
        tuple(SOURCE_BY_KEY[key] for key in dict.fromkeys(args.source))
        if args.source
        else SOURCES
    )
    try:
        summary = import_fuel_news(
            sources=selected_sources,
            dry_run=args.dry_run,
            max_items=args.max_items,
        )
    except Exception as exc:  # credentials/client setup failure before source isolation
        LOGGER.error("import_setup=failed error=%s", _safe_error(exc))
        return 1
    print(json.dumps(summary.to_dict(), indent=2, sort_keys=True))
    # Partial upstream outages do not block healthy sources. A run fails only when no
    # selected source completed, leaving per-source status in Supabase for diagnosis.
    return 0 if summary.successful_sources else 1


if __name__ == "__main__":
    sys.exit(main())
