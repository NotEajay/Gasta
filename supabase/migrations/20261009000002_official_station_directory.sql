-- Official branch directory metadata reuses fuel_stations. No price tables,
-- DOE area mapping, reports, geocoding, or community creation RPCs are changed.
begin;

alter table public.fuel_stations
  add column source_type text not null default 'community',
  add column source_url text,
  add column source_station_id text,
  add column directory_key text,
  add column city text,
  add column province text,
  add column directory_region text,
  add column fuel_types jsonb,
  add column operating_hours text,
  add column last_synced_at timestamptz;

-- Unknown directory coordinates/DOE region are genuinely unknown, not zero,
-- approximate city centres, or inferred DOE areas. Existing rows remain intact.
alter table public.fuel_stations
  alter column region_id drop not null,
  alter column latitude drop not null,
  alter column longitude drop not null,
  add constraint fuel_stations_source_type_check
    check (source_type in ('community', 'official_directory')),
  add constraint fuel_stations_community_location_required
    check (source_type = 'official_directory' or
      (region_id is not null and latitude is not null and longitude is not null)),
  add constraint fuel_stations_official_provenance_required
    check (source_type <> 'official_directory' or
      (length(btrim(name)) > 0
       and directory_key is not null and length(btrim(directory_key)) > 0
       and source_url is not null and source_url like 'https://%'
       and last_synced_at is not null)),
  add constraint fuel_stations_coordinates_valid
    check (source_type <> 'official_directory' or
      (latitude is null and longitude is null) or
      (latitude is not null and longitude is not null
       and latitude between -90 and 90 and longitude between -180 and 180)),
  add constraint fuel_stations_fuel_types_array
    check (fuel_types is null or jsonb_typeof(fuel_types) = 'array'),
  add constraint fuel_stations_directory_identity_unique
    unique (oil_company_id, directory_key);

-- Existing manual coordinate values are preserved even if outside modern
-- bounds; the new range check is scoped to official directory records only.

-- Same source ID may exist for different brands. Prevent duplicates within brand.
create unique index fuel_stations_source_identity_idx
  on public.fuel_stations (oil_company_id, source_station_id)
  where source_station_id is not null and source_type = 'official_directory';

-- Existing authenticated community writes remain available. Only service_role
-- may create/edit official provenance, even if a caller spoofs created_by.
create policy fuel_stations_directory_insert_guard
  on public.fuel_stations as restrictive for insert to authenticated
  with check (source_type = 'community' and directory_key is null
    and source_station_id is null and source_url is null and last_synced_at is null);
create policy fuel_stations_directory_update_guard
  on public.fuel_stations as restrictive for update to authenticated
  using (source_type = 'community')
  with check (source_type = 'community' and directory_key is null
    and source_station_id is null and source_url is null and last_synced_at is null);

comment on column public.fuel_stations.directory_region is
  'Company-published region text, if available; never an inferred DOE pricing region.';
comment on column public.fuel_stations.fuel_types is
  'Official product names/availability only; not DOE price rows or pump prices.';
comment on column public.fuel_stations.directory_key is
  'Stable source:<source ID>, or address:<normalized name/address SHA-256>, scoped to oil_company_id.';

commit;
