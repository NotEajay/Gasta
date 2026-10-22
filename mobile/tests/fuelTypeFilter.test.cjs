const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('../node_modules/typescript');
const { harness, find } = require('./componentHarness.cjs');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require: name => mocks[name] ?? {} });
  return exports;
}
const fuels = load('constants/fuelTypes.ts');
const presentation = load('constants/fuelTypePresentation.ts', { '@/constants/fuelTypes': fuels });
const theme = load('constants/Theme.ts');
function selector(initial = 'RON_91', width = 390, platform = 'android') {
  let value = initial;
  const changes = [];
  const onChange = next => { value = next; changes.push(next); };
  const h = harness(path.join(root, 'components/prices/FuelTypeFilter.tsx'), {
    '@/constants/fuelTypes': fuels, '@/constants/Theme': theme, '@/hooks/useReducedMotion':{useReducedMotion:()=>true},
    '@/constants/fuelTypePresentation': presentation,
    '@/hooks/useResponsive': { useResponsive: () => ({ width, isCompact: width < 360 }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 24 }) },
  }, platform);
  return { h, changes,
    flush: () => h.flush({ label: 'Fuel', value, onChange }),
    more: () => find(h.tree, n => n.props?.accessibilityState?.expanded !== undefined),
    option: code => {
      const list = find(h.tree, n => n.type === 'FlatList');
      return list.props.renderItem({ item: list.props.data.find(f => f.code === code) });
    },
  };
}
const flatten = style => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style && typeof style === 'object' ? style : {};
test('common fuels appear directly in deliberate canonical order and More starts closed', async () => {
  const s = selector(); await s.flush();
  const row = find(s.h.tree, n => n.props?.accessibilityRole === 'radiogroup');
  assert.deepEqual(Array.from(row.props.children[0], n => n.props.accessibilityLabel), ['Fuel: RON 91', 'Fuel: RON 95', 'Fuel: Diesel']);
  assert.equal(s.more().props.children[0].props.children, 'More');
  assert.equal(find(s.h.tree, n => n.type === 'Modal'), null);
  assert.equal(find(s.h.tree, n => n.props?.accessibilityLabel === 'Fuel: RON 97'), null); s.h.unmount();
});
test('More exposes every remaining supported fuel in canonical order', async () => {
  const s = selector(); await s.flush(); s.more().props.onPress(); await s.flush();
  const list = find(s.h.tree, n => n.type === 'FlatList');
  assert.deepEqual(Array.from(list.props.data, f => f.code), ['RON_97', 'RON_100', 'DIESEL_PLUS', 'KEROSENE']);
  assert.deepEqual(['RON_91', 'RON_95', 'DIESEL', ...Array.from(list.props.data, f => f.code)].sort(), Array.from(fuels.DOE_FUEL_TYPES, f => f.code).sort());
  assert.equal(s.changes.length, 0); s.h.unmount();
});
for (const code of ['RON_97', 'RON_100', 'DIESEL_PLUS', 'KEROSENE']) test(`selecting ${code} closes More and surfaces its exact selected label`, async () => {
  const s = selector(); await s.flush(); s.more().props.onPress(); await s.flush();
  s.option(code).props.onPress(); await s.flush();
  const name = fuels.DOE_FUEL_TYPES.find(f => f.code === code).name;
  assert.deepEqual(s.changes, [code]); assert.equal(find(s.h.tree, n => n.type === 'Modal'), null);
  assert.equal(s.more().props.children[0].props.children, name);
  assert.equal(s.more().props.accessibilityState.selected, true);
  assert.equal(s.more().props.accessibilityLabel, `Fuel: ${name}. More fuel types`);
  s.more().props.onPress(); await s.flush(); assert.equal(s.option(code).props.accessibilityState.selected, true); s.h.unmount();
});
for (const code of ['RON_91', 'RON_95', 'DIESEL']) test(`${code} can be selected directly after an uncommon fuel`, async () => {
  const s = selector('RON_97'); await s.flush();
  const name = fuels.DOE_FUEL_TYPES.find(f => f.code === code).name;
  find(s.h.tree, n => n.props?.accessibilityLabel === `Fuel: ${name}`).props.onPress(); await s.flush();
  assert.deepEqual(s.changes, [code]);
  assert.equal(find(s.h.tree, n => n.props?.accessibilityLabel === `Fuel: ${name}`).props.accessibilityState.selected, true);
  assert.equal(s.more().props.children[0].props.children, 'More'); s.h.unmount();
});
test('More can close through dismiss, backdrop, close button and screen blur without changing fuel', async () => {
  const s = selector('DIESEL'); await s.flush();
  for (const close of [
    () => find(s.h.tree, n => n.type === 'Modal').props.onRequestClose(),
    () => find(s.h.tree, n => n.props?.accessibilityLabel === 'Close more fuel types').props.onPress(),
    () => find(s.h.tree, n => n.props?.accessibilityLabel === 'Close fuel options').props.onPress(),
    () => s.h.blur(),
  ]) {
    s.more().props.onPress(); await s.flush(); close(); await s.flush();
    assert.equal(find(s.h.tree, n => n.type === 'Modal'), null);
  }
  assert.deepEqual(s.changes, []); s.h.unmount();
});
test('legacy unknown value never triggers a silent fuel substitution', async () => {
  const s = selector('legacy-unknown'); await s.flush();
  assert(find(s.h.tree, n => n.props?.children === 'Selected fuel type is unavailable.'));
  assert.deepEqual(s.changes, []); s.more().props.onPress(); await s.flush();
  assert.equal(find(s.h.tree, n => n.type === 'FlatList').props.data.length, 4); s.h.unmount();
});
for (const width of [320, 360, 390, 412, 1280]) {
  for (const code of ['RON_91', 'RON_97', 'DIESEL_PLUS', 'KEROSENE']) {
    test(`${width}px ${code} uses readable wrapping, 44px targets and untruncated labels`, async () => {
      const s = selector(code, width, width === 1280 ? 'web' : 'android'); await s.flush();
      const row = find(s.h.tree, n => n.props?.accessibilityRole === 'radiogroup');
      assert.equal(row.props.style.flexWrap, 'wrap');
      const buttons = [...row.props.children[0], s.more()];
      const twoColumns = width < 480 && ['RON_97', 'RON_100', 'DIESEL_PLUS', 'KEROSENE'].includes(code);
      for (const button of buttons) {
        const style = flatten(button.props.style({ pressed: false }));
        assert(style.minHeight >= 44); assert(style.minWidth >= 44);
        assert.equal(style.flexBasis, twoColumns ? '46%' : '22%');
        const text = find(button, n => n.type === 'Text');
        assert.equal(text.props.numberOfLines, undefined);
      }
      assert.equal(find(s.h.tree, n => n.type === 'ScrollView'), null); s.h.unmount();
    });
  }
}

