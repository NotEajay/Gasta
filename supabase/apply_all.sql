-- GasTa: run this ONCE in Supabase Dashboard → SQL Editor → New query → Run
-- Combines all migrations: schema + reference seed + dev fuel data

-- =============================================================================
-- 1/3 Schema
-- =============================================================================

create table if not exists public.regions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.fuel_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.oil_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.transport_modes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.fuel_price_bulletins (
  id uuid primary key default gen_random_uuid(),
  bulletin_date date not null unique,
  source_pdf_url text,
  notes text,
  created_at timestamptz not null default now()
);

-- ETL provenance and freshness (migrations 20240812000006 / 20240812000007)
alter table public.fuel_price_bulletins
  add column if not exists data_freshness_days integer,
  add column if not exists last_loaded_at timestamptz,
  add column if not exists source_urls jsonb not null default '{}'::jsonb;

create table if not exists public.fuel_prices (
  id uuid primary key default gen_random_uuid(),
  bulletin_id uuid not null references public.fuel_price_bulletins (id) on delete cascade,
  region_id uuid not null references public.regions (id) on delete restrict,
  oil_company_id uuid not null references public.oil_companies (id) on delete restrict,
  fuel_type_id uuid not null references public.fuel_types (id) on delete restrict,
  area_name text not null default '',
  price_per_liter numeric(8, 2) not null check (price_per_liter > 0),
  created_at timestamptz not null default now(),
  unique (bulletin_id, region_id, oil_company_id, fuel_type_id, area_name)
);

create index if not exists fuel_prices_bulletin_id_idx on public.fuel_prices (bulletin_id);
create index if not exists fuel_prices_region_fuel_type_idx on public.fuel_prices (region_id, fuel_type_id);
create index if not exists fuel_prices_lookup_idx on public.fuel_prices (region_id, fuel_type_id, bulletin_id);

create table if not exists public.vehicle_catalog (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  model text not null,
  year smallint not null check (year >= 1980 and year <= 2100),
  fuel_type_id uuid not null references public.fuel_types (id) on delete restrict,
  fuel_efficiency_km_per_liter numeric(6, 2) not null check (fuel_efficiency_km_per_liter > 0),
  created_at timestamptz not null default now(),
  unique (brand, model, year, fuel_type_id)
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  catalog_id uuid references public.vehicle_catalog (id) on delete set null,
  brand text not null,
  model text not null,
  year smallint not null check (year >= 1980 and year <= 2100),
  fuel_type_id uuid not null references public.fuel_types (id) on delete restrict,
  fuel_efficiency_km_per_liter numeric(6, 2) not null check (fuel_efficiency_km_per_liter > 0),
  nickname text,
  last_refill_price numeric(8, 2) check (last_refill_price > 0),
  last_refill_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vehicles_user_id_idx on public.vehicles (user_id);

create table if not exists public.trip_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id uuid references public.vehicles (id) on delete set null,
  distance_km numeric(8, 2) not null check (distance_km > 0),
  origin_label text,
  destination_label text,
  mcda_weights jsonb not null,
  mode_evaluations jsonb not null,
  recommended_mode_code text not null,
  created_at timestamptz not null default now()
);

create index if not exists trip_records_user_id_idx on public.trip_records (user_id);

create table if not exists public.fuel_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  year smallint not null check (year >= 2020 and year <= 2100),
  month smallint not null check (month between 1 and 12),
  limit_amount numeric(12, 2) not null check (limit_amount > 0),
  alert_threshold_percent smallint not null default 80 check (alert_threshold_percent between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, year, month)
);

create index if not exists fuel_budgets_user_id_idx on public.fuel_budgets (user_id);

alter table public.regions enable row level security;
alter table public.fuel_types enable row level security;
alter table public.oil_companies enable row level security;
alter table public.transport_modes enable row level security;
alter table public.fuel_price_bulletins enable row level security;
alter table public.fuel_prices enable row level security;
alter table public.vehicle_catalog enable row level security;
alter table public.vehicles enable row level security;
alter table public.trip_records enable row level security;
alter table public.fuel_budgets enable row level security;

