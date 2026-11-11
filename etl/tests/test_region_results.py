"""Regional history follows actual ETL operations without controlling their result."""

from __future__ import annotations

from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
import urllib.error

import pytest

from src import automation, load_supabase, pending_retry
from src.constants import ALL_REGION_KEYS, REGION_CODES
from src.discover import DiscoveredBulletin, UpstreamUnavailableError
from src.download import RegionDownloadResult, SkippedDownload
from src.parse_bulletin import BulletinNotMachineReadable, ParsedBulletin, ParsedPrice
from src.pending_downloads import PendingDownload
from src.region_results import RegionRunResult, confirm_pending, new_region_results, region_results_payload


WEEK = date(2026, 11, 3)
CODES = [REGION_CODES[key] for key in ALL_REGION_KEYS]


def bulletin(code: str, week: date = WEEK) -> DiscoveredBulletin:
    return DiscoveredBulletin(region_code=code, week_start=week, slugs=("main-pdf",))


def parsed(code: str, week: date = WEEK) -> ParsedBulletin:
    return ParsedBulletin(
        region_code=code, bulletin_date=week, week_label="test week", source_path="main.pdf",
        prices=[ParsedPrice("Example Oil", "RON_91", 60.0)],
    )


def queued_row(code: str, slug: str = "blocked-pdf", week: date = WEEK) -> dict:
    return {"id": 7, "region_code": code, "bulletin_date": week.isoformat(), "slug": slug}


def regions_from(history: Mock) -> dict:
    payload = history.call_args.kwargs["region_results"]
    assert payload["version"] == 1
    assert [row["region_code"] for row in payload["regions"]] == CODES
    return {row["region_code"]: row for row in payload["regions"]}


@pytest.fixture(autouse=True)
def no_live_database(monkeypatch: pytest.MonkeyPatch) -> None:
    def blocked():
        raise AssertionError("Regional history tests must never contact the live database")
    monkeypatch.setattr(load_supabase, "_client", blocked)
    monkeypatch.setattr(automation, "_client", blocked)