for (const code of ['RON_91', 'RON_95', 'DIESEL']) test(`${code} primary chip uses shared accent/tint, readable text and a non-color selected indicator`, async () => {
  const s = selector(code); await s.flush(); const fuel = presentation.getFuelTypePresentation(code);
  const chip = find(s.h.tree, n => n.props?.accessibilityLabel === `Fuel: ${fuel.label}`);
  const style = flatten(chip.props.style({ pressed: false }));
  assert.equal(style.backgroundColor, fuel.softBackground); assert.equal(style.borderColor, fuel.accent);
  assert.equal(style.borderWidth, 2);
  const text = find(chip, n => n.type === 'Text');
  assert.equal(flatten(text.props.style).color, theme.designSystem.color.textPrimary);
  assert.equal(flatten(text.props.style).fontWeight, '600');
  assert(find(chip, n => n.props?.name === 'check')); s.h.unmount();
});
for (const code of ['RON_97', 'RON_100', 'DIESEL_PLUS', 'KEROSENE']) test(`${code} More option and active main chip use the same shared colors`, async () => {
  const s = selector(code); await s.flush(); const fuel = presentation.getFuelTypePresentation(code);
  let style = flatten(s.more().props.style({ pressed: false }));
  assert.equal(style.backgroundColor, fuel.softBackground); assert.equal(style.borderColor, fuel.accent);
  assert.equal(flatten(s.more().props.children[0].props.style).fontWeight, '600');
  s.more().props.onPress(); await s.flush(); const option = s.option(code);
  style = flatten(option.props.style({ pressed: false }));
  assert.equal(style.backgroundColor, fuel.softBackground); assert.equal(style.borderColor, fuel.accent);
  assert(find(option, n => n.props?.name === 'check'));
  assert(find(option, n => flatten(n.props?.style).backgroundColor === fuel.accent)); s.h.unmount();
});
