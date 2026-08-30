-- Add last-refill fields to vehicles for SAW fuel-cost input

alter table public.vehicles
  add column if not exists last_refill_price numeric(8, 2) check (last_refill_price > 0),
  add column if not exists last_refill_at timestamptz;
