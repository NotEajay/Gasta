-- Restore access to a previously revoked collaborator, on the SAME row.
--
-- Fixes the re-invite failure: vehicle_shares has unique (vehicleID,
-- shared_with) and revocation only sets revoked = true, so re-inviting the same
-- person used to attempt an INSERT and fail with 23505 "already shared".
--
-- This is a narrow function on purpose. vehicle_shares_update_owner_revoke has
-- `with check (shared_by = auth.uid() and revoked = true)`, so a plain client
-- UPDATE could never set revoked back to false. Rather than loosening that
-- policy and handing clients broad UPDATE on the table, ownership and the role
-- vocabulary are re-verified here, server-side, from the JWT and the table.
-- No client-supplied owner flag is trusted.

create or replace function public.restore_vehicle_share(
  p_vehicle_id uuid,
  p_user_id uuid,
  p_role text
)
returns public.vehicle_shares
language plpgsql
security definer
set search_path = public
as $$
declare
  share_row public.vehicle_shares;
begin
  if p_role not in ('Member', 'Driver', 'Operator', 'Viewer') then
    raise exception 'Unknown access role.';
  end if;

  -- Ownership is re-derived from vehicles.user_id, never from the client.
  if not public.is_vehicle_owner(p_vehicle_id) then
    raise exception 'Only the vehicle owner can share this vehicle.';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'That is your own account. You already own this vehicle.';
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'No GasTa account found for this user.';
  end if;

  select * into share_row
  from public.vehicle_shares
  where "vehicleID" = p_vehicle_id
    and shared_with = p_user_id
  for update;

  if share_row."ShareID" is null then
    raise exception 'No previous share found. Use create instead.';
  end if;

  if share_row.revoked = false then
    raise exception 'This user already has access to this vehicle.';
  end if;

  -- Reuse the row: revoked = false and the newly chosen role.
  update public.vehicle_shares
  set revoked = false,
      role = p_role
  where "ShareID" = share_row."ShareID"
  returning * into share_row;

  return share_row;
end;
$$;

revoke all on function public.restore_vehicle_share(uuid, uuid, text) from public, anon;
grant execute on function public.restore_vehicle_share(uuid, uuid, text) to authenticated;
