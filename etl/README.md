# GasTa DOE PDF ETL Pipeline

Python ETL that parses Philippine Department of Energy weekly fuel price bulletins (static PDFs) and loads structured data into Supabase.

## Output tables

- `fuel_price_bulletins` — one row per weekly bulletin date
- `fuel_prices` — price per liter by region, oil company, and fuel type
- `oil_companies` — discovered from bulletin headers (insert if not exists)

## Fuel types (DOE)

RON 91, RON 95, RON 97, RON 100, Diesel, Diesel Plus, Kerosene

## Regions (DOE)

NCR, North Luzon, South Luzon, Visayas, Mindanao

## Planned structure

```
etl/
  README.md
  requirements.txt
  src/
    parse_bulletin.py    # PDF → structured rows
    load_supabase.py     # upsert into Postgres
  data/
    bulletins/           # downloaded DOE PDFs (gitignored)
```

## Environment

Uses Supabase **service role** key (server-side only — never in the mobile app):

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

## Status

**Not yet implemented.** Schema and seed data live in `supabase/migrations/`. Implement parsing and loading here before fuel price features can show real data.
