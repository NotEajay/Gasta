-- Harden existing split rules; partial allocation, self-only collaborator writes,
-- accepted-share protection and archived financial history are unchanged.
-- New migration only; no changes to historical migrations.
begin;

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
  v_seen uuid[] := array[]::uuid[];
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

  if jsonb_typeof(coalesce(p_allocations, '[]'::jsonb)) <> 'array' then
    raise exception 'Complete the split before saving.';
  end if;
  -- Serialize eligibility with revoke/role updates. Re-check after obtaining
  -- the locks; a revoke that committed first must not receive a new proposal.
  perform 1 from public.vehicle_shares
  where "vehicleID" = v_refill.vehicle_id
  order by "ShareID" for update;

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
    if v_user = any(v_seen) then
      raise exception 'Duplicate allocation recipient.';
    end if;
    v_seen := array_append(v_seen, v_user);
    if v_amount is null or v_amount::text in ('NaN', 'Infinity', '-Infinity') or v_amount < 0 then
      raise exception 'Allocation amounts cannot be negative.';
    end if;

    if v_amount > 0 and round(v_amount, 2) = 0 then
      raise exception 'Complete the split before saving.';
    end if;
    v_amount := round(v_amount, 2);

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
  v_vehicle uuid;
  v_refill uuid;
begin
  select refill_id into v_refill from public.refill_allocations where id = p_allocation_id;
  -- Same lock order as save_refill_split and void: refill, shares, allocation.
  select vehicle_id, voided_at into v_vehicle, v_voided from public.vehicle_refills
  where id = v_refill for update;
  perform 1 from public.vehicle_shares where "vehicleID" = v_vehicle order by "ShareID" for update;
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

  if not public.is_allocation_recipient(v_vehicle, auth.uid()) then
    raise exception 'You no longer have permission to update this refill.';
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
  v_refill uuid;
begin
  select refill_id into v_refill from public.refill_allocations where id = p_allocation_id;
  select vehicle_id into v_vehicle from public.vehicle_refills where id = v_refill for update;
  perform 1 from public.vehicle_shares where "vehicleID" = v_vehicle order by "ShareID" for update;
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

  if not public.can_manage_refill_allocations(v_vehicle)
     or (not public.is_vehicle_owner(v_vehicle) and v_row.user_id <> auth.uid()) then
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



create or replace function public.refill_allocation_totals(p_refill_id uuid)
returns table (reserved numeric, accepted_total numeric, pending_total numeric, unassigned numeric)
language plpgsql stable security definer set search_path = public
as $$
declare v_vehicle uuid;
begin
  select vehicle_id into v_vehicle from public.vehicle_refills where id = p_refill_id;
  if v_vehicle is null or not public.has_vehicle_access(v_vehicle) then
    raise exception 'You do not have permission to view this split.';
  end if;
  return query select
    coalesce(sum(a.amount) filter (where a.status in ('pending','accepted')), 0),
    coalesce(sum(a.amount) filter (where a.status = 'accepted'), 0),
    coalesce(sum(a.amount) filter (where a.status = 'pending'), 0),
    greatest(r.total_amount - coalesce(sum(a.amount) filter (where a.status in ('pending','accepted')), 0), 0)
  from public.vehicle_refills r left join public.refill_allocations a on a.refill_id = r.id
  where r.id = p_refill_id group by r.id;
end;
$$;
revoke all on function public.refill_allocation_totals(uuid) from public, anon;
grant execute on function public.refill_allocation_totals(uuid) to authenticated;

commit;
