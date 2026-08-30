# GasTa — Transportation Cost Decision Support System

Bachelor's IT capstone project for fuel price monitoring and trip cost optimization in the Philippines.

**Authoritative spec:** [docs/PROJECT_CONTEXT.md](./docs/PROJECT_CONTEXT.md)

## Repository layout

```
mobile/     React Native + Expo app (Android target)
web/        Next.js web mirror (fuel prices + trip optimizer)
supabase/   Postgres schema, migrations, and RLS policies
etl/        Python pipeline for DOE weekly PDF bulletins
docs/       Project context and manuscript-aligned documentation
```

## Modules (priority order)

1. **Fuel Price Monitoring** — DOE weekly bulletin trends, company comparison, community reporting (planned)
2. **Trip Cost Optimizer** — SAW engine (fuel cost, travel time); uses vehicle last-refill price
3. **Vehicle Profile Management** — catalog-backed vehicles with last-refill price
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

### Web mirror

```bash
cd web && npm install
cp .env.example .env.local   # same Supabase URL + anon key as mobile/.env
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — routes: `/prices`, `/trip`.

### ETL

See [etl/README.md](./etl/README.md) for the DOE PDF parsing pipeline and weekly automation.

### Existing Supabase cloud project

If the database was created before the last-refill migration, run once in **SQL Editor**:

```sql
alter table public.vehicles
  add column if not exists last_refill_price numeric(8, 2) check (last_refill_price > 0),
  add column if not exists last_refill_at timestamptz;
```

Or apply `supabase/migrations/20240812000003_vehicle_last_refill.sql`.

## Scope constraints

- **Platforms:** React Native + Expo (mobile); Next.js web mirror (`web/`)
- **Fuel data:** DOE weekly bulletins (5 regions, 7 fuel types) plus community reports with verification (planned)
- **Trips:** user-input distance + vehicle profile; no GPS tracking
- **SAW:** two criteria only (fuel cost, travel time); trip fuel cost uses **last-refill price**, not DOE bulletin price
- **Backend:** Supabase (Postgres + Auth + RLS)

## Documentation

- [docs/PROJECT_CONTEXT.md](./docs/PROJECT_CONTEXT.md) — authoritative scope spec
- [mobile/README.md](./mobile/README.md) — app development guide
- [mobile/AGENTS.md](./mobile/AGENTS.md) — conventions for AI assistants and contributors
- [PARTNER_SETUP.md](./PARTNER_SETUP.md) — clone and run guide for teammates
