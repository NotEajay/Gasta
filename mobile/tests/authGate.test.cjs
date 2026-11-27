const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');

const source = fs.readFileSync(
  path.join(__dirname, '../components/auth/AuthGate.tsx'),
  'utf8',
);

function render({
  platform = 'web',
  segments = ['index'],
  session = null,
  isLoading = false,
  isEmailVerified = false,
} = {}) {
  const exports = {};
  const jsx = {
    jsx: (type, props) => ({ type, props }),
    jsxs: (type, props) => ({ type, props }),
  };
  const React = { createElement: jsx.jsx };
  const Redirect = 'Redirect';
  const Stack = Object.assign('Stack', { Screen: 'Stack.Screen' });
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;

  vm.runInNewContext(output, {
    exports,
    require(name) {
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime') return jsx;
      if (name === 'react-native') {
        return {
          ActivityIndicator: 'ActivityIndicator',
          Platform: { OS: platform },
          StyleSheet: { create: value => value },
          View: 'View',
        };
      }
      if (name === 'expo-router') {
        return { Redirect, Stack, useSegments: () => segments };
      }
      if (name === '@/context/AuthProvider') {
        return {
          AuthProvider: 'AuthProvider',
          useAuth: () => ({ session, isLoading, isEmailVerified }),
        };
      }
      if (name === '@/constants/Theme') {
        return { GasTaColors: { cream: '#fffaf0', forest: '#014421' } };
      }
      throw new Error(`Unexpected module: ${name}`);
    },
  });

  return exports.AuthGate({ children: 'child' });
}

function redirectHref(tree) {
  return tree?.type === 'Redirect' ? tree.props.href : null;
}

test('web root renders during initial auth loading for static landing export', () => {
  assert.equal(render({ platform: 'web', segments: ['index'], isLoading: true }), 'child');
});

test('native root remains blocked during initial auth loading', () => {
  const tree = render({ platform: 'ios', segments: ['index'], isLoading: true });
  assert.equal(tree.type, 'View');
  assert.equal(tree.props.children.type, 'ActivityIndicator');
});

test('non-root web routes remain blocked during initial auth loading', () => {
  const tree = render({ platform: 'web', segments: ['(auth)', 'login'], isLoading: true });
  assert.equal(tree.type, 'View');
  assert.equal(tree.props.children.type, 'ActivityIndicator');
});

test('signed-out web root remains public after auth resolution', () => {
  assert.equal(render({ platform: 'web', segments: ['index'] }), 'child');
});

test('signed-out protected routes redirect to canonical login', () => {
  assert.equal(redirectHref(render({ segments: ['(tabs)', 'home'] })), '/login');
});

test('signed-out grouped login route remains available', () => {
  assert.equal(render({ segments: ['(auth)', 'login'] }), 'child');
});

test('signed-out grouped verification and recovery routes remain available', () => {
  for (const route of ['verify-email', 'forgot-password']) {
    assert.equal(render({ segments: ['(auth)', route] }), 'child');
  }
});

test('OAuth callback remains available while signed out', () => {
  assert.equal(render({ segments: ['auth', 'callback'] }), 'child');
});

test('unverified sessions redirect to verify-email with encoded address', () => {
  const session = { user: { email: 'needs+verification@example.test' } };
  assert.equal(
    redirectHref(render({ segments: ['(tabs)', 'home'], session })),
    '/(auth)/verify-email?email=needs%2Bverification%40example.test',
  );
});

test('unverified session can remain on verify-email', () => {
  const session = { user: { email: 'needs@example.test' } };
  assert.equal(render({ segments: ['(auth)', 'verify-email'], session }), 'child');
});

for (const segments of [['index'], ['(auth)', 'login']]) {
  test(`verified session on ${segments.join('/')} redirects Home`, () => {
    const session = { user: { email: 'verified@example.test' } };
    assert.equal(
      redirectHref(render({ segments, session, isEmailVerified: true })),
      '/(tabs)/home',
    );
  });
}

test('verified callback remains mounted to finish OAuth handling', () => {
  const session = { user: { email: 'verified@example.test' } };
  assert.equal(
    render({ segments: ['auth', 'callback'], session, isEmailVerified: true }),
    'child',
  );
});
