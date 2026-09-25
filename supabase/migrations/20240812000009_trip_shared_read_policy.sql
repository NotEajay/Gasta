-- Allow invited users to read trips for vehicles shared with them.
-- The existing trip_records_select_own policy remains unchanged.

create policy "trip_records_select_shared_vehicle"
  on public.trip_records
  for select
  using (
    exists (
      select 1
      from public.vehicle_shares vs
      where vs."vehicleID" = trip_records.vehicle_id
        and vs.shared_with = auth.uid()
        and vs.revoked = false
    )
  );
