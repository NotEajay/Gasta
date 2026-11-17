const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');
const { harness, find } = require('./componentHarness.cjs');
function moduleAt(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports }); return exports;
}
const theme = moduleAt('constants/Theme.ts');
const format = moduleAt('lib/format.ts');
const user = { id: 'me', email: 'alex@example.test', user_metadata: { full_name: 'Alex Rivera' } };
const baseBudget = { hasBudget: true, limitAmount: 5000, spent: 1250, estimatedTripSpend: 99999,
  remaining: 3750, overBy: 0, progress: 0.25, status: 'ok', actualUnavailable: false };
const basePrice = { price: 65.5, stationName: 'Petron', source: 'doe', regionCode: 'NCR', fuelCode: 'RON_91',
  isRegionFallback: true, isFuelFallback: true, isNearbyRecommended: false, distanceKm: null,
  bulletinDate: '2026-10-05', vsLastBulletin: -0.5, savingsOnFill: null, runnersUp: [] };
const vehicle = { id: 'car', nickname: 'Daily drive', brand: 'Toyota', model: 'Vios',
  fuel_type_id: 'gas', fuel_efficiency_km_per_liter: 14, last_refill_price: 65.5, last_refill_at: '2026-11-05T10:00:00Z' };
const baseNews = [
  { id: 'news-1', headline: 'Diesel prices roll back Tuesday', publisher: 'Publisher One', canonicalUrl: 'https://publisher.example/one' },
  { id: 'news-2', headline: 'Fuel firms announce new pump prices', publisher: 'Publisher Two', canonicalUrl: 'https://publisher.example/two' },
  { id: 'news-3', headline: 'Weekly fuel price update', publisher: 'Publisher Three', canonicalUrl: 'https://publisher.example/three' },
];
function setup({ budget = baseBudget, price = basePrice, vehicles = [vehicle], trips = [], news = baseNews, newsError = null, desktop = false } = {}) {
  const pushed = [], navigated = []; const router = { push: value => pushed.push(value), navigate: value => navigated.push(value) };
  const h = harness(path.join(__dirname, '../app/(tabs)/home.tsx'), {
    '@/constants/Theme': theme, '@/lib/format': format,
    '@/components/ExternalLink': { ExternalLink: 'ExternalLink' },
    'expo-router': { useRouter: () => router },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 20 }) },
    '@/app/(tabs)/_layout': { floatingNavContentInset: value => 100 + value },
    '@/context/AuthProvider': { useAuth: () => ({ user, loading: false }) },
    '@/context/TabBarVisibility': { useTabBarScrollHandler: () => () => {} },
    '@/hooks/useResponsive': { useResponsive: () => ({ width: desktop ? 1440 : 390, isDesktop: desktop, contentMaxWidth: desktop ? 1120 : 359, horizontalPadding: desktop ? 48 : 24 }) },
    '@/lib/supabase': { isSupabaseConfigured: true },
    '@/constants/regions': { DOE_REGIONS: [{ code: 'NCR', name: 'National Capital Region' }] },
    '@/constants/fuelTypes': { DOE_FUEL_TYPES: [{ code: 'RON_91', name: 'RON 91' }] },
    '@/lib/services/fuelPrices': { getBulletinFreshness: () => ({ status: 'stale', label: 'Older bulletin' }) },
    '@/lib/services/dashboard': { DASHBOARD_REGION: 'NCR', DASHBOARD_FUEL_TYPE: 'RON_91', DASHBOARD_RECO_FILL_LITERS: 40,
      fetchDashboardBudgetSummary: async () => budget, fetchDashboardPendingSummary: async () => ({ count: 1, total: 250 }),
      fetchDashboardPriceSummary: async () => price, fetchRecentUserReports: async () => [], resolveVehicleFuelCode: async () => 'RON_91' },
    '@/lib/services/location': { resolveCurrentPlace: async () => null },
    '@/lib/services/fuelNews': { fetchFuelNewsPreview: async () => {
      if (newsError) throw newsError;
      return news;
    } },
    '@/lib/services/trips': { fetchRecentTrips: async () => trips },
    '@/lib/services/vehicles': { fetchVehicles: async () => vehicles },
  });
  return { h, pushed, navigated, async ready() { await h.flush({}); await h.flush(); } };
}
const text = node => Array.isArray(node) ? node.map(text).join(' ') : typeof node === 'string' ? node : node && typeof node === 'object' ? text(node.props?.children) : '';
const all = (tree, predicate, found = []) => {
  if (Array.isArray(tree)) { for (const node of tree) all(node, predicate, found); return found; }
  if (!tree || typeof tree !== 'object') return found;
  if (predicate(tree)) found.push(tree);
  all(tree.props?.children, predicate, found);
  return found;
};
const byLabel = (h, label) => find(h.tree, node => node.props?.accessibilityLabel === label);

