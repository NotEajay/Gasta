const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');
const { harness, find } = require('./componentHarness.cjs');

function moduleAt(file) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    { exports },
  );
  return exports;
}

const theme = moduleAt('constants/Theme.ts');
const format = moduleAt('lib/format.ts');
const user = {
  id: 'profile-user',
  email: 'alex@example.test',
  email_confirmed_at: '2026-01-01T00:00:00Z',
  created_at: '2025-01-01T00:00:00Z',
  last_sign_in_at: '2026-11-01T00:00:00Z',
  user_metadata: { full_name: 'Alex Rivera' },
};

const text = node => Array.isArray(node)
  ? node.map(text).join(' ')
  : typeof node === 'string'
    ? node
    : node && typeof node === 'object'
      ? text(node.props?.children)
      : '';

const all = (tree, predicate, found = []) => {
  if (Array.isArray(tree)) {
    for (const node of tree) all(node, predicate, found);
    return found;
  }
  if (!tree || typeof tree !== 'object') return found;
  if (predicate(tree)) found.push(tree);
  all(tree.props?.children, predicate, found);
  return found;
};

function setup(role) {
  const pushed = [];
  const query = {
    select: () => query,
    eq: () => query,
    single: async () => ({ data: { role } }),
  };
  const router = { push: route => pushed.push(route) };
  const h = harness(path.join(__dirname, '../app/(tabs)/profile.tsx'), {
    '@/constants/Theme': theme,
    '@/lib/format': format,
    'expo-router': { useRouter: () => router },
    '@/components/Themed': { Text: 'Text' },
    '@/components/ui/ScreenHeader': { default: 'ScreenHeader' },
    '@/components/AuthPrompt': { default: 'AuthPrompt' },
    '@/components/SupabaseSetupBanner': { default: 'SupabaseSetupBanner' },
    '@/components/auth/AnimatedPressable': { default: 'AnimatedPressable' },
    '@/components/navigation/HideWhenBlurred': { default: 'HideWhenBlurred' },
    '@/components/ui/InlineNotice': { default: 'InlineNotice' },
    '@/components/ui/LoadingState': { default: 'LoadingState' },
    '@/context/AuthProvider': {
      useAuth: () => ({ user, loading: false, signOut: async () => ({ error: null }) }),
    },
    '@/context/TabBarVisibility': { useTabBarScrollHandler: () => () => {} },
    '@/hooks/useResponsive': { useResponsive: () => ({ contentMaxWidth: 760 }) },
    '@/lib/supabase': { isSupabaseConfigured: true, supabase: { from: () => query } },
  });
  return {
    h,
    pushed,
    async ready() {
      await h.flush({});
      await h.flush();
    },
  };
}

function privilegedSection(tree) {
  const label = find(tree, node => node.type === 'Text' && text(node) === 'Developer & Admin');
  if (!label) return null;
  return find(tree, node => node.type === 'Fragment' && Array.isArray(node.props?.children)
    && node.props.children.includes(label))?.props.children?.[1] ?? null;
}

function workflowsRow(section) {
  return all(section, node => node.type === 'Pressable')
    .find(row => text(row).trim() === 'Workflows');
}

function assertDeveloperWorkflowsOnly(env) {
  const section = privilegedSection(env.h.tree);
  assert(section, 'Developer & Admin section should be visible');
  const rows = all(section, node => node.type === 'Pressable');
  assert.equal(rows.length, 1);
  assert.equal(text(rows[0]).trim(), 'Workflows');
  assert.equal(all(rows[0], node => node.type === 'Ionicons' && node.props?.name === 'git-network-outline').length, 1);
  assert.equal(all(rows[0], node => node.type === 'Ionicons' && node.props?.name === 'chevron-forward').length, 1);
  assert(!text(section).includes('User Management'));
  return rows[0];
}

test('ordinary user does not see the Developer & Admin section', async () => {
  const env = setup('user');
  await env.ready();
  assert.equal(privilegedSection(env.h.tree), null);
  assert(!text(env.h.tree).includes('Developer & Admin'));
  assert(!text(env.h.tree).includes('Workflows'));
});

test('developer sees only the Workflows row', async () => {
  const env = setup('developer');
  await env.ready();
  assertDeveloperWorkflowsOnly(env);
});

test('admin sees Workflows and User Management rows', async () => {
  const env = setup('admin');
  await env.ready();
  const section = privilegedSection(env.h.tree);
  const rows = all(section, node => node.type === 'Pressable');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => text(row).trim()), ['Workflows', 'User Management']);
  assert.equal(all(rows[1], node => node.type === 'Ionicons' && node.props?.name === 'people-outline').length, 1);
  rows[1].props.onPress();
  assert.equal(env.pushed.at(-1), '/admin/users');
});

test('Workflows row routes to /admin/etl for admin', async () => {
  const env = setup('admin');
  await env.ready();
  workflowsRow(privilegedSection(env.h.tree)).props.onPress();
  assert.deepEqual(env.pushed, ['/admin/etl']);
});
