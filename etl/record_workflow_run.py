"""Backfill a workflow-level history row when the ETL command could not save one."""

from __future__ import annotations

import argparse
import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any


def _request_json(
    url: str,
    *,
    headers: dict[str, str],
    method: str = "GET",
    payload: dict[str, Any] | None = None,
) -> Any:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=20) as response:
        raw = response.read()
    return json.loads(raw) if raw else None


def _parse_timestamp(value: str | None, fallback: datetime) -> datetime:
    if not value:
        return fallback
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _github_job(
    *, repository: str, run_id: str, run_attempt: int, token: str, job_name: str
) -> dict[str, Any] | None:
    api_url = (os.environ.get("GITHUB_API_URL") or "https://api.github.com").rstrip("/")
    response = _request_json(
        f"{api_url}/repos/{repository}/actions/runs/{run_id}/attempts/{run_attempt}/jobs?per_page=100",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    jobs = response.get("jobs", []) if isinstance(response, dict) else []
    return next((job for job in jobs if job.get("name") == job_name), None)


def _failed_step(job: dict[str, Any] | None) -> str | None:
    if not job:
        return None
    failed_conclusions = {"failure", "cancelled", "timed_out", "action_required"}
    for step in job.get("steps") or []:
        if step.get("conclusion") in failed_conclusions:
            return step.get("name") or None
    return None


def _supabase_headers(service_key: str) -> dict[str, str]:
    return {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }


def fetch_existing_history(
    *,
    supabase_url: str,
    service_key: str,
    workflow: str,
    run_id: str,
    run_attempt: int,
) -> dict[str, Any] | None:
    query = urllib.parse.urlencode(
        {
            "select": "*",
            "workflow": f"eq.{workflow}",
            "github_run_id": f"eq.{run_id}",
            "github_run_attempt": f"eq.{run_attempt}",
            "limit": "1",
        }
    )
    rows = _request_json(
        f"{supabase_url.rstrip('/')}/rest/v1/doe_etl_runs?{query}",
        headers=_supabase_headers(service_key),
    )
    return rows[0] if rows else None


def _history_payload(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        print(f"WARNING: invalid ETL history payload: {exc}")
        return {}
    return parsed if isinstance(parsed, dict) else {}


def reconcile_run(
    *,
    workflow: str,
    job_name: str,
    job_result: str,
    repository: str,
    run_id: str,
    run_attempt: int,
    github_token: str,
    supabase_url: str,
    service_key: str,
    history_payload: str | None = None,
) -> bool:
    """Reconcile GitHub job timing/outcome with the detailed ETL history, if present."""
    try:
        existing = fetch_existing_history(
            supabase_url=supabase_url,
            service_key=service_key,
            workflow=workflow,
            run_id=run_id,
            run_attempt=run_attempt,
        )
    except Exception as exc:  # noqa: BLE001 — the output handoff can still be saved
        print(f"WARNING: could not read existing ETL history: {type(exc).__name__}: {exc}")
        existing = None
    handoff = _history_payload(history_payload)
    detail = {**(existing or {}), **handoff}
    # Current structured output supersedes a sparse fallback or an earlier snapshot.
    # A legacy/sparse handoff must not replace an already detailed row's outcome.
    if existing and existing.get("region_results") is not None and handoff.get("region_results") is None:
        detail.update(existing)

    now = datetime.now(timezone.utc)
    try:
        job = _github_job(
            repository=repository,
            run_id=run_id,
            run_attempt=run_attempt,
            token=github_token,
            job_name=job_name,
        )
    except Exception as exc:  # noqa: BLE001 — Supabase fallback can still be saved
        print(f"WARNING: could not read GitHub job details: {type(exc).__name__}: {exc}")
        job = None

    conclusion = (job or {}).get("conclusion") or job_result or "failure"
    started_at = _parse_timestamp((job or {}).get("started_at") or detail.get("started_at"), now)
    ended_at = _parse_timestamp((job or {}).get("completed_at") or detail.get("ended_at"), now)
    if ended_at < started_at:
        ended_at = now
    status = detail.get("status") or (
        "success" if conclusion == "success" else "failed"
    )
    failed_step = detail.get("failed_step")
    failure_reason = detail.get("failure_reason")
    if conclusion != "success":
        if not detail or status == "success":
            status = "failed"
        failed_step = failed_step or _failed_step(job)
        failure_reason = failure_reason or f"GitHub Actions job concluded with {conclusion}."

    payload = {
        "p_workflow": workflow,
        "p_status": status,
        "p_started_at": started_at.isoformat(),
        "p_ended_at": ended_at.isoformat(),
        "p_trigger_source": "github-actions",
        "p_github_run_id": run_id,
        "p_github_run_attempt": run_attempt,
        "p_regions_ok": int(detail.get("regions_ok") or 0),
        "p_regions_failed": int(detail.get("regions_failed") or 0),
        "p_regions_skipped": int(detail.get("regions_skipped") or 0),
        "p_duration_s": round(max(0.0, (ended_at - started_at).total_seconds()), 1),
        "p_failure_reason": failure_reason,
        "p_failed_step": failed_step,
    }
    if detail.get("region_results") is not None:
        payload["p_region_results"] = detail["region_results"]
    _request_json(
        f"{supabase_url.rstrip('/')}/rest/v1/rpc/save_doe_etl_run",
        headers=_supabase_headers(service_key),
        method="POST",
        payload=payload,
    )
    return existing is None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workflow", required=True, choices=("weekly", "pending-retry"))
    parser.add_argument("--job-name", required=True)
    parser.add_argument("--job-result", required=True)
    args = parser.parse_args()

    required_env = (
        "GITHUB_REPOSITORY",
        "GITHUB_RUN_ID",
        "GITHUB_RUN_ATTEMPT",
        "GITHUB_TOKEN",
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
    )
    missing = [name for name in required_env if not os.environ.get(name)]
    if missing:
        raise RuntimeError(f"Missing required environment: {', '.join(missing)}")

    created = reconcile_run(
        workflow=args.workflow,
        job_name=args.job_name,
        job_result=args.job_result,
        repository=os.environ["GITHUB_REPOSITORY"],
        run_id=os.environ["GITHUB_RUN_ID"],
        run_attempt=int(os.environ["GITHUB_RUN_ATTEMPT"]),
        github_token=os.environ["GITHUB_TOKEN"],
        supabase_url=os.environ["SUPABASE_URL"],
        service_key=os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        history_payload=os.environ.get("ETL_HISTORY_PAYLOAD"),
    )
    print("Saved fallback ETL history row." if created else "Detailed ETL history already exists.")


if __name__ == "__main__":
    main()