@pytest.fixture
def weekly(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.setattr(automation, "discover_latest_weeks", lambda key, **_: [bulletin(REGION_CODES[key])])
    monkeypatch.setattr(automation, "_newest_stored_week", lambda _: None)
    monkeypatch.setattr(automation, "is_bulletin_stale", lambda *_: False)
    monkeypatch.setattr(automation, "download_region_bulletins", lambda *args: RegionDownloadResult(
        paths=[tmp_path / "main.pdf"], urls=["https://example.invalid/main.pdf"], skipped=[],
    ))
    monkeypatch.setattr(automation, "clear_pending_download", Mock())
    monkeypatch.setattr(automation, "parse_region_pdfs", lambda paths, code, **_: parsed(code))
    monkeypatch.setattr(automation, "carry_forward_missing_areas", lambda _: [])
    monkeypatch.setattr(automation, "missing_core_fuels", lambda _: [])
    monkeypatch.setattr(automation, "_region_already_loaded", lambda *_: False)
    load = Mock(return_value={"price_rows": 12, "companies": 3})
    state = Mock()
    history = Mock()
    monkeypatch.setattr(automation, "load_bulletin", load)
    monkeypatch.setattr(automation, "record_doe_website_fetch", state)
    monkeypatch.setattr(automation, "try_record_etl_run", history)
    return SimpleNamespace(load=load, state=state, history=history)


@pytest.mark.parametrize("code", CODES)
def test_each_region_not_fetched_is_recorded_without_changing_available_region_rule(
    code: str, weekly, monkeypatch: pytest.MonkeyPatch,
) -> None:
    def discover(key, **_):
        if REGION_CODES[key] == code:
            raise UpstreamUnavailableError("DOE page unavailable")
        return [bulletin(REGION_CODES[key])]
    monkeypatch.setattr(automation, "discover_latest_weeks", discover)
    result = automation.sync_all_regions()
    assert automation.summarise_results(result).startswith("SUCCESS WITH 1")
    assert weekly.load.call_count == 4
    weekly.state.assert_called_once()
    saved = regions_from(weekly.history)
    assert saved[code]["fetch_status"] == "not_fetched"
    assert saved[code]["issues"][0]["kind"] == "not_fetched"
    assert saved[code]["issues"][0]["retry_queued"] is None
    assert all(saved[item]["fetch_status"] == "fetched" for item in CODES if item != code)
    assert weekly.history.call_args.kwargs["status"] == "success"
    assert weekly.history.call_args.kwargs["failure_reason"] is None


def test_all_five_unavailable_keep_failed_verdict_and_all_region_evidence(weekly, monkeypatch) -> None:
    monkeypatch.setattr(automation, "discover_latest_weeks", Mock(side_effect=UpstreamUnavailableError("not served")))
    result = automation.sync_all_regions()
    assert automation.summarise_results(result).startswith("FAILED")
    weekly.load.assert_not_called()
    weekly.state.assert_not_called()
    saved = regions_from(weekly.history)
    assert all(row["fetch_status"] == "not_fetched" for row in saved.values())
    assert weekly.history.call_args.kwargs["regions_skipped"] == 5


@pytest.mark.parametrize("row_matches", [True, False])
def test_partial_pdf_download_saves_confirmed_queue_evidence_only(weekly, monkeypatch, tmp_path, row_matches) -> None:
    code = "SOUTH_LUZON"
    monkeypatch.setattr(automation, "ALL_REGION_KEYS", ("south_luzon",))
    downloaded = RegionDownloadResult(
        paths=[tmp_path / "main.pdf"], urls=["https://example.invalid/main.pdf"],
        skipped=[SkippedDownload("blocked-pdf", "https://example.invalid/blocked.pdf", "HTTP Error 403")],
    )
    monkeypatch.setattr(automation, "download_region_bulletins", Mock(return_value=downloaded))
    queue = Mock(return_value=queued_row(code if row_matches else "VISAYAS"))
    monkeypatch.setattr(automation, "upsert_pending_download", queue)
    result = automation.sync_all_regions()
    assert result[0].status == "CURRENT"
    weekly.load.assert_called_once()
    region = regions_from(weekly.history)[code]
    assert region["fetch_status"] == "partial"
    issue = region["issues"][0]
    assert issue["kind"] == "not_fetched"
    assert issue["slug"] == "blocked-pdf"
    assert issue["week_start"] == WEEK.isoformat()
    assert issue["retry_queued"] is (True if row_matches else None)
    assert bool(issue["retry_checked_at"]) is row_matches


def test_queue_failure_preserves_sibling_load_and_leaves_retry_unknown(weekly, monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(automation, "ALL_REGION_KEYS", ("south_luzon",))
    monkeypatch.setattr(automation, "download_region_bulletins", Mock(return_value=RegionDownloadResult(
        paths=[tmp_path / "main.pdf"], urls=[],
        skipped=[SkippedDownload("blocked-pdf", "https://example.invalid/blocked.pdf", "HTTP Error 403")],
    )))
    monkeypatch.setattr(automation, "upsert_pending_download", Mock(side_effect=RuntimeError("queue unavailable")))
    result = automation.sync_all_regions()
    assert result[0].pending_queue_error is True
    assert result[0].status == "ERROR"
    weekly.load.assert_called_once()
    issues = regions_from(weekly.history)["SOUTH_LUZON"]["issues"]
    assert {item["kind"] for item in issues} == {"not_fetched", "error"}
    assert all(item["retry_queued"] is None for item in issues)


def test_no_downloaded_pdf_is_not_mislabeled_as_unreadable(weekly, monkeypatch) -> None:
    monkeypatch.setattr(automation, "ALL_REGION_KEYS", ("mindanao",))
    monkeypatch.setattr(automation, "download_region_bulletins", Mock(return_value=RegionDownloadResult(
        paths=[], urls=[], skipped=[SkippedDownload("blocked-pdf", "https://example.invalid/pdf", "HTTP Error 403")],
    )))
    monkeypatch.setattr(automation, "upsert_pending_download", Mock(return_value=queued_row("MINDANAO")))
    monkeypatch.setattr(automation, "parse_region_pdfs", Mock(side_effect=RuntimeError("No PDF paths")))
    automation.sync_all_regions()
    region = regions_from(weekly.history)["MINDANAO"]
    assert region["fetch_status"] == "not_fetched"
    assert [item["kind"] for item in region["issues"]] == ["not_fetched"]
    assert region["issues"][0]["retry_queued"] is True


def test_unreadable_newer_pdf_survives_successful_fallback(weekly, monkeypatch) -> None:
    older = date(2026, 10, 27)
    monkeypatch.setattr(automation, "ALL_REGION_KEYS", ("north_luzon",))
    monkeypatch.setattr(automation, "discover_latest_weeks", Mock(return_value=[bulletin("NORTH_LUZON"), bulletin("NORTH_LUZON", older)]))
    monkeypatch.setattr(automation, "parse_region_pdfs", Mock(side_effect=[BulletinNotMachineReadable("OCR needed"), parsed("NORTH_LUZON", older)]))
    result = automation.sync_all_regions()
    assert result[0].week_start == older.isoformat()
    assert result[0].status == "CURRENT"
    assert "Newer weeks were unusable" in result[0].message
    region = regions_from(weekly.history)["NORTH_LUZON"]
    assert region["fetch_status"] == "fetched"
    assert region["issues"][0]["kind"] == "unreadable"
    assert region["issues"][0]["week_start"] == WEEK.isoformat()
    assert region["issues"][0]["retry_queued"] is None


def test_unreadable_all_candidates_keeps_exact_original_failure_result(weekly, monkeypatch) -> None:
    monkeypatch.setattr(automation, "ALL_REGION_KEYS", ("ncr",))
    monkeypatch.setattr(automation, "parse_region_pdfs", Mock(side_effect=BulletinNotMachineReadable("scan")))
    result = automation.sync_all_regions()
    assert result[0].stale is True
    assert "Failed: RuntimeError: No usable bulletin" in result[0].message
    region = regions_from(weekly.history)["NCR"]
    assert region["fetch_status"] == "fetched"
    assert [item["kind"] for item in region["issues"]] == ["unreadable"]


def test_loaded_but_stale_is_not_not_fetched(weekly, monkeypatch) -> None:
    monkeypatch.setattr(automation, "ALL_REGION_KEYS", ("south_luzon",))
    monkeypatch.setattr(automation, "is_bulletin_stale", lambda *_: True)
    result = automation.sync_all_regions()
    assert result[0].stale is True
    assert result[0].price_rows == 12
    region = regions_from(weekly.history)["SOUTH_LUZON"]
    assert region["fetch_status"] == "fetched"
    assert {item["kind"] for item in region["issues"]} == {"outdated"}


def test_history_keeps_all_regions_when_shared_state_write_fails(weekly) -> None:
    weekly.state.side_effect = RuntimeError("database state failed")
    with pytest.raises(RuntimeError, match="database state failed"):
        automation.sync_all_regions()
    assert all(row["fetch_status"] == "fetched" for row in regions_from(weekly.history).values())
    assert weekly.history.call_args.kwargs["failed_step"] == "latest DOE fetch state"
    assert weekly.history.call_args.kwargs["status"] == "failed"


def test_weekly_dry_run_still_does_not_write_history(weekly) -> None:
    result = automation.sync_all_regions(dry_run=True)
    assert len(result) == 5
    weekly.history.assert_not_called()
    weekly.state.assert_not_called()
    weekly.load.assert_not_called()


@pytest.fixture
def retry(monkeypatch, tmp_path):
    history = Mock()
    monkeypatch.setattr(load_supabase, "try_record_etl_run", history)
    monkeypatch.setattr(load_supabase, "record_doe_website_fetch", Mock())
    monkeypatch.setattr(pending_retry, "clear_pending_download", Mock())
    monkeypatch.setattr(pending_retry, "_rediscover_same_week_url", Mock(return_value=None))
    return history


@pytest.mark.parametrize("code", CODES)
def test_retry_records_each_region_and_confirms_exact_remaining_pdf(code, retry, monkeypatch) -> None:
    item = PendingDownload(7, code, WEEK, "blocked-pdf", "https://example.invalid/pdf")
    monkeypatch.setattr(pending_retry, "list_pending_downloads", Mock(return_value=[item]))
    monkeypatch.setattr(pending_retry, "download_slug", Mock(side_effect=urllib.error.HTTPError(item.source_url, 403, "Forbidden", None, None)))
    monkeypatch.setattr(pending_retry, "touch_pending_error", Mock(return_value=queued_row(code)))
    result = pending_retry.retry_pending_downloads()
    assert result[0].status == "still_pending"
    all_regions = regions_from(retry)
    assert all_regions[code]["fetch_status"] == "not_fetched"
    issue = all_regions[code]["issues"][0]
    assert issue["retry_queued"] is True
    assert issue["week_start"] == WEEK.isoformat()
    assert all(row["status"] == "no_work" for key, row in all_regions.items() if key != code)


def test_idle_retry_has_all_five_no_work_regions(retry, monkeypatch) -> None:
    monkeypatch.setattr(pending_retry, "list_pending_downloads", Mock(return_value=[]))
    result = pending_retry.retry_pending_downloads()
    assert result[0].status == "idle"
    assert all(row["status"] == "no_work" and not row["issues"] for row in regions_from(retry).values())


def test_retry_queue_lookup_failure_leaves_regions_unobserved(retry, monkeypatch) -> None:
    monkeypatch.setattr(pending_retry, "list_pending_downloads", Mock(side_effect=RuntimeError("queue unavailable")))
    with pytest.raises(RuntimeError, match="queue unavailable"):
        pending_retry.retry_pending_downloads()
    assert all(row["status"] == "not_processed" and not row["issues"] for row in regions_from(retry).values())


@pytest.mark.parametrize("confirmation", [None, {"id": 7}, queued_row("VISAYAS")])
def test_confirmation_requires_exact_returned_queue_identity(confirmation) -> None:
    assert confirm_pending(confirmation, region_code="NCR", week_start=WEEK.isoformat(), slug="blocked-pdf") == (None, None)


@pytest.mark.parametrize("kind", ["unreadable", "load_error", "recovered"])
def test_retry_records_parse_load_and_recovery_without_changing_queue_actions(
    kind, retry, monkeypatch, tmp_path,
) -> None:
    from src import parse_bulletin
    item = PendingDownload(7, "NORTH_LUZON", WEEK, "main-pdf", "https://example.invalid/main.pdf")
    monkeypatch.setattr(pending_retry, "list_pending_downloads", Mock(return_value=[item]))
    monkeypatch.setattr(pending_retry, "download_slug", Mock(return_value=tmp_path / "main.pdf"))
    parser = Mock(return_value=parsed("NORTH_LUZON"))
    if kind == "unreadable":
        parser.side_effect = BulletinNotMachineReadable("scanned PDF")
    monkeypatch.setattr(parse_bulletin, "parse_bulletin_pdf", parser)
    merge = Mock(return_value={"price_rows": 12, "companies": 3})
    if kind == "load_error":
        merge.side_effect = RuntimeError("database load failed")
    monkeypatch.setattr(load_supabase, "merge_bulletin_prices", merge)
    touch = Mock(return_value=queued_row("NORTH_LUZON", "main-pdf"))
    monkeypatch.setattr(pending_retry, "touch_pending_error", touch)
    result = pending_retry.retry_pending_downloads()
    region = regions_from(retry)["NORTH_LUZON"]
    assert region["fetch_status"] == "fetched"
    if kind == "recovered":
        assert result[0].status == "recovered"
        assert region["price_rows"] == 12
        assert region["companies"] == 3
        assert region["issues"] == []
        pending_retry.clear_pending_download.assert_called_once()
        touch.assert_not_called()
    else:
        assert result[0].status == "error"
        assert region["issues"][0]["kind"] == ("unreadable" if kind == "unreadable" else "error")
        assert region["issues"][0]["retry_queued"] is True
        assert region["issues"][0]["slug"] == "main-pdf"
        pending_retry.clear_pending_download.assert_not_called()
        touch.assert_called_once()


def test_retry_retains_unexpected_download_exception_and_records_unprocessed_regions(
    retry, monkeypatch,
) -> None:
    items = [
        PendingDownload(7, "NCR", WEEK, "ncr-pdf", "https://example.invalid/ncr.pdf"),
        PendingDownload(8, "VISAYAS", WEEK, "visayas-pdf", "https://example.invalid/visayas.pdf"),
    ]
    monkeypatch.setattr(pending_retry, "list_pending_downloads", Mock(return_value=items))
    monkeypatch.setattr(pending_retry, "download_slug", Mock(side_effect=OSError("connection failed")))
    with pytest.raises(OSError, match="connection failed"):
        pending_retry.retry_pending_downloads()
    snapshot = regions_from(retry)
    assert snapshot["NCR"]["issues"][0]["kind"] == "not_fetched"
    assert snapshot["VISAYAS"]["status"] == "not_processed"
    assert snapshot["VISAYAS"]["issues"] == []


def test_pending_write_returns_existing_response_without_extra_queries(monkeypatch) -> None:
    from src import pending_downloads
    client = Mock()
    row = queued_row("NCR")
    query = client.table.return_value
    query.upsert.return_value.execute.return_value = SimpleNamespace(data=[row])
    query.update.return_value.eq.return_value.execute.return_value = SimpleNamespace(data=[row])
    monkeypatch.setattr(pending_downloads, "_client", lambda: client)
    assert pending_downloads.upsert_pending_download(
        region_code="NCR", bulletin_date=WEEK, slug="blocked-pdf", source_url="https://example.invalid/pdf",
    ) == row
    assert pending_downloads.touch_pending_error(7, "HTTP Error 403") == row
    query.select.assert_not_called()
    query.upsert.assert_called_once()
    query.update.assert_called_once()


def test_region_snapshot_is_a_copy_and_includes_all_regions() -> None:
    results = new_region_results()
    region = results["NCR"]
    region.start("PDF download")
    region.week_start = WEEK.isoformat()
    region.issue("not_fetched", "unavailable")
    payload = region_results_payload(results)
    region.issues[0]["message"] = "changed"
    assert payload["regions"][0]["issues"][0]["message"] == "unavailable"
    assert len(payload["regions"]) == 5
