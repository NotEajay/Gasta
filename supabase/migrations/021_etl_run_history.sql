-- ============================================================
-- Migration 021: ETL run history table
-- ============================================================
-- One row per ETL workflow execution. Written by the Python ETL
-- (automation.py) using the service-role key which bypasses RLS.
-- Admins and developers read via admin panel.

create table if not exists public.doe_etl_runs (
  id              uuid        primary key default gen_random_uuid(),
  run_at          timestamptz not null default now(),
  workflow        text        not null,                    -- 'weekly' | 'pending-retry'
  status          text        not null                     -- 'success' | 'partial' | 'failed'
                              check (status in ('success', 'partial', 'failed')),
  trigger_source  text,                                    -- 'github-actions' | 'cli'
  github_run_id   text,                                    -- GH Actions run ID (links to run URL)
  regions_ok      int         not null default 0,
  regions_failed  int         not null default 0,
  regions_skipped int         not null default 0,
  duration_s      numeric(8,1),
  error_summary   text,
  created_at      timestamptz not null default now()
);

comment on table public.doe_etl_runs is
  'History of DOE ETL pipeline executions recorded by the Python ETL script.';

alter table public.doe_etl_runs enable row level security;

-- Developers and admins can read; ETL writes via service-role (bypasses RLS).
create policy "admins_can_read_etl_runs"
  on public.doe_etl_runs
  for select
  using (public.is_developer_or_admin());
