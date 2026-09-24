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

### Google sign-in (web + Android + iOS / Expo Go)

GasTa uses **Supabase Google OAuth** (browser PKCE). One **Web** OAuth client in Google Cloud powers every platform — do not use a deleted or old client ID.

#### A. Create (or recreate) the Web OAuth client

If Google shows **`Error 401: deleted_client`**, the Client ID in Supabase points at a deleted credential. Fix it:

1. Open the **shared** GasTa project in [Google Cloud Console](https://console.cloud.google.com/)
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**
3. Application type: **Web application**
4. Name: `GasTa Supabase`
5. **Authorized redirect URIs** — add exactly:

```text
https://xzslsklecloqiitcirtw.supabase.co/auth/v1/callback
```

6. Copy the new **Client ID** and **Client secret**

#### B. Paste into Supabase

1. [Supabase Dashboard](https://supabase.com/dashboard/project/xzslsklecloqiitcirtw) → **Authentication → Providers → Google**
2. Enable Google
3. Paste the **new** Client ID and Client secret (replace any old values)
4. Save

#### C. Allow app redirect URLs (all devices)

**Authentication → URL Configuration → Redirect URLs** — add:

```text
gasta://**
exp://**
https://*.exp.direct/**
http://localhost:8081/**
http://127.0.0.1:8081/**
```

Also add your production web origin if you deploy (e.g. `https://your-app.vercel.app/**`).

Site URL can stay your primary web URL (or `http://localhost:8081` for local web).

#### D. Consent screen test users

While the OAuth consent screen is in **Testing**, add every Gmail that should sign in under **Test users**.

#### E. Try again on phone

```bash
cd mobile
npx expo start --tunnel --clear
```

Use Expo Go → Google. After the client ID is updated, `deleted_client` goes away on web and native alike.

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
| Google `deleted_client` / Authorization Error | Recreate **Web** OAuth client in Google Cloud; paste new ID/secret into Supabase Auth → Google (see §5) |
| Google works on web, not phone | Add `gasta://**`, `exp://**`, and `https://*.exp.direct/**` under Supabase Redirect URLs; prefer `npx expo start --tunnel` |
| Supabase not configured banner | Create `mobile/.env` from `.env.example` |
| Trip optimizer shows no results | Set a last-refill price on your vehicle (My Vehicles tab) |
| Vehicle save column error | Run the last-refill migration SQL above |
