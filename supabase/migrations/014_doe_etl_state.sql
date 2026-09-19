-- Singleton row: when the ETL last successfully fetched bulletins from doe.gov.ph
-- (GitHub Actions weekly sync, or a manual sync-all). Updated even if all weeks
-- were already stored and price rows were skipped.

create table if not exists public.doe_etl_state (
  id smallint primary key default 1 check (id = 1),
  last_website_fetch_at timestamptz not null,
  last_trigger text,
  last_run_id text,
  updated_at timestamptz not null default now()
);

comment on table public.doe_etl_state is
  'Last successful pull from the DOE retail pump price website / CMS';
comment on column public.doe_etl_state.last_website_fetch_at is
  'When ETL last contacted DOE and resolved the latest bulletins';

alter table public.doe_etl_state enable row level security;

drop policy if exists "doe_etl_state_public_read" on public.doe_etl_state;
create policy "doe_etl_state_public_read"
  on public.doe_etl_state for select
  using (true);

grant select on public.doe_etl_state to anon, authenticated;

-- Seed from the latest successful GitHub Actions weekly sync known at migration time
-- (DOE Weekly ETL #9 on master, 16:22 PH). Later sync-all runs overwrite this.
insert into public.doe_etl_state (id, last_website_fetch_at, last_trigger, last_run_id)
values (1, '2026-09-16T16:22:00+08:00', 'github-actions', null)
on conflict (id) do nothing;
