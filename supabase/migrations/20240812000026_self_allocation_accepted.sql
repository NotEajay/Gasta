-- Phase 2 correction: a person must never be asked to approve an amount they
-- chose for themselves.
--
-- The bug: save_refill_split() in 20240812000025 treated EVERY changed accepted
-- allocation the same way, including the caller's own row:
--
--   elsif v_existing.status = 'accepted' then
--     update ... set status = 'pending', responded_at = null ...
--
-- So when a creator changed their own share (500 -> 700) their own allocation
-- was reset to 'pending', which then showed up in their OWN inbox
-- (my_pending_refill_allocations() is pending + self) demanding an Accept or
-- Reject for an amount they had just explicitly chosen. That is the reported
-- symptom.
--
-- The rule, now enforced server-side:
--
--   own row        -> always 'accepted'; the creator is choosing their own
--                     amount, so they may change it freely with no re-approval
--   someone else's -> unchanged accepted stays accepted; a CHANGED accepted
--                     amount returns to 'pending' and needs fresh approval;
--                     pending / rejected / cancelled stays or becomes 'pending'
--
-- Only auth.uid() (their own row) or the recipient calling
-- respond_to_refill_allocation() can ever produce 'accepted'. A creator can
-- never mark another person's allocation accepted.
--
-- 20240812000025 is left untouched: it has already been reviewed. This is a
-- CREATE OR REPLACE of the same signature, so the existing GRANT carries over
-- and no client call changes.

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
      -- New row. Self-allocation is accepted immediately; anyone else must
      -- approve, so it starts pending.
      insert into public.refill_allocations
        (refill_id, user_id, amount, status, created_by, responded_at)
      values (
        p_refill_id, v_user, v_amount,
        case when v_user = auth.uid() then 'accepted' else 'pending' end,
        auth.uid(),
        case when v_user = auth.uid() then now() else null end
      );
    elsif v_existing.user_id = auth.uid() then
      -- The caller's OWN row, whatever its current status. They are choosing
      -- this amount for themselves, so it stays accepted and they may revise it
      -- at any time without triggering an approval round.
      update public.refill_allocations
      set amount = v_amount,
          status = 'accepted',
          responded_at = now(),
          response_note = null,
          created_by = auth.uid(),
          updated_at = now()
      where id = v_existing.id;
    elsif v_existing.status = 'accepted' and v_existing.amount = v_amount then
      -- Someone else's accepted amount, unchanged: never touch it.
      null;
    elsif v_existing.status = 'accepted' then
      -- Someone else's accepted amount CHANGED. Never silently rewrite a
      -- personal budget charge: drop it back to pending so the recipient
      -- approves the new figure.
      update public.refill_allocations
      set amount = v_amount,
          status = 'pending',
          responded_at = null,
          response_note = null,
          created_by = auth.uid(),
          updated_at = now()
      where id = v_existing.id;
    else
      -- Someone else's pending / rejected / cancelled row, or a brand new ask.
      update public.refill_allocations
      set amount = v_amount,
          status = 'pending',
          responded_at = null,
          response_note = null,
          created_by = auth.uid(),
          updated_at = now()
      where id = v_existing.id;
    end if;
  end loop;

  -- Anyone dropped from the split whose row is still pending is cancelled,
  -- which returns the amount to unassigned. Accepted rows are left untouched.
  -- This includes the caller's own accepted row: choosing not to re-enter an
  -- amount for yourself must never silently drop a charge you already agreed
  -- to, so the caller can only change their own amount, never clear it here.
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

-- ------------------------------------------------------------------ repair ---

-- Heal rows already poisoned by the old behaviour, so nobody is left holding a
-- pending request for an amount they assigned to themselves.
--
-- created_by is always auth.uid() at write time, so user_id = created_by proves
-- the row is a self-allocation that the old code wrongly left pending. Only
-- pending rows are touched; accepted, rejected and cancelled history is left
-- exactly as it is.
update public.refill_allocations
set status = 'accepted',
    responded_at = coalesce(responded_at, now()),
    updated_at = now()
where status = 'pending'
  and user_id = created_by;

