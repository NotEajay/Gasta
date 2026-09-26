-- Narrow, vehicle-scoped member lookup for the refill UI ("Paid by", "Logged by").
--
-- The profiles table is own-row-only under RLS, so the app cannot currently
-- resolve a co-member's name at all (VehicleSharePanel falls back to
-- "Shared user"). This SECURITY DEFINER function is the single, narrow exception:
--
--   * it only returns members of ONE vehicle,
--   * and only when the caller already has access to that vehicle,
--   * and it returns just id + full_name + role. No email, no unrelated users,
--     and no way to enumerate the wider user base.
--
-- This mirrors the existing find_user_by_email pattern (security definer,
-- revoked from public/anon, granted to authenticated).

create or replace function public.vehicle_members(p_vehicle_id uuid)
returns table (user_id uuid, full_name text, role text)
language sql
stable
security definer
set search_path = public
as $$
  -- The vehicle owner.
  select v.user_id, p.full_name, 'Owner'::text
  from public.vehicles v
  left join public.profiles p on p.id = v.user_id
  where v.id = p_vehicle_id
    and public.has_vehicle_access(p_vehicle_id)

  union all

  -- Active Driver / Operator recipients.
  select s.shared_with, p2.full_name, s.role
  from public.vehicle_shares s
  left join public.profiles p2 on p2.id = s.shared_with
  where s."vehicleID" = p_vehicle_id
    and s.revoked = false
    and public.has_vehicle_access(p_vehicle_id);
$$;

revoke all on function public.vehicle_members(uuid) from public, anon;
grant execute on function public.vehicle_members(uuid) to authenticated;
