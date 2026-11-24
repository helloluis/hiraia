/**
 * Rewrite the print snapshots (src/print/snapshots/*.html, *.txt) from the fixtures, after a deliberate change to
 * the print page. Read the diff before keeping it: a snapshot is the page teachers print.
 *   pnpm exec tsx scripts/print-snapshots.mts
 */
import { writeFileSync } from 'node:fs';
import { frauncesBase64, renderPlanHtml, renderPlanText } from '../src/print/index';
import { printFixture } from '../src/print/fixtures';

for (const kind of ['dlp', 'dll', 'multigrade'] as const) {
  const fixture = printFixture(kind);
  writeFileSync(new URL(`../src/print/snapshots/${kind}.html`, import.meta.url), renderPlanHtml(fixture).replace(frauncesBase64, '[BUNDLED_FRAUNCES]'));
  writeFileSync(new URL(`../src/print/snapshots/${kind}.txt`, import.meta.url), renderPlanText(fixture));
  console.log(`${kind}: snapshots written`);
}
