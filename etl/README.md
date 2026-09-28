# GasTa DOE PDF ETL Pipeline

Python ETL that parses Philippine Department of Energy weekly fuel price bulletins (PDF) and loads structured rows into Supabase.

Two jobs, both automated:

| Job | Command | Purpose |
|-----|---------|---------|
| **Weekly sync** | `python run.py sync-all` | Load the current week so the app always shows the latest price |
| **History backfill** | `python run.py backfill` | Load DOE's whole published archive so the app can show price history |

## Automation

DOE data must be ingested **automatically each week**, not by hand.

### Weekly sync — all five macro-regions

```bash
cd etl
source .venv/bin/activate
python run.py sync-all
```

This discovers, downloads, parses, and loads **NCR, North Luzon, South Luzon, Visayas, and Mindanao**. Each region is skipped independently if that region's prices for the bulletin week already exist in Supabase, so re-running is safe and cheap.

Preview without writing:

```bash
python run.py sync-all --dry-run
```

Single region:

```bash
python run.py sync-region --region north_luzon
python run.py sync-ncr          # NCR only (legacy alias)
```

### History backfill

DOE keeps roughly two years of bulletins on each region page. The backfill walks that archive and loads every week it can parse:

```bash
python run.py backfill                              # all regions, whole archive
python run.py backfill --region visayas             # one region
python run.py backfill --since 2025-01-01           # only from a date onward
python run.py backfill --weeks 26                   # only the last 26 weeks
python run.py backfill --dry-run                    # parse and report, write nothing
```

Weeks already stored are skipped unless you pass `--force`. Downloaded PDFs are cached in `data/bulletins/`, so a repeat run does not re-download.

See what DOE currently publishes for a region without loading anything:

```bash
python run.py list-weeks --region mindanao
python run.py discover-region --region visayas   # latest week only
```

### GitHub Actions (production schedule)

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `doe-etl-weekly.yml` | **Tuesday only** — several PH slots (06:00–23:00) | `sync-all` |
| `doe-etl-backfill.yml` | Manual only | `backfill` with region / since / dry-run inputs |
| `etl-tests.yml` | Push or PR touching `etl/` | `pytest` |

DOE bulletin weeks start Tuesday and files can appear at different times that day, so the weekly workflow tries multiple Tuesday slots. Runs after the first successful one are no-ops because each region's week is already stored. Use **Run workflow** manually if DOE publishes after Tuesday.

**One-time setup**

1. Apply the database prerequisite below.
2. Add repo secrets (GitHub → Settings → Secrets and variables → Actions):

| Secret | Value |
|--------|--------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key from Supabase dashboard |

3. Run **Actions → DOE ETL Backfill → Run workflow** once with region `all` to load the history.

After that the weekly workflow keeps the current week up to date on its own. Manual trigger: **Actions → DOE Weekly ETL → Run workflow**.

---

## Discovery

Each macro-region has a retail pump prices archive page:

```
https://doe.gov.ph/data-and-prices/liquid-fuels/retail-pump-prices/{region}-pump-prices
```

That page links every bulletin PDF for the region. **Two link families are present and
both are read:**

| Family | Shape | Status |
|--------|-------|--------|
| Legacy CMS | `prod-cms.doe.gov.ph/documents/d/guest/<slug>` | Still rendered, but **frozen at 2026-08-25** |
| Current media API | `<cdn>/api/media/file/<url-encoded filename>?prefix=dev%2Fmedia` | Serves all current weeks |

When the same bulletin appears under both, the media link wins. The new family is
matched on the `/api/media/file/` **path marker rather than the CDN hostname**, so a
future CDN change fails the tests instead of silently reverting to stale data.

> **Regression fixture:** `tests/fixtures/doe_ncr_pump_prices_2026-09-28.html` is a
> sanitized capture of the current page. `test_discover_media.py` asserts discovery
> finds the newest weeks from it. **If DOE changes its hosting again, update that
> fixture first** — the failure mode this guards against is silent, not loud.

### Staleness guard

A run **fails (exit 1)** when the newest bulletin a region has is more than
`MAX_BULLETIN_AGE_DAYS` (14) old. See `src/freshness.py`.

This exists because a run could otherwise be "successful" while serving a month-old
bulletin: discovery found an old week, that week was already stored, so the result was
`skipped` and nothing counted as a failure. A stale week is reported even when it was
skipped.

**Why 14 days:** DOE weeks start Tuesday, so the current week is up to 6 days old.
DOE also "regularly uploads a week's bulletin several days late (sometimes not until
the following week)", which is 13 days — 14 absorbs that without masking a real outage.

