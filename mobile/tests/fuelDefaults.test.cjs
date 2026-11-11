const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');
const { harness, find } = require('./componentHarness.cjs');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require: name => mocks[name] ?? {}, console });
  return exports;
}
const constants = load('constants/fuelTypes.ts');
const presentation = load('constants/fuelTypePresentation.ts', { '@/constants/fuelTypes': constants });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const car = (id, fuel, extra = {}) => ({ id, user_id: 'me', nickname: id, brand: 'Honda', model: 'City', fuel_type_id: fuel, archived_at: null, ...extra });
function pricesScreen(options = {}) {
  let vehicles = options.vehicles ?? [car('City', 'gas95'), car('Truck', 'diesel')];
  let user = { id: 'me' };
  let defaultId = options.defaultId ?? null;
  const selection = options.selection ?? load('lib/vehicleSelection.ts');
  if (options.selected) selection.selectSessionVehicle(user.id, options.selected);
  const queries = [], writes = [], defaultWrites = [], trends = [];
  const fuels = { gas95: 'RON_95', diesel: 'DIESEL', gas91: 'RON_91', gas97: 'RON_97', gas100: 'RON_100', dieselPlus: 'DIESEL_PLUS', kerosene: 'KEROSENE', unknown: 'Premium' };
  const fuel = load('lib/services/vehicleFuel.ts', {
    '@/constants/fuelTypes': constants,
    '@/lib/supabase': { supabase: { from: table => {
      assert.equal(table, 'fuel_types');
      return { select: () => ({ eq: (_, id) => ({ maybeSingle: () => options.lookup
        ? options.lookup(id)
        : Promise.resolve({ data: fuels[id] ? { code: fuels[id], name: fuels[id] } : null, error: null }) }) }) };
    } } },
  });
  const h = harness(path.join(root, 'app/(tabs)/prices/index.tsx'), {
    '@/constants/fuelTypePresentation': presentation,
    '@/components/ui/FuelTypeBadge': { __esModule: true, default: 'FuelTypeBadge' },
    'expo-router': { useRouter: () => ({ push() {} }) },
    '@/context/AuthProvider': { useAuth: () => ({ user }) },
    '@/context/TabBarVisibility': { useTabBarScrollHandler: () => () => {} },
    '@/hooks/useResponsive': { useResponsive: () => ({ isCompact: false }) },
    '@/lib/useTheme': { useTheme: () => ({}) },
    '@/lib/supabase': { isSupabaseConfigured: true },
    '@/constants/Theme': load('constants/Theme.ts'),
    '@/constants/regions': { DOE_REGIONS: [{ code: 'NCR', name: 'NCR' }] },
    '@/constants/fuelTypes': constants,
    '@/constants/communityReports': { VERIFY_CONFIRMATIONS_REQUIRED: 3 },
    '@/lib/format': { formatCurrency: n => `₱${n}`, formatBulletinRange: () => 'Oct 5', formatDate: () => '', formatShortDate: () => '' },
    '@/lib/services/location': { resolveCurrentPlace: async () => null, matchBulletinArea: () => null },
    '@/lib/officialCompanyRows': { buildOfficialDoeRows: () => [] },
    '@/lib/services/vehicleFuel': fuel,
    '@/lib/services/defaultVehicle': { fetchDefaultVehicleId: async () => defaultId, setDefaultVehicle: (...args) => defaultWrites.push(args) },
    '@/lib/vehicleSelection': selection,
    '@/lib/services/vehicles': {
      fetchTripVehicles: () => options.fetchVehicles ? options.fetchVehicles() : Promise.resolve(vehicles),
      updateVehicle: (...args) => writes.push(args),
    },
    '@/lib/services/fuelPrices': {
      fetchLatestBulletinForRegion: async () => ({ id: 'week', bulletin_date: '2026-10-05' }),
      fetchBulletinsForRegion: async () => [], fetchBulletinAreas: async () => [],
      fetchFuelPricesForBulletin: async (...args) => { queries.push(args); return []; },
      fetchPriceTrend: async (...args) => { trends.push(args); return []; }, getBulletinFreshness: () => ({ label: 'Current', tone: 'fresh' }),
    },
    '@/lib/services/communityReports': {
      fetchCommunityReports: async () => [], fetchPendingReports: async () => [],
      fetchFreshVerifiedPrices: async () => [], fetchFuelStationsByRegion: async () => [],
      fetchOilCompanies: async () => [], fetchConfirmedReportIds: async () => new Set(),
    },
  }, 'ios', { console }, { '@/hooks/useFuelPriceDefault': path.join(root, 'hooks/useFuelPriceDefault.ts') });
  return { h, selection, queries, writes, defaultWrites, trends,
    filter: () => find(h.tree, n => n.props?.label === 'Fuel'),
    setVehicles: list => { vehicles = list; },
    setUser: value => { user = value; },
    setDefaultId: value => { defaultId = value; },
  };
}
for (const [id, code] of [['City', 'RON_95'], ['Truck', 'DIESEL']]) {
  test(`Fuel Prices defaults selected ${id} to ${code}, labels its source and queries that exact fuel`, async () => {
    const s = pricesScreen({ selected: id }); await s.h.flush({});
    assert.equal(s.filter().props.value, code);
    assert(find(s.filter().props.context, n => Array.isArray(n.props?.children) && n.props.children.includes(id)));
    assert.equal(s.queries.at(-1)[2], code); s.h.unmount();
  });
}
test('manual filter is local, never mutates the vehicle, and survives focus refresh', async () => {
  const vehicle = Object.freeze(car('City', 'gas95'));
  const s = pricesScreen({ selected: 'City', vehicles: [vehicle] }); await s.h.flush({});
  s.filter().props.onChange('DIESEL'); await s.h.flush(); s.h.focus(); await s.h.flush();
  assert.equal(s.filter().props.value, 'DIESEL'); assert.equal(vehicle.fuel_type_id, 'gas95');
  assert.equal(s.selection.getSessionVehicleId('me'), 'City'); assert.equal(s.writes.length, 0);
  assert(!find(s.h.tree, n => Array.isArray(n.props?.children) && n.props.children.includes('Using ')));
  s.h.unmount();
});
test('meaningful vehicle change reapplies default, while unrelated focus preserves a manual filter', async () => {
  const s = pricesScreen({ selected: 'City' }); await s.h.flush({});
  s.filter().props.onChange('RON_91'); await s.h.flush();
  s.selection.selectSessionVehicle('me', 'Truck'); await s.h.flush();
  assert.equal(s.filter().props.value, 'DIESEL'); s.h.unmount();
});
for (const [name, vehicles, selected] of [
  ['missing fuel', [car('City', null)], 'City'], ['legacy missing field', [{ id: 'City' }], 'City'],
  ['unknown fuel code', [car('City', 'unknown')], 'City'], ['missing fuel row', [car('City', 'deleted')], 'City'],
  ['archived', [car('City', 'gas95', { archived_at: '2026-10-01' })], 'City'],
  ['revoked/removed with no owned fallback', [car('Truck', 'diesel', { user_id: 'other' })], 'City'], ['no vehicle', [], null],
]) test(`${name} falls back safely to the existing RON_91 filter`, async () => {
  const s = pricesScreen({ vehicles, selected }); await s.h.flush({});
  assert.equal(s.filter().props.value, 'RON_91'); s.h.unmount();
});
test('a shared selected vehicle uses its registered fuel', async () => {
  const s = pricesScreen({ selected: 'Shared', vehicles: [car('Shared', 'diesel', { user_id: 'owner' })] });
  await s.h.flush({}); assert.equal(s.filter().props.value, 'DIESEL'); s.h.unmount();
});
test('initial selection reuses owned order and an unavailable selection falls back to the first owned vehicle', async () => {
  const s = pricesScreen(); await s.h.flush({}); assert.equal(s.filter().props.value, 'RON_95');
  s.selection.selectSessionVehicle('me', 'deleted'); await s.h.flush();
  assert.equal(s.filter().props.value, 'RON_95'); s.h.unmount();
});
test('vehicle removal on focus clears the old default', async () => {
  const s = pricesScreen({ selected: 'City' }); await s.h.flush({});
  s.setVehicles([car('Truck', 'diesel')]); s.h.focus(); await s.h.flush();
  assert.equal(s.filter().props.value, 'DIESEL'); s.h.unmount();
});
test('manual choice during initial vehicle loading wins', async () => {
  const pending = deferred(); const s = pricesScreen({ fetchVehicles: () => pending.promise });
  await s.h.flush({}); s.filter().props.onChange('DIESEL'); await s.h.flush();
  pending.resolve([car('City', 'gas95')]); await s.h.flush();
  assert.equal(s.filter().props.value, 'DIESEL'); s.h.focus(); await s.h.flush();
  assert.equal(s.filter().props.value, 'DIESEL'); s.h.unmount();
});
test('manual choice during fuel lookup wins', async () => {
  const pending = deferred(); const s = pricesScreen({ lookup: () => pending.promise });
  await s.h.flush({}); s.filter().props.onChange('DIESEL'); await s.h.flush();
  pending.resolve({ data: { code: 'RON_95' }, error: null }); await s.h.flush();
  assert.equal(s.filter().props.value, 'DIESEL'); s.h.unmount();
});
test('rapid switches ignore an older fuel lookup, including a return to the original vehicle', async () => {
  const diesel = deferred();
  const s = pricesScreen({ selected: 'City', lookup: id => id === 'diesel' ? diesel.promise : Promise.resolve({ data: { code: 'RON_95' }, error: null }) });
  await s.h.flush({}); s.selection.selectSessionVehicle('me', 'Truck'); await s.h.flush();
  s.selection.selectSessionVehicle('me', 'City'); await s.h.flush();
  diesel.resolve({ data: { code: 'DIESEL' }, error: null }); await s.h.flush();
  assert.equal(s.filter().props.value, 'RON_95'); s.h.unmount();
});
test('same-fuel vehicle switching does not refetch prices', async () => {
  const s = pricesScreen({ selected: 'City', vehicles: [car('City', 'gas95'), car('Second', 'gas95')] });
  await s.h.flush({}); const before = s.queries.length;
  s.selection.selectSessionVehicle('me', 'Second'); await s.h.flush();
  assert.equal(s.queries.length, before); s.h.unmount();
});
test('account changes clear manual filter and old lookup cannot restore it', async () => {
  const pending = deferred(); const s = pricesScreen({ selected: 'City', lookup: () => pending.promise });
  await s.h.flush({}); s.filter().props.onChange('DIESEL'); await s.h.flush();
  s.setUser(null); await s.h.flush({});
  pending.resolve({ data: { code: 'RON_95' }, error: null }); await s.h.flush();
  assert.equal(s.filter().props.value, 'RON_91');
  s.h.unmount();
});
test('session selection is isolated by user and cleared on logout, with no persistence', () => {
  const store = load('lib/vehicleSelection.ts'); let updates = 0;
  const unsubscribe = store.subscribeVehicleSelection(() => updates++);
  store.selectSessionVehicle('a', 'City'); assert.equal(store.getSessionVehicleId('b'), null);
  store.selectSessionVehicle('a', 'City'); assert.equal(updates, 1);
  store.resetVehicleSelectionForUser(null); assert.equal(store.getSessionVehicleId('a'), null);
  unsubscribe(); store.selectSessionVehicle('b', 'Truck'); assert.equal(updates, 2);
});

