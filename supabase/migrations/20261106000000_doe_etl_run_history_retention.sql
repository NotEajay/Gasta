-- Upgrade both the original files_processed/error_log table and migration 021.
begin;

create table if not exists public.doe_etl_runs (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  status text not null,
  trigger_source text,
  created_at timestamptz not null default now()
);

alter table public.doe_etl_runs
  add column if not exists workflow text,
  add column if not exists github_run_id text,
  add column if not exists github_run_attempt integer not null default 1,
  add column if not exists regions_ok integer not null default 0,
  add column if not exists regions_failed integer not null default 0,
  add column if not exists regions_skipped integer not null default 0,
  add column if not exists duration_s numeric(8,1),
  add column if not exists error_summary text,
  add column if not exists started_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists failure_reason text,
  add column if not exists failed_step text,
  add column if not exists files_processed integer,
  add column if not exists error_log text;

-- Legacy run_at was the insertion (completion) time. Unknown workflows stay
-- unclassified rather than being attributed to a job that did not run.
update public.doe_etl_runs
set
  workflow = coalesce(workflow, case
    when trigger_source in ('pending-retry', 'DOE Pending PDF Retry') then 'pending-retry'
    when trigger_source in ('weekly', 'github-actions', 'DOE Weekly ETL') then 'weekly'
    else null
  end),
  started_at = coalesce(
    started_at,
    run_at - greatest(coalesce(duration_s, 0), 0) * interval '1 second'
  ),
  ended_at = coalesce(ended_at, run_at),
  failure_reason = coalesce(failure_reason, error_summary, error_log),
  error_summary = coalesce(error_summary, error_log);

alter table public.doe_etl_runs
  alter column started_at set not null,
  alter column ended_at set not null;

comment on column public.doe_etl_runs.started_at is
  'UTC job start. Legacy rows without duration use their original run_at.';
comment on column public.doe_etl_runs.ended_at is
  'UTC job completion, whether successful or failed.';
comment on column public.doe_etl_runs.github_run_attempt is
  'GitHub attempt number; rerunning a workflow creates a separate record.';

with duplicate_runs as (
  select id, row_number() over (
    partition by workflow, github_run_id, github_run_attempt
    order by started_at desc, created_at desc, id desc
  ) as position
  from public.doe_etl_runs
  where github_run_id is not null and workflow in ('weekly', 'pending-retry')
)
delete from public.doe_etl_runs
where id in (select id from duplicate_runs where position > 1);

create unique index if not exists doe_etl_runs_github_attempt_idx
  on public.doe_etl_runs (workflow, github_run_id, github_run_attempt)
  where github_run_id is not null;

create index if not exists doe_etl_runs_workflow_started_idx
  on public.doe_etl_runs (workflow, started_at desc, created_at desc, id desc);

with ranked_runs as (
  select id, row_number() over (
    partition by workflow
    order by started_at desc, created_at desc, id desc
  ) as position
  from public.doe_etl_runs
  where workflow in ('weekly', 'pending-retry')
)
delete from public.doe_etl_runs
where id in (select id from ranked_runs where position > 10);

alter table public.doe_etl_runs enable row level security;
revoke all on public.doe_etl_runs from public, anon;
revoke insert, update, delete, truncate, references, trigger
  on public.doe_etl_runs from authenticated;
grant select on public.doe_etl_runs to authenticated;
grant all on public.doe_etl_runs to service_role;

drop policy if exists admins_can_read_etl_runs on public.doe_etl_runs;
create policy admins_can_read_etl_runs on public.doe_etl_runs
  for select to authenticated using (public.is_developer_or_admin());

-- Restrict any legacy permissive read policies as well.
drop policy if exists etl_runs_admin_read_guard on public.doe_etl_runs;
create policy etl_runs_admin_read_guard on public.doe_etl_runs
  as restrictive for select to authenticated using (public.is_developer_or_admin());

drop function if exists public.save_doe_etl_run(
  text, text, timestamptz, timestamptz, text, text,
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
  p_failed_step text
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

  -- Insert/update and pruning share a transaction and a per-workflow lock.
  perform pg_advisory_xact_lock(hashtext('doe_etl_runs:' || p_workflow));

  insert into public.doe_etl_runs (
    run_at, workflow, status, trigger_source, github_run_id, github_run_attempt,
    regions_ok, regions_failed, regions_skipped, duration_s, error_summary,
    started_at, ended_at, failure_reason, failed_step
  ) values (
    p_started_at, p_workflow, p_status, nullif(btrim(p_trigger_source), ''),
    nullif(btrim(p_github_run_id), ''), p_github_run_attempt,
    p_regions_ok, p_regions_failed, p_regions_skipped,
    coalesce(round(p_duration_s, 1),
      round(extract(epoch from (p_ended_at - p_started_at))::numeric, 1)),
    case when p_status <> 'success' then nullif(btrim(p_failure_reason), '') end,
    p_started_at, p_ended_at,
    case when p_status <> 'success' then nullif(btrim(p_failure_reason), '') end,
    case when p_status <> 'success' then nullif(btrim(p_failed_step), '') end
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
    failed_step = excluded.failed_step
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
  integer, integer, integer, numeric, text, text
) from public, anon, authenticated;
grant execute on function public.save_doe_etl_run(
  text, text, timestamptz, timestamptz, text, text, integer,
  integer, integer, integer, numeric, text, text
) to service_role;

notify pgrst, 'reload schema';
commit;
