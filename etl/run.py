#!/usr/bin/env python3
"""GasTa ETL CLI — parse DOE PDF bulletins and load into Supabase."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path

# Allow running as `python run.py` from etl/
sys.path.insert(0, str(Path(__file__).parent))

from src.automation import (
    summarise_results,
    sync_all_regions,
    sync_latest_ncr,
    sync_latest_region,
    sync_result_to_json,
)
from src.backfill import backfill_all_regions, backfill_region
from src.constants import ALL_REGION_KEYS
from src.discover import discover_latest_region, discover_region_bulletins
from src.download import download_ncr_bulletin, download_region_bulletins, normalize_region
from src.export_sql import export_bulletin_sql
from src.freshness import MAX_BULLETIN_AGE_DAYS, describe_freshness
from src.load_supabase import load_bulletin
from src.parse_bulletin import parse_bulletin_pdf, parse_region_pdfs
from src.pending_retry import retry_pending_downloads


def cmd_parse(args: argparse.Namespace) -> None:
    region = normalize_region(args.region)
    paths = [Path(p) for p in args.pdf]
    if len(paths) == 1:
        fallback = date.fromisoformat(args.week) if args.week else None
        parsed = parse_bulletin_pdf(paths[0], region, fallback_week_start=fallback)
    else:
        fallback = date.fromisoformat(args.week) if args.week else None
        parsed = parse_region_pdfs(paths, region, fallback_week_start=fallback)
    payload = parsed.to_dict()
    if args.output:
        Path(args.output).write_text(json.dumps(payload, indent=2))
        print(f"Wrote {args.output}")
    else:
        print(json.dumps(payload, indent=2))
    print(f"\nParsed {len(parsed.prices)} prices for {region} week starting {parsed.bulletin_date}")


def cmd_load(args: argparse.Namespace) -> None:
    region = normalize_region(args.region)
    paths = [Path(p) for p in args.pdf]
    fallback = date.fromisoformat(args.week) if args.week else None
    parsed = parse_region_pdfs(paths, region, fallback_week_start=fallback)
    result = load_bulletin(parsed, dry_run=args.dry_run)
    print(json.dumps(result, indent=2))


def cmd_run(args: argparse.Namespace) -> None:
    cmd_load(args)


def cmd_export_sql(args: argparse.Namespace) -> None:
    region = normalize_region(args.region)
    paths = [Path(p) for p in args.pdf]
    fallback = date.fromisoformat(args.week) if args.week else None
    parsed = parse_region_pdfs(paths, region, fallback_week_start=fallback)
    sql = export_bulletin_sql(parsed)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(sql)
    print(f"Wrote {out} ({len(parsed.prices)} price rows)")


def _status_table(results: list) -> str:
    """Per-region status table, so a scheduled log never implies a region was
    refreshed when it was not."""
    width = max((len(r.region_code) for r in results), default=9)
    lines = []
    for result in results:
        week = result.week_start or "-"
        lines.append(f"{result.region_code:<{width}}  {result.status:<22}  {week}")
    return "\n".join(lines)


def _report_staleness(results: list) -> None:
    """Explain, on stderr, exactly why a run is being failed for stale data."""
    stale = [r for r in results if getattr(r, "stale", False) and not r.upstream_unavailable]
    if not stale:
        return
    today = date.today()
    print("STALE: newest bulletin is too old to serve as current DOE data.", file=sys.stderr)
    for result in stale:
        week = date.fromisoformat(result.week_start) if result.week_start else None
        print(
            f"  - {result.region_code}: {result.week_start or 'no week resolved'}; "
            f"{describe_freshness(week, today)}",
            file=sys.stderr,
        )
    print(
        f"  Threshold: {MAX_BULLETIN_AGE_DAYS} days since estimated DOE post "
        "(week start + 7 days — the following Tuesday). "
        "That matches the old 14-day week-start grace for one late publication.",
        file=sys.stderr,
    )
    print(
        "  This usually means DOE's archive page changed and discovery is no longer "
        "finding the newest bulletin. Check `python run.py list-weeks --region ncr`.",
        file=sys.stderr,
    )


def _report_unavailable(results: list) -> None:
    """Name the regions DOE is not currently serving, without calling them refreshed."""
    unavailable = [r for r in results if r.upstream_unavailable]
    if not unavailable:
        return
    print(
        f"WARNING: {len(unavailable)} region(s) are not currently published by DOE "
        "(upstream unavailable). No data was loaded for them:",
        file=sys.stderr,
    )
    for result in unavailable:
        print(f"  - {result.region_code}: {result.message}", file=sys.stderr)
    print(
        "  Ingestion resumes automatically once DOE serves the page again; no code "
        "change is needed.",
        file=sys.stderr,
    )


def _report_fuel_gaps(results: list) -> None:
    """Call out regions whose parse/load still lacks RON 91 or Diesel Plus."""
    gaps = [r for r in results if getattr(r, "missing_fuels", ())]
    if not gaps:
        return
    print(
        "FUEL GAP: RON 91 and/or Diesel Plus missing — Prices filters for those "
        "fuels will be empty:",
        file=sys.stderr,
    )
    for result in gaps:
        print(
            f"  - {result.region_code} ({result.week_start or 'no week'}): "
            f"{', '.join(result.missing_fuels)}",
            file=sys.stderr,
        )


def cmd_sync_ncr(args: argparse.Namespace) -> None:
    result = sync_latest_ncr(
        dest_dir=args.out_dir,
        dry_run=args.dry_run,
        force=args.force,
    )
    print(sync_result_to_json(result))
    _report_staleness([result])
    if result.stale:
        sys.exit(1)
    if result.skipped:
        sys.exit(0)
    if result.price_rows == 0 and not args.dry_run and "Failed" not in result.message:
        sys.exit(1)


def cmd_sync_region(args: argparse.Namespace) -> None:
    result = sync_latest_region(
        args.region,
        dest_dir=args.out_dir,
        dry_run=args.dry_run,
        force=args.force,
    )
    print(sync_result_to_json(result))
    _report_staleness([result])
    if result.stale:
        sys.exit(1)
    if result.price_rows == 0 and not args.dry_run and not result.skipped and "Failed" not in result.message:
        sys.exit(1)


def cmd_sync_all(args: argparse.Namespace) -> None:
    results = sync_all_regions(
        dest_dir=args.out_dir,
        dry_run=args.dry_run,
        force=args.force,
    )
    print(json.dumps([json.loads(sync_result_to_json(r)) for r in results], indent=2))

    print("\nDOE region status")
    print("----------------")
    print(_status_table(results))

    _report_unavailable(results)
    _report_staleness(results)
    _report_fuel_gaps(results)

    verdict = summarise_results(results)
    print(f"\nOverall: {verdict}")

    # Upstream-unavailable regions are reported but non-fatal. Everything else that is
    # not "current" is a real failure: a stale week that is already stored reports
    # `skipped`, which the price-row failure check ignores -- that combination is how
    # NCR sat on 2026-08-25 while every scheduled run exited 0.
    if verdict.startswith("FAILED"):
        sys.exit(1)
    failures = [r for r in results if r.price_rows == 0 and not r.skipped and "Failed" in r.message]
    if failures and not args.dry_run:
        sys.exit(1)


def cmd_discover(args: argparse.Namespace) -> None:
    discovered = discover_latest_region(args.region)
    print(
        json.dumps(
            {
                "region_code": discovered.region_code,
                "week_start": discovered.week_start.isoformat(),
                "slugs": discovered.slugs,
                "urls": [f"https://prod-cms.doe.gov.ph/documents/d/guest/{s}" for s in discovered.slugs],
                "source": discovered.source,
            },
            indent=2,
        )
    )


def cmd_download_ncr(args: argparse.Namespace) -> None:
    week_start = date.fromisoformat(args.week)
    dest = download_ncr_bulletin(week_start, args.out_dir)
    print(f"Downloaded {dest}")


def cmd_download_region(args: argparse.Namespace) -> None:
    discovered = discover_latest_region(args.region)
    downloaded = download_region_bulletins(
        args.region,
        discovered.slugs,
        args.out_dir,
        discovered.urls,
    )
    for path in downloaded.paths:
        print(f"Downloaded {path}")
    for skip in downloaded.skipped:
        print(f"Skipped {skip.note()}")


def _week_bounds(args: argparse.Namespace) -> tuple[date | None, date | None]:
    since = date.fromisoformat(args.since) if args.since else None
    until = date.fromisoformat(args.until) if args.until else None
    if args.weeks:
        window_start = date.today() - timedelta(weeks=args.weeks)
        since = max(since, window_start) if since else window_start
    return since, until


def _print_backfill_summary(reports: list) -> None:
    print("\n=== Backfill summary ===")
    for report in reports:
        print(
            f"{report.region_code:<12} found={report.documents_found:<4} "
            f"loaded={report.weeks_loaded:<4} skipped={report.weeks_skipped:<4} "
            f"failed={report.weeks_failed:<3} prices={report.price_rows:<6} "
            f"weeks={report.oldest_week or '-'} .. {report.newest_week or '-'}"
        )
        for error in report.errors:
            print(f"  ! {error}")
        for note in report.unreadable:
            print(f"  - skipped (DOE published a scan): {note}")
        for note in report.rejected_out_of_range:
            print(f"  - out of requested range: {note}")
        for week in report.weeks:
            for warning in week.warnings:
                print(f"  ~ {week.week_start}: {warning}")


def cmd_backfill(args: argparse.Namespace) -> None:
    since, until = _week_bounds(args)
    reports = (
        backfill_all_regions(
            dest_dir=args.out_dir,
            since=since,
            until=until,
            dry_run=args.dry_run,
            force=args.force,
            max_weeks=args.max_weeks,
        )
        if args.region == "all"
        else [
            backfill_region(
                args.region,
                dest_dir=args.out_dir,
                since=since,
                until=until,
                dry_run=args.dry_run,
                force=args.force,
                max_weeks=args.max_weeks,
            )
        ]
    )
    print(json.dumps([r.to_dict() for r in reports], indent=2))
    _print_backfill_summary(reports)

    # A week dated in the future can only be a mis-parse of a PDF DOE actually
    # published. It is rejected rather than loaded, but it is also a real defect in
    # what the parser read, so a production run fails loudly instead of quietly
    # leaving the archive short a week. Dry runs report without failing.
    for report in reports:
        for entry in report.rejected_future:
            print(f"REJECTED FUTURE WEEK: {entry}", file=sys.stderr)
            print(
                "  This week is dated after today, which means the PDF header was read "
                "incorrectly. It was NOT loaded.",
                file=sys.stderr,
            )
    if any(r.rejected_future for r in reports) and not args.dry_run:
        sys.exit(1)

    if not args.dry_run and all(r.weeks_loaded == 0 and r.weeks_skipped == 0 for r in reports):
        sys.exit(1)


def cmd_list_weeks(args: argparse.Namespace) -> None:
    bulletins = discover_region_bulletins(args.region)
    print(
        json.dumps(
            [
                {
                    "week_start": b.week_start.isoformat(),
                    "slugs": list(b.slugs),
                }
                for b in bulletins
            ],
            indent=2,
        )
    )
    print(f"\n{len(bulletins)} datable bulletin weeks discovered for {args.region}")


def cmd_retry_pending(args: argparse.Namespace) -> None:
    """Daily probe of PDFs skipped by weekly sync (403/missing). Idle if none."""
    results = retry_pending_downloads(dest_dir=args.out_dir, dry_run=args.dry_run)
    print(
        json.dumps(
            [
                {
                    "region_code": r.region_code,
                    "week_start": r.week_start,
                    "slug": r.slug,
                    "status": r.status,
                    "message": r.message,
                    "price_rows": r.price_rows,
                }
                for r in results
            ],
            indent=2,
        )
    )
    recovered = sum(1 for r in results if r.status == "recovered")
    pending = sum(1 for r in results if r.status == "still_pending")
    errors = sum(1 for r in results if r.status == "error")
    idle = any(r.status == "idle" for r in results)
    if idle:
        print("\nPending retry: IDLE (nothing queued)")
    else:
        print(
            f"\nPending retry: recovered={recovered} still_pending={pending} errors={errors}"
        )
    # Unexpected errors fail the job; still-403 is expected and stays green.
    if errors:
        sys.exit(1)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="GasTa DOE PDF ETL")
    sub = parser.add_subparsers(dest="command", required=True)

    p_parse = sub.add_parser("parse", help="Parse PDF(s) and print JSON")
    p_parse.add_argument("pdf", nargs="+", help="Path(s) to DOE bulletin PDF")
    p_parse.add_argument("--region", default="ncr", help="Region key (ncr, north_luzon, ...)")
    p_parse.add_argument("--week", help="Fallback week start YYYY-MM-DD (Visayas slug-only headers)")
    p_parse.add_argument("-o", "--output", help="Optional JSON output file")
    p_parse.set_defaults(func=cmd_parse)

    p_load = sub.add_parser("load", help="Parse PDF(s) and upsert into Supabase")
    p_load.add_argument("pdf", nargs="+", help="Path(s) to DOE bulletin PDF")
    p_load.add_argument("--region", default="ncr", help="Region key (ncr, north_luzon, ...)")
    p_load.add_argument("--week", help="Fallback week start YYYY-MM-DD")
    p_load.add_argument("--dry-run", action="store_true", help="Parse only, do not write to Supabase")
    p_load.set_defaults(func=cmd_load)

    p_run = sub.add_parser("run", help="Alias for load")
    p_run.add_argument("pdf", nargs="+", help="Path(s) to DOE bulletin PDF")
    p_run.add_argument("--region", default="ncr")
    p_run.add_argument("--week", help="Fallback week start YYYY-MM-DD")
    p_run.add_argument("--dry-run", action="store_true")
    p_run.set_defaults(func=cmd_run)

    p_sql = sub.add_parser("export-sql", help="Write INSERT SQL for Supabase SQL Editor")
    p_sql.add_argument("pdf", nargs="+", help="Path(s) to DOE bulletin PDF")
    p_sql.add_argument("--region", default="ncr")
    p_sql.add_argument("--week", help="Fallback week start YYYY-MM-DD")
    p_sql.add_argument("-o", "--output", default="output/import.sql")
    p_sql.set_defaults(func=cmd_export_sql)

    p_dl = sub.add_parser("download-ncr", help="Download an NCR bulletin PDF from DOE")
    p_dl.add_argument("--week", required=True, help="Week start date YYYY-MM-DD")
    p_dl.add_argument("--out-dir", default="data/bulletins", help="Output directory")
    p_dl.set_defaults(func=cmd_download_ncr)

    p_dl2 = sub.add_parser("download-region", help="Download latest bulletin PDF(s) for a region")
    p_dl2.add_argument("--region", required=True, choices=ALL_REGION_KEYS)
    p_dl2.add_argument("--out-dir", default="data/bulletins")
    p_dl2.set_defaults(func=cmd_download_region)

    p_disc = sub.add_parser("discover-region", help="Print latest DOE PDF slug(s) for a region")
    p_disc.add_argument("--region", required=True, choices=ALL_REGION_KEYS)
    p_disc.set_defaults(func=cmd_discover)

    p_sync = sub.add_parser(
        "sync-ncr",
        help="Automated: discover latest DOE NCR PDF, parse, and load to Supabase",
    )
    p_sync.add_argument("--out-dir", default="data/bulletins")
    p_sync.add_argument("--dry-run", action="store_true")
    p_sync.add_argument("--force", action="store_true", help="Reload even if bulletin date exists")
    p_sync.set_defaults(func=cmd_sync_ncr)

    p_sync_r = sub.add_parser("sync-region", help="Discover, download, parse, and load one region")
    p_sync_r.add_argument("--region", required=True, choices=ALL_REGION_KEYS)
    p_sync_r.add_argument("--out-dir", default="data/bulletins")
    p_sync_r.add_argument("--dry-run", action="store_true")
    p_sync_r.add_argument("--force", action="store_true")
    p_sync_r.set_defaults(func=cmd_sync_region)

    p_sync_all = sub.add_parser("sync-all", help="Sync all five macro-regions")
    p_sync_all.add_argument("--out-dir", default="data/bulletins")
    p_sync_all.add_argument("--dry-run", action="store_true")
    p_sync_all.add_argument("--force", action="store_true")
    p_sync_all.set_defaults(func=cmd_sync_all)

    p_pending = sub.add_parser(
        "retry-pending",
        help=(
            "Daily: retry DOE PDFs that weekly sync could not download. "
            "Idle (no work) when the queue is empty."
        ),
    )
    p_pending.add_argument("--out-dir", default="data/bulletins")
    p_pending.add_argument("--dry-run", action="store_true")
    p_pending.set_defaults(func=cmd_retry_pending)

    p_backfill = sub.add_parser(
        "backfill",
        help="Load the full DOE bulletin archive (price history) for one or all regions",
    )
    p_backfill.add_argument(
        "--region",
        default="all",
        choices=("all", *ALL_REGION_KEYS),
        help="Region key, or 'all' for every macro-region",
    )
    p_backfill.add_argument("--since", help="Earliest bulletin week to load (YYYY-MM-DD)")
    p_backfill.add_argument("--until", help="Latest bulletin week to load (YYYY-MM-DD)")
    p_backfill.add_argument("--weeks", type=int, help="Only load the last N weeks")
    p_backfill.add_argument("--max-weeks", type=int, help="Cap how many weeks are loaded")
    p_backfill.add_argument("--out-dir", default="data/bulletins")
    p_backfill.add_argument("--dry-run", action="store_true")
    p_backfill.add_argument("--force", action="store_true", help="Reload weeks already stored")
    p_backfill.set_defaults(func=cmd_backfill)

    p_weeks = sub.add_parser(
        "list-weeks",
        help="Print every bulletin week DOE currently publishes for a region",
    )
    p_weeks.add_argument("--region", required=True, choices=ALL_REGION_KEYS)
    p_weeks.set_defaults(func=cmd_list_weeks)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
