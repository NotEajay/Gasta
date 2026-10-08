-- Monitoring/history visibility: let authenticated users read OLD verified
-- community reports, without touching recommendation freshness.
--
-- The Past filter on the Prices/Community screens is a MONITORING view. The
-- previous read policy required `verified_at >= now() - 7 days`, so verified
-- reports older than the recommendation freshness window disappeared from the
-- database entirely -- not just from recommendations -- and the Past filter
-- could never show them.
--
-- The 7-day freshness rule for RECOMMENDATIONS lives exclusively in the
-- `fresh_verified_community_prices` view. That view, its 7-day filter, the
-- Trip Optimizer / Fuel Price Recommendation / Fuel Station Recommendation
-- inputs, the verification threshold and the +/- P0.50 confirmation tolerance
-- are NOT touched by this migration.
--
-- ---------------------------------------------------------------------------
-- POLICY REPLACED (same names, drop + recreate):
--
--   1. public.community_fuel_reports_select_verified  (table
--      public.community_fuel_reports, SELECT)
--      BEFORE (migration 016_require_authenticated_reads.sql):
--        to authenticated
--        using (status = 'verified'
--               and verified_at >= now() - interval '7 days')
--      AFTER (this file):
--        to authenticated
--        using (status = 'verified')
--      Effect: verified reports are readable by signed-in users at ANY age.
--      The 7-day window no longer gates read visibility; it only gates
--      recommendation freshness via the view above.
--
--   2. public.community_fuel_report_confirmations_select  (table
--      public.community_fuel_report_confirmations, SELECT)
--      BEFORE (migration 20240812000005_community_fuel_stations.sql):
--        to authenticated
--        using (parent report visible when
--               (status = 'verified' and verified_at >= now() - interval '7 days')
--               or status = 'pending'
--               or (own report and status in ('rejected', 'needs_review')))
--      AFTER (this file):
--        to authenticated
--        using (parent report visible when
--               status = 'verified'            -- any age, mirrors the table
--               or status = 'pending'
--               or (own report and status in ('rejected', 'needs_review')))
--      Effect: confirmation rows follow parent-report visibility exactly, so
--      viewing a historical verified report can still show its confirmation
--      history. No new statuses are exposed.
--
-- POLICIES LEFT UNCHANGED (verified against the current definitions):
--
--   * community_fuel_reports_select_pending      -> any authenticated user may
--     read status = 'pending' (unchanged; no date condition existed).
--   * community_fuel_reports_select_own_private  -> author-only read of own
--     rejected / needs_review rows (unchanged).
--   * rejected / needs_review rows of OTHER users remain invisible to everyone
--     but their author: neither is added to any non-owner policy here.
--   * anon gains nothing: both replaced policies stay `to authenticated`.
--   * INSERT/UPDATE/DELETE remain RPC-only (no write policies exist or are
--     added). Verification still happens through
--     confirm_community_fuel_report at 3 confirmations (+/- P0.50), unchanged.
--
-- DEPLOYMENT: this file is NOT applied automatically -- run it manually in the
-- Supabase SQL editor (or via `supabase db push`) when ready.
-- ---------------------------------------------------------------------------

-- 1) Verified reports: readable by authenticated users at any age.
drop policy if exists "community_fuel_reports_select_verified"
  on public.community_fuel_reports;

create policy "community_fuel_reports_select_verified"
  on public.community_fuel_reports for select
  to authenticated
  using (status = 'verified');

-- 2) Confirmation rows follow the parent report's new visibility exactly.
drop policy if exists "community_fuel_report_confirmations_select"
  on public.community_fuel_report_confirmations;

create policy "community_fuel_report_confirmations_select"
  on public.community_fuel_report_confirmations for select
  to authenticated
  using (
    exists (
      select 1 from public.community_fuel_reports r
      where r.id = report_id
        and (
          r.status = 'verified'
          or r.status = 'pending'
          or (r.reported_by = auth.uid() and r.status in ('rejected', 'needs_review'))
        )
    )
  );