test('lookup failure safely falls back without changing registered fuel', async () => {
  const s = pricesScreen({ selected: 'City', lookup: async () => ({ data: null, error: { message: 'network' } }) });
  await s.h.flush({}); assert.equal(s.filter().props.value, 'RON_91'); assert.equal(s.writes.length, 0); s.h.unmount();
});
test('a canceled focus load cannot overwrite a newer vehicle list', async () => {
  const old = deferred(); let calls = 0;
  const s = pricesScreen({ fetchVehicles: () => ++calls === 1 ? old.promise : Promise.resolve([car('Truck', 'diesel')]) });
  await s.h.flush({}); s.h.blur(); s.h.focus(); await s.h.flush();
  assert.equal(s.filter().props.value, 'DIESEL');
  old.resolve([car('City', 'gas95')]); await s.h.flush();
  assert.equal(s.filter().props.value, 'DIESEL'); s.h.unmount();
});
test('a fuel lookup canceled by blur is retried on focus and defaults correctly', async () => {
  const old = deferred(); let calls = 0;
  const s = pricesScreen({ lookup: () => ++calls === 1 ? old.promise : Promise.resolve({ data: { code: 'RON_95' }, error: null }) });
  await s.h.flush({}); s.h.blur(); s.h.focus(); await s.h.flush();
  old.resolve({ data: { code: 'DIESEL' }, error: null }); await s.h.flush();
  assert.equal(s.filter().props.value, 'RON_95'); s.h.unmount();
});
test('accessible vehicle service preserves archive and revoked-share filtering', async () => {
  const queries = [];
  const supabase = { from(table) {
    const query = { table, filters: [] }; queries.push(query);
    const q = {
      select: () => q, eq: (...args) => { query.filters.push(['eq', ...args]); return q; },
      is: (...args) => { query.filters.push(['is', ...args]); return q; },
      in: (...args) => { query.filters.push(['in', ...args]); return q; }, order: () => q,
      then(resolve) {
        const data = table === 'vehicle_shares' ? [{ vehicleID: 'shared', role: 'Driver' }]
          : query.filters.some(f => f[1] === 'user_id') ? [car('owned', 'gas95')]
          : [car('shared', 'diesel')];
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    }; return q;
  } };
  const service = load('lib/services/vehicles.ts', { '@/lib/supabase': { supabase } });
  const vehicles = await service.fetchTripVehicles('me');
  assert.deepEqual(Array.from(vehicles, v => [v.id, v.fuel_type_id]), [['owned', 'gas95'], ['shared', 'diesel']]);
  assert(queries.find(q => q.table === 'vehicle_shares').filters.some(f => f[0] === 'eq' && f[1] === 'revoked' && f[2] === false));
  assert(queries.filter(q => q.table === 'vehicles').every(q => q.filters.some(f => f[0] === 'is' && f[1] === 'archived_at' && f[2] === null)));
});

test('Fuel Prices prioritizes database default over current Trip vehicle and first owned vehicle', async () => {
  const s = pricesScreen({ defaultId: 'Truck', selected: 'City' }); await s.h.flush({});
  assert.equal(s.filter().props.value, 'DIESEL');
  assert.equal(s.selection.getSessionVehicleId('me'), 'City');
  s.selection.selectSessionVehicle('me', 'manual'); await s.h.flush();
  assert.equal(s.filter().props.value, 'DIESEL'); s.h.unmount();
});
test('manual Fuel Prices choice survives focus with the same persisted default and never writes it', async () => {
  const s = pricesScreen({ defaultId: 'Truck', selected: 'City' }); await s.h.flush({});
  s.filter().props.onChange('RON_95'); await s.h.flush(); s.h.focus(); await s.h.flush();
  assert.equal(s.filter().props.value, 'RON_95'); assert.equal(s.writes.length, 0);
  s.h.unmount();
});
test('changed database default is applied when Fuel Prices reopens', async () => {
  const s = pricesScreen({ defaultId: 'City' }); await s.h.flush({});
  s.h.blur(); s.setDefaultId('Truck'); s.h.focus(); await s.h.flush();
  assert.equal(s.filter().props.value, 'DIESEL'); s.h.unmount();
});
test('archived, shared and inaccessible profile defaults are ignored', async () => {
  for (const defaultId of ['archived', 'shared', 'removed']) {
    const s = pricesScreen({ defaultId, vehicles: [
      car('owned', 'gas95'), car('archived', 'diesel', { archived_at: '2026-10-01' }),
      car('shared', 'diesel', { user_id: 'owner' }),
    ] }); await s.h.flush({}); assert.equal(s.filter().props.value, 'RON_95'); s.h.unmount();
  }
});
test('unselected shared-only list does not silently become account default context', async () => {
  const s = pricesScreen({ vehicles: [car('shared', 'diesel', { user_id: 'owner' })] });
  await s.h.flush({}); assert.equal(s.filter().props.value, 'RON_91'); s.h.unmount();
});

function renderFuelFilter(screen) {
  const h = harness(path.join(root, 'components/prices/FuelTypeFilter.tsx'), {
    '@/constants/fuelTypes': constants, '@/constants/Theme': load('constants/Theme.ts'),
    '@/constants/fuelTypePresentation': presentation,
    '@/hooks/useResponsive': { useResponsive: () => ({ width: 390, isCompact: false }) },
    '@/hooks/useReducedMotion': { useReducedMotion: () => true },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
  });
  return { h, sync: () => h.flush(screen.filter().props),
    more: () => find(h.tree, n => n.props?.accessibilityState?.expanded !== undefined),
    async selectMore(code) {
      this.more().props.onPress(); await this.sync();
      const list = find(h.tree, n => n.type === 'FlatList');
      list.props.renderItem({ item: list.props.data.find(f => f.code === code) }).props.onPress();
      await screen.h.flush(); await this.sync();
    },
  };
}
for (const [fuel, code, label] of [
  ['gas91', 'RON_91', 'RON 91'], ['gas95', 'RON_95', 'RON 95'], ['diesel', 'DIESEL', 'Diesel'],
  ['gas97', 'RON_97', 'RON 97'], ['gas100', 'RON_100', 'RON 100'],
  ['dieselPlus', 'DIESEL_PLUS', 'Diesel Plus'], ['kerosene', 'KEROSENE', 'Kerosene'],
]) test(`Default Vehicle ${label} initializes Fuel Prices with an exact, visibly selected fuel`, async () => {
  const vehicle = Object.freeze(car('Default', fuel));
  const s = pricesScreen({ vehicles: [vehicle], defaultId: 'Default' }); await s.h.flush({});
  const filter = renderFuelFilter(s); await filter.sync();
  assert.equal(s.filter().props.value, code);
  const context=s.filter().props.context;
  assert(context.props.accessibilityLabel.endsWith(` · ${label}`));
  assert(find(context,n=>Array.isArray(n.props?.style)&&n.props.style.some(style=>style?.backgroundColor===presentation.getFuelTypePresentation(code).accent)),'Default Vehicle context must retain the shared fuel color');
  const selected = find(filter.h.tree, n => n.props?.accessibilityState?.selected && n.props.accessibilityLabel?.startsWith(`Fuel: ${label}`));
  assert(selected, `Selected ${label} must be visible without opening More`);
  assert.equal(s.queries.at(-1)[2], code); assert.equal(s.trends.at(-1)[1], code);
  assert.equal(vehicle.fuel_type_id, fuel); assert.equal(s.defaultWrites.length, 0);
  filter.h.unmount(); s.h.unmount();
});
test('selecting More changes exact price/history queries, stays visible, survives focus, and changes no vehicle preference', async () => {
  const vehicle = Object.freeze(car('Default', 'gas95'));
  const s = pricesScreen({ vehicles: [vehicle], defaultId: 'Default' }); await s.h.flush({});
  const filter = renderFuelFilter(s); await filter.sync(); await filter.selectMore('RON_97');
  assert.equal(s.queries.at(-1)[2], 'RON_97'); assert.equal(s.trends.at(-1)[1], 'RON_97');
  assert.equal(filter.more().props.children[0].props.children, 'RON 97');
  assert.equal(find(filter.h.tree, n => n.type === 'Modal'), null);
  s.h.focus(); await s.h.flush(); await filter.sync();
  assert.equal(s.filter().props.value, 'RON_97'); assert.equal(vehicle.fuel_type_id, 'gas95');
  assert.equal(s.writes.length, 0); assert.equal(s.defaultWrites.length, 0);
  filter.h.unmount(); s.h.unmount();
});
test('supported More fuel with no DOE records remains selected and uses the existing empty state', async () => {
  const s = pricesScreen({ vehicles: [], defaultId: null }); await s.h.flush({});
  const filter = renderFuelFilter(s); await filter.sync(); await filter.selectMore('KEROSENE');
  assert.equal(s.filter().props.value, 'KEROSENE');
  assert.equal(s.queries.at(-1)[2], 'KEROSENE'); assert.equal(s.trends.at(-1)[1], 'KEROSENE');
  assert(find(s.h.tree, n => n.props?.children === 'No DOE prices for these filters. Try another area or fuel type.'));
  assert.equal(filter.more().props.children[0].props.children, 'Kerosene');
  filter.h.unmount(); s.h.unmount();
});
