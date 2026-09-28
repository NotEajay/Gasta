-- Invariants that RLS cannot express, plus the latest-refill cache sync.

-- ------------------------------------------------------------------ guard ---
-- vehicle_refills_update_owner_or_author already stops a collaborator from
-- rewriting logged_by, but these rules also cover the owner's own mistakes and
-- keep the "one shared history" promise intact.
create or replace function public.vehicle_refills_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Audit columns. These are what the record IS, not what it currently says.
  -- No role, owner included, may rewrite them; the table grants UPDATE on the
  -- whole row, so this trigger is the only thing standing between a client and
  -- the history.
  if new.id is distinct from old.id then
    raise exception 'vehicle_refills.id is immutable';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'vehicle_refills.created_at is immutable';
  end if;
  if new.logged_by is distinct from old.logged_by then
    raise exception 'vehicle_refills.logged_by is immutable — it records who created the refill';
  end if;
  if new.vehicle_id is distinct from old.vehicle_id then
    raise exception 'vehicle_refills.vehicle_id is immutable';
  end if;

  -- Only the vehicle owner may restore a soft-voided refill.
  if old.voided_at is not null and new.voided_at is null
     and not public.is_vehicle_owner(old.vehicle_id) then
    raise exception 'only the vehicle owner may restore a voided refill';
  end if;

  -- Voiding must record who did it.
  if old.voided_at is null and new.voided_at is not null and new.voided_by is null then
    new.voided_by := auth.uid();
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger vehicle_refills_guard_trg
  before update on public.vehicle_refills
  for each row execute function public.vehicle_refills_guard();

-- ------------------------------------------------------------- cache sync ---
-- vehicles.last_refill_price / last_refill_at are a CACHED view of the newest
-- non-voided refill, kept because the Trip Optimizer reads that rate directly.
--
-- SECURITY DEFINER is the whole point: a Driver must be able to log a refill
-- that updates the owner's vehicles row, but vehicles_update_own stays
-- owner-only and is NOT weakened. Only the two cache columns are ever written.
--
-- Recomputing (rather than trusting the changed row) is what makes backdated
-- inserts and voiding behave correctly: the cache always reflects the latest
-- non-voided refill by occurred_at, and is cleared when none remain.
create or replace function public.vehicle_refills_sync_cache()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.vehicle_id, old.vehicle_id);
begin
  update public.vehicles v
  set last_refill_price = latest.price_per_liter,
      last_refill_at = latest.occurred_at
  from (
    select r.price_per_liter, r.occurred_at
    from public.vehicle_refills r
    where r.vehicle_id = target and r.voided_at is null
    order by r.occurred_at desc, r.created_at desc, r.id desc
    limit 1
  ) latest
  where v.id = target;

  -- No valid refills left: clear the cached rate.
  update public.vehicles v
  set last_refill_price = null,
      last_refill_at = null
  where v.id = target
    and not exists (
      select 1 from public.vehicle_refills r
      where r.vehicle_id = target and r.voided_at is null
    );

  return null;
end;
$$;

create trigger vehicle_refills_sync_cache_trg
  after insert or update or delete on public.vehicle_refills
  for each row execute function public.vehicle_refills_sync_cache();
