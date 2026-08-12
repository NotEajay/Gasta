# GasTa — Transportation Cost Decision Support System

Bachelor's IT capstone project for fuel price monitoring and trip cost optimization in the Philippines.

## Repository layout

```
mobile/     React Native + Expo app (Android target)
supabase/   Postgres schema, migrations, and RLS policies
etl/        Python pipeline for DOE weekly PDF bulletins (separate from app)
```

## Modules (priority order)

1. **Fuel Price Monitoring** — DOE weekly bulletin trends and multi-company/region comparison
2. **Trip Cost Optimizer** — MCDA engine (fuel cost, travel time, depreciation)
3. **Vehicle Profile Management** — catalog-backed vehicle registration
4. **Personal Fuel Budget Planner** — monthly limits with alerts

## Quick start

**Prerequisites:** [Docker Desktop](https://docs.docker.com/desktop/) (running), [Supabase CLI](https://supabase.com/docs/guides/cli), Node.js 18+.

```bash
./scripts/setup.sh    # starts Supabase, applies migrations, writes mobile/.env
cd mobile && npm run android
```

Or manually:

```bash
supabase start && supabase db reset
cp mobile/.env.example mobile/.env   # paste URL + anon key from: supabase status
cd mobile && npm install && npm run android
```

### ETL (future)

See [etl/README.md](./etl/README.md) for the DOE PDF parsing pipeline.

## Scope constraints

- **Android only** — React Native + Expo (managed), Expo Router, TypeScript
- **Fuel data** — DOE weekly bulletins only (5 regions, 7 fuel types); no live/intra-week pricing
- **Trips** — user-input distance + vehicle profile; no GPS tracking
- **MCDA** — three criteria only (fuel cost, travel time, depreciation); weighted sum with inverted min-max normalization
- **Backend** — Supabase (Postgres + Auth + RLS)

## Documentation

- [mobile/README.md](./mobile/README.md) — app development guide
- [mobile/AGENTS.md](./mobile/AGENTS.md) — conventions for AI assistants and contributors
