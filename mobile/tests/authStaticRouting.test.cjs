const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '../..');
const mobileRoot = path.join(projectRoot, 'mobile');
const readMobile = file => fs.readFileSync(path.join(mobileRoot, file), 'utf8');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

test('grouped login owns /login and the top-level redirect route is gone', () => {
  assert.equal(fs.existsSync(path.join(mobileRoot, 'app/(auth)/login.tsx')), true);
  assert.equal(fs.existsSync(path.join(mobileRoot, 'app/(auth)/index.tsx')), false);
  assert.equal(fs.existsSync(path.join(mobileRoot, 'app/login.tsx')), false);

  const authLayout = readMobile('app/(auth)/_layout.tsx');
  assert.match(authLayout, /<Stack\.Screen name="login" \/>/);
  assert.doesNotMatch(authLayout, /<Stack\.Screen name="index" \/>/);
});

test('root navigator is anchored at index without a duplicate login screen', () => {
  assert.match(readMobile('app/_layout.tsx'), /anchor:\s*'index'/);
  const authGate = readMobile('components/auth/AuthGate.tsx');
  assert.doesNotMatch(authGate, /<Stack\.Screen name="login"/);
});

test('signin, signup, callback errors, and protected redirects use /login', () => {
  const navigation = readMobile('lib/navigation.ts');
  assert.match(navigation, /pathname:\s*'\/login'[\s\S]*mode:\s*'signin'/);
  assert.match(navigation, /pathname:\s*'\/login'[\s\S]*mode:\s*'signup'/);

  const callback = readMobile('app/auth/callback.tsx');
  assert.equal((callback.match(/`\/login\?error=/g) ?? []).length, 2);
  assert.match(readMobile('app/(auth)/forgot-password.tsx'), /\/login\?mode=signin/);
  assert.match(readMobile('app/shared-vehicle-history.tsx'), /Redirect href="\/login"/);
});

test('successful profile sign-out returns to the public root', () => {
  const profile = readMobile('app/(tabs)/profile.tsx');
  assert.match(profile, /if \(result\.error\)[\s\S]*return;[\s\S]*router\.replace\('\/'\)/);
});

test('native entry opens login and preserves OAuth code forwarding', async () => {
  const { harness } = require('./componentHarness.cjs');
  const file = path.join(mobileRoot, 'app/index.tsx');
  const router = { 'expo-router': { Redirect: 'Redirect' } };
  const native = harness(file, router, 'ios');
  await native.flush({});
  assert.equal(native.tree.props.href, '/login');

  const callback = harness(file, router, 'web', {
    URLSearchParams, window: { location: { search: '?code=a%2Bb' } },
  });
  await callback.flush({});
  assert.equal(callback.tree.props.href, '/auth/callback?code=a%2Bb');
});

test('no migrated navigation redirects target the auth group root', () => {
  const sourceFiles = walk(path.join(mobileRoot, 'app'))
    .concat(walk(path.join(mobileRoot, 'components')))
    .concat(walk(path.join(mobileRoot, 'lib')))
    .filter(file => /\.(?:ts|tsx)$/.test(file));

  const offenders = sourceFiles.flatMap(file => {
    const source = fs.readFileSync(file, 'utf8');
    return /(?:href|pathname):?\s*=*\s*["'`]\/\(auth\)(?:\?|["'`])|router\.(?:push|replace)\(["'`]\/\(auth\)(?:\?|["'`])/.test(source)
      ? [path.relative(mobileRoot, file)]
      : [];
  });

  assert.deepEqual(offenders, []);
  assert.match(readMobile('lib/navigation.ts'), /\/\(auth\)\/verify-email/);
  assert.match(readMobile('app/(auth)/login.tsx'), /\/\(auth\)\/forgot-password/);
});

test('Vercel serves generated static route documents with clean URLs', () => {
  const config = JSON.parse(fs.readFileSync(path.join(projectRoot, 'vercel.json'), 'utf8'));
  assert.equal(config.cleanUrls, true);
  assert.deepEqual(config.rewrites ?? [], []);
});

test('Expo web uses the existing GasTa mark as favicon', () => {
  const appConfig = JSON.parse(readMobile('app.json'));
  const favicon = appConfig.expo.web.favicon;
  assert.equal(favicon, './assets/images/gasta-mark.png');
  assert.equal(fs.existsSync(path.join(mobileRoot, favicon)), true);
});

test('native OAuth keeps the public /oauth-bridge.html compatibility URL', () => {
  assert.match(readMobile('lib/auth.ts'), /\$\{PUBLIC_SITE_URL\}\/oauth-bridge\.html\?native=/);
  assert.equal(fs.existsSync(path.join(mobileRoot, 'public/oauth-bridge.html')), true);
});
