-- RSS-imported Philippine fuel-price news. This schema is independent of DOE,
-- community-report, vehicle, and trip data.
begin;

create table if not exists public.fuel_news_articles (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  publisher text not null,
  source_guid text,
  canonical_url text not null,
  headline text not null,
  excerpt text,
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  classification text not null,
  parse_status text not null,
  is_feed_visible boolean not null default true,
  dedup_hash text not null,
  content_hash text not null,
  parse_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_news_articles_source_key_check
    check (length(btrim(source_key)) between 1 and 100),
  constraint fuel_news_articles_publisher_check
    check (length(btrim(publisher)) between 1 and 200),
  constraint fuel_news_articles_source_guid_check
    check (source_guid is null or length(btrim(source_guid)) between 1 and 500),
  constraint fuel_news_articles_canonical_url_check
    check (canonical_url ~ '^https://[^[:space:]]+$' and length(canonical_url) <= 2048),
  constraint fuel_news_articles_headline_check
    check (length(btrim(headline)) between 1 and 500),
  constraint fuel_news_articles_excerpt_check
    check (excerpt is null or length(excerpt) <= 1000),
  constraint fuel_news_articles_classification_check
    check (classification in ('confirmed', 'forecast', 'news_update')),
  constraint fuel_news_articles_parse_status_check
    check (parse_status in ('structured', 'unstructured', 'conflict')),
  constraint fuel_news_articles_dedup_hash_check
    check (dedup_hash ~ '^[0-9a-f]{64}$'),
  constraint fuel_news_articles_content_hash_check
    check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint fuel_news_articles_parse_result_check
    check (jsonb_typeof(parse_result) = 'object'),
  constraint fuel_news_articles_dedup_hash_key unique (dedup_hash),
  constraint fuel_news_articles_source_guid_key unique (source_key, source_guid),
  constraint fuel_news_articles_canonical_url_key unique (source_key, canonical_url)
);

create table if not exists public.fuel_news_events (
  id uuid primary key default gen_random_uuid(),
  event_hash text not null,
  classification text not null,
  direction text not null,
  effective_at timestamptz,
  effective_timezone text not null default 'Asia/Manila',
  effective_precision text,
  coverage text,
  summary text,
  confidence text not null,
  parse_status text not null,
  discrepancy boolean not null default false,
  published_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_news_events_event_hash_check
    check (event_hash ~ '^[0-9a-f]{64}$'),
  constraint fuel_news_events_classification_check
    check (classification in ('confirmed', 'forecast', 'news_update')),
  constraint fuel_news_events_direction_check
    check (direction in ('hike', 'rollback', 'mixed', 'news_update')),
  constraint fuel_news_events_effective_timezone_check
    check (length(btrim(effective_timezone)) between 1 and 100),
  constraint fuel_news_events_effective_precision_check
    check (effective_precision is null or effective_precision in ('date', 'minute')),
  constraint fuel_news_events_effective_pair_check
    check ((effective_at is null) = (effective_precision is null)),
  constraint fuel_news_events_coverage_check
    check (coverage is null or length(coverage) <= 1000),
  constraint fuel_news_events_summary_check
    check (summary is null or length(summary) <= 1000),
  constraint fuel_news_events_confidence_check
    check (confidence in ('low', 'medium', 'high')),
  constraint fuel_news_events_parse_status_check
    check (parse_status in ('structured', 'unstructured', 'conflict')),
  constraint fuel_news_events_event_hash_key unique (event_hash)
);

create table if not exists public.fuel_news_adjustments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.fuel_news_events (id) on delete cascade,
  fuel_type text not null,
  amount_centavos integer not null,
  confidence text not null default 'high',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_news_adjustments_fuel_type_check
    check (fuel_type in ('GASOLINE', 'DIESEL', 'KEROSENE')),
  constraint fuel_news_adjustments_amount_check
    check (amount_centavos <> 0),
  constraint fuel_news_adjustments_confidence_check
    check (confidence in ('low', 'medium', 'high')),
  constraint fuel_news_adjustments_event_fuel_key unique (event_id, fuel_type)
);

