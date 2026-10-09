const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');
const { harness, find } = require('./componentHarness.cjs');
const root = path.resolve(__dirname, '..');
function modules(mocks = {}) {
  const cache = {};
  function load(name) {
    if (name in mocks) return mocks[name];
    if (name in cache) return cache[name];
    const file = path.join(root, name.replace(/^@\//, '') + '.ts');
    const exports = cache[name] = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText, { exports, require: load, Date, console, Number, Error });
    return exports;
  }
  return load;
}
const load = modules();
const mcda = load('@/lib/mcda');
const calculator = load('@/lib/tripCalculator');
const weights = { fuelCost: .6, travelTime: .4 };
const input = { distanceKm: 28, fuelPricePerLiter: 70, fuelEfficiencyKmPerLiter: 14, weights, ownVehicleTravelTimeMinutes: 40 };
test('fuel units, unrounded formula, route duration, ranking and vehicle change', () => {
  const result = calculator.calculateTripRecommendation(input);
  const own = result.evaluations.find(row => row.modeCode === 'OWN_VEHICLE');
  assert.equal(own.raw.fuelCost, 140); assert.equal(own.raw.travelTime, 40);
  assert.equal(result.recommended, result.evaluations[0]);
  const next = calculator.calculateTripRecommendation({ ...input, distanceKm: 29, fuelEfficiencyKmPerLiter: 12 });
  assert.equal(next.evaluations.find(row => row.modeCode === 'OWN_VEHICLE').raw.fuelCost, 29 / 12 * 70);
  assert(result.evaluations.every(row => Number.isFinite(row.weightedScore)));
});
test('equal criteria and single mode normalize without division by zero; ties stay stable', () => {
  const modes = ['OWN_VEHICLE', 'JEEPNEY'].map(modeCode => ({ modeCode, fuelCost: 50, travelTime: 10 }));
  const scores = mcda.evaluateModes(modes, weights);
  assert(scores.every(row => row.weightedScore === 1));
  assert.equal(mcda.getRecommendedMode(scores), 'OWN_VEHICLE');
  assert.equal(mcda.evaluateModes([modes[0]], weights)[0].weightedScore, 1);
  assert.equal(mcda.normalizeCriterion(20, 10, 30), .5);
});
test('invalid/zero efficiency, non-finite numbers, overflow and malformed weights fail safely', () => {
  for (const value of [0, -1, NaN, Infinity]) {
    assert.throws(() => calculator.calculateTripRecommendation({ ...input, fuelEfficiencyKmPerLiter: value }));
  }
  assert.throws(() => calculator.calculateTripRecommendation({ ...input, fuelPricePerLiter: Infinity }));
  assert.throws(() => calculator.calculateTripRecommendation({ ...input, fuelEfficiencyKmPerLiter: 1e-308, fuelPricePerLiter: 1e308 }));
  for (const invalid of [{ fuelCost: -1, travelTime: 2 }, { fuelCost: .8, travelTime: .8 }, { fuelCost: NaN, travelTime: 1 }]) {
    assert.equal(mcda.weightsSumToOne(invalid), false);
    assert.throws(() => calculator.calculateTripRecommendation({ ...input, weights: invalid }));
  }
});
function priceResolver({ bulletin = { id: 'week', bulletin_date: '2026-10-05' }, bulletinError = false, verified = [], area = [75], region = [60] } = {}) {
  const calls = [];
  const resolve = modules({
    '@/lib/supabase': { supabase: { from: table => { assert.equal(table, 'fuel_types'); return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { code: 'RON_91', name: 'Gasoline' }, error: null }) }) }) }; } } },
    '@/lib/services/communityReports': { fetchFreshVerifiedPrices: async (...args) => { calls.push(['verified', ...args]); return verified; } },
    '@/lib/services/fuelPrices': {
      fetchLatestBulletinForRegion: async () => { if (bulletinError) throw Error('raw DB error'); return bulletin; },
      fetchFuelPricesForBulletin: async (id, regionCode, fuel, areaName) => { calls.push(['doe', id, regionCode, fuel, areaName]); return (areaName ? area : region).map(price_per_liter => ({ price_per_liter })); },
    },
  })('@/lib/services/tripFuelPrice').resolveTripFuelPrice;
  return { resolve: () => resolve({ fuelTypeId: 'fuel', regionCode: 'NCR', areaName: 'Quezon City', now: new Date('2026-10-09T00:00:00Z') }), calls };
}
test('DOE area beats region; invalid prices cannot become estimates', async () => {
  assert.equal((await priceResolver().resolve()).price.pricePerLiter, 75);
  const regional = await priceResolver({ area: [NaN, Infinity, 0] }).resolve();
  assert.equal(regional.price.source, 'doe_region'); assert.equal(regional.price.pricePerLiter, 60);
});
for (const [name, overrides] of [['normal', {}], ['no bulletin', { bulletin: null }], ['bulletin failure', { bulletinError: true }]]) {
  test(`fresh verified community beats DOE (${name}), without claiming an exact branch/locality`, async () => {
    const result = await priceResolver({ ...overrides, verified: [{ reported_price: 80, verified_at: '2026-10-08T00:00:00Z', station_name: 'Quezon City Road' }] }).resolve();
    assert.equal(result.price.source, 'community_verified'); assert.equal(result.price.pricePerLiter, 80);
    assert.equal(result.price.locality, 'region'); assert.equal(result.price.areaName, null);
    assert.equal(result.price.bulletinDate, null); assert.match(result.price.detail, /verified Oct 8/);
  });
}
test('pending and stale reports stay outside the trusted view; empty trusted view falls back to DOE', async () => {
  const sql = fs.readFileSync(path.resolve(root, '../supabase/migrations/20240812000005_community_fuel_stations.sql'), 'utf8');
  const view = sql.slice(sql.indexOf('create or replace view public.fresh_verified_community_prices'), sql.indexOf('--', sql.indexOf("and r.verified_at >= now() - interval '7 days'")));
  assert.match(view, /r.status = 'verified'/); assert.match(view, /r.verified_at >= now\(\) - interval '7 days'/);
  const empty = priceResolver({ verified: [] });
  assert.equal((await empty.resolve()).price.source, 'doe_area');
  assert.deepEqual(empty.calls.find(c => c[0] === 'verified'), ['verified', 'NCR', 'RON_91']);
});
test('no trusted price is unavailable, with no fabricated fallback', async () => {
  const result = await priceResolver({ area: [], region: [], verified: [{ reported_price: Infinity }] }).resolve();
  assert.equal(result.status, 'unavailable'); assert.equal(result.reason, 'no_doe_price');
  assert.equal((await priceResolver({ bulletin: null }).resolve()).reason, 'no_bulletin');
});
function savedService(vehicle = { id: 'v1', archived_at: null }, error = null) {
  let inserts = [];
  const supabase = { from: table => table === 'vehicles' ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: vehicle, error }) }) }) } : {
    insert: data => { inserts.push({ table, data }); return { select: () => ({ single: async () => ({ data: { id: 'saved', ...data }, error: null }) }) }; },
  } };
  const loader = modules({ '@/lib/supabase': { supabase } });
  return { ...loader('@/lib/services/savedTrips'), history: loader('@/lib/services/trips').logTripToHistory, inserts };
}
const saveInput = { userId: 'user', name: 'Commute', vehicleId: 'v1', distanceKm: 28, weights, originLabel: 'Start', destinationLabel: 'End' };
test('saved templates preserve route setup, while history preserves evaluations', async () => {
  const service = savedService();
  await service.createSavedTrip(saveInput);
  await service.history({ ...saveInput, evaluations: calculator.calculateTripRecommendation(input).evaluations, recommendedModeCode: 'OWN_VEHICLE' });
  assert.equal(service.inserts[0].table, 'saved_trips'); assert.equal(service.inserts[0].data.distance_km, 28);
  assert.equal(service.inserts[0].data.vehicle_id, 'v1'); assert.equal(service.inserts[0].data.origin_label, 'Start');
  assert.equal(service.inserts[1].table, 'trip_records'); assert(service.inserts[1].data.mode_evaluations.length > 0);
});
for (const [name, vehicle, error] of [['archived', { id: 'v1', archived_at: '2026-10-09' }, null], ['missing/revoked', null, null], ['read failure', null, { code: 'network', message: 'secret DB text' }]]) {
  test(`${name} vehicle blocks template and history writes before insert`, async () => {
    const service = savedService(vehicle, error);
    await assert.rejects(service.createSavedTrip(saveInput), /vehicle.*(archived|unavailable)/);
    await assert.rejects(service.history({ ...saveInput, evaluations: [] }), /vehicle.*(archived|unavailable)/);
    assert.equal(service.inserts.length, 0);
  });
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function tripScreen(options = {}) {
  const timers = new Map(); let timerId = 0;
  let vehicles = options.vehicles ?? [{ id: 'v1', nickname: 'Car', brand: 'Toyota', model: 'Vios', fuel_type_id: 'gas', fuel_efficiency_km_per_liter: 14, last_refill_price: 1 }, { id: 'v2', nickname: 'Truck', brand: 'Toyota', model: 'Hilux', fuel_type_id: 'diesel', fuel_efficiency_km_per_liter: 7 }];
  const params = options.params ?? { origin: 'Start', destination: 'End', vehicleId: 'v1', templateName: 'Commute' };
  const user = { id: 'user' }, alerts = [], saves = [], logs = [], routes = [], prices = [], pushes = [];
  const mocks = {
    'expo-router': { useLocalSearchParams: () => params, useRouter: () => ({ push: value => pushes.push(value) }) },
    'react-native': { Alert: { alert: (...args) => alerts.push(args) }, Keyboard: { dismiss() {} } },
    '@/context/AuthProvider': { useAuth: () => ({ user }) },
    '@/context/TabBarVisibility': { useTabBarScrollHandler: () => () => {} },
    '@/lib/useTheme': { useTheme: () => ({}) },
    '@/lib/supabase': { isSupabaseConfigured: true },
    '@/lib/format': { formatPeso: n => `₱${n.toFixed(2)}`, transportModeLabel: code => code },
    '@/lib/services/vehicles': { fetchVehicleCatalog: async () => [], fetchTripVehicles: async () => vehicles },
    '@/lib/services/routeSelection': { consumeRouteSelection: () => null },
    '@/lib/services/savedTrips': { createSavedTrip: async value => { saves.push(value); return options.save ? options.save(value) : {}; } },
    '@/lib/services/trips': { logTripToHistory: async value => { logs.push(value); return options.history ? options.history(value) : {}; } },
    '@/lib/services/googleGeocoding': { getReadableAddress: value => value, searchPlaces: async () => [{ formattedAddress: 'Start', latitude: 14.6, longitude: 121 }] },
    '@/lib/services/googlePlacesAutocomplete': { searchPlaceSuggestions: async () => [{ placeId: 'new', description: 'New origin' }], resolvePlaceSuggestion: options.resolvePlace ?? (async () => ({ description: 'New origin', latitude: 15, longitude: 120 })), PlacesAutocompleteError: class extends Error {} },
    '@/lib/services/googleMaps': { DirectionsError: class extends Error {}, getDrivingRoute: async (...args) => { routes.push(args); return options.route ? options.route(...args) : { distanceKm: 28, durationMinutes: 40, coordinates: [] }; } },
    '@/lib/services/location': { regionFromCoordinates: lat => lat < 15 ? 'NCR' : 'NORTH_LUZON', reverseGeocodeCityOnly: options.city ?? (async () => 'Quezon City'), matchBulletinArea: city => city },
    '@/lib/services/fuelPrices': { fetchLatestBulletinForRegion: async () => ({ id: 'week' }), fetchBulletinAreas: async () => ['Quezon City'] },
    '@/lib/services/tripFuelPrice': { resolveTripFuelPrice: async value => { prices.push(value); if (options.price) return options.price(value); return { status: 'ok', price: { pricePerLiter: value.fuelTypeId === 'diesel' ? 60 : 70, sourceLabel: 'DOE bulletin', detail: 'DOE area estimate' } }; } },
  };
  for (const name of ['@/constants/Theme', '@/constants/home', '@/constants/mcda', '@/constants/tripDefaults', '@/lib/mcda', '@/lib/tripCalculator']) mocks[name] = load(name);
  const h = harness(path.join(root, 'app/(tabs)/trip/index.tsx'), mocks, 'ios', {
    AbortController, console: { log() {}, warn() {} },
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
  });
  return { h, params, alerts, saves, logs, routes, prices, pushes, setVehicles: value => { vehicles = value; },
    async settle() { await h.flush({}); for (let i = 0; i < 3; i++) { const batch = [...timers.values()]; timers.clear(); batch.forEach(fn => fn()); await h.flush(); } },
    button: label => find(h.tree, n => n.props?.label === label),
    textField: placeholder => find(h.tree, n => n.props?.placeholder === placeholder),
    own: () => logs.at(-1)?.evaluations.find(row => row.modeCode === 'OWN_VEHICLE'),
  };
}
test('complete route + active vehicle + DOE comparison uses the shown metrics, not last-refill price', async () => {
  const s = tripScreen(); await s.settle(); await s.button('Compare trip costs').props.onPress(); await s.h.flush();
  assert.equal(s.own().raw.fuelCost, 140); assert.equal(s.own().raw.travelTime, 40);
  assert.equal(s.logs.length, 1); assert.equal(s.logs[0].distanceKm, 28); assert.equal(s.logs[0].vehicleId, 'v1');
  assert.deepEqual({ ...s.prices.at(-1) }, { fuelTypeId: 'gas', regionCode: 'NCR', areaName: 'Quezon City' });
  s.h.unmount();
});
test('manual override is trip-only; invalid suffix is rejected; switching off restores DOE', async () => {
  const s = tripScreen(); await s.settle(); s.button('Use my own price').props.onPress(); await s.h.flush();
  s.textField('e.g. 80.00').props.onChangeText('80junk'); await s.h.flush();
  await s.button('Compare trip costs').props.onPress(); assert.equal(s.logs.length, 0);
  s.textField('e.g. 80.00').props.onChangeText('80'); await s.h.flush();
  await s.button('Compare trip costs').props.onPress(); await s.h.flush(); assert.equal(s.own().raw.fuelCost, 160);
  s.button('Use automatic price').props.onPress(); await s.h.flush();
  await s.button('Compare trip costs').props.onPress(); await s.h.flush(); assert.equal(s.own().raw.fuelCost, 140);
  assert.equal(s.saves.length, 0); s.h.unmount();
});
test('Other/manual vehicle price input actually feeds calculation', async () => {
  const s = tripScreen({ vehicles: [], params: { origin: 'Start', destination: 'End', vehicleId: 'manual' } });
  await s.settle(); s.textField('62.50').props.onChangeText('80'); await s.h.flush();
  await s.button('Compare trip costs').props.onPress(); await s.h.flush();
  assert.equal(s.own().raw.fuelCost, 160); assert.equal(s.logs[0].vehicleId, null); s.h.unmount();
});
test('vehicle switch recalculates efficiency, fuel and cost', async () => {
  const s = tripScreen(); await s.settle();
  find(s.h.tree, n => n.props?.accessibilityLabel === 'Truck, 7 kilometers per liter').props.onPress(); await s.h.flush();
  await s.button('Compare trip costs').props.onPress(); await s.h.flush();
  assert.equal(s.own().raw.fuelCost, 240); assert.equal(s.prices.at(-1).fuelTypeId, 'diesel'); s.h.unmount();
});
test('failed replacement route cannot reuse old metrics or save a stale comparison', async () => {
  let fail = false; const s = tripScreen({ route: async () => { if (fail) throw Error('raw Google secret'); return { distanceKm: 28, durationMinutes: 40 }; } });
  await s.settle(); fail = true; s.textField('Search destination').props.onChangeText('Missing road'); await s.settle();
  await s.button('Compare trip costs').props.onPress(); await s.h.flush();
  assert.equal(s.logs.length, 0); assert.equal(s.own(), undefined);
  assert(find(s.h.tree, n => typeof n.props?.children === 'string' && /Couldn.t retrieve a route/.test(n.props.children)));
  assert(!find(s.h.tree, n => n.props?.children === 'raw Google secret')); s.h.unmount();
});
test('successful route replacement and fresh comparison use new distance/time', async () => {
  const s = tripScreen({ route: async (_origin, dest) => ({ distanceKm: dest === 'New end' ? 42 : 28, durationMinutes: dest === 'New end' ? 60 : 40 }) });
  await s.settle(); s.textField('Search destination').props.onChangeText('New end'); await s.settle();
  await s.button('Compare trip costs').props.onPress(); await s.h.flush();
  assert.equal(s.own().raw.fuelCost, 210); assert.equal(s.own().raw.travelTime, 60); assert.equal(s.logs[0].distanceKm, 42); s.h.unmount();
});
test('save success captures correct setup and blocks duplicate taps before rerender', async () => {
  const pending = deferred(); const s = tripScreen({ save: () => pending.promise }); await s.settle();
  await s.button('Compare trip costs').props.onPress(); await s.h.flush();
  const button = s.button('Save as template'); const first = button.props.onPress(); const second = button.props.onPress();
  assert.equal(s.saves.length, 1); assert.equal(s.saves[0].vehicleId, 'v1'); assert.equal(s.saves[0].distanceKm, 28);
  await s.h.flush(); assert.equal(s.button('Saving…').props.disabled, true);
  pending.resolve({}); await Promise.all([first, second]); await s.h.flush();
  assert.equal(s.alerts.at(-1)[0], 'Saved'); s.h.unmount();
});
test('save failure remains friendly and permits retry; compare double tap cannot double-log', async () => {
  const history = deferred(); const s = tripScreen({ save: async () => { throw Error('private Postgres constraint'); }, history: () => history.promise }); await s.settle();
  const compare = s.button('Compare trip costs'); const first = compare.props.onPress(); const second = compare.props.onPress();
  assert.equal(s.logs.length, 1); history.resolve({}); await Promise.all([first, second]); await s.h.flush();
  await s.button('Save as template').props.onPress(); await s.h.flush();
  assert.equal(s.saves.length, 1); assert.match(s.alerts.at(-1)[1], /try again/); assert(!s.alerts.flat().includes('private Postgres constraint'));
  assert.equal(s.button('Save as template').props.disabled, false); s.h.unmount();
});
test('focus refresh removes a missing/archived vehicle without silently selecting a different one', async () => {
  const s = tripScreen(); await s.settle(); s.setVehicles([{ id: 'v2', nickname: 'Truck', brand: 'Toyota', model: 'Hilux', fuel_type_id: 'diesel', fuel_efficiency_km_per_liter: 7 }]);
  s.h.focus(); await s.h.flush();
  assert(find(s.h.tree, n => n.props?.accessibilityLabel === 'Other vehicle, enter details manually' && n.props.accessibilityState.selected));
  await s.button('Compare trip costs').props.onPress(); assert.equal(s.logs.length, 0); s.h.unmount();
});
test('typing while a place detail request is pending cannot restore the old location', async () => {
  const detail = deferred(); const s = tripScreen({ resolvePlace: () => detail.promise }); await s.settle();
  s.textField('Search starting point').props.onChangeText('New origin'); await s.settle();
  const select = find(s.h.tree, n => n.props?.accessibilityLabel === 'Use New origin').props.onPress();
  await s.h.flush(); s.textField('Search starting point').props.onChangeText('Different origin'); await s.h.flush();
  detail.resolve({ description: 'Old selection', latitude: 15, longitude: 120 }); await select; await s.h.flush();
  assert.equal(s.textField('Search starting point').props.value, 'Different origin'); s.h.unmount();
});
test('moving origins changes region immediately while city lookup is pending, without the old area', async () => {
  const city = deferred(); const s = tripScreen({ city: lat => lat < 15 ? Promise.resolve('Quezon City') : city.promise }); await s.settle();
  s.textField('Search starting point').props.onChangeText('New origin'); await s.settle();
  await find(s.h.tree, n => n.props?.accessibilityLabel === 'Use New origin').props.onPress(); await s.h.flush();
  assert.equal(s.prices.at(-1).regionCode, 'NORTH_LUZON'); assert.equal(s.prices.at(-1).areaName, null);
  city.resolve('Baguio'); await s.h.flush(); assert.equal(s.prices.at(-1).areaName, 'Baguio'); s.h.unmount();
});
test('focusing a resolved origin preserves coordinates and map navigation carries both point identities', async () => {
  const s = tripScreen(); await s.settle(); const before = s.prices.length;
  s.textField('Search starting point').props.onFocus(); await s.h.flush(); assert.equal(s.prices.length, before);
  s.textField('Search destination').props.onChangeText('New origin'); await s.settle();
  await find(s.h.tree, n => n.props?.accessibilityLabel === 'Use New origin').props.onPress(); await s.h.flush();
  find(s.h.tree, n => n.props?.accessibilityLabel === 'Choose origin and destination on a map').props.onPress();
  assert.equal(s.pushes.at(-1).params.originLatitude, '14.6'); assert.equal(s.pushes.at(-1).params.destinationLatitude, '15'); s.h.unmount();
});
function mapScreen(options = {}) {
  const params = options.params ?? { origin: 'Start', destination: 'End', originLatitude: '14.6', originLongitude: '121', destinationLatitude: '15', destinationLongitude: '120' };
  const published = [], routes = []; const pendingTimers = new Map(); let timerId = 0;
  const h = harness(path.join(root, 'app/(tabs)/trip/pick-map.tsx'), {
    'expo-router': { useLocalSearchParams: () => params, useRouter: () => ({ back() {} }) },
    'expo-location': { requestForegroundPermissionsAsync: async () => ({ status: 'denied' }), reverseGeocodeAsync: async () => [], Accuracy: { Balanced: 'balanced' } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@/hooks/useResponsive': { useResponsive: () => ({ width: 375, scale: n => n, horizontalPadding: 16, isLandscape: false }) },
    '@/lib/useTheme': { useTheme: () => ({}) },
    '@/lib/supabase': { isSupabaseConfigured: true },
    '@/components/maps/TripMap': { MapView: 'MapView', Marker: 'Marker', Polyline: 'Polyline' },
    '@/lib/services/routeSelection': { publishRouteSelection: value => published.push(value) },
    '@/lib/services/googleMaps': { DirectionsError: class extends Error {}, getDrivingRoute: async (...args) => { routes.push(args); return options.route ? options.route(...args) : { distanceKm: 28, durationMinutes: 40, coordinates: [] }; } },
    '@/lib/services/googleGeocoding': { GeocodingError: class extends Error {}, getReadableAddress: value => value, reverseGeocode: options.reverse ?? (async lat => ({ formattedAddress: `Location ${lat}` })) },
    '@/lib/services/googlePlacesAutocomplete': { PlacesAutocompleteError: class extends Error {}, searchPlaceSuggestions: async () => [] },
    '@/constants/regions': load('@/constants/regions'), '@/constants/Theme': load('@/constants/Theme'),
  }, 'ios', { AbortController, setTimeout: fn => { pendingTimers.set(++timerId, fn); return timerId; }, clearTimeout: id => pendingTimers.delete(id) });
  return { h, routes, published, apply: () => find(h.tree, n => n.props?.label === 'Use this route'), map: () => find(h.tree, n => n.type === 'MapView') };
}
test('map picker reopens with both coordinates and returns matching display names/coordinates', async () => {
  const s = mapScreen(); await s.h.flush({}); assert(s.apply()); s.apply().props.onPress();
  assert.equal(s.published[0].origin.displayName, 'Start'); assert.equal(s.published[0].origin.latitude, 14.6);
  assert.equal(s.published[0].destination.displayName, 'End'); assert.equal(s.published[0].destination.longitude, 120);
  assert.equal(s.routes[0][0], '14.6,121'); assert.equal(s.routes[0][1], '15,120'); s.h.unmount();
});
test('two rapid map taps keep the most recent address, even if the first geocode resolves last', async () => {
  const first = deferred(), second = deferred();
  const s = mapScreen({ reverse: lat => lat === 16 ? first.promise : second.promise }); await s.h.flush({});
  const one = s.map().props.onPress({ nativeEvent: { coordinate: { latitude: 16, longitude: 121 } } });
  const two = s.map().props.onPress({ nativeEvent: { coordinate: { latitude: 17, longitude: 122 } } });
  second.resolve({ formattedAddress: 'Latest tap' }); await two; await s.h.flush();
  first.resolve({ formattedAddress: 'Old tap' }); await one; await s.h.flush();
  assert.equal(find(s.h.tree, n => n.props?.placeholder === 'Search start location...').props.value, 'Latest tap');
  s.apply().props.onPress(); assert.equal(s.published[0].origin.latitude, 17); s.h.unmount();
});
test('clearing a map endpoint invalidates a late Directions response', async () => {
  const request = deferred(); const s = mapScreen({ route: () => request.promise }); await s.h.flush({});
  find(s.h.tree, n => n.props?.placeholder === 'Search destination...').props.onChangeText(''); await s.h.flush();
  request.resolve({ distanceKm: 999, durationMinutes: 999, coordinates: [] }); await s.h.flush();
  assert.equal(s.apply(), null); assert(!find(s.h.tree, n => n.props?.distanceKm === 999)); s.h.unmount();
});
test('Directions service rejects malformed metrics and converts raw failures into friendly messages', async () => {
  for (const data of [{ distanceKm: Infinity, durationMinutes: 40 }, { distanceKm: 28, durationMinutes: NaN }, { distanceKm: 0, durationMinutes: 40 }]) {
    const service = modules({ '@/lib/supabase': { supabase: { functions: { invoke: async () => ({ data, error: null }) } } } })('@/lib/services/googleMaps');
    await assert.rejects(service.getDrivingRoute('Start', 'End'), error => error.code === 'invalid_response');
  }
  const service = modules({ '@/lib/supabase': { supabase: { functions: { invoke: async () => { throw Error('raw Google token'); } } } } })('@/lib/services/googleMaps');
  await assert.rejects(service.getDrivingRoute('Start', 'End'), error => error.code === 'network' && !error.message.includes('token'));
});
test('trip vehicle catalog includes owned and active shared profiles, excluding archived/revoked shares', async () => {
  const rows = [{ id: 'own', user_id: 'user', archived_at: null }, { id: 'shared', user_id: 'owner', archived_at: null, fuel_type_id: 'diesel', fuel_efficiency_km_per_liter: 8 }, { id: 'archived', user_id: 'owner', archived_at: '2026-10-01' }, { id: 'revoked', user_id: 'owner', archived_at: null }];
  const shares = [{ vehicleID: 'shared', shared_with: 'user', role: 'Driver', revoked: false }, { vehicleID: 'archived', shared_with: 'user', role: 'Member', revoked: false }, { vehicleID: 'revoked', shared_with: 'user', role: 'Viewer', revoked: true }];
  const supabase = { from: table => {
    let filters = [], ids = null;
    const query = { select() { return query; }, eq(key, value) { filters.push(row => row[key] === value); return query; }, is(key, value) { filters.push(row => row[key] === value); return query; }, in(key, values) { ids = values; filters.push(row => values.includes(row[key])); return query; },
      order: async () => ({ data: (table === 'vehicles' ? rows : shares).filter(row => filters.every(fn => fn(row))), error: null }),
      then(resolve) { return query.order().then(resolve); },
    }; return query;
  } };
  const service = modules({ '@/lib/supabase': { supabase } })('@/lib/services/vehicles');
  const result = await service.fetchTripVehicles('user');
  assert.deepEqual(Array.from(result, row => row.id), ['own', 'shared']);
  assert.equal(result[1].fuel_type_id, 'diesel'); assert.equal(result[1].fuel_efficiency_km_per_liter, 8);
});
for (const [screen, serviceName, method, empty] of [['saved', 'savedTrips', 'fetchSavedTrips', 'No saved trips yet. Save a template from New trip.'], ['history', 'trips', 'fetchRecentTrips', 'No trip history yet. Compare trip costs to record your first trip.']]) {
  test(`${screen} refreshes on focus and shows a friendly retry state on query failure`, async () => {
    let fail = true, calls = 0; const user = { id: 'user' };
    const h = harness(path.join(root, `app/(tabs)/trip/${screen}.tsx`), {
      'expo-router': { useRouter: () => ({ push() {} }) },
      '@/context/AuthProvider': { useAuth: () => ({ user, loading: false }) },
      '@/context/TabBarVisibility': { useTabBarScrollHandler: () => () => {} },
      '@/lib/useTheme': { useTheme: () => ({}) }, '@/constants/Theme': load('@/constants/Theme'),
      '@/lib/supabase': { isSupabaseConfigured: true },
      [`@/lib/services/${serviceName}`]: { [method]: async () => { calls++; if (fail) throw Error('raw SQL text'); return []; } },
    });
    await h.flush({}); assert(find(h.tree, n => n.props?.label === 'Try again')); assert(!find(h.tree, n => n.props?.children === 'raw SQL text'));
    fail = false; h.focus(); await h.flush(); assert.equal(calls, 2); assert(find(h.tree, n => n.props?.children === empty)); h.unmount();
  });
}
test('history write failure does not block the comparison and no longer falsely claims it was recorded', async () => {
  const s = tripScreen({ history: async () => { throw Error('raw SQL write'); } }); await s.settle();
  await s.button('Compare trip costs').props.onPress(); await s.h.flush();
  assert(find(s.h.tree, n => n.type === 'Modal' && n.props.visible));
  assert(find(s.h.tree, n => typeof n.props?.children === 'string' && n.props.children.includes('could not be saved to Trip History')));
  s.h.unmount();
});
test('map current-location permission denial preserves the previous origin identity', async () => {
  const s = mapScreen(); await s.h.flush({});
  const locate = find(s.h.tree, n => n.props?.onPress && find(n.props.children, child => child.props?.name === 'navigation-variant'));
  assert(locate); await locate.props.onPress(); await s.h.flush();
  assert.equal(find(s.h.tree, n => n.props?.placeholder === 'Search start location...').props.value, 'Start');
  s.apply().props.onPress(); assert.equal(s.published[0].origin.latitude, 14.6); s.h.unmount();
});
test('native geocoding failure preserves real pin coordinates with a readable fallback', async () => {
  const s = mapScreen({ reverse: async () => { throw Error('API failure'); } }); await s.h.flush({});
  await s.map().props.onPress({ nativeEvent: { coordinate: { latitude: 16, longitude: 121 } } }); await s.h.flush();
  assert.match(find(s.h.tree, n => n.props?.placeholder === 'Search start location...').props.value, /Pinned location/);
  s.apply().props.onPress(); assert.equal(s.published[0].origin.latitude, 16); s.h.unmount();
});
test('route selection is delivered once, without losing display names or coordinates', () => {
  const service = modules()('@/lib/services/routeSelection');
  const origin = { displayName: 'Start', latitude: 14.6, longitude: 121 }, destination = { displayName: 'End', latitude: 15, longitude: 120, directionsValue: '15,120' };
  service.publishRouteSelection({ origin, destination }); const received = service.consumeRouteSelection();
  assert.equal(received.origin, origin); assert.equal(received.destination, destination); assert.equal(service.consumeRouteSelection(), null);
});
test('late save completion after unmount does not open a native alert on another screen', async () => {
  const pending = deferred(); const s = tripScreen({ save: () => pending.promise }); await s.settle();
  await s.button('Compare trip costs').props.onPress(); await s.h.flush();
  const save = s.button('Save as template').props.onPress(); s.h.unmount(); pending.resolve({}); await save;
  assert.equal(s.alerts.length, 0);
});
test('manual override stays accessible when automatic prices are unavailable, with accurate UI provenance', async () => {
  const s = tripScreen({ price: async () => ({ status: 'unavailable', reason: 'no_doe_price', message: 'No current fuel price.' }) }); await s.settle();
  assert(s.button('Use my own price')); s.button('Use my own price').props.onPress(); await s.h.flush();
  s.textField('e.g. 80.00').props.onChangeText('80'); await s.h.flush();
  assert(find(s.h.tree, n => n.props?.children === 'Entered for this trip only'));
  assert(!find(s.h.tree, n => n.props?.children === 'Current fuel price unavailable'));
  await s.button('Compare trip costs').props.onPress(); await s.h.flush(); assert.equal(s.own().raw.fuelCost, 160); s.h.unmount();
});
function priorityBar(value = .5, delayedMeasure = false) {
  const changes = [], measurements = [];
  const props = { value, onChange: next => changes.push(next), estimatedCost: null, estimatedTimeMinutes: null, costFormatter: String };
  const h = harness(path.join(root, 'components/ui/PriorityBalanceBar.tsx'), {
    '@/constants/Theme': load('@/constants/Theme'), '@/constants/home': load('@/constants/home'),
    'react-native': { PanResponder: { create: callbacks => ({ panHandlers: callbacks }) } },
    '@/lib/mcda': mcda,
  });
  return { h, props, changes, measurements, async mount() {
    await h.flush(props); const track = find(h.tree, n => n.props?.onLayout);
    track.props.ref.current = { measureInWindow: fn => delayedMeasure ? measurements.push(fn) : fn(100) };
    track.props.onLayout({ nativeEvent: { layout: { width: 200 } } }); await h.flush();
    if (delayedMeasure) measurements.shift()(100);
  }, track: () => find(h.tree, n => n.props?.onPanResponderMove) };
}
test('slider rapid 50 → 90 → 10 → 50 retains the final gesture before React rerenders', async () => {
  const s = priorityBar(); await s.mount();
  for (const pageX of [280, 120, 200]) s.track().props.onPanResponderMove({ nativeEvent: { pageX } });
  assert.equal(s.changes.at(-1), .5); s.h.unmount();
});
test('delayed native track measurement cannot replay an old touch after a newer move', async () => {
  const s = priorityBar(.5, true); await s.mount();
  s.track().props.onPanResponderGrant({ nativeEvent: { pageX: 200 } });
  s.track().props.onPanResponderMove({ nativeEvent: { pageX: 280 } });
  await s.h.flush({ ...s.props, value: .9 }); s.measurements.shift()(100);
  assert.equal(s.changes.at(-1), .9); s.h.unmount();
});
test('SAW normalization uses only eligible displayed alternatives, without hidden walking anchors', () => {
  const result = calculator.calculateTripRecommendation({ ...input, distanceKm: 10, ownVehicleTravelTimeMinutes: 20 });
  assert(!result.evaluations.some(row => row.modeCode === 'WALKING'));
  const slowest = result.evaluations.reduce((a, b) => b.raw.travelTime > a.raw.travelTime ? b : a);
  const cheapest = result.evaluations.reduce((a, b) => b.raw.fuelCost < a.raw.fuelCost ? b : a);
  assert.equal(slowest.normalized.travelTime, 0); assert.equal(cheapest.normalized.fuelCost, 1);
  assert.equal(result.recommended.modeCode, 'OWN_VEHICLE');
});
test('priority defaults, endpoints, midpoint and quarter positions use complementary full-precision weights', () => {
  assert.deepEqual({ ...load('@/constants/mcda').DEFAULT_MCDA_WEIGHTS }, { fuelCost: .6, travelTime: .4 });
  for (const p of [0, .25, .5, .75, 1, .123456789]) {
    const weights = mcda.weightsForTimePriority(p);
    assert.equal(weights.travelTime, p); assert.equal(weights.fuelCost, 1 - p);
    assert.equal(weights.fuelCost + weights.travelTime, 1);
  }
});
test('malformed and out-of-range priorities cannot produce invalid weights', () => {
  for (const [value, expected] of [[-1, 0], [2, 1], [-Infinity, 0], [Infinity, 1], [NaN, .4], [undefined, .4], [null, .4], ['90', .4]]) {
    const weights = mcda.weightsForTimePriority(value);
    assert.equal(weights.travelTime, expected); assert(mcda.weightsSumToOne(weights));
  }
});
function scoredPriority(options, p) {
  return Array.from(mcda.evaluateModes(options, mcda.weightsForTimePriority(p))).sort((a, b) => b.weightedScore - a.weightedScore);
}
test('conflicting A ₱100/60min and B ₱150/30min switch winner at 50%; tied scores use stable input order', () => {
  const options = [{ modeCode: 'OWN_VEHICLE', fuelCost: 100, travelTime: 60 }, { modeCode: 'JEEPNEY', fuelCost: 150, travelTime: 30 }];
  const money = scoredPriority(options, .1), time = scoredPriority(options, .9), balanced = scoredPriority(options, .5);
  assert.equal(money[0].modeCode, 'OWN_VEHICLE'); assert.equal(money[0].weightedScore, .9);
  assert.equal(time[0].modeCode, 'JEEPNEY'); assert.equal(time[0].weightedScore, .9);
  assert.equal(balanced[0].modeCode, 'OWN_VEHICLE'); assert.equal(balanced[0].weightedScore, .5); assert.equal(balanced[1].weightedScore, .5);
  assert.equal(scoredPriority(options, .49)[0].modeCode, 'OWN_VEHICLE'); assert.equal(scoredPriority(options, .51)[0].modeCode, 'JEEPNEY');
});
test('three conflicting options mathematically transition cheapest → balanced → fastest', () => {
  const options = [{ modeCode: 'OWN_VEHICLE', fuelCost: 100, travelTime: 60 }, { modeCode: 'JEEPNEY', fuelCost: 120, travelTime: 35 }, { modeCode: 'RIDE_HAILING', fuelCost: 150, travelTime: 30 }];
  assert.equal(scoredPriority(options, .1)[0].modeCode, 'OWN_VEHICLE');
  const balanced = scoredPriority(options, .5);
  assert.equal(balanced[0].modeCode, 'JEEPNEY'); assert(Math.abs(balanced[0].weightedScore - (.6 * .5 + 25 / 30 * .5)) < 1e-12);
  assert.equal(scoredPriority(options, .9)[0].modeCode, 'RIDE_HAILING');
});
test('equal travel time retains neutral normalization without destabilizing cost ranking', () => {
  const options = [{ modeCode: 'OWN_VEHICLE', fuelCost: 100, travelTime: 30 }, { modeCode: 'JEEPNEY', fuelCost: 150, travelTime: 30 }];
  for (const p of [0, .1, .5, .9, 1]) {
    const result = scoredPriority(options, p);
    assert(result.every(row => row.normalized.travelTime === 1 && Number.isFinite(row.weightedScore)));
    assert.equal(result[0].modeCode, 'OWN_VEHICLE');
  }
  for (const p of [0, .5, 1]) {
    const result = scoredPriority(options.map(row => ({ ...row, fuelCost: 100 })), p);
    assert(result.every(row => row.weightedScore === 1)); assert.equal(result[0].modeCode, 'OWN_VEHICLE');
  }
});
test('slider feedback shows actual percentage weights and accessibility adjustment moves toward time', async () => {
  const s = priorityBar(.4); await s.mount();
  const adjustable = find(s.h.tree, n => n.props?.accessibilityRole === 'adjustable');
  assert.equal(adjustable.props.accessibilityValue.now, 40);
  assert(find(s.h.tree, n => n.props?.children === 'Save money')); assert(find(s.h.tree, n => n.props?.children === 'Save time'));
  adjustable.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } });
  assert.equal(s.changes.at(-1), .45); s.h.unmount();
});
const screenPriority = s => find(s.h.tree, n => n.props?.onChange && 'estimatedTimeMinutes' in n.props);
test('live priorities repeatedly change real recommended mode, score and badge without resetting inputs or refetching route/price', async () => {
  const s = tripScreen({ route: async () => ({ distanceKm: 10, durationMinutes: 20 }) }); await s.settle();
  const routeCount = s.routes.length, priceCount = s.prices.length;
  assert.equal(screenPriority(s).props.value, .4);
  const expected = [[.5, 'OWN_VEHICLE'], [.9, 'OWN_VEHICLE'], [.1, 'JEEPNEY'], [.5, 'OWN_VEHICLE']];
  let initialScore;
  for (const [p, winner] of expected) {
    screenPriority(s).props.onChange(p); await s.h.flush();
    const live = screenPriority(s).props;
    assert.equal(live.value, p); assert.equal(live.recommendedModeLabel, winner);
    assert.equal(live.estimatedCost, winner === 'OWN_VEHICLE' ? 50 : 26); assert.equal(live.estimatedTimeMinutes, winner === 'OWN_VEHICLE' ? 20 : 33);
    assert.equal(s.textField('Search starting point').props.value, 'Start'); assert.equal(s.textField('Search destination').props.value, 'End');
    assert(find(s.h.tree, n => n.props?.accessibilityLabel === 'Car, 14 kilometers per liter' && n.props.accessibilityState.selected));
    assert.equal(s.routes.length, routeCount); assert.equal(s.prices.length, priceCount);
    assert(find(s.h.tree, n => n.props?.accessibilityLabel === 'Show last trip comparison'));
    if (initialScore == null) initialScore = live.estimatedCost;
    else if (p === .5) assert.equal(live.estimatedCost, initialScore);
  }
  await s.button('Compare trip costs').props.onPress(); await s.h.flush();
  assert.equal(s.logs[0].distanceKm, 10); assert.equal(s.logs[0].evaluations[0].raw.travelTime, 20);
  assert(find(s.h.tree, n => n.props?.children === 'Best match for your selected priority'));
  s.h.unmount();
});
test('actual drag callbacks feed the parent’s SAW result correctly even when rapid updates are batched', async () => {
  const s = tripScreen({ route: async () => ({ distanceKm: 10, durationMinutes: 20 }) }); await s.settle();
  screenPriority(s).props.onChange(.5); await s.h.flush(); const bar = priorityBar(.5);
  bar.props.onChange = p => { bar.changes.push(p); screenPriority(s).props.onChange(p); }; await bar.mount();
  const routeCount = s.routes.length;
  for (const pageX of [280, 120, 200]) bar.track().props.onPanResponderMove({ nativeEvent: { pageX } });
  await s.h.flush(); assert.equal(screenPriority(s).props.value, .5); assert.equal(screenPriority(s).props.recommendedModeLabel, 'OWN_VEHICLE');
  assert.equal(s.routes.length, routeCount); bar.h.unmount(); s.h.unmount();
});
test('current full-precision priorities are saved with their corresponding evaluations; historical runs stay immutable', async () => {
  const s = tripScreen({ route: async () => ({ distanceKm: 10, durationMinutes: 20 }) }); await s.settle();
  await s.button('Compare trip costs').props.onPress(); await s.h.flush(); const original = JSON.stringify(s.logs[0]);
  const p = .9123456789; screenPriority(s).props.onChange(p); await s.h.flush();
  assert.equal(s.logs.length, 1); assert.equal(JSON.stringify(s.logs[0]), original);
  await s.button('Save as template').props.onPress(); await s.h.flush();
  assert.equal(s.saves[0].weights.travelTime, p); assert.equal(s.saves[0].weights.fuelCost, 1 - p);
  await s.button('Compare trip costs').props.onPress(); await s.h.flush();
  assert.equal(s.logs[1].weights.travelTime, p);
  const expected = calculator.calculateTripRecommendation({ ...input, distanceKm: 10, ownVehicleTravelTimeMinutes: 20, weights: mcda.weightsForTimePriority(p) });
  assert.equal(JSON.stringify(s.logs[1].evaluations), JSON.stringify(expected.evaluations));
  assert.equal(JSON.stringify(s.logs[0]), original); s.h.unmount();
});
test('priority changes retain manual fuel override and do not trigger network requests', async () => {
  const s = tripScreen(); await s.settle(); s.button('Use my own price').props.onPress(); await s.h.flush();
  s.textField('e.g. 80.00').props.onChangeText('80'); await s.h.flush();
  const routeCount = s.routes.length, priceCount = s.prices.length;
  for (const p of [0, 1, .5]) { screenPriority(s).props.onChange(p); await s.h.flush(); }
  assert.equal(s.textField('e.g. 80.00').props.value, '80'); assert.equal(s.routes.length, routeCount); assert.equal(s.prices.length, priceCount);
  await s.button('Compare trip costs').props.onPress(); await s.h.flush(); assert.equal(s.own().raw.fuelCost, 160); s.h.unmount();
});
