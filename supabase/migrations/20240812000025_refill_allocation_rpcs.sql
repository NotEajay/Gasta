-- Phase 2 writes: narrow SECURITY DEFINER functions instead of broad table
-- mutation policies.
--
-- Every rule the split UI must not be trusted to enforce lives here:
--   * only the owner or an active non-Viewer collaborator may manage a split
--   * recipients must be an eligible member (Viewer and revoked excluded)
--   * pending + accepted may never exceed the refill total
--   * an ACCEPTED amount can never be silently changed -- it returns to
--     pending so the recipient approves the new figure
--   * a recipient may only answer their own allocation
--   * a voided refill accepts nothing

-- ------------------------------------------------------------ save split ---

create or replace function public.save_refill_split(
  p_refill_id uuid,
  p_allocations jsonb
)
returns setof public.refill_allocations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refill public.vehicle_refills;
  v_entry jsonb;
  v_user uuid;
  v_amount numeric;
  v_existing public.refill_allocations;
  v_reserved numeric;
begin
  -- Locking the refill serialises concurrent split edits, so the cap check
  -- below cannot race two writers past the refill total.
  select * into v_refill
  from public.vehicle_refills
  where id = p_refill_id
  for update;

  if v_refill.id is null then
    raise exception 'Refill not found.';
  end if;
  if v_refill.voided_at is not null then
    raise exception 'This refill was voided and cannot be split.';
  end if;

  if not public.can_manage_refill_allocations(v_refill.vehicle_id) then
    raise exception 'You do not have permission to split this refill.';
  end if;

  for v_entry in
    select value from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb))
  loop
    v_user := (v_entry->>'user_id')::uuid;
    v_amount := (v_entry->>'amount')::numeric;

    if v_user is null then
      raise exception 'Each allocation needs a recipient.';
    end if;
    if v_amount is null or v_amount <= 0 then
      raise exception 'Allocation amounts must be greater than zero.';
    end if;
    if not public.is_allocation_recipient(v_refill.vehicle_id, v_user) then
      raise exception 'That person is not eligible to receive a share of this refill.';
    end if;

    select * into v_existing
    from public.refill_allocations
    where refill_id = p_refill_id and user_id = v_user
    for update;

    if v_existing.id is null then
      -- Self-allocation is accepted at once; anyone else must approve first.
      insert into public.refill_allocations
        (refill_id, user_id, amount, status, created_by, responded_at)
      values (
        p_refill_id, v_user, v_amount,
        case when v_user = auth.uid() then 'accepted' else 'pending' end,
        auth.uid(),
        case when v_user = auth.uid() then now() else null end
      );
    elsif v_existing.status = 'accepted' and v_existing.amount = v_amount then
      -- Unchanged and already accepted: never touch it.
      null;
    elsif v_existing.status = 'accepted' then
      -- Changing an accepted amount REQUIRES fresh approval. It is never
      -- silently rewritten, because that is a personal budget charge.
      update public.refill_allocations
      set amount = v_amount,
          status = 'pending',
          responded_at = null,
          response_note = null,
          created_by = auth.uid(),
          updated_at = now()
      where id = v_existing.id;
    else
      -- pending / rejected / cancelled: revive as a fresh request.
      update public.refill_allocations
      set amount = v_amount,
          status = case when v_user = auth.uid() then 'accepted' else 'pending' end,
          responded_at = case when v_user = auth.uid() then now() else null end,
          response_note = null,
          created_by = auth.uid(),
          updated_at = now()
      where id = v_existing.id;
    end if;
  end loop;

  -- Anyone dropped from the split whose row is still pending is cancelled,
  -- which returns the amount to unassigned. Accepted rows are left untouched.
  update public.refill_allocations a
  set status = 'cancelled', updated_at = now()
  where a.refill_id = p_refill_id
    and a.status = 'pending'
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) e
      where (e->>'user_id')::uuid = a.user_id
    );

  -- Server-side cap. Rejected and cancelled reserve nothing.
  select coalesce(sum(amount), 0) into v_reserved
  from public.refill_allocations
  where refill_id = p_refill_id and status in ('pending', 'accepted');

  if v_reserved > v_refill.total_amount then
    raise exception 'Allocated total exceeds the refill total. Lower the amounts and try again.';
  end if;

  return query
    select * from public.refill_allocations
    where refill_id = p_refill_id
    order by created_at, user_id;
end;
$$;

revoke all on function public.save_refill_split(uuid, jsonb) from public, anon;
grant execute on function public.save_refill_split(uuid, jsonb) to authenticated;

-- ------------------------------------------------- accept / reject own ---

create or replace function public.respond_to_refill_allocation(
  p_allocation_id uuid,
  p_accept boolean,
  p_note text default null
)
returns public.refill_allocations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.refill_allocations;
  v_voided timestamptz;
begin
  select * into v_row
  from public.refill_allocations
  where id = p_allocation_id
  for update;

  if v_row.id is null then
    raise exception 'Allocation not found.';
  end if;

  -- Only the recipient may answer. No collaborator can accept on their behalf.
  if v_row.user_id <> auth.uid() then
    raise exception 'You can only respond to your own allocation.';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'This allocation has already been answered.';
  end if;

  select voided_at into v_voided
  from public.vehicle_refills
  where id = v_row.refill_id;

  if v_voided is not null then
    raise exception 'This refill was voided.';
  end if;

  update public.refill_allocations
  set status = case when p_accept then 'accepted' else 'rejected' end,
      responded_at = now(),
      response_note = p_note,
      updated_at = now()
  where id = p_allocation_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.respond_to_refill_allocation(uuid, boolean, text)
  from public, anon;