create table if not exists public.fuel_news_event_articles (
  event_id uuid not null references public.fuel_news_events (id) on delete cascade,
  article_id uuid not null references public.fuel_news_articles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint fuel_news_event_articles_pkey primary key (event_id, article_id),
  constraint fuel_news_event_articles_article_key unique (article_id)
);

create table if not exists public.fuel_news_source_state (
  source_key text primary key,
  publisher text not null,
  feed_url text not null,
  etag text,
  last_modified text,
  last_polled_at timestamptz not null,
  last_success_at timestamptz,
  last_error_at timestamptz,
  status text not null,
  http_status integer,
  error_message text,
  last_error text,
  consecutive_failures integer not null default 0,
  items_seen integer not null default 0,
  candidates_seen integer not null default 0,
  articles_written integer not null default 0,
  events_written integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint fuel_news_source_state_source_key_check
    check (length(btrim(source_key)) between 1 and 100),
  constraint fuel_news_source_state_publisher_check
    check (length(btrim(publisher)) between 1 and 200),
  constraint fuel_news_source_state_feed_url_check
    check (feed_url ~ '^https://[^[:space:]]+$' and length(feed_url) <= 2048),
  constraint fuel_news_source_state_etag_check
    check (etag is null or length(etag) <= 500),
  constraint fuel_news_source_state_last_modified_check
    check (last_modified is null or length(last_modified) <= 500),
  constraint fuel_news_source_state_status_check
    check (status in ('success', 'partial', 'error', 'not_modified')),
  constraint fuel_news_source_state_http_status_check
    check (http_status is null or http_status between 100 and 599),
  constraint fuel_news_source_state_error_message_check
    check (error_message is null or length(error_message) <= 1000),
  constraint fuel_news_source_state_last_error_check
    check (last_error is null or length(last_error) <= 1000),
  constraint fuel_news_source_state_failure_count_check
    check (consecutive_failures >= 0),
  constraint fuel_news_source_state_counts_check
    check (items_seen >= 0 and candidates_seen >= 0
      and articles_written >= 0 and events_written >= 0)
);

create index if not exists fuel_news_articles_feed_published_idx
  on public.fuel_news_articles (published_at desc, fetched_at desc, id desc)
  where is_feed_visible;
create index if not exists fuel_news_events_last_seen_idx
  on public.fuel_news_events (last_seen_at desc, id desc);

