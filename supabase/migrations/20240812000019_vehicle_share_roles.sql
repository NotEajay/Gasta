-- Widen the share role vocabulary.
--
-- The original inline CHECK (role in ('Driver','Operator')) was created in
-- 20240812000008 and auto-named vehicle_shares_role_check. It is replaced, not
-- edited, so existing Driver/Operator rows stay valid untouched.
--
-- Owner is deliberately NOT a role: ownership stays structural in
-- vehicles.user_id, so an owner never needs a vehicle_shares row.
--
-- 'Member'   trusted person who shares and uses the vehicle (family, partner,
--            roommate).
-- 'Driver'   drives on behalf of the owner or as part of their work.
-- 'Operator' helps manage day-to-day operation.
-- 'Viewer'   read-only.

alter table public.vehicle_shares
  drop constraint if exists vehicle_shares_role_check;

alter table public.vehicle_shares
  add constraint "vehicle_shares_role_check"
  check (role in ('Member', 'Driver', 'Operator', 'Viewer'));
