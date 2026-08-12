-- Dev/sample fuel price data for local development until ETL is implemented.
-- Oil companies commonly listed in DOE weekly bulletins.

insert into public.oil_companies (name, slug) values
  ('Petron', 'petron'),
  ('Shell', 'shell'),
  ('Caltex', 'caltex'),
  ('Total', 'total'),
  ('Seaoil', 'seaoil'),
  ('Unioil', 'unioil'),
  ('Phoenix', 'phoenix'),
  ('Jetti', 'jetti');

insert into public.fuel_price_bulletins (bulletin_date, notes) values
  ('2026-08-05', 'Dev sample — current week'),
  ('2026-07-29', 'Dev sample — prior week for trend');

-- Helper: insert prices for one bulletin across companies/regions for RON 95 and Diesel
insert into public.fuel_prices (bulletin_id, region_id, oil_company_id, fuel_type_id, price_per_liter)
select
  b.id,
  r.id,
  c.id,
  ft.id,
  base.price + r_offset.offset + c_offset.offset
from public.fuel_price_bulletins b
cross join public.regions r
cross join public.oil_companies c
cross join public.fuel_types ft
cross join lateral (
  select case ft.code
    when 'RON_91' then 58.50
    when 'RON_95' then 62.20
    when 'RON_97' then 66.80
    when 'RON_100' then 72.50
    when 'DIESEL' then 54.30
    when 'DIESEL_PLUS' then 56.10
    when 'KEROSENE' then 48.90
  end as price
) base
cross join lateral (
  select case r.code
    when 'NCR' then 0.00
    when 'NORTH_LUZON' then -0.40
    when 'SOUTH_LUZON' then -0.20
    when 'VISAYAS' then 0.60
    when 'MINDANAO' then 0.80
  end as offset
) r_offset
cross join lateral (
  select case c.slug
    when 'petron' then 0.00
    when 'shell' then 0.15
    when 'caltex' then 0.10
    when 'total' then -0.05
    when 'seaoil' then -0.20
    when 'unioil' then -0.15
    when 'phoenix' then -0.25
    when 'jetti' then -0.30
  end as offset
) c_offset
where b.bulletin_date = '2026-08-05'
  and ft.code in ('RON_91', 'RON_95', 'RON_97', 'RON_100', 'DIESEL', 'DIESEL_PLUS', 'KEROSENE');

-- Prior week — slightly lower for trend demo
insert into public.fuel_prices (bulletin_id, region_id, oil_company_id, fuel_type_id, price_per_liter)
select
  (select id from public.fuel_price_bulletins where bulletin_date = '2026-07-29'),
  fp.region_id,
  fp.oil_company_id,
  fp.fuel_type_id,
  fp.price_per_liter - 0.80
from public.fuel_prices fp
join public.fuel_price_bulletins b on b.id = fp.bulletin_id
where b.bulletin_date = '2026-08-05';

-- Vehicle catalog samples
insert into public.vehicle_catalog (brand, model, year, fuel_type_id, fuel_efficiency_km_per_liter)
select 'Toyota', 'Vios', 2022, ft.id, 14.5
from public.fuel_types ft where ft.code = 'RON_91'
union all
select 'Honda', 'City', 2023, ft.id, 15.2
from public.fuel_types ft where ft.code = 'RON_91'
union all
select 'Mitsubishi', 'Mirage', 2021, ft.id, 16.0
from public.fuel_types ft where ft.code = 'RON_91'
union all
select 'Toyota', 'Innova', 2022, ft.id, 11.5
from public.fuel_types ft where ft.code = 'DIESEL'
union all
select 'Mitsubishi', 'Montero Sport', 2021, ft.id, 10.8
from public.fuel_types ft where ft.code = 'DIESEL'
union all
select 'Honda', 'Click 125', 2023, ft.id, 45.0
from public.fuel_types ft where ft.code = 'RON_95'
union all
select 'Yamaha', 'Mio i 125', 2022, ft.id, 42.0
from public.fuel_types ft where ft.code = 'RON_95';
