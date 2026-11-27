const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { harness, find } = require('./componentHarness.cjs');

const videoFile = path.join(__dirname, '../components/landing/LandingHeroVideo.web.tsx');
const byType = (tree, type) => find(tree, node => node.type === type);

async function setup({ reducedMotion = false, saveData = false } = {}) {
  const events = new Map();
  const document = {
    visibilityState: 'visible',
    addEventListener(type, cb) { events.set(type, cb); },
    removeEventListener(type) { events.delete(type); },
  };
  const connection = {
    saveData,
    addEventListener(type, cb) { events.set(type, cb); },
    removeEventListener(type) { events.delete(type); },
  };
  const h = harness(videoFile, {
    '@/constants/Theme': {
      colors: { navy: '#192D42', accent: '#DCE9B5' },
      radii: { sm: 12, lg: 22 },
      spacing: { md: 16, lg: 24 },
    },
    '@/hooks/useReducedMotion': { useReducedMotion: () => reducedMotion },
  }, 'web', { document, navigator: { connection } });
  await h.flush({});
  const video = () => byType(h.tree, 'video');
  const poster = () => byType(h.tree, 'img');
  const calls = { play: 0, pause: 0 };
  const media = {
    async play() { calls.play++; },
    pause() { calls.pause++; },
  };
  video().props.ref.current = media;
  return {
    h, video, poster, calls, media,
    visibility(state) {
      document.visibilityState = state;
      events.get('visibilitychange')();
    },
    async setSaveData(value) {
      connection.saveData = value;
      events.get('change')();
      await h.flush();
    },
  };
}

test('video autoplays muted and inline on a loop, without native or custom playback controls', async () => {
  const { h, video, poster } = await setup();
  const { props } = video();
  assert.equal(props.src, '/landing/gasta-landing-hero.mp4');
  assert.equal(props.poster, '/landing/gasta-landing-poster.jpg');
  assert.equal(props.autoPlay, true);
  assert.equal(props.loop, true);
  assert.equal(props.muted, true);
  assert.equal(props.playsInline, true);
  assert.equal(props.controls, false);
  assert.equal(props.tabIndex, -1);
  assert.equal(find(h.tree, node => node.props?.accessibilityRole === 'button' || node.props?.onPress), null);
  assert.equal(poster().props.style.opacity, 1);
  props.onPlaying();
  await h.flush();
  assert.equal(poster().props.style.opacity, 0);
  assert.equal(video().props.style.opacity, 1);
});

test('reduced motion and data saver keep the poster instead of starting playback', async () => {
  for (const options of [{ reducedMotion: true }, { saveData: true }]) {
    const { video, poster, calls, visibility } = await setup(options);
    assert.equal(video().props.autoPlay, false);
    assert.equal(video().props.preload, 'none');
    visibility('visible');
    assert.equal(calls.play, 0);
    assert.equal(poster().props.style.opacity, 1);
  }
});

test('visibility and data-saver changes pause and resume automatic playback', async () => {
  const { visibility, setSaveData, video, poster, calls, h } = await setup();
  visibility('hidden');
  assert.equal(calls.pause, 1);
  visibility('visible');
  assert.equal(calls.play, 1);
  video().props.onPlaying();
  await h.flush();
  await setSaveData(true);
  assert.equal(calls.pause, 2);
  assert.equal(poster().props.style.opacity, 1);
  visibility('visible');
  assert.equal(calls.play, 1);
  await setSaveData(false);
  assert.equal(calls.play, 2);
});

test('browser-denied autoplay falls back to the poster without a retry button', async () => {
  const { h, video, poster, media, visibility } = await setup();
  video().props.onPlaying();
  await h.flush();
  media.play = async () => { throw new Error('Playback denied'); };
  visibility('visible');
  await h.flush();
  assert.equal(poster().props.style.opacity, 1);
  assert.equal(byType(h.tree, 'Pressable'), null);
});

test('media errors remove the failed video and keep the poster', async () => {
  const { h, video, poster } = await setup();
  video().props.onError();
  await h.flush();
  assert.equal(video(), null);
  assert.equal(poster().props.style.opacity, 1);
});
