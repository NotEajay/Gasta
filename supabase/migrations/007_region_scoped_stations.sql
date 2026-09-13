-- Stations typed on Report a price belong to one DOE region only.
-- Custom brands are stored on the station (brand_label), not as a global oil company.

alter table public.fuel_stations
  add column if not exists brand_label text;

insert into public.oil_companies (name, slug)
values ('Independent', 'independent')
on conflict (slug) do nothing;

drop function if exists public.create_fuel_station(text, uuid, uuid, numeric, numeric, text);

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

grant execute on function public.create_fuel_station(text, uuid, uuid, numeric, numeric, text, text)
  to authenticated;
