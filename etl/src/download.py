"""Fetch DOE pages and download price monitoring PDFs."""

from __future__ import annotations

import time
import urllib.error
import urllib.request
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


def _request(url: str) -> urllib.request.Request:
    return urllib.request.Request(url, headers={"User-Agent": HTTP_USER_AGENT})


def read_url_bytes(url: str, *, retries: int = HTTP_MAX_RETRIES) -> bytes:
    """GET a URL, retrying transient failures with a short backoff."""
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(_request(url), timeout=HTTP_TIMEOUT_SECONDS) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            if exc.code in (404, 410):
                raise
            last_error = exc
        except (urllib.error.URLError, TimeoutError) as exc:
            last_error = exc
        if attempt < retries - 1:
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Failed to fetch {url} after {retries} attempts: {last_error}")


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


def download_slug(region_code: str, slug: str, dest_dir: str | Path) -> Path:
    dest = Path(dest_dir) / slug_filename(region_code, slug)
    return download_pdf(slug_to_url(slug), dest)


def download_ncr_bulletin(week_start: date, dest_dir: str | Path) -> Path:
    dest = Path(dest_dir) / f"ncr-{week_start.isoformat()}.pdf"
    return download_pdf(ncr_pdf_url(week_start), dest)


def download_region_bulletins(
    region_key: str,
    slugs: tuple[str, ...],
    dest_dir: str | Path,
) -> list[Path]:
    """Download every CMS guest slug that makes up one macro-region bulletin week."""
    region_code = normalize_region(region_key)
    return [download_slug(region_code, slug, dest_dir) for slug in slugs]


def normalize_region(region: str) -> str:
    key = region.strip().lower().replace(" ", "_").replace("-", "_")
    if key not in REGION_CODES:
        raise ValueError(f"Unknown region '{region}'. Expected one of: {', '.join(REGION_CODES)}")
    return REGION_CODES[key]
