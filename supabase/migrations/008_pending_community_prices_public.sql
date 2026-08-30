-- Show pending (unverified) community prices on the public Fuel Prices page.
-- Confirmations still require authentication via confirm_community_fuel_report.

drop policy if exists "community_fuel_reports_select_pending_authenticated"
  on public.community_fuel_reports;

create policy "community_fuel_reports_select_pending"
  on public.community_fuel_reports for select
  using (status = 'pending');
