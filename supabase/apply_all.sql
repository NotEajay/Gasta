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

create table if not exists public.fuel_prices (
  id uuid primary key default gen_random_uuid(),
  bulletin_id uuid not null references public.fuel_price_bulletins (id) on delete cascade,
  region_id uuid not null references public.regions (id) on delete restrict,
  oil_company_id uuid not null references public.oil_companies (id) on delete restrict,
  fuel_type_id uuid not null references public.fuel_types (id) on delete restrict,
  price_per_liter numeric(8, 2) not null check (price_per_liter > 0),
  created_at timestamptz not null default now(),
  unique (bulletin_id, region_id, oil_company_id, fuel_type_id)
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
-- 3/3 Dev sample fuel + vehicle catalog (only if empty)
-- =============================================================================

insert into public.oil_companies (name, slug) values
  ('Petron', 'petron'),
  ('Shell', 'shell'),
  ('Caltex', 'caltex'),
  ('Total', 'total'),
  ('Seaoil', 'seaoil'),
  ('Unioil', 'unioil'),
  ('Phoenix', 'phoenix'),
  ('Jetti', 'jetti')
on conflict (slug) do nothing;

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
    when 'KEROSENE' then 48.90 end as price
) base
cross join lateral (
  select case r.code
    when 'NCR' then 0.00 when 'NORTH_LUZON' then -0.40 when 'SOUTH_LUZON' then -0.20
    when 'VISAYAS' then 0.60 when 'MINDANAO' then 0.80 end as offset
) r_offset
cross join lateral (
  select case c.slug
    when 'petron' then 0.00 when 'shell' then 0.15 when 'caltex' then 0.10
    when 'total' then -0.05 when 'seaoil' then -0.20 when 'unioil' then -0.15
    when 'phoenix' then -0.25 when 'jetti' then -0.30 end as offset
) c_offset
where b.bulletin_date = '2026-08-05'
on conflict (bulletin_id, region_id, oil_company_id, fuel_type_id) do nothing;

insert into public.fuel_prices (bulletin_id, region_id, oil_company_id, fuel_type_id, price_per_liter)
select
  (select id from public.fuel_price_bulletins where bulletin_date = '2026-07-29'),
  fp.region_id, fp.oil_company_id, fp.fuel_type_id, fp.price_per_liter - 0.80
from public.fuel_prices fp
join public.fuel_price_bulletins b on b.id = fp.bulletin_id
where b.bulletin_date = '2026-08-05'
on conflict (bulletin_id, region_id, oil_company_id, fuel_type_id) do nothing;

insert into public.vehicle_catalog (brand, model, year, fuel_type_id, fuel_efficiency_km_per_liter)
select 'Toyota', 'Vios', 2022, ft.id, 14.5 from public.fuel_types ft where ft.code = 'RON_91'
union all select 'Honda', 'City', 2023, ft.id, 15.2 from public.fuel_types ft where ft.code = 'RON_91'
union all select 'Mitsubishi', 'Mirage', 2021, ft.id, 16.0 from public.fuel_types ft where ft.code = 'RON_91'
union all select 'Toyota', 'Innova', 2022, ft.id, 11.5 from public.fuel_types ft where ft.code = 'DIESEL'
union all select 'Mitsubishi', 'Montero Sport', 2021, ft.id, 10.8 from public.fuel_types ft where ft.code = 'DIESEL'
union all select 'Honda', 'Click 125', 2023, ft.id, 45.0 from public.fuel_types ft where ft.code = 'RON_95'
union all select 'Yamaha', 'Mio i 125', 2022, ft.id, 42.0 from public.fuel_types ft where ft.code = 'RON_95'
on conflict (brand, model, year, fuel_type_id) do nothing;
