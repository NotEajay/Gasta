"""GitHub workflow completion reconciles missing or partial ETL history rows."""

from __future__ import annotations

import json
import urllib.parse
from unittest.mock import patch

import pytest

from record_workflow_run import _github_job, fetch_existing_history, reconcile_run


FAILED_JOB = {
    "name": "Sync latest bulletins (all regions)",
    "conclusion": "failure",
    "started_at": "2026-11-06T01:00:00Z",
    "completed_at": "2026-11-06T01:05:00Z",
    "steps": [
        {"name": "Checkout", "conclusion": "success"},
        {"name": "Install dependencies", "conclusion": "failure"},
    ],
}


def _call(**overrides):
    args = {
        "workflow": "weekly",
        "job_name": "Sync latest bulletins (all regions)",
        "job_result": "failure",
        "repository": "NotEajay/Gasta",
        "run_id": "123",
        "run_attempt": 2,
        "github_token": "token",
        "supabase_url": "https://example.supabase.co",
        "service_key": "service-key",
    }
    args.update(overrides)
    with (
        patch("record_workflow_run._github_job", return_value=FAILED_JOB),
        patch("record_workflow_run._request_json", return_value={}) as request,
    ):
        created = reconcile_run(**args)
    return created, request.call_args.kwargs["payload"]


def test_setup_failure_creates_failed_history_with_github_step() -> None:
    with patch("record_workflow_run.fetch_existing_history", return_value=None):
        created, payload = _call()

    assert created is True
    assert payload["p_workflow"] == "weekly"
    assert payload["p_status"] == "failed"
    assert payload["p_started_at"] == "2026-11-06T01:00:00+00:00"
    assert payload["p_ended_at"] == "2026-11-06T01:05:00+00:00"
    assert payload["p_duration_s"] == 300.0
    assert payload["p_github_run_id"] == "123"
    assert payload["p_github_run_attempt"] == 2
    assert payload["p_failure_reason"] == "GitHub Actions job concluded with failure."
    assert payload["p_failed_step"] == "Install dependencies"
    assert payload["p_regions_ok"] == 0
    assert "p_region_results" not in payload


def test_existing_partial_history_keeps_status_counts_and_reason() -> None:
    existing = {
        "status": "partial",
        "regions_ok": 2,
        "regions_failed": 1,
        "regions_skipped": 3,
        "failure_reason": "Bicol PDF still unavailable",
        "failed_step": "PDF download",
    }
    with patch("record_workflow_run.fetch_existing_history", return_value=existing):
        created, payload = _call(workflow="pending-retry")

    assert created is False
    assert payload["p_status"] == "partial"
    assert payload["p_regions_ok"] == 2
    assert payload["p_regions_failed"] == 1
    assert payload["p_regions_skipped"] == 3
    assert payload["p_failure_reason"] == "Bicol PDF still unavailable"
    assert payload["p_failed_step"] == "PDF download"


def test_output_payload_recovers_counts_when_initial_database_write_failed() -> None:
    history_payload = json.dumps(
        {
            "status": "success",
            "regions_ok": 5,
            "regions_failed": 0,
            "regions_skipped": 0,
            "failure_reason": None,
            "failed_step": None,
        }
    )
    successful_job = {**FAILED_JOB, "conclusion": "success", "steps": []}
    with (
        patch("record_workflow_run.fetch_existing_history", return_value=None),
        patch("record_workflow_run._github_job", return_value=successful_job),
        patch("record_workflow_run._request_json", return_value={}) as request,
    ):
        created = reconcile_run(
            workflow="weekly",
            job_name="Sync latest bulletins (all regions)",
            job_result="success",
            repository="NotEajay/Gasta",
            run_id="123",
            run_attempt=2,
            github_token="token",
            supabase_url="https://example.supabase.co",
            service_key="service-key",
            history_payload=history_payload,
        )

    payload = request.call_args.kwargs["payload"]
    assert created is True
    assert payload["p_status"] == "success"
    assert payload["p_regions_ok"] == 5


@pytest.fixture
def region_results() -> dict:
    return {
        "version": 1,
        "regions": [
            {
                "region_code": code,
                "status": "processed" if index < 2 else "no_work",
                "fetch_status": "fetched" if index < 2 else "not_attempted",
                "week_start": "2026-11-03" if index < 2 else None,
                "price_rows": 12 if index < 2 else 0,
                "companies": 3 if index < 2 else None,
                "issues": [],
            }
            for index, code in enumerate(
                ("NCR", "NORTH_LUZON", "SOUTH_LUZON", "VISAYAS", "MINDANAO")
            )
        ],
    }


def test_existing_lookup_selects_all_columns_and_exact_attempt() -> None:
    legacy_row = {"status": "failed", "regions_ok": 0}
    with patch("record_workflow_run._request_json", return_value=[legacy_row]) as request:
        found = fetch_existing_history(
            supabase_url="https://example.supabase.co/",
            service_key="service-key",
            workflow="pending-retry",
            run_id="123",
            run_attempt=3,
        )
    assert found == legacy_row
    url = urllib.parse.urlparse(request.call_args.args[0])
    assert url.path == "/rest/v1/doe_etl_runs"
    assert urllib.parse.parse_qs(url.query) == {
        "select": ["*"],
        "workflow": ["eq.pending-retry"],
        "github_run_id": ["eq.123"],
        "github_run_attempt": ["eq.3"],
        "limit": ["1"],
    }


