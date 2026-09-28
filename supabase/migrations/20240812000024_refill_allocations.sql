-- Phase 2: splitting ONE shared refill expense among the people who use it.
--
-- The four Phase 1 concepts stay separate and are never collapsed:
--
--   vehicle_refills           what happened to the vehicle (one shared expense)
--   vehicle_refills.paid_by   who physically paid at the station
--   refill_allocations        who is being asked to absorb part of the cost
--   allocations.status        whether that person agreed to carry their share
--
-- An allocation only becomes a personal charge when the RECIPIENT accepts it.
-- Nothing here writes to a budget; budgets are derived by reading accepted rows
-- (see my_accepted_refill_total in the next migration).

create table public.refill_allocations (
  id uuid primary key default gen_random_uuid(),
  refill_id uuid not null references public.vehicle_refills (id) on delete restrict,
  -- The person being asked to absorb this amount. NOT necessarily who paid.
  user_id uuid not null references auth.users (id),
  amount numeric(12, 2) not null check (amount > 0),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  -- The collaborator who proposed this split.
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  response_note text,
  -- One allocation row per person per refill. A person cannot be asked twice.
  unique (refill_id, user_id)
);

comment on table public.refill_allocations is
  'Proposed split of a shared vehicle refill. Counts toward a personal budget only when status = accepted and the refill is not voided.';

comment on column public.refill_allocations.user_id is
  'Recipient who must accept the amount, not the person who paid at the station.';

comment on column public.refill_allocations.created_by is
  'Collaborator who proposed this allocation.';

-- Split editor for one refill.
create index refill_allocations_refill_idx
  on public.refill_allocations (refill_id);


-- ---------------------------------------------------------------- helpers ---

-- True when the caller may PROPOSE or EDIT a split: the owner, or an active
-- share whose role is not 'Viewer'. Same predicate as can_contribute_refills(),
-- restated here so the allocation security intent can be audited on its own.
create or replace function public.can_manage_refill_allocations(p_vehicle_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select public.is_vehicle_owner(p_vehicle_id) or exists (
    select 1
    from public.vehicle_shares s
    where s."vehicleID" = p_vehicle_id
      and s.shared_with = auth.uid()
      and s.revoked = false
      and s.role <> 'Viewer'
  );
$$;

revoke all on function public.can_manage_refill_allocations(uuid) from public, anon;
grant execute on function public.can_manage_refill_allocations(uuid) to authenticated;

-- True when p_user_id may RECEIVE an allocation on this vehicle: the owner, or
-- an active Member / Driver / Operator. Viewer and revoked collaborators are
-- both excluded. SECURITY DEFINER because the caller's RLS cannot see another
-- user's share row.
create or replace function public.is_allocation_recipient(p_vehicle_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.vehicles v
    where v.id = p_vehicle_id and v.user_id = p_user_id
  )
  or exists (
    select 1
    from public.vehicle_shares s
    where s."vehicleID" = p_vehicle_id
      and s.shared_with = p_user_id
      and s.revoked = false
      and s.role <> 'Viewer'
  );
$$;

revoke all on function public.is_allocation_recipient(uuid, uuid) from public, anon;
grant execute on function public.is_allocation_recipient(uuid, uuid) to authenticated;

-- Per-refill totals used by the split UI and by the server-side cap check.
-- reserved = pending + accepted; rejected and cancelled reserve nothing.
create or replace function public.refill_allocation_totals(p_refill_id uuid)
returns table (
  reserved numeric,
  accepted_total numeric,
  pending_total numeric,
  unassigned numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(a.amount) filter (where a.status in ('pending', 'accepted')), 0),
    coalesce(sum(a.amount) filter (where a.status = 'accepted'), 0),
    coalesce(sum(a.amount) filter (where a.status = 'pending'), 0),
    greatest(
      coalesce(r.total_amount, 0)
        - coalesce(sum(a.amount) filter (where a.status in ('pending', 'accepted')), 0),
      0
    )
  from public.vehicle_refills r
  left join public.refill_allocations a on a.refill_id = r.id
  where r.id = p_refill_id
  group by r.id, r.total_amount;
$$;

revoke all on function public.refill_allocation_totals(uuid) from public, anon;
grant execute on function public.refill_allocation_totals(uuid) to authenticated;

-- ------------------------------------------------------------------- RLS ---

alter table public.refill_allocations enable row level security;

-- READ ONLY policy. There are deliberately NO insert/update/delete policies:
-- every mutation goes through the SECURITY DEFINER RPCs in the next migration,
-- which is what enforces the total cap and the accepted-allocation protection.
--
-- A person keeps read access to their OWN allocation history even after their
-- share is revoked, because revoked collaborators must still be able to audit
-- what they were once charged. The vehicle-access branch covers the live split.
create policy "refill_allocations_select_members_and_recipients"
  on public.refill_allocations
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.vehicle_refills r
      where r.id = refill_allocations.refill_id
        and public.has_vehicle_access(r.vehicle_id)
    )
  );

-- "What am I still being asked to approve?"
create index refill_allocations_user_status_idx
  on public.refill_allocations (user_id, status);

-- Budget lookups scan accepted rows only.
create index refill_allocations_accepted_user_idx
  on public.refill_allocations (user_id, refill_id)
  where status = 'accepted';
