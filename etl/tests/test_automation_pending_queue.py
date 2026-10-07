"""Skipped multi-PDF downloads are persisted for daily retry."""

from __future__ import annotations

from datetime import date
from pathlib import Path
from unittest.mock import patch

from src.automation import _sync_discovered
from src.discover import DiscoveredBulletin
from src.download import RegionDownloadResult, SkippedDownload
from src.parse_bulletin import ParsedBulletin


def _discovered() -> DiscoveredBulletin:
    return DiscoveredBulletin(
        region_code="SOUTH_LUZON",
        week_start=date(2026, 9, 22),
        slugs=("calabarzon", "mimaropa", "bicol"),
        urls=(
            "https://cdn.example/calabarzon.pdf",
            "https://cdn.example/mimaropa.pdf",
            "https://cdn.example/bicol.pdf",
        ),
    )


def test_skipped_bicol_is_queued_while_siblings_load(tmp_path: Path) -> None:
    calabarzon = tmp_path / "calabarzon.pdf"
    mimaropa = tmp_path / "mimaropa.pdf"
    calabarzon.write_bytes(b"%PDF")
    mimaropa.write_bytes(b"%PDF")
    downloaded = RegionDownloadResult(
        paths=[calabarzon, mimaropa],
        urls=[
            "https://cdn.example/calabarzon.pdf",
            "https://cdn.example/mimaropa.pdf",
        ],
        skipped=[
            SkippedDownload(
                slug="bicol",
                url="https://cdn.example/bicol.pdf",
                error="HTTP Error 403: Forbidden",
            )
        ],
    )
    parsed = ParsedBulletin(
        region_code="SOUTH_LUZON",
        bulletin_date=date(2026, 9, 22),
        week_label="September 22 to 28",
        source_path="; ".join(map(str, downloaded.paths)),
    )

    with (
        patch("src.automation._newest_stored_week", return_value=None),
        patch("src.automation.download_region_bulletins", return_value=downloaded),
        patch("src.automation.parse_region_pdfs", return_value=parsed),
        patch("src.automation.carry_forward_missing_areas", return_value=[]),
        patch("src.automation.missing_core_fuels", return_value=[]),
        patch("src.automation._region_already_loaded", return_value=False),
        patch("src.automation.clear_pending_download"),
        patch("src.automation.load_bulletin", return_value={"price_rows": 2, "companies": 1}),
        patch("src.automation.upsert_pending_download") as upsert,
    ):
        result = _sync_discovered(_discovered(), dest_dir=tmp_path, today=date(2026, 9, 30))

    upsert.assert_called_once_with(
        region_code="SOUTH_LUZON",
        bulletin_date=date(2026, 9, 22),
        slug="bicol",
        source_url="https://cdn.example/bicol.pdf",
        last_error="HTTP Error 403: Forbidden",
    )
    assert result.price_rows == 2
    assert result.status == "CURRENT"


def test_repeated_discovery_uses_same_pending_conflict_key(tmp_path: Path) -> None:
    downloaded = RegionDownloadResult(
        paths=[tmp_path / "calabarzon.pdf"],
        urls=["https://cdn.example/calabarzon.pdf"],
        skipped=[
            SkippedDownload(
                slug="bicol",
                url="https://cdn.example/bicol.pdf",
                error="HTTP Error 403: Forbidden",
            )
        ],
    )
    parsed = ParsedBulletin(
        region_code="SOUTH_LUZON",
        bulletin_date=date(2026, 9, 22),
        week_label="September 22 to 28",
        source_path="calabarzon.pdf",
    )

    pending_rows: dict[tuple[str, date, str], dict] = {}

    def upsert_pending(**kwargs: object) -> None:
        key = (kwargs["region_code"], kwargs["bulletin_date"], kwargs["slug"])
        pending_rows[key] = kwargs

    with (
        patch("src.automation._newest_stored_week", return_value=None),
        patch("src.automation.download_region_bulletins", return_value=downloaded),
        patch("src.automation.parse_region_pdfs", return_value=parsed),
        patch("src.automation.carry_forward_missing_areas", return_value=[]),
        patch("src.automation.missing_core_fuels", return_value=[]),
        patch("src.automation._region_already_loaded", return_value=False),
        patch("src.automation.clear_pending_download"),
        patch("src.automation.load_bulletin", return_value={"price_rows": 1, "companies": 1}),
        patch("src.automation.upsert_pending_download", side_effect=upsert_pending) as upsert,
    ):
        _sync_discovered(_discovered(), dest_dir=tmp_path, today=date(2026, 9, 30))
        _sync_discovered(_discovered(), dest_dir=tmp_path, today=date(2026, 9, 30))

    assert upsert.call_count == 2
    assert len(pending_rows) == 1
    assert next(iter(pending_rows)) == (
        "SOUTH_LUZON",
        date(2026, 9, 22),
        "bicol",
    )


def test_queue_persistence_failure_is_visible_without_dropping_siblings(
    tmp_path: Path,
) -> None:
    downloaded = RegionDownloadResult(
        paths=[tmp_path / "calabarzon.pdf", tmp_path / "mimaropa.pdf"],
        urls=["https://cdn.example/calabarzon.pdf", "https://cdn.example/mimaropa.pdf"],
        skipped=[
            SkippedDownload(
                slug="bicol",
                url="https://cdn.example/bicol.pdf",
                error="HTTP Error 403: Forbidden",
            )
        ],
    )
    parsed = ParsedBulletin(
        region_code="SOUTH_LUZON",
        bulletin_date=date(2026, 9, 22),
        week_label="September 22 to 28",
        source_path="siblings.pdf",
    )

    with (
        patch("src.automation._newest_stored_week", return_value=None),
        patch("src.automation.download_region_bulletins", return_value=downloaded),
        patch("src.automation.parse_region_pdfs", return_value=parsed) as parse,
        patch("src.automation.carry_forward_missing_areas", return_value=[]),
        patch("src.automation.missing_core_fuels", return_value=[]),
        patch("src.automation._region_already_loaded", return_value=False),
        patch("src.automation.clear_pending_download"),
        patch("src.automation.load_bulletin", return_value={"price_rows": 2, "companies": 1}) as load,
        patch(
            "src.automation.upsert_pending_download",
            side_effect=RuntimeError("Supabase unavailable"),
        ),
    ):
        result = _sync_discovered(_discovered(), dest_dir=tmp_path, today=date(2026, 9, 30))

    parse.assert_called_once()
    load.assert_called_once()
    assert result.pending_queue_error is True
    assert result.status == "ERROR"
    assert "Failed to persist pending-download queue" in result.message
