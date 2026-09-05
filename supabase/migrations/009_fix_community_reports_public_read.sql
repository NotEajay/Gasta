-- Fix: pending community reports must be readable by anon + authenticated
-- (empty UI with rows in Table Editor almost always means RLS blocked the client).

drop policy if exists "community_fuel_reports_select_pending_authenticated"
  on public.community_fuel_reports;
drop policy if exists "community_fuel_reports_select_pending"
  on public.community_fuel_reports;

create policy "community_fuel_reports_select_pending"
  on public.community_fuel_reports for select
  using (status = 'pending');

-- Ensure stations (needed to resolve names) stay publicly readable
drop policy if exists "fuel_stations_public_read" on public.fuel_stations;
create policy "fuel_stations_public_read"
  on public.fuel_stations for select using (true);

-- Fresh verified view for recommendation UI
grant select on public.fresh_verified_community_prices to anon, authenticated;
