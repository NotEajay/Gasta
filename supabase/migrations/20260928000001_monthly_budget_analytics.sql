-- ---------------------------------------------------------------------------
-- Monthly per-vehicle budget analytics (decision support, read only)
-- ---------------------------------------------------------------------------
--
-- WHY AN RPC AND NOT CLIENT-SIDE QUERIES
--
-- The obvious build is "fetch my allocations, group by vehicle" from the client.
-- That is quietly wrong here, not merely slow.
--
--   refill_allocations SELECT policy -> user_id = auth.uid() OR has_vehicle_access()
--   vehicle_refills    SELECT policy -> has_vehicle_access() AND voided_at IS NULL
--
-- A collaborator whose share was REVOKED keeps permanent read access to their own
-- allocation history -- migration 20240812000024 does this deliberately, so a
-- removed driver can still audit what they were once charged. But the same person
-- can no longer read the vehicle_refills row behind that allocation.
--
-- So a client-side join returns fewer rows than the headline figure:
--   my_accepted_refill_total (SECURITY DEFINER) -> counts that spend
--   client-side per-vehicle query               -> cannot see it
-- The per-vehicle shares would silently fail to sum to "Spent this month".
--
-- This function is SECURITY DEFINER for exactly the same reason
-- my_accepted_refill_total is: it must aggregate the caller's own accepted
-- responsibility without depending on current vehicle membership. The trust
-- model is unchanged and still narrow -- auth.uid() is hardcoded, so there is no
-- parameter through which one user could read another's budget.
--
-- MONTH BOUNDARY
--
-- Matches my_accepted_refill_total exactly: refill months come from
-- occurred_at AT TIME ZONE 'UTC'. A different convention here would make the
-- per-vehicle rows stop reconciling with the headline total at month edges.
--
-- NOTHING IS ALTERED. One new function plus one index; no existing table,
-- policy, or RPC changes.
-- ---------------------------------------------------------------------------

