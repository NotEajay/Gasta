"""Fetch DOE pages and download price monitoring PDFs."""

from __future__ import annotations

import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from .constants import (
    DOE_CMS_GUEST_BASE,
    HTTP_MAX_RETRIES,
    HTTP_TIMEOUT_SECONDS,
    HTTP_USER_AGENT,
    NCR_PDF_URL_TEMPLATE,
    REGION_CODES,
)

# CloudFront / Payload media GETs are rejected more often without a site Referer.
# Accept mirrors a browser PDF navigation; neither alone unlocks every object, but
# both are required for some CDN edge rules.
_HTTP_HEADERS = {
    "User-Agent": HTTP_USER_AGENT,
    "Accept": "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
    "Referer": "https://doe.gov.ph/",
}

# Permanent / access failures: retrying wastes the weekly job budget.
_NON_RETRYABLE_HTTP = frozenset({403, 404, 410})


def _request(url: str) -> urllib.request.Request:
    return urllib.request.Request(url, headers=dict(_HTTP_HEADERS))


def read_url_bytes(url: str, *, retries: int = HTTP_MAX_RETRIES) -> bytes:
    """GET a URL, retrying transient failures with a short backoff."""
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(_request(url), timeout=HTTP_TIMEOUT_SECONDS) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            if exc.code in _NON_RETRYABLE_HTTP:
                raise
            last_error = exc
        except (urllib.error.URLError, TimeoutError) as exc:
            last_error = exc
        if attempt < retries - 1:
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Failed to fetch {url} after {retries} attempts: {last_error}")


def _is_inaccessible(exc: BaseException) -> bool:
    """True when DOE refused or removed a single PDF (skip siblings; do not abort)."""
    if isinstance(exc, urllib.error.HTTPError):
        return exc.code in _NON_RETRYABLE_HTTP
    if isinstance(exc, RuntimeError):
        text = str(exc)
        return any(token in text for token in ("403", "404", "410", "Forbidden", "Not Found"))
    return False


def read_url_text(url: str) -> str:
    return read_url_bytes(url).decode("utf-8", errors="replace")


def pdf_exists(url: str) -> bool:
    """True when a CMS guest URL serves an actual PDF rather than a 404 page."""
    try:
        with urllib.request.urlopen(_request(url), timeout=HTTP_TIMEOUT_SECONDS) as response:
            content_type = response.headers.get("Content-Type", "").lower()
            return response.status == 200 and "pdf" in content_type
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
        return False


def slug_to_url(slug: str) -> str:
    return DOE_CMS_GUEST_BASE + slug


def ncr_pdf_url(week_start: date) -> str:
    mmddyyyy = week_start.strftime("%m%d%Y")
    return NCR_PDF_URL_TEMPLATE.format(mmddyyyy=mmddyyyy)


def download_pdf(url: str, dest: Path, *, overwrite: bool = False) -> Path:
    """Download a PDF, reusing an existing local copy unless `overwrite` is set."""
    if dest.exists() and dest.stat().st_size > 0 and not overwrite:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    payload = read_url_bytes(url)
    if not payload.startswith(b"%PDF"):
        raise RuntimeError(f"{url} did not return a PDF (got {len(payload)} bytes of other data)")
    dest.write_bytes(payload)
    return dest


# Long enough for every DOE slug seen so far, short enough to stay well inside the
# 255-character filename limit once the region prefix and extension are added.
MAX_SLUG_CHARS = 150


def slug_filename(region_code: str, slug: str) -> str:
    """Local filename for a CMS slug, keeping the slug intact.

    The whole slug is preserved because it identifies the bulletin: the date, the
    sub-region, and DOE's sequence counter can each sit at either end of the name, and
    the parser falls back to reading the week from this filename.
    """
    prefix = region_code.lower().replace("_", "-")
    short = slug.split("/")[-1]
    if short.endswith("-pdf"):
        short = short[: -len("-pdf")]
    if len(short) > MAX_SLUG_CHARS:
        # Keep both ends so the name stays recognisable, and mark the cut so two
        # different slugs cannot collapse onto the same file.
        head, tail = short[: MAX_SLUG_CHARS - 40], short[-36:]
        short = f"{head}-x{len(short)}-{tail}"
    return f"{prefix}-{short}.pdf"


def download_slug(region_code: str, slug: str, dest_dir: str | Path, url: str | None = None) -> Path:
    """Download one bulletin.

    `url` is the link discovery actually found. It is required for DOE's media-API
    documents, where reconstructing a legacy CMS guest URL from the filename 404s.
    """
    dest = Path(dest_dir) / slug_filename(region_code, slug)
    return download_pdf(url or slug_to_url(slug), dest)


def download_ncr_bulletin(week_start: date, dest_dir: str | Path) -> Path:
    dest = Path(dest_dir) / f"ncr-{week_start.isoformat()}.pdf"
    return download_pdf(ncr_pdf_url(week_start), dest)


@dataclass(frozen=True)
class SkippedDownload:
    """One PDF the CDN refused; kept so weekly sync can queue a daily retry."""

    slug: str
    url: str
    error: str

    def note(self) -> str:
        return f"{self.slug} ({self.error})"


@dataclass
class RegionDownloadResult:
    """Paths that downloaded, aligned source URLs, and per-slug skip notes."""

    paths: list[Path] = field(default_factory=list)
    urls: list[str] = field(default_factory=list)
    skipped: list[SkippedDownload] = field(default_factory=list)

    def __iter__(self):
        # Back-compat for callers that still unpack `for path in download_region_bulletins(...)`.
        return iter(self.paths)

    @property
    def skip_notes(self) -> list[str]:
        return [item.note() for item in self.skipped]


def download_region_bulletins(
    region_key: str,
    slugs: tuple[str, ...],
    dest_dir: str | Path,
    urls: tuple[str | None, ...] = (),
) -> RegionDownloadResult:
    """Download every bulletin PDF that makes up one macro-region week.

    `urls` is parallel to `slugs`; a None entry falls back to the legacy CMS guest
    URL built from that slug.

    South Luzon publishes three undated sub-region media files under one week
    heading. DOE sometimes leaves one object (e.g. Region V Bicol.pdf) on a
    403 while the siblings are public. Skipping the blocked file still loads
    Calabarzon/Mimaropa instead of failing the whole macro-region.
    """
    region_code = normalize_region(region_key)
    result = RegionDownloadResult()
    for index, slug in enumerate(slugs):
        url = urls[index] if index < len(urls) else None
        resolved = url or slug_to_url(slug)
        try:
            path = download_slug(region_code, slug, dest_dir, url)
        except (urllib.error.HTTPError, RuntimeError) as exc:
            if _is_inaccessible(exc):
                result.skipped.append(
                    SkippedDownload(slug=slug, url=resolved, error=str(exc))
                )
                continue
            raise
        result.paths.append(path)
        result.urls.append(resolved)

    if not result.paths and not result.skipped:
        detail = "; ".join(result.skip_notes) if result.skipped else "no slugs"
        raise RuntimeError(
            f"Failed to download any bulletin PDF for {region_code}: {detail}"
        )
    return result


def normalize_region(region: str) -> str:
    key = region.strip().lower().replace(" ", "_").replace("-", "_")
    if key not in REGION_CODES:
        raise ValueError(f"Unknown region '{region}'. Expected one of: {', '.join(REGION_CODES)}")
    return REGION_CODES[key]
