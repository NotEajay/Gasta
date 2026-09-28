-- More NCR street-named stations for Brand | Station price list UI
insert into public.oil_companies (name, slug) values
  ('Flying V', 'flying-v'),
  ('PTT', 'ptt'),
  ('Seaoil', 'seaoil')
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
