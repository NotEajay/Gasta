"""Daily pending-retry idles when the queue is empty."""

from __future__ import annotations

from datetime import date
from pathlib import Path
from unittest.mock import patch
import urllib.error

from src.parse_bulletin import ParsedBulletin, ParsedPrice
from src.pending_downloads import PendingDownload
from src.pending_retry import _rediscover_same_week_url, retry_pending_downloads


def test_retry_pending_idles_when_queue_empty() -> None:
    with patch("src.pending_retry.list_pending_downloads", return_value=[]):
        results = retry_pending_downloads(dry_run=True)

    assert len(results) == 1
    assert results[0].status == "idle"


def test_recovered_pending_pdf_merges_and_clears_only_pending_row(tmp_path: Path) -> None:
    pending = PendingDownload(
        id=7,
        region_code="SOUTH_LUZON",
        bulletin_date=date(2026, 9, 22),
        slug="bicol",
        source_url="https://cdn.example/bicol.pdf",
        last_error="HTTP Error 403: Forbidden",
    )
    parsed = ParsedBulletin(
        region_code="SOUTH_LUZON",
        bulletin_date=date(2026, 9, 22),
        week_label="September 22 to 28",
        source_path="bicol.pdf",
        source_url=pending.source_url,
        prices=[
            ParsedPrice("Example Oil", "RON_91", 60.0, "Legazpi City"),
        ],
    )
    downloaded = tmp_path / "south-luzon-bicol.pdf"
    downloaded.write_bytes(b"%PDF")

    with (
        patch("src.pending_retry.list_pending_downloads", return_value=[pending]),
        patch("src.pending_retry.download_slug", return_value=downloaded),
        patch("src.parse_bulletin.parse_bulletin_pdf", return_value=parsed),
        patch(
            "src.load_supabase.merge_bulletin_prices",
            return_value={"price_rows": 1},
        ) as merge,
        patch("src.pending_retry.clear_pending_download") as clear,
        patch("src.load_supabase.record_doe_website_fetch") as record,
    ):
        results = retry_pending_downloads(dest_dir=tmp_path)

    assert results[0].status == "recovered"
    merge.assert_called_once_with(parsed, dry_run=False)
    clear.assert_called_once_with(
        region_code="SOUTH_LUZON",
        bulletin_date=date(2026, 9, 22),
        slug="bicol",
    )
    record.assert_called_once_with(trigger="pending-retry")


def test_pending_retry_rediscovery_matches_same_week_and_subregion() -> None:
    pending = PendingDownload(
        id=7,
        region_code="SOUTH_LUZON",
        bulletin_date=date(2026, 9, 29),
        slug="region-v-bicol",
        source_url="https://cdn.example/old-generic-bicol.pdf",
    )
    html = """
    <ul>
      <li>2026</li>
      <li><ul>
        <li>September 29 to October 5</li>
        <li><ul>
          <li><a href="https://d24qbtp4vooyzi.cloudfront.net/api/media/file/Region%20IV-A%20CALABARZON%2029-5.pdf?prefix=dev%2Fmedia">Calabarzon</a></li>
          <li><a href="https://d24qbtp4vooyzi.cloudfront.net/api/media/file/Region%20IV-B%20MIMAROPA%2029-5.pdf?prefix=dev%2Fmedia">Mimaropa</a></li>
          <li><a href="https://d24qbtp4vooyzi.cloudfront.net/api/media/file/Region%20V%20Bicol%2029-5.pdf?prefix=dev%2Fmedia">Bicol</a></li>
        </ul></li>
        <li>September 22 to 28</li>
        <li><ul>
          <li><a href="https://d24qbtp4vooyzi.cloudfront.net/api/media/file/Region%20V%20Bicol%20old.pdf?prefix=dev%2Fmedia">Bicol</a></li>
        </ul></li>
      </ul></li>
    </ul>
    """

    with (
        patch(
            "src.pending_retry.fetch_region_page_html",
            return_value=("https://doe.gov.ph/south", html),
        ),
    ):
        assert (
            _rediscover_same_week_url(pending)
            == "https://d24qbtp4vooyzi.cloudfront.net/api/media/file/Region%20V%20Bicol%2029-5.pdf?prefix=dev%2Fmedia"
        )


def test_pending_retry_uses_rediscovered_url_and_updates_queue(tmp_path: Path) -> None:
    pending = PendingDownload(
        id=7,
        region_code="SOUTH_LUZON",
        bulletin_date=date(2026, 9, 29),
        slug="region-v-bicol",
        source_url="https://cdn.example/old-generic-bicol.pdf",
    )
    dated_url = "https://d24qbtp4vooyzi.cloudfront.net/api/media/file/Region%20V%20Bicol%2029-5.pdf?prefix=dev%2Fmedia"
    parsed = ParsedBulletin(
        region_code="SOUTH_LUZON",
        bulletin_date=date(2026, 9, 29),
        week_label="September 29 to October 5",
        source_path="bicol.pdf",
        source_url=dated_url,
        prices=[ParsedPrice("Example Oil", "RON_91", 60.0, "Legazpi City")],
    )
    downloaded = tmp_path / "bicol.pdf"
    downloaded.write_bytes(b"%PDF")

    calls: list[str] = []

    def fake_download(_region: str, _slug: str, _dest: Path, url: str) -> Path:
        calls.append(url)
        if url == pending.source_url:
            raise urllib.error.HTTPError(url, 403, "Forbidden", hdrs=None, fp=None)
        return downloaded

    with (
        patch("src.pending_retry.list_pending_downloads", return_value=[pending]),
        patch("src.pending_retry.download_slug", side_effect=fake_download),
        patch("src.pending_retry._rediscover_same_week_url", return_value=dated_url),
        patch("src.pending_retry.update_pending_source_url") as update_url,
        patch("src.parse_bulletin.parse_bulletin_pdf", return_value=parsed),
        patch("src.load_supabase.merge_bulletin_prices", return_value={"price_rows": 1}),
        patch("src.pending_retry.clear_pending_download") as clear,
        patch("src.load_supabase.record_doe_website_fetch"),
    ):
        results = retry_pending_downloads(dest_dir=tmp_path)

    assert results[0].status == "recovered", results[0].message
    assert calls == [pending.source_url, dated_url]
    update_url.assert_called_once_with(pending.id, dated_url)
    clear.assert_called_once_with(
        region_code="SOUTH_LUZON",
        bulletin_date=pending.bulletin_date,
        slug=pending.slug,
    )


def test_ncr_pending_retry_rediscovery_matches_exact_week() -> None:
    pending = PendingDownload(
        id=8,
        region_code="NCR",
        bulletin_date=date(2026, 9, 29),
        slug="ncr-liquid-fuel-price-monitoring-29-sep-to-5-oct-2026",
        source_url="https://cdn.example/old.pdf",
    )
    document = type(
        "Document",
        (),
        {
            "week_start": date(2026, 9, 29),
            "url": "https://cdn.example/ncr-2026-09-29.pdf",
        },
    )()
    with patch("src.pending_retry.discover_region_documents", return_value=[document]), patch(
        "src.pending_retry.group_documents_by_week",
        return_value=([type("Bulletin", (), {"week_start": date(2026, 9, 29), "urls": (document.url,)})()], []),
    ):
        assert (
            _rediscover_same_week_url(pending)
            == "https://cdn.example/ncr-2026-09-29.pdf"
        )
