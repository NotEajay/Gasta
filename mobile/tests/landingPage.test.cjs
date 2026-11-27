const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { harness, find } = require('./componentHarness.cjs');

const root = path.join(__dirname, '..');
const landingFile = path.join(root, 'app/index.web.tsx');
const sourceModules = {
  featureCard: props => ({ type: 'LandingFeatureCard', props: { ...props, testID: 'landing-feature-card' } }),
  landingLink: props => ({ type: 'LandingLink', props }),
};

function setup({ desktop = false, compact = false, search = '' } = {}) {
  const width = desktop ? 1440 : compact ? 340 : 390;
  const windowListeners = new Map();
  const window = {
    innerWidth: width,
    location: { search },
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    removeEventListener(type, listener) { if (windowListeners.get(type) === listener) windowListeners.delete(type); },
  };
  const h = harness(landingFile, {
    'expo-router/server': {},
    'expo-router': { Redirect: 'Redirect', Link: 'Link' },
    'expo-router/head': { default: ({ children }) => children },
    '@/components/ui/BrandWordmark': { default: 'BrandWordmark' },
    '@/components/landing/LandingHeroVideo': { default: 'LandingHeroVideo' },
    '@/components/landing/LandingLink': { default: sourceModules.landingLink },
    '@/components/landing/LandingFeatureCard': { default: sourceModules.featureCard },
    '@/constants/Theme': {
      GasTaColors: {
        cream: '#F5F6F7', white: '#FFFFFF', textMuted: '#566679', textSoft: '#687789',
      },
      colors: {
        primary: '#3E5FB5', primaryDark: '#304D96', primarySoft: '#EFF2F8',
        primaryBorder: '#D5DDEB', navy: '#192D42', accent: '#DCE9B5', border: '#E2E6EB',
      },
      radii: { sm: 12, md: 16, lg: 22, xl: 28, pill: 999 },
      spacing: { sm: 8, md: 16, lg: 24 },
    },
    '@/hooks/useResponsive': {
      useResponsive: () => ({
        contentMaxWidth: desktop ? 1120 : width * 0.92,
        horizontalPadding: desktop ? 48 : 20,
        isCompact: compact,
        isDesktop: desktop,
      }),
    },
  }, 'web', {
    window, URLSearchParams,
    process: { env: {} },
  }, sourceModules);
  return h;
}

const text = node => Array.isArray(node)
  ? node.map(text).join(' ')
  : typeof node === 'string'
    ? node
    : node && typeof node === 'object'
      ? text(node.props?.children)
      : '';

function all(tree, predicate, found = []) {
  if (Array.isArray(tree)) {
    for (const node of tree) all(node, predicate, found);
    return found;
  }
  if (!tree || typeof tree !== 'object') return found;
  if (predicate(tree)) found.push(tree);
  all(tree.props?.children, predicate, found);
  return found;
}

function indexOfNode(tree, testID) {
  let index = 0;
  let result = -1;
  (function visit(node) {
    if (result !== -1 || !node) return;
    if (Array.isArray(node)) { for (const child of node) visit(child); return; }
    if (typeof node !== 'object') return;
    if (node.props?.testID === testID) { result = index; return; }
    index += 1;
    visit(node.props?.children);
  })(tree);
  return result;
}

test('landing renders desktop two-column and mobile stacked hero with copy before video', async () => {
  const desktop = setup({ desktop: true });
  await desktop.flush({});
  assert(find(desktop.tree, node => node.props?.testID === 'landing-hero-desktop'));
  assert(indexOfNode(desktop.tree, 'landing-hero-copy') < indexOfNode(desktop.tree, 'landing-hero-media'));

  const mobile = setup();
  await mobile.flush({});
  assert(find(mobile.tree, node => node.props?.testID === 'landing-hero-stacked'));
  assert(indexOfNode(mobile.tree, 'landing-hero-copy') < indexOfNode(mobile.tree, 'landing-hero-media'));
  assert.equal(all(mobile.tree, node => node.props?.feature?.title).length, 3);
});

test('only the desktop layout caps the landing video at 640 pixels wide', async () => {
  for (const desktop of [true, false]) {
    const h = setup({ desktop });
    await h.flush({});
    const media = find(h.tree, node => node.props?.testID === 'landing-hero-media');
    const style = Object.assign({}, ...media.props.style);
    assert.equal(style.width, '100%');
    assert.equal(style.maxWidth, desktop ? 640 : undefined);
  }
});

