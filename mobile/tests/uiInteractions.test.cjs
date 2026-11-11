const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');
const { harness, find } = require('./componentHarness.cjs');
const theme = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../constants/Theme.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: theme });
const mocks = {
  '@/constants/Theme': theme,
  '@/lib/useTheme': { useTheme: () => theme.getTheme('light') },
};
const setup = name => harness(path.join(__dirname, `../components/ui/${name}.tsx`), mocks);

test('redesigned input preserves keyboard props, editing and focus callbacks', async () => {
  const h = setup('LabeledInput');
  const calls = [];
  await h.flush({ label: 'Liters', value: '12.5', keyboardType: 'decimal-pad',
    onChangeText: value => calls.push(value), onFocus: () => calls.push('focus'), onBlur: () => calls.push('blur') });
  let field = find(h.tree, n => n.type === 'TextInput');
  assert.equal(field.props.value, '12.5');
  assert.equal(field.props.keyboardType, 'decimal-pad');
  assert.equal(field.props.accessibilityLabel, 'Liters');
  field.props.onFocus({}); await h.flush();
  field = find(h.tree, n => n.type === 'TextInput');
  field.props.onChangeText('15.75'); field.props.onBlur({}); await h.flush();
  assert.deepEqual(calls, ['focus', '15.75', 'blur']);
});

test('input validation keeps its explanatory message and custom accessible label', async () => {
  const h = setup('LabeledInput');
  await h.flush({ label: 'Price', accessibilityLabel: 'Observed price per liter', error: 'Enter a valid price.', value: '' });
  assert(find(h.tree, n => n.props?.children === 'Enter a valid price.'));
  assert(find(h.tree, n => n.props?.accessibilityLabel === 'Observed price per liter'));
});

test('primary action preserves disabled state and handler', async () => {
  const h = setup('PrimaryButton'); let calls = 0;
  const onPress = () => calls++;
  await h.flush({ label: 'Save refill', disabled: true, onPress });
  let button = find(h.tree, n => n.type === 'Pressable');
  assert.equal(button.props.disabled, true);
  assert.equal(button.props.accessibilityState.disabled, true);
  await h.flush({ label: 'Save refill', disabled: false, onPress });
  button = find(h.tree, n => n.type === 'Pressable'); button.props.onPress();
  assert.equal(calls, 1);
});

test('select opens, returns the original option value, and closes', async () => {
  const h = setup('SelectField'); const selected = [];
  await h.flush({ label: 'Fuel type', value: 'RON_91', options: [{ value: 'RON_91', label: 'RON 91' }, { value: 'DIESEL', label: 'Diesel' }], onChange: value => selected.push(value) });
  find(h.tree, n => n.type === 'Pressable').props.onPress(); await h.flush();
  assert.equal(find(h.tree, n => n.type === 'Modal').props.visible, true);
  const list = find(h.tree, n => n.type === 'FlatList');
  list.props.renderItem({ item: list.props.data[1] }).props.onPress(); await h.flush();
  assert.deepEqual(selected, ['DIESEL']);
  assert.equal(find(h.tree, n => n.type === 'Modal').props.visible, false);
});

for (const component of ['ChipSelect', 'SegmentedToggle']) test(`${component} keeps selection and sends the original value`, async () => {
  const h = setup(component); const selected = [];
  await h.flush({ label: 'View', value: 'official', options: [{ value: 'official', label: 'Official' }, { value: 'community', label: 'Community' }], onChange: value => selected.push(value) });
  const active = find(h.tree, n => n.type === 'Pressable' && (n.props.accessibilityState?.selected || n.props.accessibilityState?.checked));
  assert(active);
  const other = find(h.tree, n => n.type === 'Pressable' && n !== active); other.props.onPress();
  assert.deepEqual(selected, ['community']);
});
