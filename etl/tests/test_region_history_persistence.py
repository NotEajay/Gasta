"""Region snapshots survive history outages without inventing legacy detail."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from src.load_supabase import record_etl_run, try_record_etl_run


@pytest.fixture
def region_results() -> dict:
    regions = [
        {
            "region_code": code,
            "status": "no_work",
            "fetch_status": "not_attempted",
            "week_start": None,
            "price_rows": 0,
            "companies": None,
            "issues": [],
        }
        for code in ("NCR", "NORTH_LUZON", "SOUTH_LUZON", "VISAYAS", "MINDANAO")
    ]
    regions[0].update(
        status="processed", fetch_status="fetched", week_start="2026-11-03",
        price_rows=24, companies=4,
    )
    regions[2].update(
        status="not_processed", fetch_status="partial", week_start="2026-11-03",
        issues=[{
            "kind": "not_fetched",
            "message": "Bicol PDF unavailable\nRetry queued — awaiting DOE.",
            "step": "PDF download",
            "week_start": "2026-11-03",
            "slug": "bicol",
            "retry_queued": True,
            "retry_checked_at": "2026-11-06T01:02:08+00:00",
        }, {
            "kind": "missing_prices",
            "message": "No usable prices for this region.",
            "step": None,
            "week_start": None,
            "slug": None,
            "retry_queued": None,
            "retry_checked_at": None,
        }],
    )
    return {"version": 1, "regions": regions}


@pytest.fixture
def history(region_results: dict) -> dict:
    return {
        "workflow": "pending-retry",
        "status": "partial",
        "started_at": datetime(2026, 11, 6, 1, 2, 3, tzinfo=timezone.utc),
        "ended_at": datetime(2026, 11, 6, 1, 2, 8, tzinfo=timezone.utc),
        "regions_ok": 1,
        "regions_failed": 1,
        "regions_skipped": 3,
        "failure_reason": "SOUTH_LUZON: Bicol PDF unavailable",
        "failed_step": "PDF download",
        "region_results": region_results,
    }


def test_record_etl_run_saves_all_five_regions_unchanged(history: dict) -> None:
    client = MagicMock()
    with patch("src.load_supabase._client", return_value=client):
        record_etl_run(**history)

    name, payload = client.rpc.call_args.args
    assert name == "save_doe_etl_run"
    assert payload["p_region_results"] == history["region_results"]
    assert len(payload["p_region_results"]["regions"]) == 5
    assert payload["p_region_results"]["regions"][4]["status"] == "no_work"
    assert payload["p_regions_ok"] == 1
    assert payload["p_regions_failed"] == 1
    client.rpc.return_value.execute.assert_called_once_with()


def test_identical_output_and_stderr_snapshot_exist_before_rpc_outage(
    history: dict, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    output = tmp_path / "github-output.txt"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    expected = {
        **history,
        "started_at": history["started_at"].isoformat(),
        "ended_at": history["ended_at"].isoformat(),
    }

    def fail_after_handoff() -> None:
        output_lines = output.read_text(encoding="utf-8").splitlines()
        log_lines = capsys.readouterr().err.splitlines()
        assert len(output_lines) == len(log_lines) == 1
        assert output_lines[0].startswith("history_payload=")
        assert log_lines[0].startswith("DOE_ETL_HISTORY_PAYLOAD=")
        serialized = output_lines[0].partition("=")[2]
        assert log_lines[0].partition("=")[2] == serialized
        assert json.loads(serialized) == expected
        raise RuntimeError("RPC unavailable")

    client = MagicMock()
    client.rpc.return_value.execute.side_effect = fail_after_handoff
    with patch("src.load_supabase._client", return_value=client):
        assert try_record_etl_run(**history) is False

    assert "RPC unavailable" in capsys.readouterr().err
    assert history["status"] == "partial"
    assert json.loads(output.read_text().partition("=")[2]) == expected


def test_output_file_failure_preserves_log_and_database_write(
    history: dict, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("GITHUB_OUTPUT", str(tmp_path))  # A directory is not writable as a file.
    with patch("src.load_supabase.record_etl_run") as record:
        assert try_record_etl_run(**history) is True
    record.assert_called_once_with(**history)
    lines = capsys.readouterr().err.splitlines()
    assert json.loads(lines[0].partition("=")[2])["region_results"] == history["region_results"]
    assert "failed to publish DOE ETL history output" in lines[1]


@pytest.mark.parametrize("rpc_fails", [False, True])
@pytest.mark.parametrize("output_fails", [False, True])
def test_broken_stderr_cannot_change_history_or_etl_outcome(
    history: dict, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
    rpc_fails: bool, output_fails: bool,
) -> None:
    output = tmp_path if output_fails else tmp_path / "github-output.txt"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    with (
        patch("src.load_supabase.sys.stderr") as stderr,
        patch("src.load_supabase.record_etl_run") as record,
    ):
        stderr.write.side_effect = OSError("log stream closed")
        if rpc_fails:
            record.side_effect = RuntimeError("RPC unavailable")
        assert try_record_etl_run(**history) is not rpc_fails
    record.assert_called_once_with(**history)
    if not output_fails:
        assert json.loads(output.read_text().partition("=")[2])["region_results"] == history["region_results"]


def test_snapshot_is_logged_without_github_output(
    history: dict, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.delenv("GITHUB_OUTPUT", raising=False)
    with patch("src.load_supabase.record_etl_run"):
        assert try_record_etl_run(**history) is True
    line = capsys.readouterr().err.strip()
    assert line.startswith("DOE_ETL_HISTORY_PAYLOAD=")
    assert json.loads(line.partition("=")[2])["region_results"] == history["region_results"]


@pytest.mark.parametrize("explicit_none", [False, True])
def test_legacy_calls_omit_new_rpc_argument_and_do_not_invent_regions(
    history: dict, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, explicit_none: bool,
) -> None:
    history.pop("region_results")
    if explicit_none:
        history["region_results"] = None
    output = tmp_path / "github-output.txt"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    client = MagicMock()
    with patch("src.load_supabase._client", return_value=client):
        assert try_record_etl_run(**history) is True
    payload = client.rpc.call_args.args[1]
    assert len(payload) == 13
    assert "p_region_results" not in payload
    handoff = json.loads(output.read_text().partition("=")[2])
    assert handoff.get("region_results") is None
    assert ("region_results" in handoff) is explicit_none
