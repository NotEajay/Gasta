const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');

const file = path.resolve(__dirname, '../lib/services/fuelNews.ts');
const source = fs.readFileSync(file, 'utf8');

function article(overrides = {}) {
  return {
    id: 'article-a',
    publisher: 'Publisher A',
    canonical_url: 'https://publisher.example/a',
    headline: 'Fuel update A',
    published_at: '2026-11-16T08:00:00Z',
    fetched_at: '2026-11-16T08:05:00Z',
    is_feed_visible: true,
    ...overrides,
  };
}

function loadService({ data = [], error = null } = {}) {
  const calls = [];
  const result = Promise.resolve({ data, error });
  const query = {
    select(value) { calls.push(['select', value]); return this; },
    order(column, options) { calls.push(['order', column, options]); return this; },
    limit(value) { calls.push(['limit', value]); return result; },
  };
  const supabase = {
    from(table) { calls.push(['from', table]); return query; },
  };
  const exportsObject = {};
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports: exportsObject,
    require(name) {
      if (name === '@/lib/supabase') return { supabase };
      throw new Error(`Unexpected import: ${name}`);
    },
    URL,
    Date,
    Math,
    Number,
  });
  return { news: exportsObject, calls };
}

function comparable(value) {
  return JSON.parse(JSON.stringify(value));
}

test('safe links accept only credential-free HTTPS publisher URLs', () => {
  const { news } = loadService();
  assert.equal(news.safeHttpsUrl('https://example.com/report?id=1'), 'https://example.com/report?id=1');
  assert.equal(news.safeHttpsUrl('http://example.com/report'), null);
  assert.equal(news.safeHttpsUrl('javascript:alert(1)'), null);
  assert.equal(news.safeHttpsUrl('https://user:pass@example.com/report'), null);
  assert.equal(news.safeHttpsUrl('not a url'), null);
});

test('lead selection chooses the newest linked visible article with a safe URL', () => {
  const { news } = loadService();
  const lead = news.selectNewestVisibleArticle([
    { article: article({ id: 'old', headline: 'Older', published_at: '2026-11-15T08:00:00Z' }) },
    { article: article({ id: 'hidden', headline: 'Hidden newest', published_at: '2026-11-17T08:00:00Z', is_feed_visible: false }) },
    { article: article({ id: 'unsafe', headline: 'Unsafe newer', published_at: '2026-11-16T10:00:00Z', canonical_url: 'http://publisher.example/unsafe' }) },
    { article: [article({ id: 'new', headline: 'Newest usable', publisher: 'Publisher B', canonical_url: 'https://publisher.example/new', published_at: '2026-11-16T09:00:00Z' })] },
  ]);
  assert.equal(lead.id, 'new');
  assert.equal(lead.headline, 'Newest usable');
});

test('Home preview queries newest events, caps at three, and returns only compact content', async () => {
  const rows = Array.from({ length: 4 }, (_, index) => ({
    id: `event-${index + 1}`,
    fuel_news_event_articles: [{
      article: article({
        id: `article-${index + 1}`,
        headline: `Headline ${index + 1}`,
        publisher: `Source ${index + 1}`,
        canonical_url: `https://publisher.example/${index + 1}`,
      }),
    }],
  }));
  const { news, calls } = loadService({ data: rows });
  const result = await news.fetchFuelNewsPreview();

  assert.deepEqual(comparable(result), rows.slice(0, 3).map((row, index) => ({
    id: row.id,
    headline: `Headline ${index + 1}`,
    publisher: `Source ${index + 1}`,
    canonicalUrl: `https://publisher.example/${index + 1}`,
  })));
  assert.deepEqual(comparable(calls.filter(([kind]) => kind === 'order')), [
    ['order', 'published_at', { ascending: false, nullsFirst: false }],
    ['order', 'last_seen_at', { ascending: false }],
    ['order', 'id', { ascending: false }],
  ]);
  assert.deepEqual(comparable(calls.find(([kind]) => kind === 'limit')), ['limit', 12]);

  const select = calls.find(([kind]) => kind === 'select')[1];
  for (const field of ['id', 'headline', 'publisher', 'canonical_url', 'published_at', 'fetched_at', 'is_feed_visible']) {
    assert(select.includes(field));
  }
  for (const forbidden of ['excerpt', 'summary', 'adjustments', 'source_state', 'confidence', 'parse_status']) {
    assert(!select.includes(forbidden));
  }
});

test('Home preview skips unusable leading events before applying the three-row cap', async () => {
  const rows = [
    { id: 'unsafe', fuel_news_event_articles: [{ article: article({ canonical_url: 'http://publisher.example/no' }) }] },
    { id: 'hidden', fuel_news_event_articles: [{ article: article({ is_feed_visible: false }) }] },
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `good-${index + 1}`,
      fuel_news_event_articles: [{ article: article({
        id: `good-article-${index + 1}`,
        headline: `Usable ${index + 1}`,
        canonical_url: `https://publisher.example/good-${index + 1}`,
      }) }],
    })),
  ];
  const loaded = loadService({ data: rows });
  assert.deepEqual(
    comparable(await loaded.news.fetchFuelNewsPreview()).map((item) => item.id),
    ['good-1', 'good-2', 'good-3'],
  );
});

test('Home preview drops events without a visible safe article and propagates query failures', async () => {
  const rows = [
    { id: 'unsafe', fuel_news_event_articles: [{ article: article({ canonical_url: 'http://publisher.example/no' }) }] },
    { id: 'hidden', fuel_news_event_articles: [{ article: article({ is_feed_visible: false }) }] },
    { id: 'good', fuel_news_event_articles: [{ article: article({ headline: 'Usable report' }) }] },
  ];
  const loaded = loadService({ data: rows });
  assert.deepEqual(comparable(await loaded.news.fetchFuelNewsPreview()), [{
    id: 'good',
    headline: 'Usable report',
    publisher: 'Publisher A',
    canonicalUrl: 'https://publisher.example/a',
  }]);

  const failure = new Error('fuel_news_events is missing');
  const failed = loadService({ error: failure });
  await assert.rejects(failed.news.fetchFuelNewsPreview(), /missing/);
});

test('service exposes one Home API and no feed, detail, health, or pagination exports', () => {
  const { news } = loadService();
  const publicApi = Object.keys(news).sort();
  assert.deepEqual(publicApi, [
    'fetchFuelNewsPreview',
    'safeHttpsUrl',
    'selectNewestVisibleArticle',
  ]);
  for (const stale of ['fetchFuelNewsPage', 'fetchFuelNewsDetail', 'fetchFuelNewsSourceState', 'FUEL_NEWS_PAGE_SIZE']) {
    assert.equal(news[stale], undefined);
  }
});