-- Mark an article as updated only when publisher-supplied feed content changes.
-- Routine hourly polls still advance fetched_at without manufacturing a correction.
create or replace function public.fuel_news_prepare_article()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.content_hash is distinct from old.content_hash then
      new.updated_at = clock_timestamp();
    else
      new.updated_at = old.updated_at;
    end if;
  else
    new.updated_at = coalesce(new.updated_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists fuel_news_articles_prepare_row on public.fuel_news_articles;
create trigger fuel_news_articles_prepare_row
  before insert or update on public.fuel_news_articles
  for each row execute function public.fuel_news_prepare_article();

-- Keep event conflict metadata and importer-maintained timestamps consistent.
create or replace function public.fuel_news_prepare_event()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  if new.parse_status = 'conflict' then
    new.discrepancy = true;
  end if;
  return new;
end;
$$;

drop trigger if exists fuel_news_events_prepare_row on public.fuel_news_events;
create trigger fuel_news_events_prepare_row
  before insert or update on public.fuel_news_events
  for each row execute function public.fuel_news_prepare_event();

-- Atomically persist one parsed article and its normalized event. Event observation
-- timestamps are derived from the complete linked article set, never trusted as a
-- monotonic value from whichever source happened to be imported last.
create or replace function public.import_fuel_news_article(
  article_payload jsonb,
  event_payload jsonb,
  adjustment_payloads jsonb
)
returns table (article_id uuid, event_id uuid)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_article_id uuid;
  v_candidate_article_id uuid;
  v_event_id uuid;
  v_old_event_id uuid;
  v_source_key text;
  v_source_guid text;
  v_canonical_url text;
  v_dedup_hash text;
begin
  if pg_catalog.jsonb_typeof(article_payload) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'article_payload must be a JSON object';
  end if;
  if pg_catalog.jsonb_typeof(event_payload) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'event_payload must be a JSON object';
  end if;
  if pg_catalog.jsonb_typeof(adjustment_payloads) is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'adjustment_payloads must be a JSON array';
  end if;
  if pg_catalog.jsonb_typeof(article_payload -> 'parse_result')
      is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'article_payload.parse_result must be a JSON object';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(adjustment_payloads) as item(value)
    where pg_catalog.jsonb_typeof(item.value) is distinct from 'object'
  ) then
    raise exception using
      errcode = '22023',
      message = 'every adjustment_payloads item must be a JSON object';
  end if;

  v_source_key := article_payload ->> 'source_key';
  v_source_guid := article_payload ->> 'source_guid';
  v_canonical_url := article_payload ->> 'canonical_url';
  v_dedup_hash := article_payload ->> 'dedup_hash';

  -- Serialize identity reconciliation for a source. In particular, a concurrent
  -- import cannot both observe that a source-scoped GUID or URL is absent.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('fuel_news_article_source'),
    pg_catalog.hashtext(coalesce(v_source_key, ''))
  );

  -- All three importer identities are authoritative. Refuse to merge when they
  -- identify different rows; the exception rolls back the complete graph write.
  for v_candidate_article_id in
    select article.id
    from public.fuel_news_articles as article
    where article.dedup_hash = v_dedup_hash
      or (
        v_source_guid is not null
        and article.source_key = v_source_key
        and article.source_guid = v_source_guid
      )
      or (
        article.source_key = v_source_key
        and article.canonical_url = v_canonical_url
      )
    for update
  loop
    if v_article_id is null then
      v_article_id := v_candidate_article_id;
    elsif v_article_id <> v_candidate_article_id then
      raise exception using
        errcode = '21000',
        message = 'ambiguous fuel news article identity',
        detail = pg_catalog.format(
          'Incoming identities match existing article IDs %s and %s.',
          v_article_id,
          v_candidate_article_id
        );
    end if;
  end loop;

  if v_article_id is null then
    insert into public.fuel_news_articles as article (
      source_key,
      publisher,
      source_guid,
      canonical_url,
      headline,
      excerpt,
      published_at,
      fetched_at,
      classification,
      parse_status,
      is_feed_visible,
      dedup_hash,
      content_hash,
      parse_result
    ) values (
      v_source_key,
      article_payload ->> 'publisher',
      v_source_guid,
      v_canonical_url,
      article_payload ->> 'headline',
      article_payload ->> 'excerpt',
      (article_payload ->> 'published_at')::timestamptz,
      (article_payload ->> 'fetched_at')::timestamptz,
      article_payload ->> 'classification',
      article_payload ->> 'parse_status',
      (article_payload ->> 'is_feed_visible')::boolean,
      v_dedup_hash,
      article_payload ->> 'content_hash',
      article_payload -> 'parse_result'
    )
    returning article.id into v_article_id;
  else
    update public.fuel_news_articles as article
    set
      source_key = v_source_key,
      publisher = article_payload ->> 'publisher',
      source_guid = v_source_guid,
      canonical_url = v_canonical_url,
      headline = article_payload ->> 'headline',
      excerpt = article_payload ->> 'excerpt',
      published_at = (article_payload ->> 'published_at')::timestamptz,
      fetched_at = (article_payload ->> 'fetched_at')::timestamptz,
      classification = article_payload ->> 'classification',
      parse_status = article_payload ->> 'parse_status',
      is_feed_visible = (article_payload ->> 'is_feed_visible')::boolean,
      dedup_hash = v_dedup_hash,
      content_hash = article_payload ->> 'content_hash',
      parse_result = article_payload -> 'parse_result'
    where article.id = v_article_id
    returning article.id into v_article_id;
  end if;

  select link.event_id
  into v_old_event_id
  from public.fuel_news_event_articles as link
  where link.article_id = v_article_id
  for update;

  insert into public.fuel_news_events as event (
    event_hash,
    classification,
    direction,
    effective_at,
    effective_timezone,
    effective_precision,
    coverage,
    summary,
    confidence,
    parse_status,
    discrepancy,
    published_at,
    last_seen_at
  ) values (
    event_payload ->> 'event_hash',
    event_payload ->> 'classification',
    event_payload ->> 'direction',
    (event_payload ->> 'effective_at')::timestamptz,
    event_payload ->> 'effective_timezone',
    event_payload ->> 'effective_precision',
    event_payload ->> 'coverage',
    event_payload ->> 'summary',
    event_payload ->> 'confidence',
    event_payload ->> 'parse_status',
    (event_payload ->> 'discrepancy')::boolean,
    (event_payload ->> 'published_at')::timestamptz,
    (event_payload ->> 'last_seen_at')::timestamptz
  )
  on conflict (event_hash) do update set
    event_hash = excluded.event_hash,
    classification = excluded.classification,
    direction = excluded.direction,
    effective_at = excluded.effective_at,
    effective_timezone = excluded.effective_timezone,
    effective_precision = excluded.effective_precision,
    coverage = excluded.coverage,
    summary = excluded.summary,
    confidence = excluded.confidence,
    parse_status = excluded.parse_status,
    discrepancy = excluded.discrepancy,
    published_at = excluded.published_at,
    last_seen_at = excluded.last_seen_at
  returning event.id into v_event_id;

  delete from public.fuel_news_adjustments as adjustment
  where adjustment.event_id = v_event_id;

  insert into public.fuel_news_adjustments (
    event_id,
    fuel_type,
    amount_centavos,
    confidence
  )
  select
    v_event_id,
    adjustment.fuel_type,
    adjustment.amount_centavos,
    adjustment.confidence
  from pg_catalog.jsonb_to_recordset(adjustment_payloads) as adjustment(
    fuel_type text,
    amount_centavos integer,
    confidence text
  );

  insert into public.fuel_news_event_articles as link (event_id, article_id)
  values (v_event_id, v_article_id)
  on conflict on constraint fuel_news_event_articles_article_key do update set
    event_id = excluded.event_id;

  update public.fuel_news_events as event
  set
    published_at = observations.published_at,
    last_seen_at = observations.last_seen_at
  from (
    select
      pg_catalog.max(article.published_at) as published_at,
      pg_catalog.max(article.fetched_at) as last_seen_at
    from public.fuel_news_event_articles as link
    join public.fuel_news_articles as article on article.id = link.article_id
    where link.event_id = v_event_id
  ) as observations
  where event.id = v_event_id;

  if v_old_event_id is not null and v_old_event_id <> v_event_id then
    if exists (
      select 1
      from public.fuel_news_event_articles as link
      where link.event_id = v_old_event_id
    ) then
      update public.fuel_news_events as event
      set
        published_at = observations.published_at,
        last_seen_at = observations.last_seen_at
      from (
        select
          pg_catalog.max(article.published_at) as published_at,
          pg_catalog.max(article.fetched_at) as last_seen_at
        from public.fuel_news_event_articles as link
        join public.fuel_news_articles as article on article.id = link.article_id
        where link.event_id = v_old_event_id
      ) as observations
      where event.id = v_old_event_id;
    else
      delete from public.fuel_news_events as event
      where event.id = v_old_event_id;
    end if;
  end if;

  return query select v_article_id, v_event_id;
