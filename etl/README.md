# GasTa DOE PDF ETL Pipeline

Python ETL that parses Philippine Department of Energy weekly fuel price bulletins (PDF) and loads structured rows into Supabase.

## Automation (required for capstone)

DOE data must be ingested **automatically each week**, not by hand.

### One command — all five macro-regions

```bash
cd etl
source .venv/bin/activate
python run.py sync-all
```

This discovers, downloads, parses, and loads **NCR, North Luzon, South Luzon, Visayas, and Mindanao**. Each region is skipped independently if that region’s prices for the bulletin week already exist in Supabase.

Preview without writing:

```bash
python run.py sync-all --dry-run
```

Single region:

```bash
python run.py sync-region --region north_luzon
python run.py sync-ncr          # NCR only (legacy alias)
```

Discover latest PDF slug(s) without downloading:

```bash
python run.py discover-region --region visayas
```

### GitHub Actions (production schedule)

`.github/workflows/doe-etl-weekly.yml` runs **every Wednesday 02:00 UTC** (10:00 PH) and executes `sync-all`.

**One-time setup** — add repo secrets (GitHub → Settings → Secrets → Actions):

| Secret | Value |
|--------|--------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key from Supabase dashboard |

Manual trigger: **Actions → DOE Weekly ETL → Run workflow**.

---

## Regional bulletin formats (DOE)

DOE does **not** use one URL pattern for all regions. Discovery scrapes [doe.gov.ph retail pump price listings](https://doe.gov.ph/articles/group/liquid-fuels?display_type=Card&maincat=Retail+Pump+Prices) and resolves CMS guest slugs on `prod-cms.doe.gov.ph`.

| Macro-region | Discovery | PDF structure | Parser notes |
|--------------|-----------|---------------|--------------|
| **NCR** | Date-probed slug `ncr-price-monitoring-MMDDYYYY-pdf` | Single PDF; city/area rows; 9 company columns | Same as original v1 parser |
| **North Luzon** | `lf-price-monitoring-for-…-pdf` (combined CAR + Reg I–III) | Text-extractable tables; **6** companies (incl. Clean Fuel) | Avoid `north-luzon-pump-prices-as-of-*` image PDFs (garbled text) |
| **South Luzon** | **Three** PDFs per week: CALABARZON, MIMAROPA, BICOL | Same table layout as NCR | Merged → min price per company/fuel |
| **Visayas** | `vfo-price-monitoring-MMDDYY_…-pdf` | Regions 6–8 & NIR; 8 companies (incl. Jetti); price **ranges** | Week date from slug when header says only “Tuesday - Monday” |
| **Mindanao** | `NN-lfro-price-monitoring-month-D-YYYY-pdf` | Multi–sub-region PDF (~18 pp); 8 companies (incl. My Gas) | Uses `NONE` instead of `#N/A` |

Sample non-NCR PDFs used to validate the parser live under `etl/data/bulletins/samples/` (gitignored with other downloads).

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

---

## Parser notes

- Reads fuel price rows from DOE PDF text (`RON 95 81.70 87.60 …`)
- Region-specific company column order (see table above)
- Stores **minimum** price per company/fuel across areas/sub-regions in the bulletin
- Bulletin date = **week start** from PDF header or CMS filename slug
- South Luzon: three sub-region PDFs merged into one `SOUTH_LUZON` row set

## Output tables

| Table | Content |
|-------|---------|
| `fuel_price_bulletins` | One row per weekly bulletin date (shared across regions) |
| `fuel_prices` | Price/L by region, company, fuel type |
| `oil_companies` | Auto-created when new companies appear (e.g. Clean Fuel, My Gas) |

## Roadmap

- [x] NCR automated sync (`sync-ncr`)
- [x] GitHub Actions weekly schedule
- [x] North Luzon / South Luzon / Visayas / Mindanao download + sync
- [ ] Historical backfill for trend charts
