# GasTa — AI assistant & contributor guide

Read Expo v57 docs before changing navigation or native config: https://docs.expo.dev/versions/v57.0.0/

## Project scope (do not expand)

- **Platform:** Android only (React Native + Expo managed, Expo Router, TypeScript)
- **Fuel data:** DOE weekly PDF bulletins only — 5 regions, 7 fuel types; no live pricing
- **Trips:** user-input distance + vehicle profile; no GPS/background tracking
- **MCDA:** exactly 3 criteria (fuel cost, travel time, depreciation); weighted sum; inverted min-max normalization `(max - x) / (max - min)`; store full breakdown
- **Backend:** Supabase with RLS — public read for fuel prices; users own vehicles, trips, budgets
- **Out of scope:** comfort/safety/weather criteria, fuel subsidy/tax policy, iOS/web shipping

## Repository layout

```
mobile/     Expo app — app/, components/, constants/, lib/, types/
supabase/   SQL migrations (source of truth for schema)
etl/        Python PDF pipeline (separate; uses service role key)
```

## Conventions

- Domain constants in `mobile/constants/` (`regions.ts`, `fuelTypes.ts`, `transportModes.ts`, `mcda.ts`) must match `supabase/migrations/` seed data
- Domain types in `mobile/types/`; `database.ts` mirrors Supabase schema
- MCDA logic in `mobile/lib/mcda.ts` — do not add extra criteria
- Supabase client: `mobile/lib/supabase.ts` — env vars `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- Four tab modules in `app/(tabs)/`: `index` (prices), `trip`, `vehicles`, `budget`
- Prefer extending existing files over new abstractions; minimal diff

## Module build order

1. Fuel Price Monitoring
2. Trip Cost Optimizer
3. Vehicle Profile Management
4. Personal Fuel Budget Planner

## Database entities

`regions`, `oil_companies`, `fuel_types`, `fuel_price_bulletins`, `fuel_prices`, `vehicle_catalog`, `vehicles`, `transport_modes`, `trip_records`, `fuel_budgets`
