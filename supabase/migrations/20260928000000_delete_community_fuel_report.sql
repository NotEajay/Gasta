-- Withdraw your own community price report.
--
-- WHY THIS EXISTS
--   RLS is enabled on community_fuel_reports and the schema grants SELECT and
--   INSERT/UPDATE through SECURITY DEFINER RPCs only ("no direct client
--   writes"). There is no DELETE policy, so a direct client DELETE is rejected
--   by Postgres for every user, author included. Withdrawal therefore needs a
--   server-side path, exactly like submit and confirm already do.
--
-- SAFETY
--   * Ownership is re-checked here, not trusted from the client. SECURITY
--     DEFINER bypasses RLS, so this function IS the authorization boundary.
--   * Only the author's own PENDING report can be withdrawn.
--   * No table-level DELETE grant is added, so this RPC stays the only path.
--   * No new status, no column, no change to buildStationPriceRows precedence,
--     community verification, or the fresh_verified_community_prices view.
--
-- WHY VERIFIED REPORTS ARE NOT DELETABLE
--   status='verified' is set automatically by
--   sync_community_report_confirmation_count() at 3 independent confirmations,
--   and such rows are what fresh_verified_community_prices exposes to every
--   user's station prices. Hard-deleting one would remove pricing other users
--   depend on and would cascade away the confirmations that justified it. The
--   schema has no withdrawal/cancel status, and one is not introduced here.
--
-- Rejected / needs_review rows are author-private and never feed pricing, but
-- they are left alone as well so the rule stays the simple, auditable
-- "own pending report" case.

create or replace function public.delete_community_fuel_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_report public.community_fuel_reports%rowtype;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_report_id is null then
    raise exception 'Report id is required';
  end if;

  select * into v_report
  from public.community_fuel_reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'Report not found';
  end if;

  if v_report.reported_by is distinct from v_user_id then
    raise exception 'You can only delete your own reports';
  end if;

  if v_report.status <> 'pending' then
    raise exception 'Only reports still pending can be deleted';
  end if;

  -- Confirmations cascade with the report. A pending report is not shown as
  -- trusted pricing anywhere, so nothing user-visible is lost.
  delete from public.community_fuel_reports
  where id = p_report_id;
end;
$$;

revoke execute on function public.delete_community_fuel_report(uuid) from public, anon;
grant execute on function public.delete_community_fuel_report(uuid) to authenticated;