drop policy if exists "regions_public_read" on public.regions;
drop policy if exists "fuel_types_public_read" on public.fuel_types;
drop policy if exists "oil_companies_public_read" on public.oil_companies;
drop policy if exists "transport_modes_public_read" on public.transport_modes;
drop policy if exists "fuel_price_bulletins_public_read" on public.fuel_price_bulletins;
drop policy if exists "fuel_prices_public_read" on public.fuel_prices;
drop policy if exists "vehicle_catalog_public_read" on public.vehicle_catalog;
drop policy if exists "vehicles_select_own" on public.vehicles;
drop policy if exists "vehicles_insert_own" on public.vehicles;
drop policy if exists "vehicles_update_own" on public.vehicles;
drop policy if exists "vehicles_delete_own" on public.vehicles;
drop policy if exists "trip_records_select_own" on public.trip_records;
drop policy if exists "trip_records_insert_own" on public.trip_records;
drop policy if exists "trip_records_update_own" on public.trip_records;
drop policy if exists "trip_records_delete_own" on public.trip_records;
drop policy if exists "fuel_budgets_select_own" on public.fuel_budgets;
drop policy if exists "fuel_budgets_insert_own" on public.fuel_budgets;
drop policy if exists "fuel_budgets_update_own" on public.fuel_budgets;
drop policy if exists "fuel_budgets_delete_own" on public.fuel_budgets;