### Regional availability

Not every region is published at all times. DOE serves its `"Page Not Found"` body —
**with HTTP 200**, so status codes cannot detect it — for a region it is not currently
publishing. It also serves that body *intermittently* for pages that are actually up
(observed for Visayas on 2026-09-28, alternating roughly one request in two), so a
single 404 proves nothing: the page is retried `DOE_PAGE_UNAVAILABLE_ATTEMPTS` times
before a region is declared unavailable.

Three conditions are kept strictly apart:

| Condition | Meaning | Effect on the run |
|-----------|---------|-------------------|
| `CURRENT` | A fresh bulletin was found or already stored | healthy |
| `STALE` | A real bulletin exists but is too old | **failure** |
| `ERROR` | Download/parse/load failed | **failure** |
| `UPSTREAM UNAVAILABLE` | DOE is not serving this region at all | **warning** |

Rules that follow from that:

- **No synthetic data is ever created.** An unavailable region loads nothing and its
  old rows are left untouched — they simply are not reported as current.
- **Unavailable is never inferred from age.** An old-but-real bulletin stays `STALE`
  and still fails the run.
- **Unavailable is not a blanket catch-all.** If *every* region is unavailable the run
  fails: no usable data source must never look healthy. Likewise a reachable region
  that is stale or broken fails regardless of how many other regions are unavailable.
- **A reachable page with zero bulletin links is NOT unavailable.** The source is up,
  so an empty archive is a genuine finding and keeps failing loudly.
- **Recovery is automatic.** When DOE serves the page again, normal discovery and
  freshness checks resume on the next run. No per-region exemption list exists, and no
  code change is required.
- The overall schedule can therefore succeed with partial regional availability.

Detection is anchored to the `<title>` element rather than a body substring, because
every valid DOE page embeds `"404 — Page Not Found"` and `NEXT_HTTP_ERROR_FALLBACK;404`
inside its Next.js hydration payload.

### Freshness timestamp

The `doe_etl_state` timestamp shown in the app ("Latest DOE fetch") is advanced only
when **every region that DOE is actually serving** came back current. It means *latest
successful DOE data refresh*, not *all regions are current* — a region DOE is not
publishing contributes no data and so cannot make the stored dataset stale.

Fetching that page is a plain HTTP request — no headless browser is involved.

NCR is also probed directly at its predictable slug `ncr-price-monitoring-MMDDYYYY-pdf`, because the archive page sometimes lags a week or two behind files that are already live on the CMS.

### Slug naming

DOE has renamed these files repeatedly. `src/slug_dates.py` recognises every naming family observed since December 2024, for example:

```
ncr-price-monitoring-08182026-pdf                     → 2026-08-18
ncr-price-monitoring-for-june-30-july-6-2026-pdf      → 2026-06-30
petro_ncr_2024-dec-3-9-pdf                            → 2024-12-03
nluz_regiii_dec-31-jan-06_2025-pdf                    → 2024-12-31
33-lfro-price-monitoring-august-18-24-2026-pdf        → 2026-08-18
vfo-price-monitoring-072826_with-lgu-and-field-pdf    → 2026-07-28
region-iv-a-calabarzon-20-pdf                         → undatable
```

A slug date is only a hint used for grouping and for skipping weeks already loaded. **The authoritative week is the one stated inside the PDF.** Some South Luzon files are numbered rather than dated, so the backfill parses every PDF and groups the results by the week each bulletin states in its own header.

`tests/test_slug_dates.py` pins this behaviour against real DOE filenames — run `pytest` after any DOE rename.

---

## Regional bulletin formats (DOE)

| Macro-region | Current PDF structure | Notes |
|--------------|----------------------|-------|
| **NCR** | Single PDF; city/area rows; 9 brand columns | Also date-probed on the CMS |
| **North Luzon** | Single combined CAR + Reg I–III PDF (2026); **four** separate sub-region PDFs in 2025 | The region DOE most often publishes as scans, so the sync regularly falls back a week or two |
| **South Luzon** | **Three** PDFs per week (CALABARZON, MIMAROPA, BICOL); **five** province PDFs in 2025 | Merged → min price per brand/fuel |
| **Visayas** | Regions 6–8 & NIR; price **ranges** like `81.70-87.60` | Range → lower bound |
| **Mindanao** | Multi–sub-region PDF (~18 pp) | Uses `NONE` instead of `#N/A` |

### How a price is matched to a brand

Because the column layout changes by region and by year, prices are matched to brands by **horizontal position**, not by counting values along a line:

