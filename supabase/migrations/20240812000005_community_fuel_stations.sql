-- Community fuel stations + crowd-verified price reports (Phase A — no Maps API)
--
-- Verification: N = 3 independent confirmations (excluding author)
-- Price match tolerance: ±0.50 PHP/L | Conflict tolerance: >1.00 PHP/L → needs_review
-- Manual review v1: Supabase Dashboard (set status + verified_by on needs_review rows)
-- Authoritative verified reports: status = verified and verified_at within 7 days

-- ---------------------------------------------------------------------------
-- fuel_stations
-- ---------------------------------------------------------------------------

create table public.fuel_stations (
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

create index fuel_stations_region_id_idx on public.fuel_stations (region_id);
create index fuel_stations_oil_company_id_idx on public.fuel_stations (oil_company_id);
create index fuel_stations_lat_lng_idx on public.fuel_stations (latitude, longitude);

-- ---------------------------------------------------------------------------
-- community_fuel_reports
-- ---------------------------------------------------------------------------

create table public.community_fuel_reports (
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

create index community_fuel_reports_station_fuel_status_idx
  on public.community_fuel_reports (station_id, fuel_type_id, status);
create index community_fuel_reports_reported_by_idx
  on public.community_fuel_reports (reported_by);
create index community_fuel_reports_status_created_idx
  on public.community_fuel_reports (status, created_at desc);

-- ---------------------------------------------------------------------------
-- community_fuel_report_confirmations
-- ---------------------------------------------------------------------------

create table public.community_fuel_report_confirmations (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.community_fuel_reports (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  observed_price numeric(8, 2) not null check (observed_price > 0),
  created_at timestamptz not null default now(),
  unique (report_id, user_id)
);

create index community_fuel_report_confirmations_report_id_idx
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

create trigger community_fuel_report_confirmations_sync_count
  after insert or delete on public.community_fuel_report_confirmations
  for each row execute function public.sync_community_report_confirmation_count();

create trigger fuel_stations_set_updated_at
  before update on public.fuel_stations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RPC: create station (when reporting at a new location)
-- ---------------------------------------------------------------------------

create or replace function public.create_fuel_station(
  p_name text,
  p_oil_company_id uuid,
  p_region_id uuid,
  p_latitude numeric,
  p_longitude numeric,
  p_address text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_station_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.fuel_stations (
    name, oil_company_id, region_id, latitude, longitude, address, created_by
  )
  values (
    trim(p_name), p_oil_company_id, p_region_id, p_latitude, p_longitude,
    nullif(trim(p_address), ''), v_user_id
  )
  on conflict (name, region_id) do update
    set updated_at = now()
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

-- Reports: verified (fresh) public; pending visible to authenticated (confirm flow);
-- rejected/needs_review visible to author only
create policy "community_fuel_reports_select_verified"
  on public.community_fuel_reports for select
  using (
    status = 'verified'
    and verified_at >= now() - interval '7 days'
  );

create policy "community_fuel_reports_select_pending_authenticated"
  on public.community_fuel_reports for select
  to authenticated
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
grant execute on function public.create_fuel_station(text, uuid, uuid, numeric, numeric, text) to authenticated;
grant execute on function public.submit_community_fuel_report(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.confirm_community_fuel_report(uuid, numeric) to authenticated;

grant select on public.fresh_verified_community_prices to anon, authenticated;
