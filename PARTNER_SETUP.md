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

The shared Supabase project already has the schema and seed data applied.

If you create a **new** Supabase project instead, run `supabase/apply_all.sql` once in **Dashboard → SQL Editor**.

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

## 5. Auth (Vehicles, Budget, saved trips)

Dashboard → **Authentication** → **Providers** → **Email** enabled.

In the app: tap the login icon → **Create account**.

## Project layout

| Path | Purpose |
|------|---------|
| `mobile/app/(tabs)/` | Four modules: Prices, Trip, Vehicles, Budget |
| `mobile/lib/` | Supabase client, MCDA engine, services |
| `supabase/` | SQL migrations + `apply_all.sql` |
| `etl/` | Future DOE PDF pipeline (not implemented yet) |

## Module priority

1. Fuel Price Monitoring (`index.tsx`)
2. Trip Cost Optimizer (`trip.tsx`)
3. Vehicle Profile (`vehicles.tsx`)
4. Fuel Budget (`budget.tsx`)

## Conventions

See `mobile/AGENTS.md` and `mobile/README.md` before making changes.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `No Android connected device` | Start Android Studio emulator, or use `npx expo start` + Expo Go |
| Empty fuel prices | Confirm `.env` is correct; check Supabase Table Editor for `fuel_prices` rows |
| Login fails | Enable Email auth in Supabase; disable email confirmation for dev if needed |
| Supabase not configured banner | Create `mobile/.env` from `.env.example` |