test('desktop centers the headline and video together without stretching the copy column', async () => {
  const h = setup({ desktop: true });
  await h.flush({});
  const hero = find(h.tree, node => node.props?.testID === 'landing-hero-desktop');
  const copy = find(hero, node => node.props?.testID === 'landing-hero-copy');
  const row = Object.assign({}, ...hero.props.style);
  assert.equal(row.justifyContent, 'center');
  assert.equal(row.gap, 36);
  assert.equal(Object.assign({}, ...copy.props.style).maxWidth, 580);
});

test('desktop content uses the page width with equal five-percent side gutters', async () => {
  const h = setup({ desktop: true });
  await h.flush({});
  const hero = find(h.tree, node => node.props?.testID === 'landing-hero-desktop');
  const style = Object.assign({}, ...hero.props.style);
  assert.equal(style.width, '100%');
  assert.equal(style.maxWidth, undefined);
  assert.equal(style.paddingHorizontal, '5%');
});

test('the public landing screen scrolls vertically with the footer inside the scroll area', async () => {
  const h = setup();
  await h.flush({});
  const page = find(h.tree, node => node.props?.testID === 'landing-page');
  assert.equal(page.type, 'ScrollView');
  assert.notEqual(page.props.horizontal, true);
  assert(find(page, node => node.props?.testID === 'landing-features'));
  assert(find(page, node => node.props?.role === 'contentinfo'));
});

test('landing uses accurate product claims and canonical authentication routes', async () => {
  const h = setup();
  await h.flush({});
  const body = text(h.tree);
  const featureCopy = all(h.tree, node => node.props?.feature?.body)
    .map(node => node.props.feature.body)
    .join(' ');
  for (const claim of [
    'weekly DOE fuel-price context',
    'verified community reports',
    "vehicle's last-refill price",
    'vehicle details, refill records, and fuel budgets',
  ]) assert(`${body} ${featureCopy}`.includes(claim), `missing claim: ${claim}`);
  for (const forbidden of ['live fuel prices', 'real-time DOE', 'GPS tracking', 'background tracking']) {
    assert(!body.toLowerCase().includes(forbidden.toLowerCase()), `forbidden claim: ${forbidden}`);
  }

  const links = all(h.tree, node => typeof node.props?.href === 'string');
  assert(links.length >= 7);
  assert(links.some(node => node.props.href === '/login?mode=signin'));
  assert(links.some(node => node.props.href === '/login?mode=signup'));
  assert(links.every(node => ['/login?mode=signin', '/login?mode=signup'].includes(node.props.href)));
  assert(links.every(node => typeof node.props.href === 'string'));
});

test('root OAuth code forwards before rendering the landing content', async () => {
  const h = setup({ search: '?code=a%2Bb%2Fc&next=ignored' });
  await h.flush({});
  assert.equal(h.tree.type, 'Redirect');
  assert.equal(h.tree.props.href, '/auth/callback?code=a%2Bb%2Fc');
  assert(!find(h.tree, node => node.props?.testID === 'landing-page'));
});

test('landing exports static metadata with canonical and poster social image', () => {
  const fs = require('node:fs');
  const ts = require('../node_modules/typescript');
  const vm = require('node:vm');
  const source = fs.readFileSync(landingFile, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, {
    exports,
    process: { env: {} },
    require: name => name === 'react/jsx-runtime'
      ? { jsx: () => null, jsxs: () => null }
      : name === 'expo-router'
        ? { Redirect: 'Redirect' }
        : name === 'expo-router/head'
        ? { default: 'Head' }
        : name === 'react-native'
          ? { StyleSheet: { create: value => value }, ScrollView: 'ScrollView', Text: 'Text', View: 'View' }
          : name === '@/constants/Theme'
            ? {
              GasTaColors: { cream: '#fff', white: '#fff', textMuted: '#555', textSoft: '#777' },
              colors: { primary: '#00f', primarySoft: '#eef', primaryBorder: '#ccd', navy: '#123', accent: '#dfb', border: '#ddd' },
              radii: { sm: 12, md: 16, lg: 22, xl: 28, pill: 999 },
              spacing: { sm: 8, md: 16, lg: 24 },
            }
            : name.startsWith('@/')
              ? name.includes('useResponsive') ? { useResponsive: () => ({}) } : { default: 'Mock' }
              : {},
  });
  const metadata = exports.generateMetadata();
  assert.equal(metadata.alternates.canonical, 'https://gasta-kappa.vercel.app');
  assert.equal(metadata.twitter.card, 'summary_large_image');
  assert.equal(metadata.openGraph.images[0].url, 'https://gasta-kappa.vercel.app/landing/gasta-landing-poster.jpg');
});
