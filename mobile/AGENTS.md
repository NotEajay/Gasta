# GasTa — AI assistant & contributor guide

**Authoritative spec:** [`docs/PROJECT_CONTEXT.md`](../docs/PROJECT_CONTEXT.md) — when anything here conflicts with that file, PROJECT_CONTEXT wins.

Read Expo v57 docs before changing mobile navigation or native config: https://docs.expo.dev/versions/v57.0.0/

## Project scope (do not expand)

- **Platforms:** React Native + Expo (managed, Expo Router, TypeScript) for mobile; **Next.js** web mirror sharing the same Supabase backend and domain logic
- **Fuel data:** DOE weekly PDF bulletins (5 regions, 7 fuel types) **plus** user-submitted community price reports with verification — no live/intra-week official pricing
- **Trips:** user-input distance + vehicle profile; no GPS/background tracking
- **Trip pricing basis:** trip cost calculations use the selected vehicle's **last-refill price** (`vehicles.last_refill_price`), **not** the current DOE bulletin price. DOE prices inform monitoring, comparison, and station recommendation only.
- **SAW (Simple Additive Weighting):** exactly **2** cost-type criteria — **fuel cost** and **travel time**; weighted sum; inverted min-max normalization `(max - x) / (max - min)`; store full per-mode breakdown
- **Backend:** Supabase with RLS — public read for DOE fuel prices and verified community reports; users own vehicles, saved trips, trip history, and budgets
- **Out of scope:** comfort/safety/weather criteria, vehicle depreciation as a SAW criterion, fuel subsidy/tax policy, iOS native shipping

## Community fuel price reporting + verification

- Authenticated users submit community price reports at a **fuel station** (via RPC).
- Every report has status `pending`, `verified`, `rejected`, or `needs_review`.
- **Auto-verify:** **3** independent confirmations within ±₱0.50/L (`confirm_community_fuel_report` RPC).
- Conflicting prices (>₱1.00/L) at the same station → `needs_review` (manual resolve in Supabase Dashboard v1).
- UI must surface verification status; only **fresh verified** (7 days) reports are authoritative.
- Only verified community reports influence station recommendation alongside DOE data.

## Fuel station recommendation

- Recommend refueling using **fresh verified** community prices at nearby stations first.
- Fallback: DOE company-level bulletin price for the region (Phase B: Google Directions to nearest branch).
- Show price source (community verified vs DOE bulletin) and verification status.

## Saved trips vs. trip history

These are **two distinct features** — do not collapse them into one table or screen.

| Feature | Purpose |
|---------|---------|
| **Saved trips** | Reusable trip templates the user names and re-runs (origin/destination labels, distance, vehicle, SAW weights) |
| **Trip history** | Immutable log of completed SAW runs with timestamp and full breakdown |

Saving a trip template does not automatically append history; running the optimizer and confirming a result writes to history.

## Offline mode

- **Cached prices:** persist the latest DOE bulletin prices (and last-fetched verified community reports) locally for read-only offline viewing.
- **Offline trip calculation:** SAW runs offline using cached data plus the vehicle's stored last-refill price and profile — no network required.
- **Local save + sync:** queue saved-trip edits and trip-history writes while offline; sync to Supabase on reconnect with conflict-safe upserts.

## Repository layout

```
mobile/     Expo app — app/, components/, constants/, lib/, types/
web/        Next.js web mirror — same modules and Supabase client pattern
supabase/   SQL migrations (source of truth for schema)
etl/        Python PDF pipeline (separate; uses service role key)
docs/       PROJECT_CONTEXT.md and manuscript-aligned documentation
```

## Conventions

- Domain constants in `mobile/constants/` (`regions.ts`, `fuelTypes.ts`, `transportModes.ts`, `mcda.ts`) must match `supabase/migrations/` seed data
- Domain types in `mobile/types/`; `database.ts` mirrors Supabase schema
- SAW logic in `mobile/lib/mcda.ts` — **exactly 2 criteria** (fuel cost, travel time); do not add extra criteria
- Default SAW weights (must sum to 1.0, user-adjustable at trip time): fuel cost **0.6**, travel time **0.4**
- Supabase client: `mobile/lib/supabase.ts` — env vars `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- Web mirror: mirror mobile module boundaries; use `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Four tab modules in `app/(tabs)/`: `index` (prices), `trip`, `vehicles`, `budget`
- Prefer extending existing files over new abstractions; minimal diff

## Module build order

1. Fuel Price Monitoring (trends, comparison, community reporting, verification, station recommendation)
2. Trip Cost Optimizer (SAW engine, saved trips, trip history)
3. Vehicle Profile Management (including last-refill price)
4. Personal Fuel Budget Planner

## Database entities

**Reference & DOE data:** `regions`, `oil_companies`, `fuel_types`, `fuel_price_bulletins`, `fuel_prices`, `vehicle_catalog`, `transport_modes`

**User-owned:** `vehicles` (includes `last_refill_price`, `last_refill_at`), `saved_trips`, `trip_records` (trip history), `fuel_budgets`

**Community:** `fuel_stations`, `community_fuel_reports`, `community_fuel_report_confirmations`