test('phone Home uses the full viewport with one gutter and puts fuel prices and two primary actions before spending', async () => {
  const env = setup(); await env.ready();
  assert.equal(env.h.tree.type, 'ScrollView');
  const content = env.h.tree.props.contentContainerStyle;
  assert.equal(content.at(-1).maxWidth, 390); assert.equal(content.at(-1).paddingHorizontal, 20);
  const body = text(env.h.tree); assert(body.indexOf('FUEL PRICE WATCH') < body.indexOf('Plan a trip'));
  assert(body.indexOf('Log refill') < body.indexOf('Your spending'));
  const actions = find(env.h.tree, node => node.props?.testID === 'home-quick-actions');
  assert.equal(actions.props.children.length, 2);
  assert(body.includes('₱1,250')); assert(body.includes('₱3,750')); assert(!body.includes('99,999'));
  assert(find(env.h.tree, node => node.props?.compact === true && node.props?.highlight === true));
});
test('fuel news stays compact, caps rows, and links each whole row directly to its publisher', async () => {
  const news = [...baseNews, { id: 'news-4', headline: 'Must be capped', publisher: 'Publisher Four', canonicalUrl: 'https://publisher.example/four' }];
  const env = setup({ news }); await env.ready();
  const section = find(env.h.tree, node => node.props?.testID === 'home-fuel-news');
  const body = text(section);
  const links = all(section, node => node.type === 'ExternalLink');
  assert.equal(links.length, 3);
  assert.deepEqual(links.map(node => node.props.href), baseNews.map(item => item.canonicalUrl));
  assert(links.every(node => node.props.accessibilityRole === 'link' && /in browser$/.test(node.props.accessibilityLabel)));
  assert(links.every(node => node.props.accessibilityHint === 'Opens the original publisher article'));
  const rows = all(section, node => node.props?.testID === 'home-fuel-news-row');
  assert.equal(rows.length, 3);
  assert(rows.every(node => Array.isArray(node.props.style) && node.props.style[0].width === '100%'));
  assert.equal(rows.filter(node => node.props.style[1]).length, 2);
  assert.equal(all(section, node => node.type === 'Ionicons' && node.props?.name === 'open-outline').length, 3);
  assert(body.includes('Fuel news'));
  for (const item of baseNews) { assert(body.includes(item.headline)); assert(body.includes(item.publisher)); }
  assert(!body.includes('Must be capped'));
  for (const forbidden of ['excerpt', 'Published', 'Effective', 'View all', 'Read more', '₱/L']) assert(!body.includes(forbidden));
});

test('fuel news distinguishes successful empty results from schema or query failure', async () => {
  const empty = setup({ news: [] }); await empty.ready();
  assert(text(empty.h.tree).includes('No fuel news yet'));
  assert(!text(empty.h.tree).includes('Fuel news unavailable'));

  const failed = setup({ newsError: new Error('fuel_news_events missing') }); await failed.ready();
  assert(text(failed.h.tree).includes('Fuel news unavailable'));
  assert(text(failed.h.tree).includes('FUEL PRICE WATCH'));
  assert(text(failed.h.tree).includes('Your spending'));
});

