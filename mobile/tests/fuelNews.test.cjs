const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');

const file = path.resolve(__dirname, '../lib/fuelNews.ts');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exportsObject, require, URL, Intl, Date, Set, Math, Number });

const news = exportsObject;

test('classification keeps forecasts distinct and labels all five visible kinds', () => {
  assert.equal(news.fuelNewsDisplayKind('forecast', 'rollback'), 'forecast');
  assert.equal(news.fuelNewsDisplayKind('confirmed', 'hike'), 'hike');
  assert.equal(news.fuelNewsKindLabel('news_update'), 'News Update');
  assert.deepEqual(
    ['hike', 'rollback', 'mixed', 'forecast', 'news_update'].map(news.fuelNewsKindLabel),
    ['Hike', 'Rollback', 'Mixed', 'Forecast', 'News Update'],
  );
});

test('signed integer centavos render as explicit peso-per-liter movements', () => {
  assert.equal(news.formatCentavosPerLiter(125), '+₱1.25/L');
  assert.equal(news.formatCentavosPerLiter(-50), '−₱0.50/L');
  assert.equal(news.describeAdjustment({ fuelType: 'GASOLINE', amountCentavos: 125 }),
    'Gasoline: +₱1.25/L increase');
  assert.equal(news.describeAdjustment({ fuelType: 'DIESEL', amountCentavos: -50 }),
    'Diesel: −₱0.50/L decrease');
});

test('timestamps are explicitly converted to Philippine time and preserve date-only precision', () => {
  const instant = '2026-11-16T16:30:00Z';
  assert.match(news.manilaTimestampLabel('Published', instant), /^Published: Nov 17, 2026, 12:30 AM PHT \(Asia\/Manila\)$/);
  assert.equal(news.effectiveTimeLabel('2026-11-16T16:00:00Z', 'date'),
    'Effective: Nov 17, 2026 PHT (Asia/Manila)');
  assert.equal(news.manilaTimestampLabel('Published', null), null);
});

test('aggregation deduplicates publishers, chooses newest timestamp, and detects updates', () => {
  const articles = [
    { id: 'a', publisher: 'GMA News', publishedAt: '2026-11-16T01:00:00Z', fetchedAt: '2026-11-16T01:02:00Z' },
    { id: 'b', publisher: 'GMA News', publishedAt: '2026-11-16T02:00:00Z', fetchedAt: '2026-11-16T02:03:00Z' },
    { id: 'c', publisher: 'Philstar', publishedAt: '2026-11-16T03:00:00Z', fetchedAt: '2026-11-16T03:01:00Z' },
  ];
  assert.deepEqual(Array.from(news.publisherNames(articles)), ['GMA News', 'Philstar']);
  assert.equal(news.latestArticleTimestamp(articles), '2026-11-16T03:00:00Z');
  assert.equal(news.hasUpdatedCoverage(articles), false);
  assert.equal(news.hasUpdatedCoverage([
    {
      id: 'a',
      publisher: 'GMA News',
      publishedAt: '2026-11-16T01:00:00Z',
      fetchedAt: '2026-11-16T03:00:00Z',
      createdAt: '2026-11-16T03:00:01Z',
      updatedAt: '2026-11-16T03:00:01Z',
    },
  ]), false);
  assert.equal(news.hasUpdatedCoverage([
    {
      id: 'a',
      publisher: 'GMA News',
      publishedAt: '2026-11-16T01:00:00Z',
      fetchedAt: '2026-11-16T03:00:00Z',
      createdAt: '2026-11-16T03:00:01Z',
      updatedAt: '2026-11-16T04:00:00Z',
    },
  ]), true);
});

test('stale source health requires every configured source to be overdue', () => {
  const now = new Date('2026-11-16T12:00:00Z');
  assert.equal(news.sourceFeedIsStale([], now), false);
  assert.equal(news.sourceFeedIsStale([
    { status: 'error', lastSuccessAt: '2026-11-16T01:00:00Z' },
    { status: 'error', lastSuccessAt: null },
  ], now), true);
  assert.equal(news.sourceFeedIsStale([
    { status: 'error', lastSuccessAt: '2026-11-16T01:00:00Z' },
    { status: 'success', lastSuccessAt: '2026-11-16T11:30:00Z' },
  ], now), false);
});

test('original links accept only credential-free HTTPS URLs', () => {
  assert.equal(news.safeHttpsUrl('https://example.com/report?id=1'), 'https://example.com/report?id=1');
  assert.equal(news.safeHttpsUrl('http://example.com/report'), null);
  assert.equal(news.safeHttpsUrl('javascript:alert(1)'), null);
  assert.equal(news.safeHttpsUrl('https://user:pass@example.com/report'), null);
  assert.equal(news.safeHttpsUrl('not a url'), null);
});
