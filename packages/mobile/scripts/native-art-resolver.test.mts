import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_SLUGS, resolveImage } from '../src/generated/imageMap.android';
import { artUri, hasArt, markArtDownloaded, installBundledArt } from '../src/data/artPresence';
import selection from '../src/config/bundled-art.selection.json';

test('native bundled images retain original dimensions, grade fallbacks, and missing-art behavior', () => {
  assert.equal(IMAGE_SLUGS.size, selection.approvedImages);
  assert.deepEqual(IMAGE_SLUGS, new Set(selection.keep));
  assert.deepEqual(resolveImage('adaptation-finch-beak-shapes'), {
    uri: 'asset:/illustrations/adaptation-finch-beak-shapes.png', width: 512, height: 442,
  });
  assert.deepEqual(resolveImage('adaptation-finch-beak-shapes-g5'), resolveImage('adaptation-finch-beak-shapes'));
  assert.equal(resolveImage('unknown-no-art'), null);
  assert.equal(hasArt('adaptation-finch-beak-shapes'), true);
});

test('grade-suffixed cards can use an image after it moves from the APK to a download', () => {
  installBundledArt(IMAGE_SLUGS);
  markArtDownloaded('downloaded-base', 'file:///downloaded/base.png');
  assert.equal(hasArt('downloaded-base-g5'), true);
  assert.equal(artUri('downloaded-base-g5'), 'file:///downloaded/base.png');
  markArtDownloaded('downloaded-base-g5', 'file:///downloaded/grade5.png');
  assert.equal(artUri('downloaded-base-g5'), 'file:///downloaded/grade5.png');
  assert.equal(hasArt('not-installed-base-g5'), false);
});

test('downloaded art still overrides bundled art through the existing URI registry', () => {
  const slug = 'adaptation-finch-beak-shapes';
  markArtDownloaded(slug, 'file:///downloaded/newer.png');
  assert.equal(artUri(slug), 'file:///downloaded/newer.png');
  assert.equal(hasArt(slug), true);
  markArtDownloaded('download-only-test', 'file:///downloaded/tail.png');
  assert.equal(hasArt('download-only-test'), true);
  assert.equal(resolveImage('download-only-test'), null);
});
