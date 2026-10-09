"""Explicit SEAOIL review decisions. Source IDs identify records, not physical sameness.

Name/address matches are warning signals, never a database uniqueness constraint.
Unreviewed matching pairs are quarantined; evidence-approved distinct IDs coexist.
"""
from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from .seaoil import Station, clean, identity, official_url

DEFAULT_REVIEW_FILE = Path(__file__).parent / "review" / "seaoil_ambiguous.json"
STATUSES = {"pending_review", "approved_distinct"}


def _data(row: Station | dict) -> dict:
    return row.preview() if isinstance(row, Station) else row


def listing_fingerprint(row: Station | dict) -> str:
    data = _data(row)
    # Approval is tied to the listing reviewed, not an everlasting slug allowlist.
    fields = {key: data.get(key) for key in ("source_station_id", "source_url", "name", "address", "operating_hours")}
    return hashlib.sha256(json.dumps(fields, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def load_reviews(path: Path = DEFAULT_REVIEW_FILE) -> dict[str, dict]:
    # Missing/corrupt registry is an error, not permission to ingest known ambiguities.
    manifest = json.loads(path.read_text())
    if manifest.get("version") != 1 or manifest.get("company_slug") != "seaoil" or not isinstance(manifest.get("records"), list):
        raise ValueError("Invalid SEAOIL review manifest")
    reviews = {}
    for entry in manifest["records"]:
        source_id = entry.get("source_station_id")
        if not isinstance(source_id, str) or not source_id or source_id in reviews:
            raise ValueError("Missing/duplicate review source ID")
        if entry.get("status") not in STATUSES or not entry.get("reason") or not entry.get("listing_fingerprint"):
            raise ValueError("Invalid review status/reason/fingerprint")
        if entry["status"] == "approved_distinct" and not all(entry.get(key) for key in ("reviewed_by", "reviewed_at", "evidence")):
            raise ValueError("Distinct approval requires reviewer, date, and evidence")
        reviews[source_id] = entry
    return reviews


@dataclass
class ImportPlan:
    eligible: list
    quarantined: list[dict]
    warnings: list[dict]

    def summary(self) -> dict:
        return {"safe_records": len(self.eligible), "quarantined_records": len(self.quarantined),
                "duplicate_name_address_warnings": len(self.warnings),
                "quarantined_source_ids": [q["record"]["source_station_id"] for q in self.quarantined]}


def plan_import(rows: list, reviews: dict[str, dict] | None = None) -> ImportPlan:
    registry = load_reviews() if reviews is None else reviews
    keys, source_ids, pairs = set(), set(), defaultdict(list)
    for row in rows:
        data = _data(row)
        source_id, key = data.get("source_station_id"), data.get("directory_key")
        if key in keys or (source_id and source_id in source_ids):
            raise ValueError("Duplicate import identities")
        if not source_id or key != identity(source_id, data["name"], data.get("address")):
            raise ValueError("SEAOIL import requires a source ID and matching primary key")
        if data.get("source_type", "official_directory") != "official_directory":
            raise ValueError("Review planner accepts official directory records only")
        if official_url(data["source_url"]) != "https://www.seaoil.com.ph/stations/" + source_id:
            raise ValueError("Source URL does not match authoritative source ID")
        keys.add(key)
        source_ids.add(source_id)
        if data.get("address"):
            pairs[(clean(data["name"]).casefold(), clean(data["address"]).casefold())].append(row)
    warnings, matched_ids = [], set()
    for pair, members in pairs.items():
        if len(members) > 1:
            ids = [_data(row)["source_station_id"] for row in members]
            matched_ids.update(ids)
            warnings.append({"normalized_name": pair[0], "normalized_address": pair[1], "source_station_ids": ids})
    eligible, quarantined = [], []
    for row in rows:
        data = _data(row)
        source_id = data["source_station_id"]
        decision = registry.get(source_id)
        reason = None
        if decision:
            if decision.get("status") not in STATUSES:
                raise ValueError("Invalid review status")
            if decision["status"] == "pending_review":
                reason = decision["reason"]
            elif not all(decision.get(field) for field in ("reviewed_by", "reviewed_at", "evidence")):
                raise ValueError("Distinct approval requires reviewer, date, and evidence")
            elif decision.get("listing_fingerprint") != listing_fingerprint(row):
                reason = "Reviewed listing changed; approval requires re-review"
        elif source_id in matched_ids:
            reason = "Unreviewed matching normalized name/address; distinct source IDs retained"
        if reason:
            quarantined.append({"record": data, "status": "pending_review", "reason": reason})
        else:
            eligible.append(row)
    return ImportPlan(eligible=eligible, quarantined=quarantined, warnings=warnings)
