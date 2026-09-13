-- Fix: old unique key (bulletin, region, company, fuel) still blocks city rows.
-- Postgres truncates long names to fuel_prices_bulletin_id_region_id_oil_company_id_fuel_type__key

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
  drop constraint if exists fuel_prices_bulletin_region_company_fuel_area_key;

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
