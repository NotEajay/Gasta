-- City/area grain for DOE fuel prices (all macro-regions when the PDF lists areas).
-- area_name '' = region-wide minimum (All cities / All areas view).

alter table public.fuel_prices
  add column if not exists area_name text not null default '';

-- Drop every unique constraint on fuel_prices (old 4-col key blocks city rows).
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

-- Sample street-named NCR stations for community reporting UI
insert into public.fuel_stations (name, oil_company_id, region_id, latitude, longitude, address)
select v.name, c.id, r.id, v.lat, v.lng, v.address
from (values
  ('PTT Camarin Road Caloocan', 'ptt', 14.7590, 121.0445, 'Camarin Rd, Caloocan City'),
  ('Flying V Bagumbong Road North Caloocan', 'flying-v', 14.7575, 121.0200, 'Bagumbong Rd, North Caloocan'),
  ('Petron EDSA Caloocan', 'petron', 14.6560, 120.9840, 'EDSA, Caloocan City'),
  ('Shell Quezon Avenue Quezon City', 'shell', 14.6305, 121.0034, 'Quezon Ave, Quezon City'),
  ('Caltex Marcos Highway Marikina', 'caltex', 14.6500, 121.1000, 'Marcos Highway, Marikina City'),
  ('Seaoil C5 Taguig', 'seaoil', 14.5200, 121.0500, 'C-5, Taguig City'),
  ('Unioil Roxas Boulevard Pasay', 'unioil', 14.5378, 120.9920, 'Roxas Blvd, Pasay City'),
  ('Phoenix Commonwealth Quezon City', 'phoenix', 14.6470, 121.0380, 'Commonwealth Ave, Quezon City')
) as v(name, slug, lat, lng, address)
join public.regions r on r.code = 'NCR'
join public.oil_companies c on c.slug = v.slug
on conflict (name, region_id) do nothing;