test('fuel news follows quick actions and precedes phone spending and desktop recent activity', async () => {
  const phone = setup(); await phone.ready();
  const phoneBody = text(phone.h.tree);
  assert(phoneBody.indexOf('Log refill') < phoneBody.indexOf('Fuel news'));
  assert(phoneBody.indexOf('Fuel news') < phoneBody.indexOf('Your spending'));

  const desktop = setup({ desktop: true }); await desktop.ready();
  const desktopBody = text(desktop.h.tree);
  assert(desktopBody.indexOf('Log refill') < desktopBody.indexOf('Fuel news'));
  assert(desktopBody.indexOf('Fuel news') < desktopBody.indexOf('Recent activity'));
});

test('all main shortcuts, profile, pending shares and price actions keep their routes', async () => {
  const env = setup(); await env.ready();
  for (const [label, route] of [['Log refill', '/(tabs)/vehicles'], ['Plan a trip', '/(tabs)/trip'], ['View budget', '/(tabs)/budget'], ['Review pending refill responsibility', '/(tabs)/vehicles'], ['See all fuel prices', '/(tabs)/prices']]) {
    byLabel(env.h, label).props.onPress(); assert.equal(env.pushed.at(-1), route);
  }
  byLabel(env.h, 'Open your profile').props.onPress(); assert.equal(env.navigated.at(-1), '/(tabs)/profile');
});
test('insight preview still opens the selected history period', async () => {
  const env = setup(); await env.ready();
  const preview = find(env.h.tree, node => node.props?.compact === true);
  preview.props.onViewHistory(2026, 10);
  assert.equal(env.pushed[0].pathname, '/(tabs)/budget');
  assert.equal(env.pushed[0].params.view, 'history'); assert.equal(env.pushed[0].params.month, '10');
});
test('unavailable spending never becomes a displayed zero; missing prices and vehicles keep working entry points', async () => {
  const env = setup({ budget: null, price: null, vehicles: [] }); await env.ready();
  assert(text(env.h.tree).includes('Spending unavailable')); assert(!text(env.h.tree).includes('₱0'));
  byLabel(env.h, 'Browse fuel prices').props.onPress(); assert.equal(env.pushed.at(-1), '/(tabs)/prices');
  byLabel(env.h, 'Add your first vehicle').props.onPress(); assert.equal(env.pushed.at(-1), '/(tabs)/vehicles');
});
test('fuel price preview keeps source, date freshness and fallback qualifiers', async () => {
  const env = setup(); await env.ready(); const body = text(env.h.tree);
  for (const expected of ['DOE bulletin estimate', 'Older bulletin', 'reference', "not your vehicle's fuel", '₱65.50']) assert(body.includes(expected));
  const community = setup({ price: { ...basePrice, source: 'community', bulletinDate: null, isFuelFallback: false, isRegionFallback: false, isNearbyRecommended: true, distanceKm: 0.8 } });
  await community.ready(); assert(text(community.h.tree).includes('Verified community price')); assert.match(text(community.h.tree), /800 m\s+away/);
});
test('recent activity still expands and collapses after the layout change', async () => {
  const trips = Array.from({ length: 6 }, (_, i) => ({ id: String(i), created_at: `2026-11-0${i + 1}T10:00:00Z`,
    origin_label: `Start ${i}`, destination_label: 'Work', distance_km: 20, recommended_mode_code: 'OWN_VEHICLE' }));
  const env = setup({ trips, desktop: true }); await env.ready();
  assert(text(env.h.tree).includes('Start 5')); assert(!text(env.h.tree).includes('Start 0'));
  byLabel(env.h, 'View 4 more activities').props.onPress(); await env.h.flush(); assert(text(env.h.tree).includes('Start 0'));
  byLabel(env.h, 'Show fewer activities').props.onPress(); await env.h.flush(); assert(!text(env.h.tree).includes('Start 0'));
});
