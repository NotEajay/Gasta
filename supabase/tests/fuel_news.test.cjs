const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');

const root = path.resolve(__dirname, '../..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261116000000_fuel_news.sql'),
  'utf8',
);
const hash = (character) => character.repeat(64);
const uniqueHash = (suffix) => `${'0'.repeat(63)}${suffix}`;
const iso = (value) => value === null ? null : new Date(value).toISOString();

function rpcArticle(overrides = {}) {
  return {
    source_key: 'rpc_wire',
    publisher: 'RPC Wire',
    source_guid: 'rpc-article-a',
    canonical_url: 'https://example.com/fuel/rpc-article-a',
    headline: 'RPC fuel rollback report',
    excerpt: 'Gasoline and diesel prices will fall.',
    published_at: '2026-11-16T04:00:00Z',
    fetched_at: '2026-11-16T04:05:00Z',
    classification: 'confirmed',
    parse_status: 'structured',
    is_feed_visible: true,
    dedup_hash: uniqueHash('1'),
    content_hash: uniqueHash('2'),
    parse_result: { version: 1, parser: 'test' },
    ...overrides,
  };
}

function rpcEvent(overrides = {}) {
  return {
    event_hash: uniqueHash('7'),
    classification: 'confirmed',
    direction: 'rollback',
    effective_at: '2026-11-17T00:01:00+08:00',
    effective_timezone: 'Asia/Manila',
    effective_precision: 'minute',
    coverage: 'Nationwide participating companies',
    summary: 'Publisher-reported fuel adjustment.',
    confidence: 'high',
    parse_status: 'structured',
    discrepancy: false,
    published_at: '2026-11-16T04:00:00Z',
    last_seen_at: '2026-11-16T04:05:00Z',
    ...overrides,
  };
}

async function importFuelNewsArticle(db, article, event, adjustments) {
  return (await db.query(`
    select article_id, event_id
    from public.import_fuel_news_article($1::jsonb, $2::jsonb, $3::jsonb)
  `, [JSON.stringify(article), JSON.stringify(event), JSON.stringify(adjustments)])).rows[0];
}

async function insertArticle(db, {
  sourceKey = 'gma_money',
  publisher = 'GMA News Money',
  sourceGuid,
  url,
  headline,
  visible = true,
  dedupHash,
  contentHash,
  classification = 'confirmed',
  parseStatus = 'structured',
}) {
  return (await db.query(`
    insert into public.fuel_news_articles (
      source_key, publisher, source_guid, canonical_url, headline, excerpt,
      published_at, fetched_at, classification, parse_status, is_feed_visible,
      dedup_hash, content_hash, parse_result
    ) values ($1, $2, $3, $4, $5, 'Short RSS excerpt.',
      '2026-11-16T02:00:00Z', '2026-11-16T02:05:00Z', $6, $7, $8,
      $9, $10, '{"version":1}'::jsonb)
    returning id
  `, [sourceKey, publisher, sourceGuid, url, headline, classification,
    parseStatus, visible, dedupHash, contentHash])).rows[0].id;
}

async function insertEvent(db, {
  eventHash,
  parseStatus = 'structured',
  classification = 'confirmed',
  direction = 'rollback',
}) {
  return (await db.query(`
    insert into public.fuel_news_events (
      event_hash, classification, direction, effective_at,
      effective_timezone, effective_precision, coverage, summary,
      confidence, parse_status, published_at, last_seen_at
    ) values ($1, $2, $3, '2026-11-17T00:01:00+08:00',
      'Asia/Manila', 'minute', 'Nationwide participating companies',
      'Publisher-reported fuel adjustment.', 'high', $4,
      '2026-11-16T02:00:00Z', '2026-11-16T02:05:00Z')
    returning id, discrepancy
  `, [eventHash, classification, direction, parseStatus])).rows[0];
}