end;
$$;

-- The current importer sends error_message. Retain it as last_error and maintain
-- the converged consecutive-failure contract without requiring a write RPC.
create or replace function public.fuel_news_prepare_source_state()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  if new.status in ('success', 'not_modified') then
    new.consecutive_failures = 0;
    new.error_message = null;
  elsif new.status in ('partial', 'error') then
    if tg_op = 'INSERT' then
      new.consecutive_failures = greatest(coalesce(new.consecutive_failures, 0), 1);
    else
      new.consecutive_failures = old.consecutive_failures + 1;
    end if;
    new.last_error = coalesce(nullif(btrim(new.error_message), ''), new.last_error);
    new.last_error_at = coalesce(new.last_polled_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists fuel_news_source_state_prepare_row
  on public.fuel_news_source_state;
create trigger fuel_news_source_state_prepare_row
  before insert or update on public.fuel_news_source_state
  for each row execute function public.fuel_news_prepare_source_state();

alter table public.fuel_news_articles enable row level security;
alter table public.fuel_news_events enable row level security;
alter table public.fuel_news_adjustments enable row level security;
alter table public.fuel_news_event_articles enable row level security;
alter table public.fuel_news_source_state enable row level security;

revoke all on table public.fuel_news_articles from public, anon, authenticated;
revoke all on table public.fuel_news_events from public, anon, authenticated;
revoke all on table public.fuel_news_adjustments from public, anon, authenticated;
revoke all on table public.fuel_news_event_articles from public, anon, authenticated;
revoke all on table public.fuel_news_source_state from public, anon, authenticated;

grant select on table public.fuel_news_articles to authenticated;
grant select on table public.fuel_news_events to authenticated;
grant select on table public.fuel_news_adjustments to authenticated;
grant select on table public.fuel_news_event_articles to authenticated;
grant select (
  source_key, publisher, last_polled_at, last_success_at, status,
  error_message, last_error, consecutive_failures
) on table public.fuel_news_source_state to authenticated;

grant all on table public.fuel_news_articles to service_role;
grant all on table public.fuel_news_events to service_role;
grant all on table public.fuel_news_adjustments to service_role;
grant all on table public.fuel_news_event_articles to service_role;
grant all on table public.fuel_news_source_state to service_role;

revoke all on function public.fuel_news_prepare_article()
  from public, anon, authenticated;
revoke all on function public.fuel_news_prepare_event()
  from public, anon, authenticated;
revoke all on function public.fuel_news_prepare_source_state()
  from public, anon, authenticated;
revoke all on function public.import_fuel_news_article(jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.fuel_news_prepare_article() to service_role;
grant execute on function public.fuel_news_prepare_event() to service_role;
grant execute on function public.fuel_news_prepare_source_state() to service_role;
grant execute on function public.import_fuel_news_article(jsonb, jsonb, jsonb)
  to service_role;

drop policy if exists fuel_news_articles_authenticated_read
  on public.fuel_news_articles;
create policy fuel_news_articles_authenticated_read
  on public.fuel_news_articles for select to authenticated
  using (is_feed_visible);

drop policy if exists fuel_news_event_articles_authenticated_read
  on public.fuel_news_event_articles;
create policy fuel_news_event_articles_authenticated_read
  on public.fuel_news_event_articles for select to authenticated
  using (
    exists (
      select 1
      from public.fuel_news_articles article
      where article.id = article_id and article.is_feed_visible
    )
  );

drop policy if exists fuel_news_events_authenticated_read
  on public.fuel_news_events;
create policy fuel_news_events_authenticated_read
  on public.fuel_news_events for select to authenticated
  using (
    exists (
      select 1
      from public.fuel_news_event_articles link
      join public.fuel_news_articles article on article.id = link.article_id
      where link.event_id = fuel_news_events.id and article.is_feed_visible
    )
  );

drop policy if exists fuel_news_adjustments_authenticated_read
  on public.fuel_news_adjustments;
create policy fuel_news_adjustments_authenticated_read
  on public.fuel_news_adjustments for select to authenticated
  using (
    exists (
      select 1
      from public.fuel_news_event_articles link
      join public.fuel_news_articles article on article.id = link.article_id
      where link.event_id = fuel_news_adjustments.event_id
        and article.is_feed_visible
    )
  );

drop policy if exists fuel_news_source_state_authenticated_read
  on public.fuel_news_source_state;
create policy fuel_news_source_state_authenticated_read
  on public.fuel_news_source_state for select to authenticated
  using (true);

notify pgrst, 'reload schema';
commit;
