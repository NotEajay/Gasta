"""Multi-PDF regions keep going when one media object is 403 Forbidden."""

from __future__ import annotations

import urllib.error
from pathlib import Path
from unittest.mock import patch

from src.download import RegionDownloadResult, download_region_bulletins, read_url_bytes


def test_read_url_bytes_does_not_retry_403() -> None:
    forbidden = urllib.error.HTTPError(
        "https://example.test/file.pdf", 403, "Forbidden", hdrs=None, fp=None
    )
    with patch("src.download.urllib.request.urlopen", side_effect=forbidden) as opener:
        try:
            read_url_bytes("https://example.test/file.pdf", retries=3)
            assert False, "expected HTTPError"
        except urllib.error.HTTPError as exc:
            assert exc.code == 403
    assert opener.call_count == 1


def test_download_region_skips_403_sibling(tmp_path: Path) -> None:
    """Calabarzon/Mimaropa stay loadable when Bicol's undated media file is 403."""

    def fake_download(_region: str, slug: str, dest_dir: str | Path, url=None) -> Path:
        if "bicol" in slug.lower():
            raise urllib.error.HTTPError(
                url or slug, 403, "Forbidden", hdrs=None, fp=None
            )
        path = Path(dest_dir) / f"{slug}.pdf"
        path.write_bytes(b"%PDF-1.7 ok")
        return path

    with patch("src.download.download_slug", side_effect=fake_download):
        result = download_region_bulletins(
            "south_luzon",
            (
                "region-iv-a-calabarzon",
                "region-iv-b-mimaropa",
                "region-v-bicol",
            ),
            tmp_path,
            (
                "https://cdn.example/Region%20IV-A%20CALABARZON.pdf",
                "https://cdn.example/Region%20IV-B%20MIMAROPA.pdf",
                "https://cdn.example/Region%20V%20Bicol.pdf",
            ),
        )

    assert isinstance(result, RegionDownloadResult)
    assert len(result.paths) == 2
    assert len(result.urls) == 2
    assert len(result.skipped) == 1
    assert result.skipped[0].slug == "region-v-bicol"
    assert "Bicol.pdf" in result.urls[0] or "CALABARZON" in result.urls[0]
