# GasTa! Mobile

Android app for **GasTa!** — a transportation cost decision support system for fuel price monitoring and trip optimization in the Philippines.

## Stack

- **TypeScript** — domain types for fuel records, vehicles, and MCDA trip evaluation
- **React Native + Expo** (managed) — Android target
- **Expo Router** — file-based navigation (4 module tabs)
- **Supabase** — Postgres, Auth, RLS

## Prerequisites

- Node.js 18+ (tested with v22)
- Android Studio emulator or physical Android device
- [Supabase CLI](https://supabase.com/docs/guides/cli) for local database

## Setup

```bash
# From repo root — start local Supabase and apply schema
supabase start
supabase db reset

# Mobile app
cd mobile
cp .env.example .env
# Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
npm install
npm run android
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key (safe for client) |

## Project layout

```
app/(tabs)/
  index.tsx      Module 1 — Fuel Price Monitoring
  trip.tsx       Module 2 — Trip Cost Optimizer
  vehicles.tsx   Module 3 — Vehicle Profile Management
  budget.tsx     Module 4 — Fuel Budget Planner
components/      Reusable UI (ModuleScreen placeholder, Themed, etc.)
constants/       DOE regions, fuel types, transport modes, MCDA defaults
lib/
  supabase.ts    Typed Supabase client
  mcda.ts        Weighted-sum MCDA engine (3 criteria)
types/           Domain + database types
```

## MCDA (Trip Cost Optimizer)

Three cost-type criteria — lower raw value is better:

1. Fuel cost
2. Travel time
3. Vehicle depreciation

Normalization: inverted min-max `(max - x) / (max - min)`. User weights must sum to 1. Full per-mode breakdown is stored in `trip_records.mode_evaluations`.

Default weights: fuel 0.5, time 0.3, depreciation 0.2 (`constants/mcda.ts`).

## Fuel data source

Prices come **only** from DOE weekly bulletins (loaded via `etl/`). No live or intra-week pricing.

- **Regions:** NCR, North Luzon, South Luzon, Visayas, Mindanao
- **Fuel types:** RON 91/95/97/100, Diesel, Diesel Plus, Kerosene

## Scripts

```bash
npm start       # Expo dev server
npm run android # Launch on Android emulator/device
```

## Related

- Schema: `../supabase/migrations/`
- ETL pipeline: `../etl/`
- Contributor guide: [AGENTS.md](./AGENTS.md)
