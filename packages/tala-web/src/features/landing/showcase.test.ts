import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHOTS, type ShotName } from './shots';
import { en } from '../../i18n/en';
import { fil } from '../../i18n/fil';

const DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../public/screens/home');
const manifest = JSON.parse(readFileSync(resolve(DIR, 'manifest.json'), 'utf8')) as { files: Array<{ name: string; w: number; h: number; webp: number; jpg: number }> };
const NAMES = Object.keys(SHOTS) as ShotName[];
const LANGS = ['en', 'fil'] as const;
const VIEWS = ['wide', 'phone'] as const;
// What one visitor downloads for one picture. Teachers open this page on mobile data.
const BUDGET = { wide: { webp: 160_000, jpg: 220_000 }, phone: { webp: 80_000, jpg: 110_000 } };

test('every homepage picture exists in both languages, both layouts and both formats', () => {
  for (const name of NAMES)
    for (const lang of LANGS)
      for (const view of VIEWS)
        for (const ext of ['webp', 'jpg'] as const) assert.ok(existsSync(resolve(DIR, `${name}-${view}-${lang}.${ext}`)), `${name}-${view}-${lang}.${ext} is in public/screens/home`);
  assert.equal(manifest.files.length, NAMES.length * LANGS.length * VIEWS.length, 'the manifest lists exactly the pictures the page uses');
});

test('the sizes the page reserves are the sizes of the files (nothing shifts while a picture loads)', () => {
  for (const name of NAMES)
    for (const lang of LANGS)
      for (const view of VIEWS) {
        const file = manifest.files.find((f) => f.name === `${name}-${view}-${lang}`);
        assert.ok(file, `${name}-${view}-${lang} is in the manifest`);
        assert.deepEqual([file.w, file.h], [...SHOTS[name][view]], `${name}-${view}-${lang}: run scripts/home-capture.mjs for both languages and update SHOTS`);
      }
});

test('no picture is heavier than its budget, and the manifest tells the truth about the bytes', () => {
  for (const f of manifest.files) {
    const view = f.name.includes('-wide-') ? 'wide' : 'phone';
    for (const ext of ['webp', 'jpg'] as const) {
      const bytes = statSync(resolve(DIR, `${f.name}.${ext}`)).size;
      assert.equal(bytes, f[ext], `${f.name}.${ext}: manifest bytes`);
      assert.ok(bytes <= BUDGET[view][ext], `${f.name}.${ext} is ${bytes} bytes, over the ${BUDGET[view][ext]} budget`);
    }
  }
});

test('each picture has a description in both languages, and the caveats stay on the page', () => {
  for (const strings of [en, fil] as Array<Record<string, string>>) {
    for (const key of ['landing.s.mg.alt', 'landing.s.sl.alt']) assert.ok((strings[key] ?? '').length > 60, `${key} describes its picture`);
    // Wherever slides or packs are shown, the page says they are AI drafts a teacher must check.
    assert.match(strings['landing.s.sl.draft']!, /AI/);
    assert.match(strings['landing.s.cur.packs']!, /AI/);
    assert.match(strings['landing.s.cur.packs']!, /\{built\}.*\{weeks\}/);
  }
  assert.match(en['landing.s.cur.packs'], /no teacher has reviewed/);
  assert.match(fil['landing.s.cur.packs'], /wala pang gurong nagsuri/);
});

test('the non-affiliation disclaimer is word for word what it was', () => {
  const disclaimer =
    'Hiraia is not affiliated with or endorsed by the Philippine Department of Education. Its alignment with the Revised K-12 Curriculum is based on information and content in the public domain, and is not guaranteed to be accurate, and has not been reviewed by the Department of Education or other public academic institutions. Although its originator has endeavoured to provide the most accurate synthesis possible of the current public school science curriculum, usage of Hiraia should be carried out at your own risk.';
  assert.equal(en['landing.footerDeped'], disclaimer);
  assert.equal(fil['landing.footerDeped'], disclaimer);
});

test('the homepage names no model provider', () => {
  for (const strings of [en, fil] as Array<Record<string, string>>)
    for (const [key, text] of Object.entries(strings)) if (key.startsWith('landing.')) assert.doesNotMatch(text, /deepseek|qwen|openrouter/i, `${key} names a provider`);
});
