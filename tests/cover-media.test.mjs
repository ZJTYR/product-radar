import test from 'node:test';
import assert from 'node:assert/strict';
import { coverMedia } from '../lib/cover-media.ts';

test('responsive Framer covers preserve the asset and metadata while selecting CDN variants', () => {
  const source = 'https://framerusercontent.com/images/example.png?width=3200&height=1800';
  const card = coverMedia(source);
  const featured = coverMedia(source, true);
  const image = new URL(card.src);
  assert.equal(image.searchParams.get('scale-down-to'), '512');
  assert.equal(image.searchParams.get('width'), '3200');
  assert.equal(image.pathname, '/images/example.png');
  assert.match(card.srcSet, /1024w/);
  assert.doesNotMatch(card.srcSet, /2048w/);
  assert.match(featured.srcSet, /2048w/);
  assert.equal(new URL(featured.src).searchParams.get('scale-down-to'), '1024');
  assert.equal(source, 'https://framerusercontent.com/images/example.png?width=3200&height=1800');
});

test('Qt covers keep the screenshot ratio and never enlarge a known thumbnail', () => {
  const screenshot = 'https://www.qt.io/hs-fs/hubfs/Clate.webp?width=811&height=456&name=Clate.webp';
  const image = coverMedia(screenshot);
  assert.equal(new URL(image.src).searchParams.get('width'), '400');
  assert.equal(new URL(image.src).searchParams.get('height'), '225');
  assert.match(image.srcSet, /811w/);
  assert.doesNotMatch(image.srcSet, /1200w/);
  const thumbnail = 'https://www.qt.io/hs-fs/hubfs/icon.png?width=140&height=140';
  assert.deepEqual(coverMedia(thumbnail), { src: thumbnail });
});

test('unknown hosts, relative assets and signed URLs are returned untouched', () => {
  for (const source of ['/images/local.png', 'https://example.com/screen.png?width=400', 'http://framerusercontent.com/images/a.png', 'https://framerusercontent.com/images/a.png?token=private', 'https://user:pass@framerusercontent.com/images/a.png', 'not a URL']) assert.deepEqual(coverMedia(source), { src: source });
});