def test_github_jobs_lookup_is_attempt_specific(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GITHUB_API_URL", "https://api.github.com/")
    with patch(
        "record_workflow_run._request_json", return_value={"jobs": [FAILED_JOB]}
    ) as request:
        job = _github_job(
            repository="NotEajay/Gasta", run_id="123", run_attempt=3,
            token="token", job_name=FAILED_JOB["name"],
        )
    assert job == FAILED_JOB
    assert request.call_args.args[0] == (
        "https://api.github.com/repos/NotEajay/Gasta/actions/runs/123/attempts/3/jobs?per_page=100"
    )


def test_reconcile_passes_requested_attempt_to_jobs_endpoint() -> None:
    with (
        patch("record_workflow_run.fetch_existing_history", return_value=None),
        patch("record_workflow_run._request_json", return_value={}) as request,
    ):
        reconcile_run(
            workflow="weekly", job_name=FAILED_JOB["name"], job_result="failure",
            repository="NotEajay/Gasta", run_id="123", run_attempt=4,
            github_token="token", supabase_url="https://example.supabase.co",
            service_key="service-key",
        )
    assert "/runs/123/attempts/4/jobs?" in request.call_args_list[0].args[0]
    assert request.call_args.kwargs["payload"]["p_github_run_attempt"] == 4


def test_failed_existing_lookup_still_saves_handoff(region_results: dict) -> None:
    handoff = {
        "status": "partial", "regions_ok": 2, "regions_failed": 1,
        "regions_skipped": 2, "failure_reason": "Bicol PDF unavailable",
        "failed_step": "PDF download", "region_results": region_results,
    }
    with patch(
        "record_workflow_run.fetch_existing_history", side_effect=RuntimeError("read outage")
    ):
        created, payload = _call(history_payload=json.dumps(handoff))
    assert created is True
    assert payload["p_status"] == "partial"
    assert payload["p_regions_ok"] == 2
    assert payload["p_failure_reason"] == "Bicol PDF unavailable"
    assert payload["p_region_results"] == region_results


@pytest.mark.parametrize("existing_has_snapshot", [False, True])
def test_current_rich_handoff_overrides_sparse_or_older_row(
    region_results: dict, existing_has_snapshot: bool,
) -> None:
    existing = {
        "status": "failed", "regions_ok": 0, "regions_failed": 0,
        "regions_skipped": 0, "failure_reason": "Fallback failure",
        "failed_step": "region sync", "region_results": None,
    }
    if existing_has_snapshot:
        older = json.loads(json.dumps(region_results))
        older["regions"][0].update(status="not_processed", fetch_status="unknown", price_rows=0)
        existing["region_results"] = older
    handoff = {
        "status": "partial", "regions_ok": 2, "regions_failed": 1,
        "regions_skipped": 2, "failure_reason": "Actual PDF failure",
        "failed_step": "PDF download", "region_results": region_results,
    }
    with patch("record_workflow_run.fetch_existing_history", return_value=existing):
        created, payload = _call(history_payload=json.dumps(handoff))
    assert created is False
    assert payload["p_status"] == "partial"
    assert payload["p_regions_ok"] == 2
    assert payload["p_regions_failed"] == 1
    assert payload["p_regions_skipped"] == 2
    assert payload["p_failure_reason"] == "Actual PDF failure"
    assert payload["p_failed_step"] == "PDF download"
    assert payload["p_region_results"] == region_results


@pytest.mark.parametrize("handoff", [None, {}, {"region_results": None}, {
    "status": "failed", "regions_ok": 0, "regions_failed": 0,
    "failure_reason": "Sparse fallback", "region_results": None,
}])
def test_rich_existing_row_survives_missing_or_sparse_handoff(
    region_results: dict, handoff: dict | None,
) -> None:
    existing = {
        "status": "partial", "regions_ok": 2, "regions_failed": 1,
        "regions_skipped": 2, "failure_reason": "Actual PDF failure",
        "failed_step": "PDF download", "region_results": region_results,
    }
    with patch("record_workflow_run.fetch_existing_history", return_value=existing):
        created, payload = _call(history_payload=json.dumps(handoff) if handoff is not None else None)
    assert created is False
    assert payload["p_status"] == "partial"
    assert payload["p_regions_ok"] == 2
    assert payload["p_failure_reason"] == "Actual PDF failure"
    assert payload["p_region_results"] == region_results


def test_github_outage_preserves_handoff_timing_and_snapshot(region_results: dict) -> None:
    handoff = {
        "status": "success", "started_at": "2026-11-06T01:00:00Z",
        "ended_at": "2026-11-06T01:01:00Z", "regions_ok": 2,
        "regions_failed": 0, "regions_skipped": 3, "region_results": region_results,
    }
    with (
        patch("record_workflow_run.fetch_existing_history", return_value=None),
        patch("record_workflow_run._github_job", side_effect=RuntimeError("GitHub unavailable")),
        patch("record_workflow_run._request_json", return_value={}) as request,
    ):
        reconcile_run(
            workflow="weekly", job_name=FAILED_JOB["name"], job_result="success",
            repository="NotEajay/Gasta", run_id="123", run_attempt=2,
            github_token="token", supabase_url="https://example.supabase.co",
            service_key="service-key", history_payload=json.dumps(handoff),
        )
    payload = request.call_args.kwargs["payload"]
    assert payload["p_status"] == "success"
    assert payload["p_started_at"] == "2026-11-06T01:00:00+00:00"
    assert payload["p_duration_s"] == 60.0
    assert payload["p_region_results"] == region_results


@pytest.mark.parametrize("handoff", [None, "{broken", "[]", '{"region_results":null}'])
def test_pre_job_failure_does_not_fabricate_region_snapshot(handoff: str | None) -> None:
    with patch("record_workflow_run.fetch_existing_history", return_value=None):
        _, payload = _call(history_payload=handoff)
    assert payload["p_status"] == "failed"
    assert "p_region_results" not in payload
