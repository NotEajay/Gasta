-- Require a signed-in user for EVERY read.
--
-- The mobile app ships the Supabase anon key, so any policy with
-- `using (true)` made that data queryable by anyone with the key and no
-- account — DOE prices, the station directory, community reports, ETL state.
-- Every app surface already sits behind the login gate (AuthGate redirects
-- unauthenticated users to (auth)), so real users are always authenticated
-- when these queries run and nothing changes for them.
--
-- The ETL writes and reads with the service role, which bypasses RLS and is
-- unaffected. User-owned tables (vehicles, budgets, trips, shares, refills)
-- were already owner-scoped and are not touched here.

-- ---------------------------------------------------------------------------
-- 1. Reference + DOE price data: public read -> authenticated read
-- ---------------------------------------------------------------------------

drop policy if exists "regions_public_read" on public.regions;
create policy "regions_authenticated_read"
  on public.regions for select
  to authenticated
  using (true);

drop policy if exists "fuel_types_public_read" on public.fuel_types;
create policy "fuel_types_authenticated_read"
  on public.fuel_types for select
  to authenticated
  using (true);

drop policy if exists "oil_companies_public_read" on public.oil_companies;
create policy "oil_companies_authenticated_read"
  on public.oil_companies for select
  to authenticated
  using (true);

drop policy if exists "transport_modes_public_read" on public.transport_modes;
create policy "transport_modes_authenticated_read"
  on public.transport_modes for select
  to authenticated
  using (true);

drop policy if exists "fuel_price_bulletins_public_read" on public.fuel_price_bulletins;
create policy "fuel_price_bulletins_authenticated_read"
  on public.fuel_price_bulletins for select
  to authenticated
  using (true);

drop policy if exists "fuel_prices_public_read" on public.fuel_prices;
create policy "fuel_prices_authenticated_read"
  on public.fuel_prices for select
  to authenticated
  using (true);

drop policy if exists "vehicle_catalog_public_read" on public.vehicle_catalog;
create policy "vehicle_catalog_authenticated_read"
  on public.vehicle_catalog for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- 2. Stations + community reports
-- ---------------------------------------------------------------------------

drop policy if exists "fuel_stations_public_read" on public.fuel_stations;
create policy "fuel_stations_authenticated_read"
  on public.fuel_stations for select
  to authenticated
  using (true);

drop policy if exists "community_fuel_reports_select_verified"
  on public.community_fuel_reports;
create policy "community_fuel_reports_select_verified"
  on public.community_fuel_reports for select
  to authenticated
  using (
    status = 'verified'
    and verified_at >= now() - interval '7 days'
  );

drop policy if exists "community_fuel_reports_select_pending"
  on public.community_fuel_reports;
create policy "community_fuel_reports_select_pending"
  on public.community_fuel_reports for select
  to authenticated
  using (status = 'pending');

-- ---------------------------------------------------------------------------
-- 3. ETL state
-- ---------------------------------------------------------------------------

drop policy if exists "doe_etl_state_public_read" on public.doe_etl_state;
create policy "doe_etl_state_authenticated_read"
  on public.doe_etl_state for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- 4. Views bypass table RLS (they run with the owner's rights), so for these
--    the grant itself is the gate: revoke anon, keep authenticated.
-- ---------------------------------------------------------------------------

revoke select on public.region_bulletin_weeks from anon;
revoke select on public.fresh_verified_community_prices from anon;
revoke select on public.doe_etl_state from anon;

-- ---------------------------------------------------------------------------
-- 5. SECURITY DEFINER helpers: Postgres grants EXECUTE to PUBLIC by default.
--    Both already raise on a null auth.uid(); the revokes make the anon key
--    unable to even reach them.
-- ---------------------------------------------------------------------------

revoke execute on function public.ensure_profile() from public, anon;
revoke execute on function public.ensure_oil_company(text) from public, anon;
