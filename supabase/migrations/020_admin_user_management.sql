-- ============================================================
-- Migration 020: Admin user-management RPCs
-- ============================================================

-- ── 1. Admin can UPDATE any profile (role guard done inside the RPC) ─────────
-- The RPC runs as security definer (postgres role) so it bypasses the per-user
-- RLS update policy. No extra RLS policy needed, but we DO need to make sure
-- the RPC itself checks is_admin().

create or replace function public.admin_update_profile(
  target_user_id uuid,
  new_full_name   text,
  new_role        text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Unauthorized: only admins can update profiles';
  end if;

  update public.profiles
  set
    full_name  = coalesce(new_full_name, full_name),
    role       = new_role,
    updated_at = now()
  where id = target_user_id;

  if not found then
    raise exception 'User not found: %', target_user_id;
  end if;
end;
$$;

-- ── 2. Fetch a user's vehicles ────────────────────────────────────────────────
create or replace function public.admin_get_user_vehicles(target_user_id uuid)
returns table (
  id                           uuid,
  brand                        text,
  model                        text,
  year                         smallint,
  nickname                     text,
  fuel_efficiency_km_per_liter numeric
)
language sql
security definer
set search_path = public
as $$
  select id, brand, model, year, nickname, fuel_efficiency_km_per_liter
  from   public.vehicles
  where  user_id = target_user_id
  order  by created_at asc;
$$;

-- ── 3. Update a vehicle (nickname + fuel efficiency) ─────────────────────────
create or replace function public.admin_update_vehicle(
  target_vehicle_id            uuid,
  new_nickname                 text,
  new_fuel_efficiency          numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Unauthorized: only admins can update vehicles';
  end if;

  update public.vehicles
  set
    nickname                     = new_nickname,
    fuel_efficiency_km_per_liter = new_fuel_efficiency,
    updated_at                   = now()
  where id = target_vehicle_id;

  if not found then
    raise exception 'Vehicle not found: %', target_vehicle_id;
  end if;
end;
$$;

-- ── 4. Delete a vehicle ───────────────────────────────────────────────────────
create or replace function public.admin_delete_vehicle(target_vehicle_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Unauthorized: only admins can delete vehicles';
  end if;

  delete from public.vehicles where id = target_vehicle_id;
end;
$$;

-- ── 5. Delete a user (cascades to all their data) ────────────────────────────
create or replace function public.admin_delete_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Unauthorized: only admins can delete users';
  end if;

  delete from auth.users where id = target_user_id;
end;
$$;