create policy "regions_public_read" on public.regions for select using (true);
create policy "fuel_types_public_read" on public.fuel_types for select using (true);
create policy "oil_companies_public_read" on public.oil_companies for select using (true);
create policy "transport_modes_public_read" on public.transport_modes for select using (true);
create policy "fuel_price_bulletins_public_read" on public.fuel_price_bulletins for select using (true);
create policy "fuel_prices_public_read" on public.fuel_prices for select using (true);
create policy "vehicle_catalog_public_read" on public.vehicle_catalog for select using (true);
create policy "vehicles_select_own" on public.vehicles for select using (auth.uid() = user_id);
create policy "vehicles_insert_own" on public.vehicles for insert with check (auth.uid() = user_id);
create policy "vehicles_update_own" on public.vehicles for update using (auth.uid() = user_id);
create policy "vehicles_delete_own" on public.vehicles for delete using (auth.uid() = user_id);
create policy "trip_records_select_own" on public.trip_records for select using (auth.uid() = user_id);
create policy "trip_records_insert_own" on public.trip_records for insert with check (auth.uid() = user_id);
create policy "trip_records_update_own" on public.trip_records for update using (auth.uid() = user_id);
create policy "trip_records_delete_own" on public.trip_records for delete using (auth.uid() = user_id);
create policy "fuel_budgets_select_own" on public.fuel_budgets for select using (auth.uid() = user_id);
create policy "fuel_budgets_insert_own" on public.fuel_budgets for insert with check (auth.uid() = user_id);
create policy "fuel_budgets_update_own" on public.fuel_budgets for update using (auth.uid() = user_id);
create policy "fuel_budgets_delete_own" on public.fuel_budgets for delete using (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists vehicles_set_updated_at on public.vehicles;
create trigger vehicles_set_updated_at before update on public.vehicles
  for each row execute function public.set_updated_at();

drop trigger if exists fuel_budgets_set_updated_at on public.fuel_budgets;
create trigger fuel_budgets_set_updated_at before update on public.fuel_budgets
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 2/3 Reference seed (skip if already inserted)
-- =============================================================================

insert into public.regions (code, name) values
  ('NCR', 'National Capital Region'),
  ('NORTH_LUZON', 'North Luzon'),
  ('SOUTH_LUZON', 'South Luzon'),
  ('VISAYAS', 'Visayas'),
  ('MINDANAO', 'Mindanao')
on conflict (code) do nothing;

insert into public.fuel_types (code, name, sort_order) values
  ('RON_91', 'RON 91', 1),
  ('RON_95', 'RON 95', 2),
  ('RON_97', 'RON 97', 3),
  ('RON_100', 'RON 100', 4),
  ('DIESEL', 'Diesel', 5),
  ('DIESEL_PLUS', 'Diesel Plus', 6),
  ('KEROSENE', 'Kerosene', 7)
on conflict (code) do nothing;

insert into public.transport_modes (code, name, description, sort_order) values
  ('OWN_VEHICLE', 'Own Vehicle', 'User registered vehicle using DOE bulletin fuel prices', 1),
  ('JEEPNEY', 'Jeepney', 'Public jeepney transport', 2),
  ('TRICYCLE', 'Tricycle', 'Motorized tricycle transport', 3),
  ('RIDE_HAILING', 'Ride-hailing', 'App-based ride-hailing service', 4),
  ('WALKING', 'Walking', 'Walking — no fuel cost', 5)
on conflict (code) do nothing;

-- =============================================================================
-- 3/3 Oil companies + vehicle catalog
--
-- No sample fuel prices: every price row comes from the DOE ETL
-- (`cd etl && python run.py backfill` for history, `sync-all` for the current week).
-- =============================================================================

insert into public.oil_companies (name, slug) values
  ('Petron', 'petron'),
  ('Shell', 'shell'),
  ('Caltex', 'caltex'),
  ('Total', 'total'),
  ('Seaoil', 'seaoil'),
  ('Unioil', 'unioil'),
  ('Phoenix', 'phoenix'),
  ('Jetti', 'jetti'),
  ('PTT', 'ptt'),
  ('Flying V', 'flying-v'),
  ('Clean Fuel', 'clean-fuel'),
  ('My Gas', 'my-gas')
on conflict (slug) do nothing;

<<<<<<< Updated upstream
-- Distinct DOE bulletin weeks per region (migration 20240812000007)
create or replace view public.region_bulletin_weeks as
select
  fp.region_id,
  r.code as region_code,
  b.id as bulletin_id,
  b.bulletin_date,
  b.data_freshness_days,
  b.last_loaded_at,
  count(*) as price_count
from public.fuel_prices fp
join public.fuel_price_bulletins b on b.id = fp.bulletin_id
join public.regions r on r.id = fp.region_id
group by fp.region_id, r.code, b.id, b.bulletin_date, b.data_freshness_days, b.last_loaded_at;

grant select on public.region_bulletin_weeks to anon, authenticated;
=======
insert into public.fuel_price_bulletins (bulletin_date, notes) values
  ('2026-08-05', 'Dev sample — current week'),
  ('2026-07-29', 'Dev sample — prior week for trend')
on conflict (bulletin_date) do nothing;

insert into public.fuel_prices (bulletin_id, region_id, oil_company_id, fuel_type_id, price_per_liter)
select b.id, r.id, c.id, ft.id,
  base.price + r_offset.offset + c_offset.offset
from public.fuel_price_bulletins b
cross join public.regions r
cross join public.oil_companies c
cross join public.fuel_types ft
cross join lateral (
  select case ft.code
    when 'RON_91' then 58.50 when 'RON_95' then 62.20 when 'RON_97' then 66.80
    when 'RON_100' then 72.50 when 'DIESEL' then 54.30 when 'DIESEL_PLUS' then 56.10
    when 'KEROSENE' then 48.90 else null end as price
) base
cross join lateral (
  select case r.code
    when 'NCR' then 0.00 when 'NORTH_LUZON' then -0.40 when 'SOUTH_LUZON' then -0.20
    when 'VISAYAS' then 0.60 when 'MINDANAO' then 0.80 else null end as offset
) r_offset
cross join lateral (
  select case c.slug
    when 'petron' then 0.00 when 'shell' then 0.15 when 'caltex' then 0.10
    when 'total' then -0.05 when 'seaoil' then -0.20 when 'unioil' then -0.15
    when 'phoenix' then -0.25 when 'jetti' then -0.30 else null end as offset
) c_offset
where b.bulletin_date = '2026-08-05'
  -- Only seed known sample brands; ETL may have added Flying V, PTT, Independent, etc.
  and c.slug in ('petron', 'shell', 'caltex', 'total', 'seaoil', 'unioil', 'phoenix', 'jetti')
  and base.price is not null
  and r_offset.offset is not null
  and c_offset.offset is not null
on conflict (bulletin_id, region_id, oil_company_id, fuel_type_id) do nothing;

insert into public.fuel_prices (bulletin_id, region_id, oil_company_id, fuel_type_id, price_per_liter)
select
  prior_b.id,
  fp.region_id, fp.oil_company_id, fp.fuel_type_id, fp.price_per_liter - 0.80
from public.fuel_prices fp
join public.fuel_price_bulletins b on b.id = fp.bulletin_id
join public.fuel_price_bulletins prior_b on prior_b.bulletin_date = '2026-07-29'
where b.bulletin_date = '2026-08-05'
on conflict (bulletin_id, region_id, oil_company_id, fuel_type_id) do nothing;
>>>>>>> Stashed changes

insert into public.vehicle_catalog (brand, model, year, fuel_type_id, fuel_efficiency_km_per_liter)
select 'Toyota', 'Vios', 2022, ft.id, 14.5 from public.fuel_types ft where ft.code = 'RON_91'
union all select 'Honda', 'City', 2023, ft.id, 15.2 from public.fuel_types ft where ft.code = 'RON_91'
union all select 'Mitsubishi', 'Mirage', 2021, ft.id, 16.0 from public.fuel_types ft where ft.code = 'RON_91'
union all select 'Toyota', 'Innova', 2022, ft.id, 11.5 from public.fuel_types ft where ft.code = 'DIESEL'
union all select 'Mitsubishi', 'Montero Sport', 2021, ft.id, 10.8 from public.fuel_types ft where ft.code = 'DIESEL'
union all select 'Honda', 'Click 125', 2023, ft.id, 45.0 from public.fuel_types ft where ft.code = 'RON_95'
union all select 'Yamaha', 'Mio i 125', 2022, ft.id, 42.0 from public.fuel_types ft where ft.code = 'RON_95'
on conflict (brand, model, year, fuel_type_id) do nothing;

-- From 20240812000003_vehicle_last_refill.sql
alter table public.vehicles
  add column if not exists last_refill_price numeric(8, 2) check (last_refill_price > 0),
  add column if not exists last_refill_at timestamptz;

-- From 20240812000004_saved_trips.sql
create table if not exists public.saved_trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  origin_label text,
  destination_label text,
  vehicle_id uuid references public.vehicles (id) on delete set null,
  distance_km numeric(8, 2) not null check (distance_km > 0),
  mcda_weights jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists saved_trips_user_id_idx on public.saved_trips (user_id);

alter table public.saved_trips enable row level security;

drop policy if exists "saved_trips_select_own" on public.saved_trips;
drop policy if exists "saved_trips_insert_own" on public.saved_trips;
drop policy if exists "saved_trips_update_own" on public.saved_trips;
drop policy if exists "saved_trips_delete_own" on public.saved_trips;

create policy "saved_trips_select_own" on public.saved_trips for select using (auth.uid() = user_id);
create policy "saved_trips_insert_own" on public.saved_trips for insert with check (auth.uid() = user_id);
create policy "saved_trips_update_own" on public.saved_trips for update using (auth.uid() = user_id);
create policy "saved_trips_delete_own" on public.saved_trips for delete using (auth.uid() = user_id);

drop trigger if exists saved_trips_set_updated_at on public.saved_trips;
create trigger saved_trips_set_updated_at
  before update on public.saved_trips
  for each row execute function public.set_updated_at();

-- From 20240812000005_community_fuel_stations.sql
--
-- Verification: N = 3 independent confirmations (excluding author)
-- Price match tolerance: ±0.50 PHP/L | Conflict tolerance: >1.00 PHP/L → needs_review
-- Manual review v1: Supabase Dashboard (set status + verified_by on needs_review rows)
-- Authoritative verified reports: status = verified and verified_at within 7 days

-- ---------------------------------------------------------------------------
-- fuel_stations
-- ---------------------------------------------------------------------------

create table if not exists public.fuel_stations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  oil_company_id uuid not null references public.oil_companies (id) on delete restrict,
  region_id uuid not null references public.regions (id) on delete restrict,
  latitude numeric(9, 6) not null,
  longitude numeric(9, 6) not null,
  address text,
  google_place_id text unique,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, region_id)
);