create or replace function public.monthly_budget_analytics(
  p_year int,
  p_month int
)
returns table (
  row_kind text,
  vehicle_id uuid,
  brand text,
  model text,
  year smallint,
  nickname text,
  actual_spend numeric,
  known_attributed_liters numeric,
  relevant_refill_count bigint,
  refills_with_liters_count bigint,
  logged_trip_count bigint,
  logged_distance_km numeric,
  estimated_trip_cost numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with refill_side as (
    -- Actual responsibility, grouped the same way the headline figure is.
    select
      r.vehicle_id,
      sum(a.amount) as actual_spend,
      -- Proportional litres on the SAME accepted-amount basis as the pesos, so
      -- the two never disagree about how much of a refill is mine. NULL when
      -- liters is unknown, reported as partial coverage rather than as 0.
      sum(
        case
          when r.liters is not null and r.total_amount > 0
          then r.liters * (a.amount / r.total_amount)
        end
      ) as known_attributed_liters,
      count(distinct r.id) as relevant_refill_count,
      count(distinct r.id) filter (where r.liters is not null) as refills_with_liters_count
    from public.refill_allocations a
    join public.vehicle_refills r on r.id = a.refill_id
    where a.user_id = auth.uid()
      and a.status = 'accepted'
      and r.voided_at is null
      and extract(year  from r.occurred_at at time zone 'UTC') = p_year
      and extract(month from r.occurred_at at time zone 'UTC') = p_month
    group by r.vehicle_id
  ),
  trip_side as (
    -- Logged trips ONLY, and ONLY the caller's own.
    --
    -- user_id = auth.uid() is explicit and load-bearing, not redundant with
    -- RLS: SECURITY DEFINER runs with the owner's rights, so RLS does NOT
    -- filter these rows for us. Without this predicate the
    -- trip_records_select_shared_vehicle policy would let one collaborator's
    -- trips on a shared vehicle land in another member's Budget.
    --
    -- vehicle_id IS NOT NULL: a trip with no vehicle cannot be attributed to a
    -- vehicle row, so it is excluded here. It still counts toward the month
    -- total below, which keeps the page's headline travel figures truthful.
    select
      t.vehicle_id,
      count(*) as logged_trip_count,
      sum(t.distance_km) as logged_distance_km,
      -- Mirrors estimateMonthlyFuelSpend(): the own-vehicle figure only, read
      -- from the persisted evaluation payload. trip_records stores neither
      -- efficiency nor fuel price, so estimated LITRES are deliberately NOT
      -- derivable from a trip and are not returned.
      sum(
        coalesce((
          select sum(
            case
              when (e->'raw'->>'fuelCost') ~ '^-?[0-9]+(\.[0-9]+)?$'
              then (e->'raw'->>'fuelCost')::numeric
              else 0
            end
          )
          from jsonb_array_elements(t.mode_evaluations) e
          where e->>'modeCode' = 'OWN_VEHICLE'
        ), 0)
      ) as estimated_trip_cost
    from public.trip_records t
    where t.user_id = auth.uid()
      and t.vehicle_id is not null
      and extract(year  from t.created_at at time zone 'UTC') = p_year
      and extract(month from t.created_at at time zone 'UTC') = p_month
    group by t.vehicle_id
  ),
  per_vehicle as (
    -- Full outer join: a vehicle can have accepted spend and no logged trips,
    -- or logged trips and no accepted spend. Both are worth showing and neither
    -- should erase the other.
    select
      coalesce(rs.vehicle_id, ts.vehicle_id) as vehicle_id,
      coalesce(rs.actual_spend, 0) as actual_spend,
      rs.known_attributed_liters,
      coalesce(rs.relevant_refill_count, 0) as relevant_refill_count,
      coalesce(rs.refills_with_liters_count, 0) as refills_with_liters_count,
      coalesce(ts.logged_trip_count, 0) as logged_trip_count,
      coalesce(ts.logged_distance_km, 0) as logged_distance_km,
      coalesce(ts.estimated_trip_cost, 0) as estimated_trip_cost
    from refill_side rs
    full outer join trip_side ts on ts.vehicle_id = rs.vehicle_id
  )
  -- Wrapped in parentheses so this branch's ORDER BY is scoped to it. A bare
  -- `... order by ... union all ...` is a syntax error in Postgres: a set
  -- operation takes only ONE trailing ORDER BY, applied to the whole result.
  (
  select
    'vehicle'::text as row_kind,
    pv.vehicle_id,
    v.brand,
    v.model,
    v.year,
    v.nickname,
    pv.actual_spend,
    pv.known_attributed_liters,
    pv.relevant_refill_count,
    pv.refills_with_liters_count,
    pv.logged_trip_count,
    pv.logged_distance_km,
    pv.estimated_trip_cost
  from per_vehicle pv
  join public.vehicles v on v.id = pv.vehicle_id
  order by pv.actual_spend desc, pv.logged_distance_km desc, v.brand
  )


  union all

  -- Totals, returned as a sentinel row so the client never re-aggregates and
  -- cannot disagree with the headline figure it is already showing.
  --
  -- Travel totals are MONTH-WIDE across all of the caller's trips, including the
  -- few with a NULL vehicle_id that the per-vehicle rows necessarily omit. That
  -- gap is why the page labels its travel numbers "logged trips" instead of
  -- claiming they equal the sum of the vehicle rows.
  select
    'total'::text as row_kind,
    null::uuid as vehicle_id,
    null::text as brand,
    null::text as model,
    null::smallint as year,
    null::text as nickname,
    coalesce((select sum(actual_spend) from per_vehicle), 0) as actual_spend,
    coalesce((select sum(known_attributed_liters) from per_vehicle), 0) as known_attributed_liters,
    coalesce((select sum(relevant_refill_count) from per_vehicle), 0) as relevant_refill_count,
    coalesce((select sum(refills_with_liters_count) from per_vehicle), 0) as refills_with_liters_count,
    (
      select count(*) from public.trip_records t
      where t.user_id = auth.uid()
        and extract(year  from t.created_at at time zone 'UTC') = p_year
        and extract(month from t.created_at at time zone 'UTC') = p_month
    ) as logged_trip_count,
    (
      select coalesce(sum(t.distance_km), 0) from public.trip_records t
      where t.user_id = auth.uid()
        and extract(year  from t.created_at at time zone 'UTC') = p_year
        and extract(month from t.created_at at time zone 'UTC') = p_month
    ) as logged_distance_km,
    (
      select coalesce(sum(
        coalesce((
          select sum(
            case
              when (e->'raw'->>'fuelCost') ~ '^-?[0-9]+(\.[0-9]+)?$'
              then (e->'raw'->>'fuelCost')::numeric
              else 0
            end
          )
          from jsonb_array_elements(t.mode_evaluations) e
          where e->>'modeCode' = 'OWN_VEHICLE'
        ), 0)
      ), 0)
      from public.trip_records t
      where t.user_id = auth.uid()
        and extract(year  from t.created_at at time zone 'UTC') = p_year
        and extract(month from t.created_at at time zone 'UTC') = p_month
    ) as estimated_trip_cost
  -- Single trailing ORDER BY for the whole set operation.
  --
  -- Positional (ordinal) references, because Postgres only permits a UNION's
  -- ORDER BY to name output columns or positions -- not arbitrary expressions
  -- such as a CASE. Ordinals are used deliberately and are safe here because
  -- the RETURN TABLE column order above is fixed by this function's signature.
  --   1 = row_kind, 7 = actual_spend
  -- `row_kind` sorts 'total' after 'vehicle', so the sentinel row is always last.
  order by 1 desc, 7 desc
$$;

revoke all on function public.monthly_budget_analytics(int, int) from public, anon;
grant execute on function public.monthly_budget_analytics(int, int) to authenticated;

-- Month-scoped trip scan. The existing trip_records_user_id_idx covers "all my
-- trips" but not "my trips in a month", so the analytics scan was filtering on
-- created_at after fetching by user. Additive only; no table semantics change.
--
-- refill_allocations(user_id, status) already exists as
-- refill_allocations_user_status_idx from migration 20240812000024, so it is
-- deliberately NOT duplicated here.
create index if not exists trip_records_user_created_idx
  on public.trip_records (user_id, created_at);

