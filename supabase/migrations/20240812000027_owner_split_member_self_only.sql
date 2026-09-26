-- Phase 2 correction 2: only the vehicle OWNER manages the whole split.
--
-- Before this, any active non-Viewer collaborator could write an amount for
-- ANY eligible participant, and a changed 'accepted' amount was silently pushed
-- back to 'pending' so the recipient could re-approve it. That gave every
-- collaborator split-manager power and let anyone rewrite a charge another
-- person had already agreed to.
--
-- The model now is:
--
--   Owner                   full split. May propose an amount for Owner, Member,
--                           Driver and Operator. May revise someone else's row
--                           ONLY while it is still pending. Can never touch a row
--                           another person has accepted. Always free to change
--                           their own.
--
--   Member/Driver/Operator  own row only. They choose how much of the refill they
--                           personally take responsibility for, may change it at
--                           any time, and it is always accepted. Any attempt to
--                           write another person's row is rejected.
--
--   Viewer                  no writes at all (cannot reach here).
--
-- Locking: once a recipient accepts, that amount is theirs. Editing it is
-- refused with a clear message instead of being reset to 'pending'. Unchanged
-- accepted rows pass through untouched, so the Owner can still save around them.
--
-- Zero: 0 now means "retire this proposal" rather than being rejected. For a
-- pending or own allocation it cancels the row, which frees the money back to
-- unassigned and removes it from the recipient's inbox. Rows are never deleted,
-- so the audit trail is kept.
--
-- 20240812000025 and 20240812000026 are left untouched. This is a CREATE OR
-- REPLACE of the same signature, so the existing GRANT carries over and no
-- client call changes.

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
  v_is_owner boolean;
  v_may_write boolean;
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

  v_is_owner := public.is_vehicle_owner(v_refill.vehicle_id);

  -- The caller must at least be the owner or an active non-Viewer collaborator.
  -- A revoked collaborator or a Viewer can never get past this point.
  v_may_write := v_is_owner or exists (
    select 1
    from public.vehicle_shares s
    where s."vehicleID" = v_refill.vehicle_id
      and s.shared_with = auth.uid()
      and s.revoked = false
      and s.role <> 'Viewer'
  );

  if not v_may_write then
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
    if v_amount is null or v_amount < 0 then
      raise exception 'Allocation amounts cannot be negative.';
    end if;

    -- Non-owners are not split managers. They may only write their own row.
    if v_user <> auth.uid() and not v_is_owner then
      raise exception 'You can only set your own share of this refill.';
    end if;

    if not public.is_allocation_recipient(v_refill.vehicle_id, v_user) then
      raise exception 'That person is not eligible to receive a share of this refill.';
    end if;

    select * into v_existing
    from public.refill_allocations
    where refill_id = p_refill_id and user_id = v_user
    for update;

    if v_existing.id is null then
      if v_amount = 0 then
        -- Nothing to create.
        null;
      else
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
      end if;
    elsif v_existing.user_id = auth.uid() then
      -- The caller's OWN row. They are choosing this amount for themselves, so
      -- it stays accepted and they may revise or retire it freely.
      if v_amount = 0 then
        update public.refill_allocations
        set status = 'cancelled', responded_at = now(), updated_at = now()
        where id = v_existing.id;
      else
        update public.refill_allocations
        set amount = v_amount,
            status = 'accepted',
            responded_at = now(),
            response_note = null,
            created_by = auth.uid(),
            updated_at = now()
        where id = v_existing.id;
      end if;
    elsif v_existing.status = 'accepted' then
      -- Someone else's ACCEPTED row. Passing the same amount through is fine so
      -- the Owner can still save around it, but any change is refused outright.
      if v_existing.amount = v_amount then
        null;
      else
        raise exception 'This allocation has already been accepted and can only be changed by that person.';
      end if;
    else
      -- Someone else's pending / rejected / cancelled row, owner-managed.
      if v_amount = 0 then
        update public.refill_allocations
        set status = 'cancelled', responded_at = now(), updated_at = now()
        where id = v_existing.id;
      else
        update public.refill_allocations
        set amount = v_amount,
            status = 'pending',
            responded_at = null,
            response_note = null,
            created_by = auth.uid(),
            updated_at = now()
        where id = v_existing.id;
      end if;
    end if;
  end loop;


  -- Rows the caller left out entirely. Only the owner may retire someone
  -- else's outstanding proposal this way; a non-owner must never be able to
  -- cancel other people's pending rows by omitting them from their own save.
  -- Accepted rows are never auto-cancelled, so a charge someone agreed to can
  -- only change through that person.
  if v_is_owner then
    update public.refill_allocations a
    set status = 'cancelled', updated_at = now()
    where a.refill_id = p_refill_id
      and a.status = 'pending'
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) e
        where (e->>'user_id')::uuid = a.user_id
      );
  end if;

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

