-- Make Viewer genuinely read-only, enforced in the database rather than by
-- hiding buttons in the client.
--
-- Reading is unchanged: has_vehicle_access() still admits any active share, so a
-- Viewer can read the vehicle, its trips and its refill history, and can still be
-- named as paid_by on someone else's refill. Only WRITES are withheld.

-- True when the caller may create/edit/void refills: the owner, or an active
-- share whose role is not 'Viewer'.
create or replace function public.can_contribute_refills(p_vehicle_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select public.is_vehicle_owner(p_vehicle_id) or exists (
    select 1
    from public.vehicle_shares s
    where s."vehicleID" = p_vehicle_id
      and s.shared_with = auth.uid()
      and s.revoked = false
      and s.role <> 'Viewer'
  );
$$;

revoke all on function public.can_contribute_refills(uuid) from public, anon;
grant execute on function public.can_contribute_refills(uuid) to authenticated;

-- INSERT: swap read access for write access.
drop policy if exists "vehicle_refills_insert_members" on public.vehicle_refills;
create policy "vehicle_refills_insert_members"
  on public.vehicle_refills
  for insert
  to authenticated
  with check (
    public.can_contribute_refills(vehicle_id)
    and logged_by = auth.uid()
    and public.is_vehicle_member(vehicle_id, paid_by)
  );

-- UPDATE: a Viewer is neither the owner nor an author, so they are excluded.
drop policy if exists "vehicle_refills_update_owner_or_author" on public.vehicle_refills;
create policy "vehicle_refills_update_owner_or_author"
  on public.vehicle_refills
  for update
  to authenticated
  using (
    public.is_vehicle_owner(vehicle_id)
    or (public.can_contribute_refills(vehicle_id) and logged_by = auth.uid())
  )
  with check (
    public.is_vehicle_owner(vehicle_id)
    or (public.can_contribute_refills(vehicle_id) and logged_by = auth.uid())
  );
