-- GasTa initial schema — DOE weekly fuel bulletins + user-owned records

-- ---------------------------------------------------------------------------
-- Reference tables (public read-only)
-- ---------------------------------------------------------------------------

create table public.regions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.fuel_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);

create table public.oil_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table public.transport_modes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Fuel price data (public read-only; sourced from DOE weekly PDF bulletins)
-- ---------------------------------------------------------------------------

create table public.fuel_price_bulletins (
  id uuid primary key default gen_random_uuid(),
  bulletin_date date not null unique,
  source_pdf_url text,
  notes text,
  created_at timestamptz not null default now()
);

create table public.fuel_prices (
  id uuid primary key default gen_random_uuid(),
  bulletin_id uuid not null references public.fuel_price_bulletins (id) on delete cascade,
  region_id uuid not null references public.regions (id) on delete restrict,
  oil_company_id uuid not null references public.oil_companies (id) on delete restrict,
  fuel_type_id uuid not null references public.fuel_types (id) on delete restrict,
  price_per_liter numeric(8, 2) not null check (price_per_liter > 0),
  created_at timestamptz not null default now(),
  unique (bulletin_id, region_id, oil_company_id, fuel_type_id)
);

create index fuel_prices_bulletin_id_idx on public.fuel_prices (bulletin_id);
create index fuel_prices_region_fuel_type_idx on public.fuel_prices (region_id, fuel_type_id);
create index fuel_prices_lookup_idx on public.fuel_prices (region_id, fuel_type_id, bulletin_id);

-- ---------------------------------------------------------------------------
-- Vehicle catalog (public read) + user vehicles (private)
-- ---------------------------------------------------------------------------

create table public.vehicle_catalog (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  model text not null,
  year smallint not null check (year >= 1980 and year <= 2100),
  fuel_type_id uuid not null references public.fuel_types (id) on delete restrict,
  fuel_efficiency_km_per_liter numeric(6, 2) not null check (fuel_efficiency_km_per_liter > 0),
  created_at timestamptz not null default now(),
  unique (brand, model, year, fuel_type_id)
);

create table public.vehicles (
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

create index vehicles_user_id_idx on public.vehicles (user_id);

-- ---------------------------------------------------------------------------
-- Trip records — full MCDA breakdown stored for auditability
-- ---------------------------------------------------------------------------

create table public.trip_records (
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

create index trip_records_user_id_idx on public.trip_records (user_id);

-- ---------------------------------------------------------------------------
-- Personal fuel budgets (private)
-- ---------------------------------------------------------------------------

create table public.fuel_budgets (
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

create index fuel_budgets_user_id_idx on public.fuel_budgets (user_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

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

-- Public read-only reference + fuel price data
create policy "regions_public_read" on public.regions for select using (true);
create policy "fuel_types_public_read" on public.fuel_types for select using (true);
create policy "oil_companies_public_read" on public.oil_companies for select using (true);
create policy "transport_modes_public_read" on public.transport_modes for select using (true);
create policy "fuel_price_bulletins_public_read" on public.fuel_price_bulletins for select using (true);
create policy "fuel_prices_public_read" on public.fuel_prices for select using (true);
create policy "vehicle_catalog_public_read" on public.vehicle_catalog for select using (true);

-- User-owned records
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

-- ---------------------------------------------------------------------------
-- updated_at trigger for user-editable tables
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger vehicles_set_updated_at
  before update on public.vehicles
  for each row execute function public.set_updated_at();

create trigger fuel_budgets_set_updated_at
  before update on public.fuel_budgets
  for each row execute function public.set_updated_at();