grant execute on function public.respond_to_refill_allocation(uuid, boolean, text) to authenticated;

-- ------------------------------------------------- cancel a pending ask ---

-- A manager may withdraw a request that has not been answered yet. Accepted
-- allocations are protected: withdrawing them would silently remove a charge
-- the recipient already agreed to.
create or replace function public.cancel_refill_allocation(p_allocation_id uuid)
returns public.refill_allocations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.refill_allocations;
  v_vehicle uuid;
begin
  select * into v_row
  from public.refill_allocations
  where id = p_allocation_id
  for update;

  if v_row.id is null then
    raise exception 'Allocation not found.';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'Only a pending allocation can be cancelled.';
  end if;

  select r.vehicle_id into v_vehicle
  from public.vehicle_refills r
  where r.id = v_row.refill_id;

  if not public.can_manage_refill_allocations(v_vehicle) then
    raise exception 'You do not have permission to manage this split.';
  end if;

  update public.refill_allocations
  set status = 'cancelled', responded_at = now(), updated_at = now()
  where id = p_allocation_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.cancel_refill_allocation(uuid) from public, anon;
grant execute on function public.cancel_refill_allocation(uuid) to authenticated;


-- --------------------------------------------- personal budget source ---
--
-- ACTUAL refill spending for one person, derived from accepted allocations.
--
-- Deliberately a SEPARATE figure from the existing estimated trip fuel cost.
-- The two are never summed here, so nothing can double count.
--
-- The month comes from the REFILL's occurred_at, not from when the recipient
-- happened to accept. A refill on Sep 28 accepted on Oct 2 counts in September.
--
-- There is deliberately no p_user_id parameter: the figure is always auth.uid(),
-- so one user can never read another's budget.
create or replace function public.my_accepted_refill_total(
  p_year int,
  p_month int
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(a.amount), 0)
  from public.refill_allocations a
  join public.vehicle_refills r on r.id = a.refill_id
  where a.user_id = auth.uid()
    and a.status = 'accepted'
    and r.voided_at is null
    and extract(year  from r.occurred_at at time zone 'UTC') = p_year
    and extract(month from r.occurred_at at time zone 'UTC') = p_month;
$$;

revoke all on function public.my_accepted_refill_total(int, int) from public, anon;
grant execute on function public.my_accepted_refill_total(int, int) to authenticated;

-- --------------------------------------------- pending request inbox ---
--
-- Everything the signed-in user is currently being asked to approve, with just
-- enough context to render a decision card.
create or replace function public.my_pending_refill_allocations()
returns table (
  allocation_id uuid,
  refill_id uuid,
  amount numeric,
  created_by uuid,
  created_by_name text,
  vehicle_id uuid,
  brand text,
  model text,
  refill_total numeric,
  occurred_at timestamptz,
  response_note text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.id,
    a.refill_id,
    a.amount,
    a.created_by,
    coalesce(p.full_name, 'A collaborator'),
    v.id,
    v.brand,
    v.model,
    r.total_amount,
    r.occurred_at,
    a.response_note
  from public.refill_allocations a
  join public.vehicle_refills r on r.id = a.refill_id
  join public.vehicles v on v.id = r.vehicle_id
  left join public.profiles p on p.id = a.created_by
  where a.user_id = auth.uid()
    and a.status = 'pending'
    and r.voided_at is null
  order by r.occurred_at desc;
$$;

revoke all on function public.my_pending_refill_allocations() from public, anon;
grant execute on function public.my_pending_refill_allocations() to authenticated;

-- ---------------------------------------------------------------- triggers ---

-- A voided refill must stop counting. Pending asks are cancelled outright;
-- accepted rows are RETAINED for audit but stop counting because every budget
-- read joins vehicle_refills and filters voided_at is null. Nothing is deleted.
create or replace function public.cancel_allocations_on_refill_void()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.voided_at is not null and old.voided_at is null then
    update public.refill_allocations
    set status = 'cancelled', updated_at = now()
    where refill_id = new.id and status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists vehicle_refills_void_cancels_allocations on public.vehicle_refills;
create trigger vehicle_refills_void_cancels_allocations
  after update on public.vehicle_refills
  for each row
  execute function public.cancel_allocations_on_refill_void();

-- Revoking a collaborator must not delete their financial history, so their
-- accepted and rejected rows stay exactly as they are and keep counting
-- nothing new. Only a still-pending request is cancelled, because the person is
-- no longer an eligible recipient and can no longer approve it.
create or replace function public.cancel_allocations_on_share_revoke()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.revoked and not old.revoked then
    update public.refill_allocations a
    set status = 'cancelled', updated_at = now()
    from public.vehicle_refills r
    where a.refill_id = r.id
      and r.vehicle_id = new."vehicleID"
      and a.user_id = new.shared_with
      and a.status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists vehicle_shares_revoke_cancels_allocations on public.vehicle_shares;
create trigger vehicle_shares_revoke_cancels_allocations
  after update on public.vehicle_shares
  for each row
  execute function public.cancel_allocations_on_share_revoke();

