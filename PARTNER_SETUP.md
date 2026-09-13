# Partner setup guide

Quick start for cloning GasTa and running the Android app against the shared Supabase project.

## 1. Clone and install

```bash
git clone https://github.com/NotEajay/Gasta.git
cd Gasta/mobile
npm install
```

## 2. Environment variables

```bash
cp .env.example .env
```

Ask your teammate for the **Supabase Project URL** and **anon public key** (do not commit `.env`).

Example `.env`:

```
EXPO_PUBLIC_SUPABASE_URL=https://xzslsklecloqiitcirtw.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key-from-teammate>
```

## 3. Database

The shared Supabase project should have the schema and seed data applied.

If you create a **new** Supabase project instead, run `supabase/apply_all.sql` once in **Dashboard → SQL Editor**.

### Last-refill columns (existing databases)

If vehicle save fails with unknown column errors, run once in **SQL Editor**:

```sql
alter table public.vehicles
  add column if not exists last_refill_price numeric(8, 2) check (last_refill_price > 0),
  add column if not exists last_refill_at timestamptz;
```

### Saved trips table (existing databases)

If saving trip templates fails, run `supabase/migrations/20240812000004_saved_trips.sql` in **SQL Editor**, or:

```bash
SUPABASE_DB_PASSWORD='…' node scripts/apply-migration.mjs saved_trips
```

### Community fuel tables (existing databases)

Run `supabase/migrations/20240812000005_community_fuel_stations.sql` in **SQL Editor**, or:

```bash
SUPABASE_DB_PASSWORD='…' node scripts/apply-migration.mjs community_fuel
```

## 4. Run the app

**Android Studio emulator** (start emulator first):

```bash
npm run android
```

**Or Expo Go on a physical phone** (same Wi‑Fi):

```bash
npx expo start
```

Scan the QR code with Expo Go.

## 5. Auth (Vehicles, Budget, trip history)

Dashboard → **Authentication** → **Providers** → **Email** enabled.

In the app: tap the login icon → **Create account**.

## Project layout

| Path | Purpose |
|------|---------|
| `docs/PROJECT_CONTEXT.md` | Authoritative scope spec |
| `mobile/app/(tabs)/` | Four modules: Prices, Trip, Vehicles, Budget |
| `mobile/lib/` | Supabase client, SAW engine, services |
| `supabase/` | SQL migrations + `apply_all.sql` |
| `etl/` | DOE PDF pipeline (NCR automated sync) |

## Module priority

1. Fuel Price Monitoring (`index.tsx`)
2. Trip Cost Optimizer (`trip.tsx`) — SAW: fuel cost + travel time; last-refill price for own vehicle
3. Vehicle Profile (`vehicles.tsx`) — includes last-refill price
4. Fuel Budget (`budget.tsx`)

## Conventions

See `docs/PROJECT_CONTEXT.md`, `mobile/AGENTS.md`, and `mobile/README.md` before making changes.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `No Android connected device` | Start Android Studio emulator, or use `npx expo start` + Expo Go |
| Empty fuel prices | Confirm `.env` is correct; check Supabase Table Editor for `fuel_prices` rows |
| Login fails | Enable Email auth in Supabase; disable email confirmation for dev if needed |
| Supabase not configured banner | Create `mobile/.env` from `.env.example` |
| Trip optimizer shows no results | Set a last-refill price on your vehicle (My Vehicles tab) |
| Vehicle save column error | Run the last-refill migration SQL above |
