import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_SLUGS, resolveImage } from '../src/generated/imageMap.android';
import { artUri, hasArt, markArtDownloaded } from '../src/data/artPresence';

test('native bundled images retain original dimensions, grade fallbacks, and missing-art behavior', () => {
  assert.equal(IMAGE_SLUGS.size, 12373);
  assert.deepEqual(resolveImage('adaptation-finch-beak-shapes'), {
    uri: 'asset:/illustrations/adaptation-finch-beak-shapes.png', width: 512, height: 442,
  });
  assert.deepEqual(resolveImage('adaptation-finch-beak-shapes-g5'), resolveImage('adaptation-finch-beak-shapes'));
  assert.equal(resolveImage('unknown-no-art'), null);
  assert.equal(hasArt('adaptation-finch-beak-shapes'), true);
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
