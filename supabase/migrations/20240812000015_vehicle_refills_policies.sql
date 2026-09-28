-- Row level security for vehicle_refills.
--
-- Access model (Phase 1). Ownership stays structural via vehicles.user_id; the
-- Driver / Operator labels in vehicle_shares now carry real meaning.
--
--   Owner     (vehicles.user_id)  log, read, edit any, void any
--   Operator  (active share)      log, read, edit only own
--   Driver    (active share)      log, read, edit only own
--
-- permissions are decided by ownership + authorship, never by the client-chosen
-- role string.

-- ---------------------------------------------------------------- helpers ---

-- True when the caller owns the vehicle. SECURITY INVOKER so vehicles RLS
-- (vehicles_select_own) still applies to the caller.
create or replace function public.is_vehicle_owner(p_vehicle_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.vehicles v
    where v.id = p_vehicle_id and v.user_id = auth.uid()
  );
$$;

revoke all on function public.is_vehicle_owner(uuid) from public, anon;
grant execute on function public.is_vehicle_owner(uuid) to authenticated;

-- True when the caller owns the vehicle OR has an active share on it.
create or replace function public.has_vehicle_access(p_vehicle_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select public.is_vehicle_owner(p_vehicle_id) or exists (
    select 1 from public.vehicle_shares s
    where s."vehicleID" = p_vehicle_id
      and s.shared_with = auth.uid()
      and s.revoked = false
  );
$$;

revoke all on function public.has_vehicle_access(uuid) from public, anon;
grant execute on function public.has_vehicle_access(uuid) to authenticated;

-- True when p_user_id is a valid member of the vehicle: the owner, or an active
-- Driver/Operator recipient. SECURITY DEFINER is required because the caller's
-- RLS cannot see another user's vehicle row or share row. It is gated on
-- has_vehicle_access() so a caller can only probe members of a vehicle they can
-- already access.
create or replace function public.is_vehicle_member(p_vehicle_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_vehicle_access(p_vehicle_id) and (
    exists (
      select 1 from public.vehicles v
      where v.id = p_vehicle_id and v.user_id = p_user_id
    )
    or exists (
      select 1 from public.vehicle_shares s
      where s."vehicleID" = p_vehicle_id
        and s.shared_with = p_user_id
        and s.revoked = false
    )
  );
$$;

revoke all on function public.is_vehicle_member(uuid, uuid) from public, anon;
grant execute on function public.is_vehicle_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- policies ---

-- READ: owner and active collaborators share one synchronized history.
-- Phase 1 deliberately hides voided rows from EVERY role, including the owner.
-- Voiding is a correction, not a deletion, so the row is retained on the server
-- for audit, but no client currently needs to see it and there is no audit UI
-- yet. Widening this to "owner may also read voided" can be added later without
-- changing this policy's shape.
create policy "vehicle_refills_select_members"
  on public.vehicle_refills
  for select
  to authenticated
  using (public.has_vehicle_access(vehicle_id) and voided_at is null);

-- INSERT: any member may log, but only as themselves, and only naming a payer
-- who really is a member of this vehicle.
create policy "vehicle_refills_insert_members"
  on public.vehicle_refills
  for insert
  to authenticated
  with check (
    public.has_vehicle_access(vehicle_id)
    and logged_by = auth.uid()
    and public.is_vehicle_member(vehicle_id, paid_by)
  );

-- UPDATE: owner may correct any refill; a collaborator only their own.
-- Because WITH CHECK re-evaluates logged_by on the NEW row, a collaborator
-- cannot rewrite logged_by: doing so fails logged_by = auth.uid() and they are
-- not the owner.
create policy "vehicle_refills_update_owner_or_author"
  on public.vehicle_refills
  for update
  to authenticated
  using (public.is_vehicle_owner(vehicle_id) or logged_by = auth.uid())
  with check (
    public.has_vehicle_access(vehicle_id)
    and (public.is_vehicle_owner(vehicle_id) or logged_by = auth.uid())
    and public.is_vehicle_member(vehicle_id, paid_by)
  );

-- No DELETE policy: corrections are soft-voids via voided_at / voided_by so the
-- expense history and any future allocations are never silently destroyed.
