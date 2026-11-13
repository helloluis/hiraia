import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderPlanHtml, renderPlanText, printPageSize, printOrientation, frauncesBase64 } from './index';
import { printFixture } from './fixtures';
for (const kind of ['dlp', 'dll', 'multigrade'] as const) test(`${kind} deterministic HTML and text snapshots`, () => {
  const fixture = printFixture(kind);
  const html = renderPlanHtml(fixture);
  assert.equal(html, renderPlanHtml(fixture));
  assert.equal(html.replace(frauncesBase64, '[BUNDLED_FRAUNCES]'), readFileSync(new URL(`./snapshots/${kind}.html`, import.meta.url), 'utf8'));
  assert.equal(renderPlanText(fixture), readFileSync(new URL(`./snapshots/${kind}.txt`, import.meta.url), 'utf8'));
  assert.ok(!/<script|<iframe|<link|<img|url\(https?:/i.test(html));
  assert.ok(html.includes('DRAFT')); assert.ok(html.includes('Prepared by')); assert.ok(html.includes('Checked by'));
  assert.ok(html.includes('ñ, á, é, í, ó, ú')); assert.ok(html.includes('data:font/ttf;base64,'));
});
test('print orientation, long bond size, locked footer and attribution', () => {
  const o = printFixture('multigrade');
  assert.equal(printOrientation(o), 'landscape'); assert.deepEqual(printPageSize({ ...o, paper: 'long' }), [936, 612]);
  const html = renderPlanHtml({ ...o, plan: { ...o.plan, state: 'locked', lock: { lockedAt: '2026-11-13T00:00:00Z', revisionCode: 'ABC123', revision: 4 }, lineage: { artifactId: 'artifact1', versionId: 'version1', title: 'Source', authorDisplayName: 'Author' } } });
  assert.ok(!html.includes('aria-hidden="true">DRAFT')); assert.ok(html.includes('ABC123')); assert.ok(html.includes('Source')); assert.ok(html.includes('artifact1/version1'));
});
test('user text is escaped everywhere and images=false needs no network', () => {
  const o = printFixture('dlp'); o.plan.title = '<script>alert(1)</script>'; o.teacherName = '" onload="bad';
  const html = renderPlanHtml({ ...o, includeImages: false }); assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>'));
  assert.equal(html, renderPlanHtml({ ...o, includeImages: true }));
});
