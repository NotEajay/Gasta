-- Optional region snapshots are only recorded for runs that actually supply them.
begin;

alter table public.doe_etl_runs
  add column if not exists region_results jsonb;

comment on column public.doe_etl_runs.region_results is
  'Versioned per-region ETL outcomes. NULL means no structured snapshot was recorded.';

-- Some legacy tables only allowed success/failed. Do not rewrite or reject
-- historical status values while allowing partial outcomes on all new writes.
alter table public.doe_etl_runs
  drop constraint if exists doe_etl_runs_status_check;
alter table public.doe_etl_runs
  add constraint doe_etl_runs_status_check
  check (status in ('success', 'partial', 'failed')) not valid;

-- Remove the old signature so PostgREST and positional 13-argument callers
-- unambiguously use the new function's trailing default.
drop function if exists public.save_doe_etl_run(
  text, text, timestamptz, timestamptz, text, text, integer,
  integer, integer, integer, numeric, text, text
);

create or replace function public.save_doe_etl_run(
  p_workflow text,
  p_status text,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_trigger_source text,
  p_github_run_id text,
  p_github_run_attempt integer,
  p_regions_ok integer,
  p_regions_failed integer,
  p_regions_skipped integer,
  p_duration_s numeric,
  p_failure_reason text,
  p_failed_step text,
  p_region_results jsonb default null
)
returns public.doe_etl_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_run public.doe_etl_runs;
begin
  if p_workflow is null or p_workflow not in ('weekly', 'pending-retry') then
    raise exception 'Unsupported DOE ETL workflow: %', p_workflow;
  end if;
  if p_status is null or p_status not in ('success', 'partial', 'failed') then
    raise exception 'Unsupported DOE ETL status: %', p_status;
  end if;
  if p_started_at is null or p_ended_at is null or p_ended_at < p_started_at then
    raise exception 'DOE ETL requires a start time and an end time at or after the start.';
  end if;
  if p_regions_ok is null or p_regions_failed is null or p_regions_skipped is null
     or least(p_regions_ok, p_regions_failed, p_regions_skipped) < 0 then
    raise exception 'DOE ETL counts must be nonnegative integers.';
  end if;
  if p_duration_s < 0 then
    raise exception 'DOE ETL duration cannot be negative.';
  end if;
  if p_github_run_attempt is null or p_github_run_attempt < 1 then
    raise exception 'DOE ETL run attempt must be a positive integer.';
  end if;
  if p_status <> 'success' and nullif(btrim(p_failure_reason), '') is null then
    raise exception 'Unsuccessful DOE ETL runs require a failure reason.';
  end if;

  -- Preserve the atomic save/prune transaction and per-workflow ten-row cap.
  perform pg_advisory_xact_lock(hashtext('doe_etl_runs:' || p_workflow));

  insert into public.doe_etl_runs (
    run_at, workflow, status, trigger_source, github_run_id, github_run_attempt,
    regions_ok, regions_failed, regions_skipped, duration_s, error_summary,
    started_at, ended_at, failure_reason, failed_step, region_results
  ) values (
    p_started_at, p_workflow, p_status, nullif(btrim(p_trigger_source), ''),
    nullif(btrim(p_github_run_id), ''), p_github_run_attempt,
    p_regions_ok, p_regions_failed, p_regions_skipped,
    coalesce(round(p_duration_s, 1),
      round(extract(epoch from (p_ended_at - p_started_at))::numeric, 1)),
    case when p_status <> 'success' then nullif(btrim(p_failure_reason), '') end,
    p_started_at, p_ended_at,
    case when p_status <> 'success' then nullif(btrim(p_failure_reason), '') end,
    case when p_status <> 'success' then nullif(btrim(p_failed_step), '') end,
    nullif(p_region_results, 'null'::jsonb)
  )
  on conflict (workflow, github_run_id, github_run_attempt)
    where github_run_id is not null
  do update set
    run_at = excluded.run_at,
    status = excluded.status,
    trigger_source = excluded.trigger_source,
    regions_ok = excluded.regions_ok,
    regions_failed = excluded.regions_failed,
    regions_skipped = excluded.regions_skipped,
    duration_s = excluded.duration_s,
    error_summary = excluded.error_summary,
    started_at = excluded.started_at,
    ended_at = excluded.ended_at,
    failure_reason = excluded.failure_reason,
    failed_step = excluded.failed_step,
    region_results = coalesce(excluded.region_results, doe_etl_runs.region_results)
  returning * into saved_run;

  delete from public.doe_etl_runs
  where id in (
    select id from public.doe_etl_runs
    where workflow = p_workflow
    order by started_at desc, created_at desc, id desc
    offset 10
  );
  return saved_run;
end;
$$;

revoke all on function public.save_doe_etl_run(
  text, text, timestamptz, timestamptz, text, text, integer,
  integer, integer, integer, numeric, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.save_doe_etl_run(
  text, text, timestamptz, timestamptz, text, text, integer,
  integer, integer, integer, numeric, text, text, jsonb
) to service_role;

notify pgrst, 'reload schema';
commit;