test('fuel news migration is idempotent, constrained, upsertable, and RLS-scoped', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
    `);

    await db.exec(migration);
    await db.exec(migration);

    const tableNames = (await db.query(`
      select tablename
      from pg_tables
      where schemaname = 'public' and tablename like 'fuel_news_%'
      order by tablename
    `)).rows.map((row) => row.tablename);
    assert.deepEqual(tableNames, [
      'fuel_news_adjustments',
      'fuel_news_articles',
      'fuel_news_event_articles',
      'fuel_news_events',
      'fuel_news_source_state',
    ]);

    const rls = (await db.query(`
      select relname, relrowsecurity
      from pg_class
      where relnamespace = 'public'::regnamespace
        and relname = any(array[
          'fuel_news_articles', 'fuel_news_events', 'fuel_news_adjustments',
          'fuel_news_event_articles', 'fuel_news_source_state'
        ])
      order by relname
    `)).rows;
    assert.equal(rls.length, 5);
    assert(rls.every((row) => row.relrowsecurity));

    const policies = (await db.query(`
      select tablename, policyname, roles, cmd, qual
      from pg_policies
      where schemaname = 'public' and tablename like 'fuel_news_%'
      order by tablename
    `)).rows;
    assert.equal(policies.length, 5);
    assert(policies.every((policy) => policy.cmd === 'SELECT'));
    assert(policies.every((policy) => policy.roles.includes('authenticated')));
    assert.match(
      policies.find((policy) => policy.tablename === 'fuel_news_articles').qual,
      /is_feed_visible/,
    );
    for (const table of ['fuel_news_events', 'fuel_news_adjustments', 'fuel_news_event_articles']) {
      assert.match(
        policies.find((policy) => policy.tablename === table).qual,
        /is_feed_visible/,
      );
    }

    const privileges = (await db.query(`
      select
        has_table_privilege('anon', 'public.fuel_news_articles', 'SELECT') as anon_read,
        has_table_privilege('authenticated', 'public.fuel_news_articles', 'SELECT') as auth_read,
        has_table_privilege('authenticated', 'public.fuel_news_articles', 'INSERT') as auth_write,
        has_table_privilege('service_role', 'public.fuel_news_articles', 'INSERT,UPDATE,DELETE') as service_write,
        has_column_privilege('authenticated', 'public.fuel_news_source_state', 'status', 'SELECT') as state_status_read,
        has_column_privilege('authenticated', 'public.fuel_news_source_state', 'feed_url', 'SELECT') as state_feed_read,
        has_function_privilege('anon', 'public.fuel_news_prepare_article()', 'EXECUTE') as anon_article_function,
        has_function_privilege('authenticated', 'public.fuel_news_prepare_article()', 'EXECUTE') as auth_article_function,
        has_function_privilege('service_role', 'public.fuel_news_prepare_article()', 'EXECUTE') as service_article_function,
        has_function_privilege('anon', 'public.fuel_news_prepare_event()', 'EXECUTE') as anon_function,
        has_function_privilege('authenticated', 'public.fuel_news_prepare_event()', 'EXECUTE') as auth_function,
        has_function_privilege('service_role', 'public.fuel_news_prepare_event()', 'EXECUTE') as service_function,
        has_function_privilege('anon', 'public.import_fuel_news_article(jsonb,jsonb,jsonb)', 'EXECUTE') as anon_import_function,
        has_function_privilege('authenticated', 'public.import_fuel_news_article(jsonb,jsonb,jsonb)', 'EXECUTE') as auth_import_function,
        has_function_privilege('service_role', 'public.import_fuel_news_article(jsonb,jsonb,jsonb)', 'EXECUTE') as service_import_function
    `)).rows[0];
    assert.deepEqual(privileges, {
      anon_read: false,
      auth_read: true,
      auth_write: false,
      service_write: true,
      state_status_read: true,
      state_feed_read: false,
      anon_article_function: false,
      auth_article_function: false,
      service_article_function: true,
      anon_function: false,
      auth_function: false,
      service_function: true,
      anon_import_function: false,
      auth_import_function: false,
      service_import_function: true,
    });
    const importFunction = (await db.query(`
      select prosecdef, proconfig
      from pg_proc
      where oid = 'public.import_fuel_news_article(jsonb,jsonb,jsonb)'::regprocedure
    `)).rows[0];
    assert.equal(importFunction.prosecdef, false);
    assert.deepEqual(importFunction.proconfig, ['search_path=pg_catalog']);
    assert.equal((await db.query(`
      select count(*)::int as count
      from information_schema.sequences
      where sequence_schema = 'public' and sequence_name like 'fuel_news_%'
    `)).rows[0].count, 0);

    await db.exec('set role service_role');
    const visibleArticleId = await insertArticle(db, {
      sourceGuid: 'gma-guid-visible',
      url: 'https://www.gmanetwork.com/news/money/economy/visible/story/',
      headline: 'Fuel rollback takes effect Tuesday',
      visible: true,
      dedupHash: hash('a'),
      contentHash: hash('b'),
    });
    const hiddenArticleId = await insertArticle(db, {
      sourceGuid: 'gma-guid-hidden',
      url: 'https://www.gmanetwork.com/news/money/economy/hidden/story/',
      headline: 'Hidden importer review item',
      visible: false,
      dedupHash: hash('c'),
      contentHash: hash('d'),
      classification: 'news_update',
      parseStatus: 'unstructured',
    });
    const visibleEvent = await insertEvent(db, { eventHash: hash('e') });
    const hiddenEvent = await insertEvent(db, {
      eventHash: hash('f'),
      classification: 'news_update',
      direction: 'news_update',
    });
    const conflictEvent = await insertEvent(db, {
      eventHash: hash('0'),
      parseStatus: 'conflict',
      direction: 'mixed',
    });
    assert.equal(visibleEvent.discrepancy, false);
    assert.equal(conflictEvent.discrepancy, true);

    await db.query(`
      insert into public.fuel_news_event_articles (event_id, article_id)
      values ($1, $2), ($3, $4)
    `, [visibleEvent.id, visibleArticleId, hiddenEvent.id, hiddenArticleId]);
    await db.query(`
      insert into public.fuel_news_adjustments
        (event_id, fuel_type, amount_centavos, confidence)
      values ($1, 'GASOLINE', -100, 'high'),
             ($1, 'DIESEL', -80, 'high'),
             ($2, 'KEROSENE', 60, 'medium')
    `, [visibleEvent.id, hiddenEvent.id]);

    // REST-compatible conflict targets update instead of duplicating rows.
    const initialArticleTimestamps = (await db.query(`
      select fetched_at, updated_at
      from public.fuel_news_articles where id = $1
    `, [visibleArticleId])).rows[0];
    await db.query(`
      insert into public.fuel_news_articles (
        source_key, publisher, source_guid, canonical_url, headline,
        fetched_at, classification, parse_status, dedup_hash, content_hash
      ) values (
        'gma_money', 'GMA News Money', 'same-guid',
        'https://www.gmanetwork.com/news/money/economy/same/story/',
        'Same headline', '2026-11-16T03:00:00Z', 'confirmed', 'structured', $1, $2
      )
      on conflict (dedup_hash) do update set
        fetched_at = excluded.fetched_at,
        content_hash = excluded.content_hash
    `, [hash('a'), hash('b')]);
    const routinePollTimestamps = (await db.query(`
      select fetched_at, updated_at
      from public.fuel_news_articles where id = $1
    `, [visibleArticleId])).rows[0];
    assert.notEqual(routinePollTimestamps.fetched_at, initialArticleTimestamps.fetched_at);
    assert.deepEqual(routinePollTimestamps.updated_at, initialArticleTimestamps.updated_at);

    await db.query(`
      insert into public.fuel_news_articles (
        source_key, publisher, source_guid, canonical_url, headline,
        classification, parse_status, dedup_hash, content_hash
      ) values (
        'gma_money', 'GMA News Money', 'changed-guid',
        'https://www.gmanetwork.com/news/money/economy/changed/story/',
        'Updated headline', 'confirmed', 'structured', $1, $2
      )
      on conflict (dedup_hash) do update set
        headline = excluded.headline,
        content_hash = excluded.content_hash
    `, [hash('a'), hash('9')]);
    const correctedArticle = (await db.query(`
      select headline, updated_at
      from public.fuel_news_articles where id = $1
    `, [visibleArticleId])).rows[0];
    assert.equal(correctedArticle.headline, 'Updated headline');
    assert(new Date(correctedArticle.updated_at) > new Date(initialArticleTimestamps.updated_at));

    await db.query(`
      insert into public.fuel_news_events (
        event_hash, classification, direction, confidence, parse_status,
        published_at, last_seen_at
      ) values (
        $1, 'confirmed', 'rollback', 'high', 'structured',
        '2026-11-16T01:00:00Z', '2026-11-16T01:05:00Z'
      )
      on conflict (event_hash) do update set
        published_at = excluded.published_at,
        last_seen_at = excluded.last_seen_at
    `, [hash('e')]);
    const correctedDirectEventTimestamps = (await db.query(`
      select published_at, last_seen_at from public.fuel_news_events where id = $1
    `, [visibleEvent.id])).rows[0];
    assert.equal(iso(correctedDirectEventTimestamps.published_at), '2026-11-16T01:00:00.000Z');
    assert.equal(iso(correctedDirectEventTimestamps.last_seen_at), '2026-11-16T01:05:00.000Z');
    await db.query(`
      insert into public.fuel_news_adjustments
        (event_id, fuel_type, amount_centavos)
      values ($1, 'GASOLINE', -110)
      on conflict (event_id, fuel_type)
      do update set amount_centavos = excluded.amount_centavos
    `, [visibleEvent.id]);
    await db.query(`
      insert into public.fuel_news_event_articles (event_id, article_id)
      values ($1, $2)
      on conflict (article_id) do update set event_id = excluded.event_id
    `, [visibleEvent.id, visibleArticleId]);
    assert.equal((await db.query(`
      select amount_centavos from public.fuel_news_adjustments
      where event_id = $1 and fuel_type = 'GASOLINE'
    `, [visibleEvent.id])).rows[0].amount_centavos, -110);

    // The RPC writes the whole article/event graph in one transaction.
    const firstRpcArticle = rpcArticle();
    const firstRpcEvent = rpcEvent();
    const firstRpcAdjustments = [
      { fuel_type: 'GASOLINE', amount_centavos: -100, confidence: 'high' },
      { fuel_type: 'DIESEL', amount_centavos: -80, confidence: 'medium' },
    ];
    const firstRpcWrite = await importFuelNewsArticle(
      db, firstRpcArticle, firstRpcEvent, firstRpcAdjustments,
    );
    assert(firstRpcWrite.article_id);
    assert(firstRpcWrite.event_id);
    assert.deepEqual((await db.query(`
      select source_key, publisher, source_guid, canonical_url, headline, excerpt,
        published_at, fetched_at, classification, parse_status, is_feed_visible,
        dedup_hash, content_hash, parse_result
      from public.fuel_news_articles where id = $1
    `, [firstRpcWrite.article_id])).rows[0], {
      source_key: firstRpcArticle.source_key,
      publisher: firstRpcArticle.publisher,
      source_guid: firstRpcArticle.source_guid,
      canonical_url: firstRpcArticle.canonical_url,
      headline: firstRpcArticle.headline,
      excerpt: firstRpcArticle.excerpt,
      published_at: new Date(firstRpcArticle.published_at),
      fetched_at: new Date(firstRpcArticle.fetched_at),
      classification: firstRpcArticle.classification,
      parse_status: firstRpcArticle.parse_status,
      is_feed_visible: true,
      dedup_hash: firstRpcArticle.dedup_hash,
      content_hash: firstRpcArticle.content_hash,
      parse_result: firstRpcArticle.parse_result,
    });
    assert.deepEqual((await db.query(`
      select event_hash, classification, direction, effective_at,
        effective_timezone, effective_precision, coverage, summary,
        confidence, parse_status, discrepancy, published_at, last_seen_at
      from public.fuel_news_events where id = $1
    `, [firstRpcWrite.event_id])).rows[0], {
      event_hash: firstRpcEvent.event_hash,
      classification: firstRpcEvent.classification,
      direction: firstRpcEvent.direction,
      effective_at: new Date('2026-11-16T16:01:00.000Z'),
      effective_timezone: firstRpcEvent.effective_timezone,
      effective_precision: firstRpcEvent.effective_precision,
      coverage: firstRpcEvent.coverage,
      summary: firstRpcEvent.summary,
      confidence: firstRpcEvent.confidence,
      parse_status: firstRpcEvent.parse_status,
      discrepancy: false,
      published_at: new Date(firstRpcArticle.published_at),
      last_seen_at: new Date(firstRpcArticle.fetched_at),
    });
    assert.deepEqual((await db.query(`
      select fuel_type, amount_centavos, confidence
      from public.fuel_news_adjustments where event_id = $1 order by fuel_type
    `, [firstRpcWrite.event_id])).rows, [
      { fuel_type: 'DIESEL', amount_centavos: -80, confidence: 'medium' },
      { fuel_type: 'GASOLINE', amount_centavos: -100, confidence: 'high' },
    ]);

    // Retrying exactly reuses both IDs and does not duplicate graph rows.
    const firstRpcUpdatedAt = (await db.query(`
      select updated_at from public.fuel_news_articles where id = $1
    `, [firstRpcWrite.article_id])).rows[0].updated_at;
    const retryRpcWrite = await importFuelNewsArticle(
      db, firstRpcArticle, firstRpcEvent, firstRpcAdjustments,
    );
    assert.deepEqual(retryRpcWrite, firstRpcWrite);
    assert.deepEqual((await db.query(`
      select
        (select count(*)::int from public.fuel_news_articles where dedup_hash = $1) as articles,
        (select count(*)::int from public.fuel_news_events where event_hash = $2) as events,
        (select count(*)::int from public.fuel_news_event_articles where article_id = $3) as links,
        (select count(*)::int from public.fuel_news_adjustments where event_id = $4) as adjustments
    `, [firstRpcArticle.dedup_hash, firstRpcEvent.event_hash,
      firstRpcWrite.article_id, firstRpcWrite.event_id])).rows[0], {
      articles: 1,
      events: 1,
      links: 1,
      adjustments: 2,
    });
    assert.deepEqual((await db.query(`
      select updated_at from public.fuel_news_articles where id = $1
    `, [firstRpcWrite.article_id])).rows[0].updated_at, firstRpcUpdatedAt);

    // A content correction updates every importer field, replaces adjustments, and
    // can move the event's derived publication/observation times backward.
    const correctedRpcArticle = rpcArticle({
      source_guid: 'rpc-article-a-corrected',
      canonical_url: 'https://example.com/fuel/rpc-article-a-corrected',
      headline: 'Corrected RPC fuel rollback report',
      excerpt: null,
      published_at: '2026-11-16T01:00:00Z',
      fetched_at: '2026-11-16T01:05:00Z',
      classification: 'forecast',
      parse_status: 'conflict',
      is_feed_visible: false,
      content_hash: uniqueHash('3'),
      parse_result: { version: 2, corrected: true },
    });
    const correctedRpcEvent = rpcEvent({
      classification: 'forecast',
      direction: 'mixed',
      coverage: 'Corrected limited coverage',
      summary: null,
      confidence: 'medium',
      parse_status: 'conflict',
      discrepancy: false,
      published_at: '2099-01-01T00:00:00Z',
      last_seen_at: '2099-01-01T00:00:00Z',
    });
    const correctedRpcWrite = await importFuelNewsArticle(
      db,
      correctedRpcArticle,
      correctedRpcEvent,
      [{ fuel_type: 'KEROSENE', amount_centavos: -60, confidence: 'low' }],
    );
    assert.deepEqual(correctedRpcWrite, firstRpcWrite);
    const correctedRpcRow = (await db.query(`
      select source_guid, canonical_url, headline, excerpt, published_at, fetched_at,
        classification, parse_status, is_feed_visible, content_hash, parse_result, updated_at
      from public.fuel_news_articles where id = $1
    `, [firstRpcWrite.article_id])).rows[0];
    assert.equal(correctedRpcRow.source_guid, correctedRpcArticle.source_guid);
    assert.equal(correctedRpcRow.canonical_url, correctedRpcArticle.canonical_url);
    assert.equal(correctedRpcRow.headline, correctedRpcArticle.headline);
    assert.equal(correctedRpcRow.excerpt, null);
    assert.equal(iso(correctedRpcRow.published_at), '2026-11-16T01:00:00.000Z');
    assert.equal(iso(correctedRpcRow.fetched_at), '2026-11-16T01:05:00.000Z');
    assert.equal(correctedRpcRow.classification, 'forecast');
    assert.equal(correctedRpcRow.parse_status, 'conflict');
    assert.equal(correctedRpcRow.is_feed_visible, false);
    assert.equal(correctedRpcRow.content_hash, correctedRpcArticle.content_hash);
    assert.deepEqual(correctedRpcRow.parse_result, correctedRpcArticle.parse_result);
    assert(new Date(correctedRpcRow.updated_at) > new Date(firstRpcUpdatedAt));
    const correctedRpcEventRow = (await db.query(`
      select classification, direction, coverage, summary, confidence,
        parse_status, discrepancy, published_at, last_seen_at
      from public.fuel_news_events where id = $1
    `, [firstRpcWrite.event_id])).rows[0];
    assert.deepEqual(correctedRpcEventRow, {
      classification: 'forecast',
      direction: 'mixed',
      coverage: 'Corrected limited coverage',
      summary: null,
      confidence: 'medium',
      parse_status: 'conflict',
      discrepancy: true,
      published_at: new Date(correctedRpcArticle.published_at),
      last_seen_at: new Date(correctedRpcArticle.fetched_at),
    });
    assert.deepEqual((await db.query(`
      select fuel_type, amount_centavos, confidence
      from public.fuel_news_adjustments where event_id = $1
    `, [firstRpcWrite.event_id])).rows, [
      { fuel_type: 'KEROSENE', amount_centavos: -60, confidence: 'low' },
    ]);

    // A stable source GUID reconciles the existing row even when both hash and
    // canonical URL change together.
    const guidMatchedArticle = rpcArticle({
      ...correctedRpcArticle,
      dedup_hash: uniqueHash('d'),
      canonical_url: 'https://example.com/fuel/rpc-article-a-guid-match',
      headline: 'GUID matched after URL and hash changed',
      content_hash: uniqueHash('e'),
    });
    const guidMatchedWrite = await importFuelNewsArticle(
      db,
      guidMatchedArticle,
      correctedRpcEvent,
      [{ fuel_type: 'KEROSENE', amount_centavos: -60, confidence: 'low' }],
    );
    assert.deepEqual(guidMatchedWrite, firstRpcWrite);
    assert.deepEqual((await db.query(`
      select dedup_hash, source_guid, canonical_url, headline
      from public.fuel_news_articles where id = $1
    `, [firstRpcWrite.article_id])).rows[0], {
      dedup_hash: guidMatchedArticle.dedup_hash,
      source_guid: guidMatchedArticle.source_guid,
      canonical_url: guidMatchedArticle.canonical_url,
      headline: guidMatchedArticle.headline,
    });

    // A stable source-scoped URL likewise reconciles the row while GUID and hash
    // are both replaced.
    const urlMatchedArticle = rpcArticle({
      ...guidMatchedArticle,
      source_guid: 'rpc-article-a-url-match',
      canonical_url: guidMatchedArticle.canonical_url,
      dedup_hash: uniqueHash('f'),
      headline: 'URL matched after GUID and hash changed',
      content_hash: uniqueHash('0'),
    });
    const urlMatchedWrite = await importFuelNewsArticle(
      db,
      urlMatchedArticle,
      correctedRpcEvent,
      [{ fuel_type: 'KEROSENE', amount_centavos: -60, confidence: 'low' }],
    );
    assert.deepEqual(urlMatchedWrite, firstRpcWrite);
    assert.deepEqual((await db.query(`
      select dedup_hash, source_guid, canonical_url, headline
      from public.fuel_news_articles where id = $1
    `, [firstRpcWrite.article_id])).rows[0], {
      dedup_hash: urlMatchedArticle.dedup_hash,
      source_guid: urlMatchedArticle.source_guid,
      canonical_url: urlMatchedArticle.canonical_url,
      headline: urlMatchedArticle.headline,
    });

    // Conflicting source-scoped identities must not choose or merge either row,
    // and no article/event/link/adjustment mutation may survive the exception.
    const ambiguityPeerArticle = rpcArticle({
      source_guid: 'rpc-article-ambiguity-peer',
      canonical_url: 'https://example.com/fuel/rpc-article-ambiguity-peer',
      dedup_hash: uniqueHash('6'),
      headline: 'Ambiguity peer article',
      content_hash: uniqueHash('5'),
    });
    const ambiguityPeerEvent = rpcEvent({ event_hash: uniqueHash('3') });
    const ambiguityPeerWrite = await importFuelNewsArticle(
      db,
      ambiguityPeerArticle,
      ambiguityPeerEvent,
      [{ fuel_type: 'DIESEL', amount_centavos: -35, confidence: 'medium' }],
    );
    const ambiguityBefore = {
      articles: (await db.query(`
        select id, source_guid, canonical_url, dedup_hash, headline, content_hash
        from public.fuel_news_articles
        where id = any($1::uuid[])
        order by id
      `, [[firstRpcWrite.article_id, ambiguityPeerWrite.article_id]])).rows,
      events: (await db.query(`
        select id, event_hash, direction, coverage
        from public.fuel_news_events
        where id = any($1::uuid[])
        order by id
      `, [[firstRpcWrite.event_id, ambiguityPeerWrite.event_id]])).rows,
      links: (await db.query(`
        select event_id, article_id
        from public.fuel_news_event_articles
        where article_id = any($1::uuid[])
        order by article_id
      `, [[firstRpcWrite.article_id, ambiguityPeerWrite.article_id]])).rows,
      adjustments: (await db.query(`
        select event_id, fuel_type, amount_centavos, confidence
        from public.fuel_news_adjustments
        where event_id = any($1::uuid[])
        order by event_id, fuel_type
      `, [[firstRpcWrite.event_id, ambiguityPeerWrite.event_id]])).rows,
    };
    await assert.rejects(
      importFuelNewsArticle(
        db,
        rpcArticle({
          source_guid: urlMatchedArticle.source_guid,
          canonical_url: ambiguityPeerArticle.canonical_url,
          dedup_hash: uniqueHash('9'),
          headline: 'Ambiguous update must roll back',
          content_hash: uniqueHash('8'),
        }),
        rpcEvent({
          event_hash: uniqueHash('2'),
          direction: 'hike',
          coverage: 'This event must not be inserted',
        }),
        [{ fuel_type: 'GASOLINE', amount_centavos: 75, confidence: 'high' }],
      ),
      /ambiguous fuel news article identity/,
    );
    assert.deepEqual((await db.query(`
      select id, source_guid, canonical_url, dedup_hash, headline, content_hash
      from public.fuel_news_articles
      where id = any($1::uuid[])
      order by id
    `, [[firstRpcWrite.article_id, ambiguityPeerWrite.article_id]])).rows, ambiguityBefore.articles);
    assert.deepEqual((await db.query(`
      select id, event_hash, direction, coverage
      from public.fuel_news_events
      where id = any($1::uuid[])
      order by id
    `, [[firstRpcWrite.event_id, ambiguityPeerWrite.event_id]])).rows, ambiguityBefore.events);
    assert.deepEqual((await db.query(`
      select event_id, article_id
      from public.fuel_news_event_articles
      where article_id = any($1::uuid[])
      order by article_id
    `, [[firstRpcWrite.article_id, ambiguityPeerWrite.article_id]])).rows, ambiguityBefore.links);
    assert.deepEqual((await db.query(`
      select event_id, fuel_type, amount_centavos, confidence
      from public.fuel_news_adjustments
      where event_id = any($1::uuid[])
      order by event_id, fuel_type
    `, [[firstRpcWrite.event_id, ambiguityPeerWrite.event_id]])).rows, ambiguityBefore.adjustments);
    assert.equal((await db.query(`
      select count(*)::int as count from public.fuel_news_articles
      where dedup_hash = $1
    `, [uniqueHash('9')])).rows[0].count, 0);
    assert.equal((await db.query(`
      select count(*)::int as count from public.fuel_news_events
      where event_hash = $1
    `, [uniqueHash('2')])).rows[0].count, 0);
    await db.query(`delete from public.fuel_news_events where id = $1`, [ambiguityPeerWrite.event_id]);
    await db.query(`delete from public.fuel_news_articles where id = $1`, [ambiguityPeerWrite.article_id]);

    // Corroboration derives event times from all linked articles, and moving one
    // article recomputes the event it leaves as well as the event it joins.
    const corroboratingArticle = rpcArticle({
      source_key: 'second_wire',
      publisher: 'Second Wire',
      source_guid: 'rpc-article-b',
      canonical_url: 'https://second.example/fuel/rpc-article-b',
      headline: 'Second report corroborates the rollback',
      excerpt: 'A later corroborating report.',
      published_at: '2026-11-16T06:00:00Z',
      fetched_at: '2026-11-16T06:05:00Z',
      classification: 'confirmed',
      parse_status: 'structured',
      is_feed_visible: true,
      dedup_hash: uniqueHash('4'),
      content_hash: uniqueHash('5'),
      parse_result: { version: 1, source: 'second' },
    });
    const corroboratingWrite = await importFuelNewsArticle(
      db,
      corroboratingArticle,
      rpcEvent({
        published_at: '1900-01-01T00:00:00Z',
        last_seen_at: '1900-01-01T00:00:00Z',
      }),
      [
        { fuel_type: 'GASOLINE', amount_centavos: -110, confidence: 'high' },
        { fuel_type: 'DIESEL', amount_centavos: -90, confidence: 'high' },
      ],
    );
    assert.equal(corroboratingWrite.event_id, firstRpcWrite.event_id);
    assert.notEqual(corroboratingWrite.article_id, firstRpcWrite.article_id);
    let corroboratedTimes = (await db.query(`
      select published_at, last_seen_at from public.fuel_news_events where id = $1
    `, [firstRpcWrite.event_id])).rows[0];
    assert.equal(iso(corroboratedTimes.published_at), '2026-11-16T06:00:00.000Z');
    assert.equal(iso(corroboratedTimes.last_seen_at), '2026-11-16T06:05:00.000Z');
    assert.deepEqual((await db.query(`
      select fuel_type, amount_centavos
      from public.fuel_news_adjustments where event_id = $1 order by fuel_type
    `, [firstRpcWrite.event_id])).rows, [
      { fuel_type: 'DIESEL', amount_centavos: -90 },
      { fuel_type: 'GASOLINE', amount_centavos: -110 },
    ]);

    const movedRpcEvent = rpcEvent({
      event_hash: uniqueHash('8'),
      direction: 'hike',
      coverage: 'Article moved after corrected extraction',
      published_at: '2099-01-01T00:00:00Z',
      last_seen_at: '2099-01-01T00:00:00Z',
    });
    const movedWrite = await importFuelNewsArticle(
      db,
      urlMatchedArticle,
      movedRpcEvent,
      [{ fuel_type: 'GASOLINE', amount_centavos: 50, confidence: 'medium' }],
    );
    assert.equal(movedWrite.article_id, firstRpcWrite.article_id);
    assert.notEqual(movedWrite.event_id, firstRpcWrite.event_id);
    corroboratedTimes = (await db.query(`
      select published_at, last_seen_at from public.fuel_news_events where id = $1
    `, [firstRpcWrite.event_id])).rows[0];
    assert.equal(iso(corroboratedTimes.published_at), '2026-11-16T06:00:00.000Z');
    assert.equal(iso(corroboratedTimes.last_seen_at), '2026-11-16T06:05:00.000Z');
    const movedTimes = (await db.query(`
      select published_at, last_seen_at from public.fuel_news_events where id = $1
    `, [movedWrite.event_id])).rows[0];
    assert.equal(iso(movedTimes.published_at), '2026-11-16T01:00:00.000Z');
    assert.equal(iso(movedTimes.last_seen_at), '2026-11-16T01:05:00.000Z');
    assert.equal((await db.query(`
      select count(*)::int as count from public.fuel_news_event_articles
      where article_id = $1
    `, [firstRpcWrite.article_id])).rows[0].count, 1);

    // Moving the sole article off an event removes that now-orphaned event and its
    // cascading adjustment set instead of leaving stale ordering rows behind.
    const orphanArticle = rpcArticle({
      source_key: 'orphan_wire',
      publisher: 'Orphan Wire',
      source_guid: 'rpc-article-c',
      canonical_url: 'https://orphan.example/fuel/rpc-article-c',
      headline: 'Article initially assigned to its own event',
      excerpt: 'This event will become empty.',
      published_at: '2026-11-16T07:00:00Z',
      fetched_at: '2026-11-16T07:05:00Z',
      dedup_hash: uniqueHash('a'),
      content_hash: uniqueHash('b'),
      parse_result: { version: 1, source: 'orphan' },
    });
    const orphanEvent = rpcEvent({ event_hash: uniqueHash('c') });
    const orphanWrite = await importFuelNewsArticle(
      db,
      orphanArticle,
      orphanEvent,
      [{ fuel_type: 'DIESEL', amount_centavos: -40, confidence: 'high' }],
    );
    const orphanMovedWrite = await importFuelNewsArticle(
      db,
      orphanArticle,
      movedRpcEvent,
      [{ fuel_type: 'GASOLINE', amount_centavos: 50, confidence: 'medium' }],
    );
    assert.equal(orphanMovedWrite.article_id, orphanWrite.article_id);
    assert.equal(orphanMovedWrite.event_id, movedWrite.event_id);
    assert.equal((await db.query(`
      select count(*)::int as count from public.fuel_news_events where id = $1
    `, [orphanWrite.event_id])).rows[0].count, 0);
    assert.equal((await db.query(`
      select count(*)::int as count from public.fuel_news_adjustments where event_id = $1
    `, [orphanWrite.event_id])).rows[0].count, 0);
    const twoArticleMovedTimes = (await db.query(`
      select published_at, last_seen_at from public.fuel_news_events where id = $1
    `, [movedWrite.event_id])).rows[0];
    assert.equal(iso(twoArticleMovedTimes.published_at), '2026-11-16T07:00:00.000Z');
    assert.equal(iso(twoArticleMovedTimes.last_seen_at), '2026-11-16T07:05:00.000Z');

    // Invalid shapes and late constraint failures roll back all earlier upserts.
    await assert.rejects(
      db.query(`select * from public.import_fuel_news_article(
        '[]'::jsonb, '{}'::jsonb, '[]'::jsonb
      )`),
      /article_payload must be a JSON object/,
    );
    await assert.rejects(
      db.query(`select * from public.import_fuel_news_article(
        '{}'::jsonb, '[]'::jsonb, '[]'::jsonb
      )`),
      /event_payload must be a JSON object/,
    );
    await assert.rejects(
      db.query(`select * from public.import_fuel_news_article(
        '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
      )`),
      /adjustment_payloads must be a JSON array/,
    );
    await assert.rejects(
      importFuelNewsArticle(db, rpcArticle({ parse_result: [] }), rpcEvent(), []),
      /article_payload.parse_result must be a JSON object/,
    );
    await assert.rejects(
      importFuelNewsArticle(db, rpcArticle(), rpcEvent(), ['not-an-object']),
      /every adjustment_payloads item must be a JSON object/,
    );
    const atomicBefore = (await db.query(`
      select headline, content_hash, parse_result
      from public.fuel_news_articles where id = $1
    `, [firstRpcWrite.article_id])).rows[0];
    await assert.rejects(
      importFuelNewsArticle(
        db,
        rpcArticle({
          headline: 'This update must roll back',
          content_hash: uniqueHash('6'),
          parse_result: { should_not_persist: true },
        }),
        rpcEvent({ event_hash: uniqueHash('9'), direction: 'hike' }),
        [{ fuel_type: 'LPG', amount_centavos: 50, confidence: 'high' }],
      ),
      /fuel_news_adjustments_fuel_type_check|check constraint/,
    );
    assert.deepEqual((await db.query(`
      select headline, content_hash, parse_result
      from public.fuel_news_articles where id = $1
    `, [firstRpcWrite.article_id])).rows[0], atomicBefore);
    assert.equal((await db.query(`
      select count(*)::int as count from public.fuel_news_events
      where event_hash = $1
    `, [uniqueHash('9')])).rows[0].count, 0);
    assert.deepEqual((await db.query(`
      select event_id from public.fuel_news_event_articles where article_id = $1
    `, [firstRpcWrite.article_id])).rows, [{ event_id: movedWrite.event_id }]);

    await db.exec(`
      insert into public.fuel_news_source_state (
        source_key, publisher, feed_url, last_polled_at, status,
        http_status, error_message
      ) values (
        'gma_money', 'GMA News Money',
        'https://data.gmanetwork.com/gno/rss/money/feed.xml',
        '2026-11-16T03:00:00Z', 'error', 503, 'temporary failure'
      );
    `);
    let state = (await db.query(`
      select consecutive_failures, last_error, last_error_at
      from public.fuel_news_source_state where source_key = 'gma_money'
    `)).rows[0];
    assert.equal(state.consecutive_failures, 1);
    assert.equal(state.last_error, 'temporary failure');
    assert(state.last_error_at);
    await db.exec(`
      insert into public.fuel_news_source_state (
        source_key, publisher, feed_url, last_polled_at, last_success_at,
        status, http_status
      ) values (
        'gma_money', 'GMA News Money',
        'https://data.gmanetwork.com/gno/rss/money/feed.xml',
        '2026-11-16T04:00:00Z', '2026-11-16T04:00:00Z',
        'not_modified', 304
      ) on conflict (source_key) do update set
        last_polled_at = excluded.last_polled_at,
        last_success_at = excluded.last_success_at,
        status = excluded.status,
        http_status = excluded.http_status;
    `);
    state = (await db.query(`
      select consecutive_failures, last_success_at, error_message, last_error
      from public.fuel_news_source_state where source_key = 'gma_money'
    `)).rows[0];
    assert.equal(state.consecutive_failures, 0);
    assert(state.last_success_at);
    assert.equal(state.error_message, null);
    assert.equal(state.last_error, 'temporary failure');

    // Representative domain and dedup constraints.
    await assert.rejects(insertArticle(db, {
      sourceGuid: 'duplicate-hash',
      url: 'https://www.gmanetwork.com/news/money/economy/duplicate/story/',
      headline: 'Duplicate hash',
      dedupHash: hash('a'),
      contentHash: hash('8'),
    }), /fuel_news_articles_dedup_hash_key|duplicate key/);
    await assert.rejects(insertArticle(db, {
      sourceGuid: 'bad-classification',
      url: 'https://www.gmanetwork.com/news/money/economy/invalid/story/',
      headline: 'Invalid classification',
      dedupHash: hash('7'),
      contentHash: hash('6'),
      classification: 'rumor',
    }), /fuel_news_articles_classification_check|check constraint/);
    await assert.rejects(db.query(`
      insert into public.fuel_news_adjustments
        (event_id, fuel_type, amount_centavos)
      values ($1, 'LPG', 50)
    `, [visibleEvent.id]), /fuel_news_adjustments_fuel_type_check|check constraint/);
    await assert.rejects(db.query(`
      insert into public.fuel_news_adjustments
        (event_id, fuel_type, amount_centavos)
      values ($1, 'KEROSENE', 0)
    `, [visibleEvent.id]), /fuel_news_adjustments_amount_check|check constraint/);

    // Reapplication preserves imported data as well as schema objects.
    const beforeReapply = (await db.query(`
      select
        (select count(*)::int from public.fuel_news_articles) as articles,
        (select count(*)::int from public.fuel_news_events) as events,
        (select count(*)::int from public.fuel_news_adjustments) as adjustments,
        (select count(*)::int from public.fuel_news_event_articles) as links,
        (select count(*)::int from public.fuel_news_source_state) as sources
    `)).rows[0];
    await db.exec('reset role');
    await db.exec(migration);
    await db.exec('set role service_role');
    assert.deepEqual((await db.query(`
      select
        (select count(*)::int from public.fuel_news_articles) as articles,
        (select count(*)::int from public.fuel_news_events) as events,
        (select count(*)::int from public.fuel_news_adjustments) as adjustments,
        (select count(*)::int from public.fuel_news_event_articles) as links,
        (select count(*)::int from public.fuel_news_source_state) as sources
    `)).rows[0], beforeReapply);

    await db.exec('reset role; set role anon');
    await assert.rejects(
      importFuelNewsArticle(db, rpcArticle(), rpcEvent(), []),
      /permission denied for function import_fuel_news_article/,
    );
    await assert.rejects(
      db.query('select * from public.fuel_news_articles'),
      /permission denied/,
    );
    await assert.rejects(
      db.query(`insert into public.fuel_news_articles (
        source_key, publisher, canonical_url, headline, classification,
        parse_status, dedup_hash, content_hash
      ) values ('x', 'X', 'https://example.com/x', 'X', 'news_update',
        'unstructured', $1, $2)` , [hash('1'), hash('2')]),
      /permission denied/,
    );

    await db.exec('reset role; set role authenticated');
    await assert.rejects(
      importFuelNewsArticle(db, rpcArticle(), rpcEvent(), []),
      /permission denied for function import_fuel_news_article/,
    );
    assert.deepEqual(
      (await db.query('select headline from public.fuel_news_articles order by headline')).rows,
      [
        { headline: 'Article initially assigned to its own event' },
        { headline: 'Second report corroborates the rollback' },
        { headline: 'Updated headline' },
      ],
    );
    assert.deepEqual(
      (await db.query('select id from public.fuel_news_events order by id')).rows,
      [visibleEvent.id, firstRpcWrite.event_id, movedWrite.event_id]
        .sort()
        .map((id) => ({ id })),
    );
    assert.equal((await db.query('select count(*)::int as count from public.fuel_news_adjustments')).rows[0].count, 5);
    assert.equal((await db.query('select count(*)::int as count from public.fuel_news_event_articles')).rows[0].count, 3);
    assert.deepEqual(
      (await db.query('select source_key, status from public.fuel_news_source_state')).rows,
      [{ source_key: 'gma_money', status: 'not_modified' }],
    );
    await assert.rejects(
      db.query('select feed_url from public.fuel_news_source_state'),
      /permission denied/,
    );
    await assert.rejects(
      db.query(`update public.fuel_news_articles set headline = 'client write'`),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
