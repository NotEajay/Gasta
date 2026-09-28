-- Sample street-named stations outside NCR so City + Station filters work
insert into public.oil_companies (name, slug) values
  ('Petron', 'petron'),
  ('Shell', 'shell'),
  ('Caltex', 'caltex'),
  ('Seaoil', 'seaoil'),
  ('Flying V', 'flying-v'),
  ('PTT', 'ptt')
on conflict (slug) do nothing;

insert into public.fuel_stations (name, oil_company_id, region_id, latitude, longitude, address)
select v.name, c.id, r.id, v.lat, v.lng, v.address
from (values
  -- North Luzon
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
  -- Visayas / Mindanao samples
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
