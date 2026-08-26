-- Add ETL validation and data freshness columns to fuel_price_bulletins

-- Add data freshness tracking columns
alter table public.fuel_price_bulletins
  add column if not exists data_freshness_days integer,
  add column if not exists last_loaded_at timestamptz;

-- Add comment for documentation
comment on column public.fuel_price_bulletins.data_freshness_days is 'Days between bulletin date and last ETL load (data freshness indicator)';
comment on column public.fuel_price_bulletins.last_loaded_at is 'Timestamp when this bulletin was last loaded by ETL pipeline';
