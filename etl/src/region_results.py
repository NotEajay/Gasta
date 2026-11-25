"""Structured observations for DOE workflow history; never control ETL decisions."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from .constants import ALL_REGION_KEYS, REGION_CODES


@dataclass
class RegionRunResult:
    region_code: str
    status: str = "not_processed"
    fetch_status: str = "not_attempted"
    week_start: str | None = None
    price_rows: int = 0
    companies: int | None = None
    issues: list[dict[str, Any]] = field(default_factory=list)
    step: str | None = None
    slug: str | None = None
    retry_queued: bool | None = None
    retry_checked_at: str | None = None
    _last_exception: Exception | None = field(default=None, repr=False)
    _downloads: list[bool] = field(default_factory=list, repr=False)
    parse_input_available: bool | None = None

    def start(self, step: str) -> None:
        self.status = "processed"
        self.step = step
        self._last_exception = None
        self.parse_input_available = None

    def downloaded(self, fetched: bool) -> None:
        self._downloads.append(fetched)
        self.fetch_status = (
            "fetched" if all(self._downloads)
            else "partial" if any(self._downloads)
            else "not_fetched"
        )

    def issue(
        self, kind: str, message: str, *, slug: str | None = None
    ) -> dict[str, Any]:
        item = {
            "kind": kind,
            "message": message,
            "step": self.step,
            "week_start": self.week_start,
            "slug": slug if slug is not None else self.slug,
            "retry_queued": self.retry_queued,
            "retry_checked_at": self.retry_checked_at,
        }
        for existing in self.issues:
            if item == existing:
                return existing
        self.issues.append(item)
        return item

    def failed(self, exc: Exception) -> None:
        if self._last_exception is exc:
            return
        self._last_exception = exc
        if self.step in {"discovery", "PDF download"}:
            self.downloaded(False)
            kind = "not_fetched"
        elif self.step == "PDF parse":
            if self.parse_input_available is False and any(
                item["kind"] == "not_fetched" and item["week_start"] == self.week_start
                for item in self.issues
            ):
                return
            kind = "unreadable"
        else:
            kind = "error"
            if self.fetch_status == "not_attempted":
                self.fetch_status = "unknown"
        self.issue(kind, f"{type(exc).__name__}: {exc}")

    def snapshot(self) -> dict[str, Any]:
        return {
            "region_code": self.region_code,
            "status": self.status,
            "fetch_status": self.fetch_status,
            "week_start": self.week_start,
            "price_rows": self.price_rows,
            "companies": self.companies,
            "issues": [dict(issue) for issue in self.issues],
        }


def new_region_results() -> dict[str, RegionRunResult]:
    return {
        REGION_CODES[key]: RegionRunResult(REGION_CODES[key])
        for key in ALL_REGION_KEYS
    }


def region_results_payload(results: dict[str, RegionRunResult]) -> dict[str, Any]:
    return {"version": 1, "regions": [result.snapshot() for result in results.values()]}


def confirm_pending(
    row: Any, *, region_code: str, week_start: str | None, slug: str | None
) -> tuple[bool | None, str | None]:
    """Only a matching returned queue row proves that the PDF was queued."""
    if (
        isinstance(row, dict)
        and row.get("id") is not None
        and row.get("region_code") == region_code
        and row.get("bulletin_date") == week_start
        and row.get("slug") == slug
        and week_start
        and slug
    ):
        return True, datetime.now(timezone.utc).isoformat()
    return None, None
