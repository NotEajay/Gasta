-- Phase 1: real fuel refills for vehicles, including shared vehicles.
--
-- One row per actual refuelling event. This is the single synchronized history
-- for a vehicle: every member of the vehicle sees the same rows, and the row is
-- never copied into a personal account.
--
-- vehicle_id uses ON DELETE RESTRICT (not CASCADE) on purpose: silently deleting
-- a vehicle would destroy shared expense history. Deleting a vehicle that has
-- refills must fail loudly instead.

create table public.vehicle_refills (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id) on delete restrict,
  total_amount numeric(12, 2) not null check (total_amount > 0),
  price_per_liter numeric(8, 2) not null check (price_per_liter > 0),
  liters numeric(10, 2) check (liters is null or liters > 0),
  fuel_type_id uuid references public.fuel_types (id) on delete set null,
  logged_by uuid not null references auth.users (id),
  paid_by uuid not null references auth.users (id),
  occurred_at timestamptz not null,
  notes text,
  receipt_ref text,
  voided_at timestamptz,
  voided_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- History for a vehicle, newest first.
create index vehicle_refills_vehicle_occurred_idx
  on public.vehicle_refills (vehicle_id, occurred_at desc);

-- Latest non-voided refill lookup drives the vehicles.last_refill_* cache.
create index vehicle_refills_active_idx
  on public.vehicle_refills (vehicle_id, occurred_at desc)
  where voided_at is null;

-- "What did this person pay for" reporting.
create index vehicle_refills_paid_by_idx
  on public.vehicle_refills (paid_by);

alter table public.vehicle_refills enable row level security;