alter table public.fuel_stations
  add column if not exists brand_label text;

insert into public.oil_companies (name, slug)
values ('Independent', 'independent')
on conflict (slug) do nothing;

create index if not exists fuel_stations_region_id_idx on public.fuel_stations (region_id);
create index if not exists fuel_stations_oil_company_id_idx on public.fuel_stations (oil_company_id);
create index if not exists fuel_stations_lat_lng_idx on public.fuel_stations (latitude, longitude);

-- ---------------------------------------------------------------------------
-- community_fuel_reports
-- ---------------------------------------------------------------------------

create table if not exists public.community_fuel_reports (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.fuel_stations (id) on delete cascade,
  fuel_type_id uuid not null references public.fuel_types (id) on delete restrict,
  reported_price numeric(8, 2) not null check (reported_price > 0),
  reported_by uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'rejected', 'needs_review')),
  notes text,
  confirmation_count smallint not null default 0 check (confirmation_count >= 0),
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  verified_by uuid references auth.users (id) on delete set null,
  rejected_at timestamptz,
  rejection_reason text
);

create index if not exists community_fuel_reports_station_fuel_status_idx
  on public.community_fuel_reports (station_id, fuel_type_id, status);
create index if not exists community_fuel_reports_reported_by_idx
  on public.community_fuel_reports (reported_by);
