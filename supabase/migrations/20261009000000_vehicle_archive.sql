-- Safe Archive Vehicle flow (no CASCADE, no history deletion).
--
-- DEPENDENCY LIST for public.vehicles(id) audited before this change:
--   DIRECT FKs:
--     1. vehicle_refills.vehicle_id -> ON DELETE RESTRICT (blocks delete)
--     2. vehicle_shares."vehicleID" -> ON DELETE CASCADE (would wipe shares)
--     3. trip_records.vehicle_id    -> ON DELETE SET NULL (would null history)
--     4. saved_trips.vehicle_id     -> ON DELETE SET NULL (would null template)
--   INDIRECT: refill_allocations.refill_id -> RESTRICT via refills (preserved).
--   READERS: monthly_budget_analytics(), is_vehicle_owner,
--     has_vehicle_access, is_vehicle_member, can_contribute_refills,
--     can_manage_refill_allocations, is_allocation_recipient,
--     vehicle_members, restore_vehicle_share, void_vehicle_refill.
-- Additive only: adds archived_at + RPCs. No FK loosened, no RLS changed.

alter table public.vehicles
  add column if not exists archived_at timestamptz null;

create index if not exists vehicles_active_user_idx
  on public.vehicles (user_id, created_at desc)
  where archived_at is null;

-- Owner-scoped history probe. SECURITY DEFINER so trips logged by a
-- collaborator (their user_id) are still counted; gated to the owner.
create or replace function public.vehicle_has_history(p_vehicle_id uuid)
returns table (
  has_history boolean,
  refill_count bigint,
  trip_count bigint,
  share_count bigint,
  saved_trip_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select v.user_id into v_owner
  from public.vehicles v
  where v.id = p_vehicle_id;
  if v_owner is null then
    raise exception 'Vehicle not found.';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'Only the vehicle owner can check vehicle history.';
  end if;
  return query
  select
    (
      (select count(*) from public.vehicle_refills r
        where r.vehicle_id = p_vehicle_id) > 0
      or (select count(*) from public.trip_records t
        where t.vehicle_id = p_vehicle_id) > 0
      or (select count(*) from public.vehicle_shares s
        where s."vehicleID" = p_vehicle_id) > 0
      or (select count(*) from public.saved_trips st
        where st.vehicle_id = p_vehicle_id) > 0
    ),
    (select count(*) from public.vehicle_refills r
      where r.vehicle_id = p_vehicle_id),
    (select count(*) from public.trip_records t
      where t.vehicle_id = p_vehicle_id),
    (select count(*) from public.vehicle_shares s
      where s."vehicleID" = p_vehicle_id),
    (select count(*) from public.saved_trips st
      where st.vehicle_id = p_vehicle_id);
end;
$$;

revoke all on function public.vehicle_has_history(uuid) from public, anon;
grant execute on function public.vehicle_has_history(uuid) to authenticated;

-- Archive: owner-only soft delete. The row stays, so refills, trips,
-- allocations (via refills), shares and saved trips stay intact.
create or replace function public.archive_vehicle(p_vehicle_id uuid)
returns public.vehicles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.vehicles;
begin
  select * into v_row
  from public.vehicles v
  where v.id = p_vehicle_id
  for update;
  if not found then
    raise exception 'Vehicle not found.';
  end if;
  if v_row.user_id <> auth.uid() then
    raise exception 'Only the vehicle owner can archive this vehicle.';
  end if;
  if v_row.archived_at is not null then
    return v_row;
  end if;
  update public.vehicles
  set archived_at = now()
  where id = p_vehicle_id
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.archive_vehicle(uuid) from public, anon;
grant execute on function public.archive_vehicle(uuid) to authenticated;

-- Restore: owner-only un-archive.
create or replace function public.restore_vehicle(p_vehicle_id uuid)
returns public.vehicles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.vehicles;
begin
  select * into v_row
  from public.vehicles v
  where v.id = p_vehicle_id
  for update;
  if not found then
    raise exception 'Vehicle not found.';
  end if;
  if v_row.user_id <> auth.uid() then
    raise exception 'Only the vehicle owner can restore this vehicle.';
  end if;
  if v_row.archived_at is null then
    return v_row;
  end if;
  update public.vehicles
  set archived_at = null
  where id = p_vehicle_id
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.restore_vehicle(uuid) from public, anon;
grant execute on function public.restore_vehicle(uuid) to authenticated;
