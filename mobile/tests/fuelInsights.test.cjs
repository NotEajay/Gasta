const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');
const { harness, find } = require('./componentHarness.cjs');
function load(file, mocks = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: name => {
    if (!(name in mocks)) throw Error(`Missing mock ${name}`);
    return mocks[name];
  }, Date, console });
  return exports;
}
const format = load('lib/format.ts');
const model = load('lib/fuelInsights.ts', { '@/lib/format': format });
const row = (amount = 600, label = 'Daily drive', count = 1) => ({
  vehicleId: label, label, brand: 'Toyota', model: 'Vios', year: 2024, actualSpend: amount,
  attributedLiters: null, relevantRefillCount: count, refillsWithLitersCount: 0,
  loggedTripCount: 3, loggedDistanceKm: 70, estimatedTripCost: 99999,
});
const budget = { year: 2026, month: 11, limit_amount: 1000, alert_threshold_percent: 90 };
const month = (m, amount, extra = {}) => ({ year: 2026, month: m, period: m === 11 ? 'current' : 'complete',
  available: true, actualSpend: amount, refillCount: amount > 0 ? 1 : 0,
  vehicles: amount > 0 ? [row(amount)] : [], budget: null, budgetAvailable: true, ...extra });
const insight = (months, key) => model.buildFuelInsights(months).find(item => item.key === key);

test('completed-month comparison excludes the unfinished current month and preserves exact pesos', () => {
  const item = insight([month(11, 9999), month(10, 800.25), month(9, 1000.25)], 'spending');
  assert.equal(item.title, '20.0% less recorded');
  assert.equal(item.summary, '₱800.25 vs ₱1,000.25');
  assert(item.detail.includes('₱800.25 vs ₱1,000.25'));
  assert.equal(item.period, 'Oct 1–31, 2026 vs Sep 1–30, 2026');
  assert.equal(item.month, 10);
});
test('a selected completed month compares that month against its predecessor', () => {
  const item = insight([month(10, 1200), month(9, 1000), month(8, 50)], 'spending');
  assert.equal(item.title, '20.0% more recorded');
  assert(item.period.startsWith('Oct'));
});
test('missing history never manufactures a 100 percent decrease or divides by zero', () => {
  for (const months of [[month(11, 0), month(10, 0), month(9, 300)], [month(11, 1), month(10, 300), month(9, 0)]]) {
    const item = insight(months, 'spending');
    assert(!item.title.includes('%')); assert(!/Infinity|NaN/.test(item.title + item.detail));
  }
  assert.equal(insight([month(11, 0)], 'spending').title, 'Not enough history yet');
});
test('a failed historical read is unavailable, never interpreted as zero', () => {
  const item = insight([month(11, 100), month(10, null, { available: false }), month(9, 900)], 'spending');
  assert.equal(item.title, 'Comparison unavailable');
  assert(!item.detail.includes('₱0'));
});
test('equal spending and a zero-amount baseline produce finite truthful statements', () => {
  assert.equal(insight([month(10, 20), month(9, 20)], 'spending').title, 'Recorded spending stayed the same');
  const item = insight([month(10, 20), month(9, 0, { refillCount: 1 })], 'spending');
  assert.equal(item.title, '₱20 more recorded');
});
test('budget insight uses accepted spending and the saved alert threshold, excluding trip estimates', () => {
  const months = [month(11, 850, { budget, vehicles: [row(850)] })];
  let item = insight(months, 'budget');
  assert.equal(item.tone, 'neutral'); assert.equal(item.title, '₱150 left in your budget');
  assert(item.detail.includes('85% used')); assert(!item.detail.includes('99999'));
  item = insight([month(11, 900, { budget })], 'budget'); assert.equal(item.tone, 'caution');
  assert.equal(insight([month(11, 1000, { budget })], 'budget').title, 'Budget reached');
  assert.equal(insight([month(11, 1100, { budget })], 'budget').title, '₱100 over budget');
});
test('unavailable budget data is distinct from an unset budget', () => {
  assert.equal(insight([month(11, 100)], 'budget').title, 'No budget set');
  assert.equal(insight([month(11, 100, { budgetAvailable: false })], 'budget').title, 'Budget status unavailable');
});
test('largest vehicle uses only the accepted share, with stable tie ordering', () => {
  let item = insight([month(11, 1000, { vehicles: [row(400, 'Car'), row(600, 'Van')] })], 'vehicle');
  assert.equal(item.title, 'Van'); assert(item.detail.includes('₱600 · 60.0%')); assert.equal(item.summary, '₱600 · 60.0%');
  item = insight([month(11, 1000, { vehicles: [row(500, 'Van'), row(500, 'Car')] })], 'vehicle');
  assert.equal(item.title, 'Car');
});
test('month ranges handle year rollover and leap days; future months are never compared as complete', () => {
  assert.deepEqual(Array.from(model.recentMonths(2026, 1, 3), m => `${m.year}-${m.month}`), ['2026-1', '2025-12', '2025-11']);
  assert.equal(model.monthRange(2024, 2), 'Feb 1–29, 2024');
  assert.equal(model.monthRange(2025, 2), 'Feb 1–28, 2025');
  assert.equal(model.recentMonths(2026, 11, 99).length, 6);
  const item = insight([month(12, 0, { period: 'future' }), month(11, 20), month(10, 80)], 'spending');
  assert.equal(item.title, 'Not enough history yet');
});
test('history route dates reject malformed, array and out-of-range params', () => {
  for (const [year, month] of [['x', '11'], ['2026', '13'], ['2026', '0'], ['2026', '1e1'], [['2026'], '11'], ['1899', '11']]) {
    assert.equal(model.parseInsightPeriod(year, month), null);
  }
  assert.equal(model.parseInsightPeriod('2026', '11').month, 11);
});

