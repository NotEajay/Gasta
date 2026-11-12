const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');

const source = fs.readFileSync(path.resolve(__dirname, '../app/+html.tsx'), 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const moduleExports = {};
vm.runInNewContext(output, {
  exports: moduleExports,
  require(name) {
    if (name === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null };
    if (name === 'expo-router/html') return { ScrollViewStyleReset: () => null, useServerDocumentContext: () => ({}) };
    return {};
  },
});
const recovery = moduleExports.staleBundleRecovery;
assert.equal(typeof recovery, 'string');

function execute({
  message,
  sourceUrl = '',
  priorRetry = 0,
  now = 100000,
  href = 'https://gasta.test/prices',
} = {}) {
  const handlers = {};
  const storage = new Map(priorRetry ? [['gasta:stale-bundle-retry', String(priorRetry)]] : []);
  const replacements = [];
  const RealDate = Date;
  class FakeDate extends RealDate { static now() { return now; } }
  const location = {
    href,
    search: new URL(href).search,
    replace: url => replacements.push(url),
  };
  const sandbox = {
    URL, URLSearchParams, Date: FakeDate,
    window: {
      location,
      sessionStorage: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: key => storage.delete(key),
      },
      addEventListener: (name, handler) => { handlers[name] = handler; },
    },
  };
  vm.runInNewContext(recovery, sandbox);
  if (message !== undefined) {
    handlers.error({ message, error: { message }, target: sourceUrl ? { src: sourceUrl } : null });
  }
  return { replacements, storage, handlers };
}

test('reloads once when a hashed Expo web module is missing', () => {
  const result = execute({
    message: 'Error: Loading module failed',
    sourceUrl: 'https://gasta.test/_expo/static/js/web/_layout-oldhash.js',
  });
  assert.equal(result.replacements.length, 1);
  const url = new URL(result.replacements[0]);
  assert.equal(url.pathname, '/prices');
  assert(url.searchParams.has('__bundle_retry'));
});

test('reloads when a failed script event contains only the Expo bundle URL', () => {
  const result = execute({
    message: '',
    sourceUrl: 'https://gasta.test/_expo/static/js/web/community-oldhash.js',
  });
  assert.equal(result.replacements.length, 1);
});

test('matches the exact production module failure text', () => {
  const result = execute({
    message: 'Error: Loading module https://gasta.test/_expo/static/js/web/community-caa9185a62f8a51993cc8f6fe173f92c.js failed.',
  });
  assert.equal(result.replacements.length, 1);
});

test('does not reload for application errors or non-Expo scripts', () => {
  assert.equal(execute({ message: 'SHELL_MAX_WIDTH is not defined' }).replacements.length, 0);
  assert.equal(execute({ message: 'Loading module failed', sourceUrl: 'https://cdn.test/app.js' }).replacements.length, 0);
});

test('prevents reload loops for the same tab', () => {
  const result = execute({
    message: 'Loading module failed /_expo/static/js/web/_layout-oldhash.js',
    priorRetry: 90000,
    now: 100000,
    href: 'https://gasta.test/prices?__bundle_retry=90000',
  });
  assert.equal(result.replacements.length, 0);
});

test('handles rejected dynamic imports', () => {
  const result = execute();
  result.handlers.unhandledrejection({
    reason: new Error('Failed to fetch dynamically imported module: https://gasta.test/_expo/static/js/web/page-old.js'),
  });
  assert.equal(result.replacements.length, 1);
});
