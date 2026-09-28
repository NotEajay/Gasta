-- Add owner/recipient access policies for vehicle sharing.
-- Deletion is intentionally not granted; access is revoked by setting revoked=true.

create policy "vehicle_shares_insert_owner"
  on public.vehicle_shares
  for insert
  to authenticated
  with check (
    shared_by = auth.uid()
    and exists (
      select 1
      from public.vehicles v
      where v.id = vehicle_shares."vehicleID"
        and v.user_id = auth.uid()
    )
  );

create policy "vehicle_shares_select_participant"
  on public.vehicle_shares
  for select
  to authenticated
  using (
    shared_by = auth.uid()
    or shared_with = auth.uid()
  );

create policy "vehicle_shares_update_owner_revoke"
  on public.vehicle_shares
  for update
  to authenticated
  using (shared_by = auth.uid())
  with check (
    shared_by = auth.uid()
    and revoked = true
  );
