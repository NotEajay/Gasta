-- Vehicle sharing between a vehicle owner and an invited user.
--
-- This project stores vehicle keys in public.vehicles (id) and application
-- users in auth.users (id); those are the existing equivalents of the
-- requested VehicleID and UserID references.

create table public.vehicle_shares (
  "ShareID" uuid primary key default gen_random_uuid(),
  "vehicleID" uuid not null references public.vehicles (id) on delete cascade,
  shared_by uuid not null references auth.users (id),
  shared_with uuid not null references auth.users (id),
  role varchar(20) not null check (role in ('Driver', 'Operator')),
  created_at timestamp not null default current_timestamp,
  revoked boolean not null default false,
  unique ("vehicleID", shared_with)
);
