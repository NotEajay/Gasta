-- Allow authenticated users to read the vehicle metadata needed to render
-- vehicles shared with them. Vehicle writes remain owner-only.

create policy "vehicles_select_shared"
  on public.vehicles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.vehicle_shares vs
      where vs."vehicleID" = vehicles.id
        and vs.shared_with = auth.uid()
        and vs.revoked = false
    )
  );
