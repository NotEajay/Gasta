"""DOE workflow run history records complete outcomes without changing job results."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from src.automation import SyncResult, sync_all_regions
from src.load_supabase import record_etl_run, try_record_etl_run


def _current(region: str = "NCR") -> SyncResult:
    return SyncResult(
        region_code=region,
        week_start="2026-11-03",
        pdf_path="bulletin.pdf",
        price_rows=10,
        companies=3,
        message="Loaded successfully.",
    )


def _stale(region: str = "SOUTH_LUZON") -> SyncResult:
    return SyncResult(
        region_code=region,
        week_start="2026-09-22",
        pdf_path="",
        price_rows=0,
        companies=0,
        skipped=True,
        message="Already loaded.",
        stale=True,
    )


def test_record_etl_run_uses_atomic_bounded_save_rpc(monkeypatch: pytest.MonkeyPatch) -> None:
    client = MagicMock()
    started_at = datetime(2026, 11, 6, 1, 2, 3, tzinfo=timezone.utc)
    ended_at = datetime(2026, 11, 6, 1, 2, 8, tzinfo=timezone.utc)
    monkeypatch.setenv("ETL_TRIGGER", "github-actions")
    monkeypatch.setenv("GITHUB_RUN_ID", "12345")
    monkeypatch.setenv("GITHUB_RUN_ATTEMPT", "2")

    with patch("src.load_supabase._client", return_value=client):
        record_etl_run(
            workflow="weekly",
            status="failed",
            started_at=started_at,
            ended_at=ended_at,
            regions_ok=3,
            regions_failed=1,
            regions_skipped=1,
            failure_reason="RuntimeError: parse failed",
            failed_step="PDF parse",
        )

    rpc_name, payload = client.rpc.call_args.args
    assert rpc_name == "save_doe_etl_run"
    assert payload == {
        "p_workflow": "weekly",
        "p_status": "failed",
        "p_started_at": started_at.isoformat(),
        "p_ended_at": ended_at.isoformat(),
        "p_trigger_source": "github-actions",
        "p_github_run_id": "12345",
        "p_github_run_attempt": 2,
        "p_regions_ok": 3,
        "p_regions_failed": 1,
        "p_regions_skipped": 1,
        "p_duration_s": 5.0,
        "p_failure_reason": "RuntimeError: parse failed",
        "p_failed_step": "PDF parse",
    }
    client.rpc.return_value.execute.assert_called_once_with()


def test_history_failure_is_non_disruptive_and_publishes_finalizer_payload(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = tmp_path / "github-output.txt"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    started_at = datetime(2026, 11, 6, 1, 2, 3, tzinfo=timezone.utc)
    ended_at = datetime(2026, 11, 6, 1, 2, 8, tzinfo=timezone.utc)

    with patch(
        "src.load_supabase.record_etl_run", side_effect=RuntimeError("history down")
    ):
        saved = try_record_etl_run(
            workflow="weekly",
            status="success",
            started_at=started_at,
            ended_at=ended_at,
            regions_ok=5,
        )

    assert saved is False
    output_value = output.read_text(encoding="utf-8").removeprefix("history_payload=")
    assert '"workflow":"weekly"' in output_value
    assert '"status":"success"' in output_value
    assert '"regions_ok":5' in output_value


def test_weekly_result_survives_history_storage_failure() -> None:
    with (
        patch("src.automation.ALL_REGION_KEYS", ("ncr",)),
        patch("src.automation.sync_latest_region", return_value=_current()),
        patch("src.automation.record_doe_website_fetch"),
        patch("src.automation.try_record_etl_run", return_value=False),
    ):
        results = sync_all_regions()

    assert len(results) == 1
    assert results[0].status == "CURRENT"


def test_history_migration_enforces_per_workflow_ten_row_cap() -> None:
    migration = (
        Path(__file__).resolve().parents[2]
        / "supabase"
        / "migrations"
        / "20261106000000_doe_etl_run_history_retention.sql"
    ).read_text(encoding="utf-8")

    assert "pg_advisory_xact_lock" in migration
    assert "where workflow = p_workflow" in migration
    assert "offset 10" in migration
    assert "delete from public.doe_etl_runs" in migration


def test_weekly_success_saves_times_status_and_existing_counts() -> None:
    with (
        patch("src.automation.ALL_REGION_KEYS", ("ncr",)),
        patch("src.automation.sync_latest_region", return_value=_current()),
        patch("src.automation.record_doe_website_fetch") as record_fetch,
        patch("src.automation.try_record_etl_run") as record_run,
    ):
        results = sync_all_regions()

    assert results[0].status == "CURRENT"
    record_fetch.assert_called_once_with()
    history = record_run.call_args.kwargs
    assert history["workflow"] == "weekly"
    assert history["status"] == "success"
    assert history["regions_ok"] == 1
    assert history["regions_failed"] == 0
    assert history["regions_skipped"] == 0
    assert history["failure_reason"] is None
    assert history["failed_step"] is None
    assert history["ended_at"] >= history["started_at"]
    assert history["duration_s"] >= 0


def test_weekly_mixed_failure_saves_reason_and_failing_step() -> None:
    with (
        patch("src.automation.ALL_REGION_KEYS", ("ncr", "south_luzon")),
        patch("src.automation.sync_latest_region", side_effect=[_current(), _stale()]),
        patch("src.automation.record_doe_website_fetch") as record_fetch,
        patch("src.automation.try_record_etl_run") as record_run,
    ):
        results = sync_all_regions()

    assert [result.status for result in results] == ["CURRENT", "STALE"]
    record_fetch.assert_not_called()
    history = record_run.call_args.kwargs
    assert history["status"] == "partial"
    assert history["regions_ok"] == 1
    assert history["regions_failed"] == 1
    assert history["regions_skipped"] == 0
    assert "SOUTH_LUZON: stale bulletin 2026-09-22" in history["failure_reason"]
    assert history["failed_step"] == "freshness check"


def test_weekly_region_exception_is_saved_and_existing_result_is_returned() -> None:
    with (
        patch("src.automation.ALL_REGION_KEYS", ("ncr",)),
        patch("src.automation.sync_latest_region", side_effect=RuntimeError("bad PDF")),
        patch("src.automation.try_record_etl_run") as record_run,
    ):
        results = sync_all_regions()

    assert len(results) == 1
    assert results[0].status == "STALE"
    history = record_run.call_args.kwargs
    assert history["status"] == "failed"
    assert history["regions_failed"] == 1
    assert "RuntimeError: bad PDF" in history["failure_reason"]
    assert history["failed_step"] == "region sync"


def test_weekly_uncaught_state_failure_is_saved_then_reraised() -> None:
    with (
        patch("src.automation.ALL_REGION_KEYS", ("ncr",)),
        patch("src.automation.sync_latest_region", return_value=_current()),
        patch(
            "src.automation.record_doe_website_fetch",
            side_effect=RuntimeError("state unavailable"),
        ),
        patch("src.automation.try_record_etl_run") as record_run,
    ):
        with pytest.raises(RuntimeError, match="state unavailable"):
            sync_all_regions()

    history = record_run.call_args.kwargs
    assert history["status"] == "failed"
    assert history["regions_ok"] == 1
    assert history["regions_failed"] == 0
    assert history["failure_reason"] == "RuntimeError: state unavailable"
    assert history["failed_step"] == "latest DOE fetch state"