function service({ failures = [], budgetFailure = false, noTotals = false, mismatch = false } = {}) {
  const calls = [];
  const analytics = load('lib/services/budgetAnalytics.ts', {
    '@/lib/supabase': { supabase: { rpc: async (name, args) => {
      calls.push({ name, args });
      if (failures.includes(args.p_month)) return { data: null, error: { code: '42883', message: 'private database details' } };
      return { data: [
        { row_kind: 'vehicle', vehicle_id: 'v', nickname: 'Daily drive', actual_spend: 400, relevant_refill_count: 1 },
        ...noTotals ? [] : [{ row_kind: 'total', actual_spend: mismatch ? 800 : 400, relevant_refill_count: 1,
          logged_trip_count: 5, logged_distance_km: 100, estimated_trip_cost: 99999 }],
      ], error: null };
    } } },
  });
  const api = load('lib/services/fuelInsights.ts', {
    '@/lib/fuelInsights': model,
    '@/lib/services/budgetAnalytics': analytics,
    '@/lib/services/budgets': { fetchBudgets: async user => { assert.equal(user, 'me'); if (budgetFailure) throw Error('private'); return [budget]; } },
  });
  return { ...api, calls };
}
test('service uses bounded caller-scoped monthly RPCs, even without any budget rows for older months', async () => {
  const env = service(); const result = await env.fetchFuelInsightHistory('me', 2026, 11, 6, new Date('2026-11-06T10:00:00Z'));
  assert.equal(env.calls.length, 6); assert(env.calls.every(c => c.name === 'monthly_budget_analytics'));
  assert(env.calls.every(c => !('user_id' in c.args) && !('p_user_id' in c.args)));
  assert.equal(result[0].actualSpend, 400); assert.equal(result[0].period, 'current');
  assert.equal(result[1].budget, null); assert.equal(result[1].available, true);
});
test('one failed month preserves the others and never leaks a technical error', async () => {
  const env = service({ failures: [10] }); const result = await env.fetchFuelInsightHistory('me', 2026, 11, 3);
  assert.equal(result[1].available, false); assert.equal(result[1].actualSpend, null);
  assert.equal(result[0].actualSpend, 400); assert.equal(result[2].actualSpend, 400);
  assert(!JSON.stringify(result).includes('private'));
});
test('missing totals and totals that do not reconcile cannot support insights', async () => {
  for (const config of [{ noTotals: true }, { mismatch: true }]) {
    const result = await service(config).fetchFuelInsightHistory('me', 2026, 11, 1);
    assert.equal(result[0].available, false); assert.equal(result[0].actualSpend, null);
  }
});
test('budget fetch failure preserves actual spending but does not claim there is no budget', async () => {
  const [result] = await service({ budgetFailure: true }).fetchFuelInsightHistory('me', 2026, 11, 1);
  assert.equal(result.actualSpend, 400); assert.equal(result.budgetAvailable, false);
});
test('invalid service inputs make no backend calls', async () => {
  const env = service(); await assert.rejects(env.fetchFuelInsightHistory('', 2026, 11));
  await assert.rejects(env.fetchFuelInsightHistory('me', 2026, 99)); assert.equal(env.calls.length, 0);
});

