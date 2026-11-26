const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { harness, find } = require('./componentHarness.cjs');
const { presentation, theme } = require('./currentLowestHarness.cjs');
for (const [code, primary, subtitle] of [
  ['RON_91', 'Regular Unleaded', 'RON 91'], ['RON_95', 'Premium Unleaded', 'RON 95'],
  ['RON_97', 'Premium Unleaded', 'RON 97'], ['RON_100', 'Premium Unleaded', 'RON 100'],
  ['DIESEL', 'Diesel', null], ['DIESEL_PLUS', 'Diesel Plus', null], ['KEROSENE', 'Kerosene', null],
]) test(`${code} displays its common description before the exact DOE grade`, async () => {
  const h = harness(path.resolve(__dirname, '../components/ui/FuelTypeBadge.tsx'), { '@/constants/Theme': theme });
  await h.flush({fuelCode: code});
  assert(find(h.tree, n => n.type === 'Text' && n.props?.children === primary));
  if (subtitle) assert(find(h.tree, n => n.type === 'Text' && n.props?.children === subtitle));
  assert.equal(h.tree.props.accessibilityLabel, `Fuel type: ${primary}${subtitle ? ', ' + subtitle : ''}`);
  assert.equal(presentation.getFuelTypePresentation(code).code, code);
  h.unmount();
});
test('unknown and legacy labels never acquire a guessed RON grade', () => {
  const fuel = presentation.getFuelTypePresentation('legacy', 'Old product');
  assert.equal(fuel.primaryLabel, 'Old product');
  assert.equal(fuel.code, null); assert.equal(fuel.subtitle, null);
});
