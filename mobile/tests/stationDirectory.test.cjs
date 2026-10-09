// Run: node --test mobile/tests/stationDirectory.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/services/stationDirectory.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const service = {};
vm.runInNewContext(source, { exports: service, require: () => ({ supabase: {} }) });
const station = (id, address) => ({ id, name: id, address, fuel_types: [], operating_hours: null });
const records = [
  station('north', 'NATIONAL HIGHWAY, LAOAG CITY, ILOCOS NORTE'),
  station('laguna', 'BRGY MAKILING, CALAMBA CITY, LAGUNA'),
  station('rizal', 'CAINTA, RIZAL'),
  station('ncr', 'NO 10 AURORA BLVD, QUEZON CITY'),
  station('visayas', 'CEBU CITY'),
  station('mindanao', 'DAVAO CITY'),
  station('missing', null),
];
const ids = (region, area = '') => Array.from(service.filterStationGeography(records, region, area), (row) => row.id);
for (const [region, area, expected] of [
  ['NORTH_LUZON', 'Ilocos Norte', ['north']],
  ['NORTH_LUZON', 'Laoag City', ['north']],
  ['SOUTH_LUZON', 'Laguna', ['laguna']],
  ['SOUTH_LUZON', 'Calamba', ['laguna']],
  ['NCR', 'Quezon City', ['ncr']],
  ['VISAYAS', 'Cebu City', ['visayas']],
  ['MINDANAO', 'Davao City', ['mindanao']],
  ['UNKNOWN', '', []], ['SOUTH_LUZON', 'bad area', []],
  ['SOUTH_LUZON', 'Quezon City', []], ['NCR', 'Laguna', []],
]) test(`${region} + ${area || '(region only)'}`, () => assert.deepEqual(ids(region, area), expected));
for (const [region, expected] of [
  ['NORTH_LUZON', ['north']], ['SOUTH_LUZON', ['laguna', 'rizal']],
  ['NCR', ['ncr']], ['VISAYAS', ['visayas']], ['MINDANAO', ['mindanao']],
]) test(`${region} excludes all other region fixtures`, () => assert.deepEqual(ids(region), expected));
test('no filters preserves all rows and order, including missing address', () => {
  assert.deepEqual(ids(''), records.map((row) => row.id));
});
test('area narrows geography before search and clearing restores scoped list', () => {
  const scoped = service.filterStationGeography(records, 'SOUTH_LUZON', 'Laguna');
  const search = (query) => Array.from(scoped.filter((row) => service.stationSearchText(row).includes(query.trim().toLowerCase())), (row) => row.id);
  assert.deepEqual(search('  CALAMBA '), ['laguna']);
  assert.deepEqual(search('davao'), []);
  assert.deepEqual(search(''), ['laguna']);
});
test('street and barangay names do not imply province membership', () => {
  assert.equal(service.matchesSelectedRegion(station('street', 'JP RIZAL STREET, CEBU CITY'), 'SOUTH_LUZON'), false);
  assert.equal(service.matchesSelectedRegion(station('barangay', 'BRGY RIZAL'), 'SOUTH_LUZON'), false);
  assert.equal(service.matchesSelectedArea(station('other-antipolo', 'BRGY ANTIPOLO, PONTEVEDRA, NEGROS OCCIDENTAL'), 'Antipolo'), false);
});
test('aliases, postcodes, and country suffixes remain conservative', () => {
  assert.equal(service.matchesSelectedArea(station('binan', 'BINAN CITY, LAGUNA 4024, PHILIPPINES'), 'B I Ñ A N'), true);
  assert.equal(service.matchesSelectedArea(station('rosa', 'STA. ROSA, LAGUNA'), 'Sta. Rosa'), true);
  assert.equal(service.isSupportedStationArea('Babcoorlaocda Cyity'), false);
  assert.equal(service.isSupportedStationArea('Quezon'), false);
});
