-- Enforce per-owner uniqueness of ACTIVE vehicle nicknames.
--
-- Vehicle nicknames are user-facing labels shown in vehicle selectors, trip
-- planning, refills and the sharing UI, so two active vehicles owned by the
-- same user must never share a name — even differing only by case or
-- surrounding spaces. Two DIFFERENT users may freely use the same nickname,
-- and an ARCHIVED vehicle releases its nickname for reuse.
--
-- Rule (matches the client normalization `nickname.trim().toLowerCase()`):
--   * same user + same active nickname                 -> BLOCK
--   * same user + same active nickname, other case/space -> BLOCK
--   * different users + same nickname                  -> ALLOW
--   * archived vehicle + same nickname                 -> ALLOW reuse
--
-- Comparison key: lower(btrim(nickname)) — btrim() strips leading/trailing
-- spaces, lower() makes it case-insensitive. NULL nicknames are excluded from
-- the scan and from the index (multiple NULLs remain allowed), because a
-- vehicle may legitimately fall back to its brand/model with no nickname.
--
-- Scope — additive and narrow. It touches NOTHING except the new partial
-- unique index below. It does NOT alter the primary key, any FK, any CHECK
-- constraint, vehicle_catalog's own unique (brand, model, year, fuel_type_id),
-- brand/model/year logic, or any refill/trip/share/archive data.
--
-- Safety — the index is created ONLY if no duplicate active rows already
-- exist. Existing duplicates are reported and the migration ABORTS; no row is
-- ever silently deleted or renamed. Remediation is left for manual review.
-- Idempotent — `if not exists` makes a re-run a safe no-op.

-- 1. Pre-scan: find active rows (archived_at is null, nickname not null) whose
--    (user_id, normalized nickname) already collide. Raise the offending groups
--    so an operator can review them by hand, then abort the migration.
do $$
declare
  dup record;
  dup_count integer := 0;
begin
  for dup in
    select
      user_id,
      lower(btrim(nickname)) as normalized,
      count(*) as rows,
      string_agg(id::text, ', ' order by created_at) as ids
    from public.vehicles
    where archived_at is null
      and nickname is not null
    group by user_id, lower(btrim(nickname))
    having count(*) > 1
    order by user_id, normalized
  loop
    dup_count := dup_count + 1;
    raise warning
      'Duplicate active vehicle nickname: user_id=% nickname=% rows=% ids=%',
      dup.user_id, dup.normalized, dup.rows, dup.ids;
  end loop;

  if dup_count > 0 then
    raise exception
      'Cannot create unique index vehicles_user_active_nickname_unique: % duplicate active nickname group(s) already exist (see warnings above). Rename or archive the conflicting vehicles, then re-run this migration.',
      dup_count;
  end if;
end;
$$;

-- 2. Enforce uniqueness for active vehicles per owner, on the normalized name.
--    Partial (`where archived_at is null`) so archived rows never collide and
--    their nicknames stay reusable.
create unique index if not exists vehicles_user_active_nickname_unique
  on public.vehicles (
    user_id,
    lower(btrim(nickname))
  )
  where archived_at is null;

