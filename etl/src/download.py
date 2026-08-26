"""Download DOE price monitoring PDFs."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import urllib.request

from .constants import DOE_CMS_GUEST_BASE, NCR_PDF_URL_TEMPLATE, REGION_CODES


def slug_to_url(slug: str) -> str:
    return DOE_CMS_GUEST_BASE + slug


def ncr_pdf_url(week_start: date) -> str:
    mmddyyyy = week_start.strftime("%m%d%Y")
    return NCR_PDF_URL_TEMPLATE.format(mmddyyyy=mmddyyyy)


def download_pdf(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(url, dest)
    return dest


def download_slug(slug: str, dest_dir: str | Path) -> Path:
    dest_dir = Path(dest_dir)
    filename = slug.replace("/", "-") + ".pdf" if not slug.endswith(".pdf") else slug
    if not filename.endswith(".pdf"):
        filename += ".pdf"
    dest = dest_dir / filename
    return download_pdf(slug_to_url(slug), dest)


def download_ncr_bulletin(week_start: date, dest_dir: str | Path) -> Path:
    dest_dir = Path(dest_dir)
    filename = f"ncr-{week_start.isoformat()}.pdf"
    dest = dest_dir / filename
    return download_pdf(ncr_pdf_url(week_start), dest)


def download_region_bulletins(
    region_key: str,
    slugs: tuple[str, ...],
    dest_dir: str | Path,
) -> list[Path]:
    """Download one or more CMS guest slugs for a macro-region."""
    dest_dir = Path(dest_dir)
    region_code = REGION_CODES[region_key.strip().lower().replace("-", "_")]
    paths: list[Path] = []

    if region_code == "NCR" and len(slugs) == 1 and slugs[0].startswith("ncr-price-monitoring-"):
        # slug embeds date: ncr-price-monitoring-MMDDYYYY-pdf
        mmddyyyy = slugs[0].split("-")[-2]
        week_start = date(int(mmddyyyy[4:8]), int(mmddyyyy[:2]), int(mmddyyyy[2:4]))
        paths.append(download_ncr_bulletin(week_start, dest_dir))
        return paths

    for slug in slugs:
        prefix = region_code.lower().replace("_", "-")
        short = slug.split("-pdf")[0].split("/")[-1][-40:]
        dest = dest_dir / f"{prefix}-{short}.pdf"
        paths.append(download_pdf(slug_to_url(slug), dest))
    return paths


def normalize_region(region: str) -> str:
    key = region.strip().lower().replace(" ", "_")
    if key not in REGION_CODES:
        raise ValueError(f"Unknown region '{region}'. Expected one of: {', '.join(REGION_CODES)}")
    return REGION_CODES[key]
