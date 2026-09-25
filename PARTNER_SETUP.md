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
npx expo start --go
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

#### How people use GasTa (no Apple Developer needed)

**End users never log into an Apple Developer account.** That account is only for *you* later if you publish to the App Store.

### Test on Expo Go first (recommended while building)

1. Supabase → **Authentication → URL Configuration**:
   - **Site URL:** `https://gasta-kappa.vercel.app` (must include `https://`)
   - **Redirect URLs** must include: `exp://**` and `https://gasta-kappa.vercel.app/**`
2. From `mobile/`:
   ```bash
   npx expo start
   ```
   Same Wi‑Fi as the phone.
3. Open **Expo Go** → scan QR → test Google.
4. After Google, Expo Go should reopen (return URL is `exp://…`, not the Vercel “Signing you in…” page).

| Who | Easiest access | Google login |
|-----|----------------|--------------|
| Anyone (Windows / iPhone / Android) | Open **https://gasta-kappa.vercel.app** | Works in the browser |
| You while coding | **Expo Go** (`npx expo start`) | Needs `exp://**` in Redirect URLs + Site URL with `https://` |
| Optional later | Installable Android APK / App Store iOS | Native `gasta://` (Apple Dev only for *publishing* iOS) |

### Optional later: native install (App Store / Play Store)

Only the **developer** needs Apple/Google publisher accounts. Downloaders use the store like any other app.

```bash
# Android APK (no Apple account)
npm run build:dev:android

# iOS App Store / device IPA (Apple Developer account required for YOU, not for users)
npm run build:dev:ios
```

#### C. Allow app redirect URLs (all devices)

**Authentication → URL Configuration → Redirect URLs** — add:

```text
gasta://**
exp://**
https://*.exp.direct/**
http://localhost:8081/**
http://127.0.0.1:8081/**
https://gasta-kappa.vercel.app/**
```

Site URL (required for Google on phone + web):

```text
https://gasta-kappa.vercel.app
```

Keep Vercel **unpaused** while testing Google from Expo Go or sharing the website.

**Must include the scheme** (`https://` or `http://`).  
Wrong: `gasta-kappa.vercel.app` → `requested path is invalid`.  
Right: `https://gasta-kappa.vercel.app`

#### D. Allow anyone to use Google (not only test users)

While the OAuth consent screen is **Testing**, only listed **Test users** can sign in (or Google may show an “app in testing” warning).

To let **any Google account** use GasTa:

1. Google Cloud → **APIs & Services → OAuth consent screen**
2. User type: **External**
3. Scopes: keep only the defaults (`openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`) — do not add Gmail/Drive/etc.
4. Click **Publish app** → confirm **In production**
5. Users may still see “Google hasn’t verified this app” once — they can choose **Advanced → Go to GasTa (unsafe)**. That is normal until you optionally submit for brand verification.

Also in Supabase → **Authentication → Providers → Google**: leave enabled.  
**Authentication → Settings**: ensure **Allow new users to sign up** is on.

#### Partner blocked on `supabase.co` (Cloudflare)

If someone sees **“Sorry, you have been blocked” / Unable to access supabase.co**, that is a **network / WAF** block on Supabase’s edge, not Google test-user settings. Have them:

- Turn off VPN, try mobile data or another Wi‑Fi
- Retry in Safari/Chrome (not only the in-app browser)
- If it keeps happening from their ISP/country, contact [Supabase support](https://supabase.com/dashboard/support/new) with their IP and project ref `xzslsklecloqiitcirtw`

#### E. Try again on phone

```bash
cd mobile
npx expo start --clear
```

Use Expo Go → Google. Prefer `--tunnel` only if LAN/QR connection fails.

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
| Google `requested path is invalid` | Site URL must be exactly `https://gasta-kappa.vercel.app`. Keep `exp://**` under Redirect URLs. Restart Expo. |
| Google works on web, not phone | Same Site URL + `exp://**`; same Wi‑Fi; `npx expo start`. |
| Stuck on Vercel “Signing you in…” | Old HTTPS return. Restart Expo so the app uses `exp://` return (not Vercel). Confirm Site URL has `https://`. |
| Supabase not configured banner | Create `mobile/.env` from `.env.example` |
| Trip optimizer shows no results | Set a last-refill price on your vehicle (My Vehicles tab) |
| Vehicle save column error | Run the last-refill migration SQL above |
