"""Backfill the full DOE bulletin archive so the app can show real price history.

The weekly sync only ever loads the newest bulletin. This module walks a region's
entire DOE archive instead, which is what populates the week-by-week history and
trend charts in the app.

DOE's archive is not uniform. Across 2024–2026 it has published a macro-region as a
single combined PDF, as one PDF per sub-region, and as sequentially numbered files
that carry no date at all. So rather than trusting filenames, the backfill parses
every PDF and groups the results by the week each bulletin *states* in its header,
merging whatever sub-region files share a week.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date
from pathlib import Path

from .constants import ALL_REGION_KEYS
from .discover import (
    BulletinDocument,
    discover_region_documents,
    resolve_region_code,
)
from .download import download_slug, slug_to_url
from .load_supabase import fetch_loaded_weeks, load_bulletin
from .parse_bulletin import (
    BulletinDateUnknown,
    BulletinNotMachineReadable,
    ParsedBulletin,
    merge_parsed_bulletins,
    parse_bulletin_pdf,
)


@dataclass
class WeekResult:
    region_code: str
    week_start: str
    price_rows: int
    companies: int
    pdf_count: int
    loaded: bool = False
    skipped: bool = False
    message: str = ""
    warnings: list[str] = field(default_factory=list)


@dataclass
class BackfillReport:
    region_code: str
    documents_found: int
    weeks_loaded: int
    weeks_skipped: int
    weeks_failed: int
    price_rows: int
    oldest_week: str = ""
    newest_week: str = ""
    weeks: list[WeekResult] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    # Weeks DOE published only as page scans; no prices exist to load.
    unreadable: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        payload = asdict(self)
        payload["weeks"] = [asdict(week) for week in self.weeks]
        return payload


def _select_documents(
    documents: list[BulletinDocument],
    *,
    since: date | None,
    until: date | None,
    loaded_weeks: set[str],
    force: bool,
) -> list[BulletinDocument]:
    """Narrow the archive to the documents worth downloading.

    Undated documents always pass: their week is unknowable until parsed, so they
    cannot be filtered or skipped up front.
    """
    selected: list[BulletinDocument] = []
    for document in documents:
        week = document.week_start
        if week is None:
            selected.append(document)
            continue
        if since and week < since:
            continue
        if until and week > until:
            continue
        if not force and week.isoformat() in loaded_weeks:
            continue
        selected.append(document)
    return selected


def _parse_documents(
    documents: list[BulletinDocument],
    region_code: str,
    dest_dir: Path,
    errors: list[str],
    unreadable: list[str],
) -> list[ParsedBulletin]:
    parsed: list[ParsedBulletin] = []
    for document in documents:
        try:
            path = download_slug(region_code, document.slug, dest_dir)
            parsed.append(
                parse_bulletin_pdf(
                    path,
                    region_code,
                    fallback_week_start=document.week_start,
                    source_url=slug_to_url(document.slug),
                )
            )
        except BulletinNotMachineReadable as exc:
            # DOE published this week as a scan. Nothing is wrong with the pipeline,
            # so it is reported apart from genuine failures.
            unreadable.append(f"{document.slug}: {exc}")
        except BulletinDateUnknown as exc:
            errors.append(f"{document.slug}: {exc}")
        except Exception as exc:  # noqa: BLE001 — one bad PDF must not stop the archive
            errors.append(f"{document.slug}: {type(exc).__name__}: {exc}")
    return parsed


def _group_by_stated_week(parsed: list[ParsedBulletin]) -> dict[date, list[ParsedBulletin]]:
    weeks: dict[date, list[ParsedBulletin]] = {}
    for bulletin in parsed:
        weeks.setdefault(bulletin.bulletin_date, []).append(bulletin)
    return weeks


def backfill_region(
    region_key: str,
    *,
    dest_dir: str | Path = "data/bulletins",
    since: date | None = None,
    until: date | None = None,
    dry_run: bool = False,
    force: bool = False,
    max_weeks: int | None = None,
) -> BackfillReport:
    """Load every DOE bulletin week available for one macro-region."""
    region_code = resolve_region_code(region_key)
    dest_dir = Path(dest_dir)

    documents = discover_region_documents(region_code)
    loaded_weeks = set() if (force or dry_run) else fetch_loaded_weeks(region_code)
    report = BackfillReport(
        region_code=region_code,
        documents_found=len(documents),
        weeks_loaded=0,
        weeks_skipped=0,
        weeks_failed=0,
        price_rows=0,
    )

    selected = _select_documents(
        documents,
        since=since,
        until=until,
        loaded_weeks=loaded_weeks,
        force=force,
    )
    if not selected:
        report.errors.append("Nothing to do - every discovered week is already loaded.")
        return report

    parsed = _parse_documents(
        selected, region_code, dest_dir, report.errors, report.unreadable
    )
    weeks = _group_by_stated_week(parsed)

    ordered_weeks = sorted(weeks, reverse=True)
    if max_weeks is not None:
        ordered_weeks = ordered_weeks[:max_weeks]

    for week_start in sorted(ordered_weeks):
        group = weeks[week_start]
        if not force and week_start.isoformat() in loaded_weeks:
            report.weeks_skipped += 1
            report.weeks.append(
                WeekResult(
                    region_code=region_code,
                    week_start=week_start.isoformat(),
                    price_rows=0,
                    companies=0,
                    pdf_count=len(group),
                    skipped=True,
                    message="Already loaded.",
                )
            )
            continue

        try:
            merged = merge_parsed_bulletins(group)
        except ValueError as exc:
            report.weeks_failed += 1
            report.errors.append(f"{week_start.isoformat()}: {exc}")
            continue

        if not merged.prices:
            report.weeks_skipped += 1
            report.weeks.append(
                WeekResult(
                    region_code=region_code,
                    week_start=week_start.isoformat(),
                    price_rows=0,
                    companies=0,
                    pdf_count=len(group),
                    skipped=True,
                    message="No prices extracted - likely an image-only PDF.",
                    warnings=merged.warnings,
                )
            )
            continue

        stats = load_bulletin(merged, dry_run=dry_run)
        report.weeks_loaded += 1
        report.price_rows += stats["price_rows"]
        report.weeks.append(
            WeekResult(
                region_code=region_code,
                week_start=week_start.isoformat(),
                price_rows=stats["price_rows"],
                companies=stats["companies"],
                pdf_count=len(group),
                loaded=True,
                message="Dry run - no database write." if dry_run else "Loaded.",
                warnings=merged.warnings,
            )
        )

    loaded = [w.week_start for w in report.weeks if w.loaded or w.skipped]
    if loaded:
        report.oldest_week = min(loaded)
        report.newest_week = max(loaded)
    return report


def backfill_all_regions(
    *,
    dest_dir: str | Path = "data/bulletins",
    since: date | None = None,
    until: date | None = None,
    dry_run: bool = False,
    force: bool = False,
    max_weeks: int | None = None,
    region_keys: tuple[str, ...] = ALL_REGION_KEYS,
) -> list[BackfillReport]:
    """Backfill each macro-region; a region that fails does not stop the others."""
    reports: list[BackfillReport] = []
    for region_key in region_keys:
        try:
            reports.append(
                backfill_region(
                    region_key,
                    dest_dir=dest_dir,
                    since=since,
                    until=until,
                    dry_run=dry_run,
                    force=force,
                    max_weeks=max_weeks,
                )
            )
        except Exception as exc:  # noqa: BLE001 — keep going through the region list
            reports.append(
                BackfillReport(
                    region_code=resolve_region_code(region_key),
                    documents_found=0,
                    weeks_loaded=0,
                    weeks_skipped=0,
                    weeks_failed=0,
                    price_rows=0,
                    errors=[f"{type(exc).__name__}: {exc}"],
                )
            )
    return reports
