-- Voiding has to be a function, not a client UPDATE.
--
-- vehicle_refills_select_members hides voided rows, and PostgreSQL applies the
-- SELECT policy to the NEW row of an UPDATE. So a client cannot void a refill
-- with .update({ voided_at }): the moment it is voided, the new row fails the
-- SELECT policy and the statement is rejected. Without this function, voiding
-- is impossible and a mistaken refill could only be corrected by hand.
--
-- This SECURITY DEFINER function performs the same authorisation the policies
-- would have applied (owner, or the author of that refill), then writes the
-- row. The existing BEFORE UPDATE guard still runs, so the audit columns stay
-- immutable, and the cache-sync trigger still re-syncs vehicles.last_refill_*.

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

  if not (public.is_vehicle_owner(target.vehicle_id) or target.logged_by = auth.uid()) then
    raise exception 'You can only void a refill you logged.';
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