1. The row naming the most brands is the table header; each header cell becomes a column anchor at its x position.
2. Every number in a row is assigned to the nearest anchor.
3. Anchors that are not brands (`AREA`, `PRODUCT`, `INDEPENDENT`, `OVERALL RANGE`, `COMMON PRICE`) are dropped.

This is required because DOE prints a **low–high pair per brand** and omits brands that do not operate in an area, so the *n*-th number on a line is not the *n*-th brand. An NCR diesel row, for instance, carries 21 numbers across 9 brands plus three region-wide columns.

Rows are also bounded to the table's price area. Below its table, an NCR bulletin repeats the fuel names in a "prevailing retail prices" summary whose columns are region-wide figures; those rows sit right of the product column and are ignored.

The per-region column order in `constants.py` is only a fallback for bulletins whose header cannot be read at all, and a bulletin parsed that way is flagged in `column_source` and carries a warning.

### Unusable bulletins

DOE occasionally publishes a week as page scans. Two cases are detected:

| Case | Detection |
|------|-----------|
| Image-only PDF | No text layer at all |
| Scan with a corrupt OCR text layer | Unmapped glyphs (`(cid:NN)`), or numbers with more than two decimals (`87.488` for a single `87.48` cell) |

**Automatic OCR fallback:** when either case is detected, the ETL runs
`ocrmypdf` + Tesseract to build a sidecar `*.ocr.pdf`, then parses that file.
Native text PDFs are never re-OCR'd. Disable with `GASTA_ETL_DISABLE_OCR=1`.

Local prerequisites (same as GitHub Actions):

```bash
# Debian/Ubuntu
sudo apt-get install -y tesseract-ocr ghostscript
# macOS
brew install tesseract ghostscript

pip install -r requirements.txt   # includes ocrmypdf
```

If OCR is unavailable or still cannot recover usable text, the weekly sync steps
back through previous weeks until one parses, so a region still shows its most
recent *readable* prices instead of inventing numbers. The backfill lists these
separately from real failures.

---

## Manual commands (debugging)

### Parse only

```bash
python run.py parse data/bulletins/ncr-sample.pdf --region ncr
python run.py parse data/bulletins/samples/south-luzon-*.pdf --region south_luzon
python run.py parse data/bulletins/samples/visayas-080426.pdf --region visayas --week 2026-08-04
```

### Download

```bash
python run.py download-ncr --week 2026-04-28 --out-dir data/bulletins
python run.py download-region --region mindanao --out-dir data/bulletins
```

### Load a local PDF

```bash
python run.py load data/bulletins/ncr-2026-04-28.pdf --region ncr
```

---

## Setup

```bash
cd etl
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `etl/.env` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (server-side only).

### Database prerequisite

The loader needs the price-history migration. Run these in the Supabase SQL editor once, in order:

1. `supabase/apply_all.sql` — base schema (skip if the project is already set up)
2. `supabase/migrations/20240812000007_bulletin_history.sql` — adds `fuel_price_bulletins.source_urls`, the `region_bulletin_weeks` view, and removes the dev sample bulletins

Until the second one is applied, every load fails with a message naming it, and the app's price screen has no week list to read.

Run the tests with the dev extras:

```bash
pip install -r requirements-dev.txt
pytest
```

---

## Parser notes

- Prices are matched to brands by column position, so low–high pairs and absent brands are handled correctly
- Stores the **minimum** price per company/fuel across the areas and sub-regions in the bulletin
- Bulletin date = **week start** from the PDF header, falling back to the CMS filename slug
- Sub-region PDFs sharing a week are merged into one macro-region row set
- Bulletins whose text layer is missing or garbled are **OCR'd automatically**
  (ocrmypdf + Tesseract) into a sidecar `*.ocr.pdf`, then parsed. If OCR is
  unavailable or still fails, the week is refused rather than half-loaded.

## Output tables

| Table | Content |
|-------|---------|
| `fuel_price_bulletins` | One row per weekly bulletin date (shared across regions); `source_urls` records the source PDF per region |
| `fuel_prices` | Price/L by region, company, fuel type |
| `oil_companies` | Auto-created when new companies appear (e.g. Clean Fuel, My Gas) |
| `region_bulletin_weeks` (view) | One row per region + week that has prices — what the app's history list reads |

## Roadmap

- [x] NCR automated sync (`sync-ncr`)
- [x] GitHub Actions weekly schedule (Tuesdays, matching DOE's publication day)
- [x] North Luzon / South Luzon / Visayas / Mindanao download + sync
- [x] Historical backfill for trend charts (`backfill`)
- [x] Slug-date regression tests