create index if not exists community_fuel_reports_status_created_idx
  on public.community_fuel_reports (status, created_at desc);

-- ---------------------------------------------------------------------------
-- community_fuel_report_confirmations
-- ---------------------------------------------------------------------------

create table if not exists public.community_fuel_report_confirmations (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.community_fuel_reports (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  observed_price numeric(8, 2) not null check (observed_price > 0),
  created_at timestamptz not null default now(),
  unique (report_id, user_id)
);

create index if not exists community_fuel_report_confirmations_report_id_idx
  on public.community_fuel_report_confirmations (report_id);

-- ---------------------------------------------------------------------------
-- Triggers: confirmation count + auto-verify at N=3
-- ---------------------------------------------------------------------------

create or replace function public.sync_community_report_confirmation_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_report community_fuel_reports%rowtype;
  v_required_confirmations constant integer := 3;
begin
  select count(*)::integer into v_count
  from public.community_fuel_report_confirmations
  where report_id = coalesce(new.report_id, old.report_id);

  update public.community_fuel_reports
  set confirmation_count = v_count
  where id = coalesce(new.report_id, old.report_id)
  returning * into v_report;

  if v_report.status = 'pending'
     and v_count >= v_required_confirmations then
    update public.community_fuel_reports
    set
      status = 'verified',
      verified_at = now(),
      verified_by = null
    where id = v_report.id
      and status = 'pending';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists community_fuel_report_confirmations_sync_count
  on public.community_fuel_report_confirmations;
create trigger community_fuel_report_confirmations_sync_count
  after insert or delete on public.community_fuel_report_confirmations
  for each row execute function public.sync_community_report_confirmation_count();

drop trigger if exists fuel_stations_set_updated_at on public.fuel_stations;
create trigger fuel_stations_set_updated_at
  before update on public.fuel_stations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RPC: create station (when reporting at a new location)
-- ---------------------------------------------------------------------------

drop function if exists public.create_fuel_station(text, uuid, uuid, numeric, numeric, text);
drop function if exists public.create_fuel_station(text, uuid, uuid, numeric, numeric, text, text);

create or replace function public.create_fuel_station(
  p_name text,
  p_oil_company_id uuid,
  p_region_id uuid,
  p_latitude numeric,
  p_longitude numeric,
  p_address text default null,
  p_brand_label text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_station_id uuid;
  v_name text := trim(p_name);
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if v_name = '' then
    raise exception 'Station name is required';
  end if;

  select s.id into v_station_id
  from public.fuel_stations s
  where s.region_id = p_region_id
    and lower(s.name) = lower(v_name)
  limit 1;

  if v_station_id is not null then
    update public.fuel_stations
    set
      oil_company_id = p_oil_company_id,
      brand_label = nullif(trim(p_brand_label), ''),
      updated_at = now()
    where id = v_station_id;
    return v_station_id;
  end if;

  insert into public.fuel_stations (
    name, oil_company_id, region_id, latitude, longitude, address, created_by, brand_label
  )
  values (
    v_name,
    p_oil_company_id,
    p_region_id,
    p_latitude,
    p_longitude,
    nullif(trim(p_address), ''),
    v_user_id,
    nullif(trim(p_brand_label), '')
  )
  returning id into v_station_id;

  return v_station_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: submit report (+ conflict → needs_review)
-- ---------------------------------------------------------------------------

create or replace function public.submit_community_fuel_report(
  p_station_id uuid,
  p_fuel_type_id uuid,
  p_reported_price numeric,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_report_id uuid;
  v_has_conflict boolean := false;
  v_conflict_tolerance constant numeric := 1.00;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_reported_price <= 0 then
    raise exception 'Price must be greater than zero';
  end if;

  select exists (
    select 1
    from public.community_fuel_reports r
    where r.station_id = p_station_id
      and r.fuel_type_id = p_fuel_type_id
      and r.status in ('pending', 'needs_review')
      and abs(r.reported_price - p_reported_price) > v_conflict_tolerance
  ) into v_has_conflict;

  insert into public.community_fuel_reports (
    station_id, fuel_type_id, reported_price, reported_by, status, notes
  )
  values (
    p_station_id,
    p_fuel_type_id,
    p_reported_price,
    v_user_id,
    case when v_has_conflict then 'needs_review' else 'pending' end,
    nullif(trim(p_notes), '')
  )
  returning id into v_report_id;

  if v_has_conflict then
    update public.community_fuel_reports
    set status = 'needs_review'
    where station_id = p_station_id
      and fuel_type_id = p_fuel_type_id
      and status in ('pending', 'needs_review')
      and id <> v_report_id
      and abs(reported_price - p_reported_price) > v_conflict_tolerance;
  end if;

  return v_report_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: confirm report (crowd verification)
-- ---------------------------------------------------------------------------

create or replace function public.confirm_community_fuel_report(
  p_report_id uuid,
  p_observed_price numeric default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_report public.community_fuel_reports%rowtype;
  v_observed numeric;
  v_match_tolerance constant numeric := 0.50;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_report
  from public.community_fuel_reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'Report not found';
  end if;

  if v_report.status <> 'pending' then
    raise exception 'Only pending reports can be confirmed';
  end if;

  if v_report.reported_by = v_user_id then
    raise exception 'Authors cannot confirm their own report';
  end if;

  v_observed := coalesce(p_observed_price, v_report.reported_price);

  if abs(v_observed - v_report.reported_price) > v_match_tolerance then
    raise exception 'Observed price must be within ±0.50/L of the reported price';
  end if;

  insert into public.community_fuel_report_confirmations (
    report_id, user_id, observed_price
  )
  values (p_report_id, v_user_id, v_observed);
end;
$$;

-- ---------------------------------------------------------------------------
-- View: fresh verified prices for recommendation UI
-- ---------------------------------------------------------------------------

create or replace view public.fresh_verified_community_prices as
select distinct on (r.station_id, r.fuel_type_id)
  r.id as report_id,
  r.station_id,
  r.fuel_type_id,
  r.reported_price,
  r.verified_at,
  s.name as station_name,
  s.oil_company_id,
  s.region_id,
  s.latitude,
  s.longitude,
  s.address
from public.community_fuel_reports r
join public.fuel_stations s on s.id = r.station_id
where r.status = 'verified'
  and r.verified_at >= now() - interval '7 days'
order by r.station_id, r.fuel_type_id, r.verified_at desc;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.fuel_stations enable row level security;
alter table public.community_fuel_reports enable row level security;
alter table public.community_fuel_report_confirmations enable row level security;

-- Stations: public read; authenticated insert
drop policy if exists "fuel_stations_public_read" on public.fuel_stations;
drop policy if exists "fuel_stations_authenticated_insert" on public.fuel_stations;
drop policy if exists "fuel_stations_creator_update" on public.fuel_stations;

create policy "fuel_stations_public_read"
  on public.fuel_stations for select using (true);

create policy "fuel_stations_authenticated_insert"
  on public.fuel_stations for insert
  to authenticated
  with check (auth.uid() = created_by);

create policy "fuel_stations_creator_update"
  on public.fuel_stations for update
  to authenticated
  using (auth.uid() = created_by);

-- Reports: verified (fresh) public; pending public (confirm flow);
-- rejected/needs_review visible to author only
drop policy if exists "community_fuel_reports_select_verified" on public.community_fuel_reports;
drop policy if exists "community_fuel_reports_select_pending_authenticated" on public.community_fuel_reports;
drop policy if exists "community_fuel_reports_select_pending" on public.community_fuel_reports;
drop policy if exists "community_fuel_reports_select_own_private" on public.community_fuel_reports;

create policy "community_fuel_reports_select_verified"
  on public.community_fuel_reports for select
  using (
    status = 'verified'
    and verified_at >= now() - interval '7 days'
  );

create policy "community_fuel_reports_select_pending"
  on public.community_fuel_reports for select
  using (status = 'pending');

create policy "community_fuel_reports_select_own_private"
  on public.community_fuel_reports for select
  to authenticated
  using (
    reported_by = auth.uid()
    and status in ('rejected', 'needs_review')
  );

-- Inserts/updates via SECURITY DEFINER RPCs only (no direct client writes)

-- Confirmations: read if parent report is visible; inserts via confirm RPC only
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
          (r.status = 'verified' and r.verified_at >= now() - interval '7 days')
          or r.status = 'pending'
          or (r.reported_by = auth.uid() and r.status in ('rejected', 'needs_review'))
        )
    )
  );

-- Inserts via confirm_community_fuel_report RPC only

-- ---------------------------------------------------------------------------
-- NCR sample stations (demo / testing — approximate coordinates)
-- ---------------------------------------------------------------------------

insert into public.fuel_stations (name, oil_company_id, region_id, latitude, longitude, address)
select v.name, c.id, r.id, v.lat, v.lng, v.address
from (values
  ('Petron EDSA Shaw', 'petron', 14.580600, 121.055000, 'Shaw Blvd cor EDSA, Mandaluyong'),
  ('Shell BGC Triangle', 'shell', 14.551500, 121.047000, '32nd St, Bonifacio Global City, Taguig'),
  ('Caltex Quezon Avenue', 'caltex', 14.630500, 121.003400, 'Quezon Ave, Quezon City'),
  ('Seaoil Ortigas', 'seaoil', 14.587800, 121.061400, 'Ortigas Ave, Pasig'),
  ('Phoenix Timog', 'phoenix', 14.634900, 121.034400, 'Timog Ave, Quezon City'),
  ('Unioil Pasig Boulevard', 'unioil', 14.576400, 121.085100, 'Pasig Blvd, Pasig'),
  ('Total Magallanes', 'total', 14.541700, 121.019400, 'SLEX Magallanes, Makati'),
  ('Petron NAIA Road', 'petron', 14.508600, 121.012200, 'NAIA Rd, Pasay'),
  ('Shell Katipunan', 'shell', 14.639500, 121.074100, 'Katipunan Ave, Quezon City'),
  ('Caltex Alabang-Zapote', 'caltex', 14.429700, 121.016600, 'Alabang-Zapote Rd, Las Piñas')
) as v(name, slug, lat, lng, address)
join public.regions r on r.code = 'NCR'
join public.oil_companies c on c.slug = v.slug
on conflict (name, region_id) do nothing;

-- Grant RPC execute to authenticated users
grant execute on function public.create_fuel_station(text, uuid, uuid, numeric, numeric, text, text) to authenticated;
grant execute on function public.submit_community_fuel_report(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.confirm_community_fuel_report(uuid, numeric) to authenticated;

grant select on public.fresh_verified_community_prices to anon, authenticated;

-- Ensure pending community prices are publicly readable (Table Editor ≠ client RLS)
drop policy if exists "community_fuel_reports_select_pending_authenticated"
  on public.community_fuel_reports;
drop policy if exists "community_fuel_reports_select_pending"
  on public.community_fuel_reports;
create policy "community_fuel_reports_select_pending"
  on public.community_fuel_reports for select
  using (status = 'pending');

-- City/area grain + street-named sample stations (010 / 011)
alter table public.fuel_prices
  add column if not exists area_name text not null default '';

do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    join pg_namespace n on t.relnamespace = n.oid
    where n.nspname = 'public'
      and t.relname = 'fuel_prices'
      and c.contype = 'u'
  loop
    execute format('alter table public.fuel_prices drop constraint if exists %I', r.conname);
  end loop;
end $$;

alter table public.fuel_prices
  add constraint fuel_prices_bulletin_region_company_fuel_area_key
  unique (bulletin_id, region_id, oil_company_id, fuel_type_id, area_name);

create index if not exists fuel_prices_area_lookup_idx
  on public.fuel_prices (bulletin_id, region_id, fuel_type_id, area_name);

insert into public.oil_companies (name, slug) values
  ('Flying V', 'flying-v'),
  ('PTT', 'ptt'),
  ('Clean Fuel', 'clean-fuel'),
  ('My Gas', 'my-gas'),
  ('Jetti', 'jetti')
on conflict (slug) do nothing;

insert into public.fuel_stations (name, oil_company_id, region_id, latitude, longitude, address)
select v.name, c.id, r.id, v.lat, v.lng, v.address
from (values
  ('Seaoil EDSA Guadalupe Nuevo Makati', 'seaoil', 14.5665, 121.0440, 'EDSA Guadalupe Nuevo, Makati City'),
  ('Seaoil Taguig', 'seaoil', 14.5200, 121.0500, 'Taguig City'),
  ('Petron Felix Ave Santolan Pasig', 'petron', 14.6150, 121.0850, 'Felix Ave, Santolan, Pasig City'),
  ('Petron E. Rodriguez Ave', 'petron', 14.6250, 121.0100, 'E. Rodriguez Ave, Quezon City'),
  ('Flying V San Mateo 2', 'flying-v', 14.6950, 121.1200, 'San Mateo, Rizal'),
  ('Flying V Payatas Road', 'flying-v', 14.7150, 121.0800, 'Payatas Road, Quezon City'),
  ('PTT EDSA Kamuning', 'ptt', 14.6350, 121.0400, 'EDSA Kamuning, Quezon City'),
  ('PTT Congressional Ave', 'ptt', 14.6600, 121.0400, 'Congressional Ave, Quezon City'),
  ('PTT Camarin Road Caloocan', 'ptt', 14.7590, 121.0445, 'Camarin Rd, Caloocan City'),
  ('Flying V Bagumbong Road North Caloocan', 'flying-v', 14.7575, 121.0200, 'Bagumbong Rd, North Caloocan'),
  ('Petron EDSA Caloocan', 'petron', 14.6560, 120.9840, 'EDSA, Caloocan City'),
  ('Shell Quezon Avenue Quezon City', 'shell', 14.6305, 121.0034, 'Quezon Ave, Quezon City'),
  ('Caltex Marcos Highway Marikina', 'caltex', 14.6500, 121.1000, 'Marcos Highway, Marikina City'),
  ('Seaoil C5 Taguig', 'seaoil', 14.5180, 121.0480, 'C-5, Taguig City'),
  ('Unioil Roxas Boulevard Pasay', 'unioil', 14.5378, 120.9920, 'Roxas Blvd, Pasay City'),
  ('Phoenix Commonwealth Quezon City', 'phoenix', 14.6470, 121.0380, 'Commonwealth Ave, Quezon City')
) as v(name, slug, lat, lng, address)
join public.regions r on r.code = 'NCR'
join public.oil_companies c on c.slug = v.slug
on conflict (name, region_id) do nothing;

insert into public.fuel_stations (name, oil_company_id, region_id, latitude, longitude, address)
select v.name, c.id, r.id, v.lat, v.lng, v.address
from (values
  ('Petron Session Road Baguio', 'petron', 'NORTH_LUZON', 16.4120, 120.5930, 'Session Road, Baguio City'),
  ('Shell Marcos Highway Baguio', 'shell', 'NORTH_LUZON', 16.4025, 120.5965, 'Marcos Highway, Baguio City'),
  ('Caltex Magsaysay Avenue Baguio', 'caltex', 'NORTH_LUZON', 16.4150, 120.5980, 'Magsaysay Ave, Baguio City'),
  ('Petron MacArthur Highway Angeles', 'petron', 'NORTH_LUZON', 15.1450, 120.5840, 'MacArthur Highway, Angeles City'),
  ('Shell Friendship Highway Angeles', 'shell', 'NORTH_LUZON', 15.1500, 120.5900, 'Friendship Highway, Angeles City'),
  ('Seaoil Dagupan City', 'seaoil', 'NORTH_LUZON', 16.0430, 120.3330, 'Dagupan City'),
  ('Petron Tarlac City', 'petron', 'NORTH_LUZON', 15.4860, 120.5970, 'Tarlac City'),
  ('Caltex Cabanatuan City', 'caltex', 'NORTH_LUZON', 15.4865, 120.9675, 'Cabanatuan City'),
  ('Shell Olongapo City', 'shell', 'NORTH_LUZON', 14.8290, 120.2820, 'Olongapo City'),
  ('Petron Laoag City', 'petron', 'NORTH_LUZON', 18.1980, 120.5930, 'Laoag City'),
  ('Seaoil Tuguegarao City', 'seaoil', 'NORTH_LUZON', 17.6130, 121.7270, 'Tuguegarao City'),
  ('Petron San Fernando City La Union', 'petron', 'NORTH_LUZON', 16.6190, 120.3170, 'San Fernando City, La Union'),
  ('Petron Iloilo City', 'petron', 'VISAYAS', 10.7200, 122.5620, 'Iloilo City'),
  ('Shell Cebu City', 'shell', 'VISAYAS', 10.3157, 123.8854, 'Cebu City'),
  ('Petron Davao City', 'petron', 'MINDANAO', 7.1907, 125.4553, 'Davao City'),
  ('Caltex Cagayan de Oro City', 'caltex', 'MINDANAO', 8.4542, 124.6319, 'Cagayan de Oro City'),
  ('Petron Zamboanga City', 'petron', 'MINDANAO', 6.9214, 122.0790, 'Zamboanga City'),
  ('Shell Butuan City', 'shell', 'MINDANAO', 8.9475, 125.5406, 'Butuan City')
) as v(name, slug, region_code, lat, lng, address)
join public.regions r on r.code = v.region_code
join public.oil_companies c on c.slug = v.slug
on conflict (name, region_id) do nothing;
