-- Apply the Viewer rule to the void function.
--
-- 20240812000018 already shipped void_vehicle_refill() and is applied, so its
-- file is not edited. CREATE OR REPLACE re-points the same signature, so the
-- GRANT from 018 carries over and the client RPC call is unchanged.
--
-- Only difference: a Viewer may no longer void, including their own entries,
-- because can_contribute_refills() is false for every Viewer.

create or replace function public.void_vehicle_refill(p_refill_id uuid)
returns public.vehicle_refills
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.vehicle_refills;
begin
  select * into target
  from public.vehicle_refills
  where id = p_refill_id
  for update;

  if target.id is null then
    raise exception 'Refill not found.';
  end if;

  if not public.is_vehicle_owner(target.vehicle_id) then
    if not (public.can_contribute_refills(target.vehicle_id)
            and target.logged_by = auth.uid()) then
      raise exception 'You can only void a refill you logged.';
    end if;
  end if;

  if target.voided_at is not null then
    raise exception 'This refill is already voided.';
  end if;

  update public.vehicle_refills
  set voided_at = now(), voided_by = auth.uid()
  where id = p_refill_id
  returning * into target;

  return target;
end;
$$;

revoke all on function public.void_vehicle_refill(uuid) from public, anon;
grant execute on function public.void_vehicle_refill(uuid) to authenticated;
