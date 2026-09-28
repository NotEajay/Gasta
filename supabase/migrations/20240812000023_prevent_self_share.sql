-- Block self-share at the database level.
--
-- vehicle_shares_insert_owner only checks shared_by = auth.uid() plus vehicle
-- ownership, so a hand-crafted client could still insert a row where
-- shared_with = auth.uid(). The app blocks this in the UI, but a CHECK
-- constraint cannot reference vehicles, and the UPDATE policy already prevents
-- an owner from editing an existing row, so a BEFORE trigger is used to cover
-- every write path (plain INSERT included).
--
-- This keeps the rule structural: an owner is vehicles.user_id and never needs a
-- vehicle_shares row.

create or replace function public.prevent_self_vehicle_share()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.shared_with = new.shared_by then
    raise exception 'Cannot share a vehicle with yourself.';
  end if;

  if exists (
    select 1
    from public.vehicles v
    where v.id = new."vehicleID"
      and v.user_id = new.shared_with
  ) then
    raise exception 'That user already owns this vehicle.';
  end if;

  return new;
end;
$$;

drop trigger if exists vehicle_shares_prevent_self_share on public.vehicle_shares;
create trigger vehicle_shares_prevent_self_share
  before insert or update on public.vehicle_shares
  for each row
  execute function public.prevent_self_vehicle_share();