const theme = load('constants/Theme.ts');
const text = node => Array.isArray(node) ? node.map(text).join(' ') : typeof node === 'string' ? node : node && typeof node === 'object' ? text(node.props?.children) : '';
function panel(fetch) {
  return harness(path.join(__dirname, '../components/insights/FuelInsightsPanel.tsx'), {
    '@/constants/Theme': theme, '@/lib/fuelInsights': model, '@/lib/format': format,
    '@/lib/services/fuelInsights': { fetchFuelInsightHistory: fetch },
  });
}
test('panel links an insight to its actual period and hides old-account data while a new request is pending', async () => {
  let resolve;
  const pending = new Promise(r => resolve = r); const opened = [];
  const h = panel(user => user === 'one' ? Promise.resolve([month(11, 600), month(10, 800), month(9, 1000)]) : pending);
  const props = { userId: 'one', year: 2026, month: 11, onViewHistory: (...args) => opened.push(args) };
  await h.flush(props); assert(text(h.tree).includes('20.0% less recorded'));
  find(h.tree, n => n.props?.accessibilityLabel?.startsWith('Spending change:')).props.onPress();
  assert.deepEqual(opened[0], [2026, 10]);
  await h.flush({ ...props, userId: 'two' }); assert(!text(h.tree).includes('20.0% less recorded'));
  assert(text(h.tree).includes('Loading your fuel history'));
  resolve([month(11, 0)]); await h.flush(); assert(!text(h.tree).includes('20.0% less recorded'));
});
test('unmounted/blurred requests do not overwrite a newer period', async () => {
  let resolveOld; const old = new Promise(resolve => resolveOld = resolve);
  const h = panel((user, year, monthNumber) => monthNumber === 11 ? old : Promise.resolve([month(10, 123)]));
  await h.flush({ userId: 'one', year: 2026, month: 11 });
  await h.flush({ userId: 'one', year: 2026, month: 10 });
  assert(text(h.tree).includes('₱123'));
  resolveOld([month(11, 9999)]); await h.flush(); assert(!text(h.tree).includes('₱9,999'));
});
test('history distinguishes an unavailable month from a recorded zero and opens the selected month', async () => {
  const selected = [];
  const h = panel(async () => [month(11, 0), month(10, null, { available: false })]);
  await h.flush({ userId: 'one', year: 2026, month: 11, mode: 'history', onSelectMonth: (...args) => selected.push(args) });
  assert(text(h.tree).includes('Unavailable')); assert(text(h.tree).includes('No refills recorded'));
  const failed = find(h.tree, n => n.props?.accessibilityLabel === 'View budget for Oct 2026. Unavailable.');
  assert(failed); failed.props.onPress(); assert.deepEqual(selected[0], [2026, 10]);
});

test('compact Home preview shows spending and vehicle tiles while full Budget history retains budget status', async () => {
  const h = panel(async () => [month(11, 600, { budget }), month(10, 800), month(9, 1000)]);
  await h.flush({ userId: 'one', year: 2026, month: 11, compact: true, onViewHistory() {} });
  assert(text(h.tree).includes('20.0% less recorded')); assert(text(h.tree).includes('Daily drive'));
  assert(!text(h.tree).includes('Budget status')); assert(find(h.tree, n => n.props?.accessibilityLabel === 'View fuel insight history'));
  await h.flush({ userId: 'one', year: 2026, month: 11, mode: 'history' });
  assert(text(h.tree).includes('Budget status')); assert(text(h.tree).includes('₱400 left in your budget'));
});
test('compact empty history uses one clear starting state without invented figures', async () => {
  const h = panel(async () => [month(11, 0), month(10, 0), month(9, 0)]);
  await h.flush({ userId: 'one', year: 2026, month: 11, compact: true, onViewHistory() {} });
  assert(text(h.tree).includes('Your story starts with a refill'));
  assert(!text(h.tree).includes('₱0')); assert(!text(h.tree).includes('% less'));
});

test('highlight shows one completed-month observation with its original history destination', async () => {
  const opened = [];
  const h = panel(async () => [month(11, 600, { budget }), month(10, 800), month(9, 1000)]);
  await h.flush({ userId: 'one', year: 2026, month: 11, compact: true, highlight: true, onViewHistory: (...args) => opened.push(args) });
  assert(text(h.tree).includes('20.0% less recorded'));
  assert(!text(h.tree).includes('Top vehicle')); assert(!text(h.tree).includes('Budget status'));
  find(h.tree, n => n.props?.accessibilityLabel?.startsWith('Spending change:')).props.onPress();
  assert.deepEqual(opened[0], [2026, 10]);
});
test('highlight can show a vehicle observation when completed-month comparison is unavailable', async () => {
  const h = panel(async () => [month(11, 600), month(10, null, { available: false }), month(9, 1000)]);
  await h.flush({ userId: 'one', year: 2026, month: 11, compact: true, highlight: true, onViewHistory() {} });
  assert(text(h.tree).includes('Daily drive'));
  assert(!text(h.tree).includes('% less')); assert(!text(h.tree).includes('Budget status'));
});
