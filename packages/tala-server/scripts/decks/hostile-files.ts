/**
 * Writes the hostile test files (src/modules/decks/hostile-files.ts) out as files, to try by hand or to send to a
 * running site with something other than the scripts here.
 *
 *   pnpm exec tsx scripts/decks/hostile-files.ts <new folder>
 *
 * The folder must not hold files of these names already: nothing is overwritten.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { HOSTILE_FILES } from '../../src/modules/decks/hostile-files';

const folder = process.argv[2];
if (!folder) throw new Error('usage: hostile-files.ts <new folder>');
mkdirSync(folder, { recursive: true, mode: 0o700 });
for (const f of HOSTILE_FILES) {
  const bytes = f.build();
  writeFileSync(`${folder}/${f.name}.pptx`, bytes, { flag: 'wx', mode: 0o600 });
  console.log(`${String(bytes.length).padStart(9)} bytes  ${f.name}.pptx\n           ${f.about}\n           reading it: ${f.expect}${f.then ? `; then ${f.then.about}: the edited download is ${f.then.download}` : ''}`);
}
