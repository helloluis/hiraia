/**
 * The Mathematics pilot (six weeks, 21 Nov 2026): a second, separate pack library beside the Science one.
 * What must hold: Science answers exactly as before; Mathematics is found beside the Science root without any new
 * setting; a draft stays closed to visitors; its extra files and slide pictures are served; a Science refresh
 * cannot remove it; and a pilot deck is never copied for editing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACK_ID_PATTERN, WeeklyPackContent, packSubjectOf } from '@hiraia/tala-core/contracts';
import { createTestServer } from '@hiraia/tala-server/testing';
import { createDecksModule } from '../decks';
import { createPacksModule } from './index';

const LIB = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../tala-packs/library/science-bow-2026');
const sample = existsSync(LIB) ? readdirSync(LIB).find((d) => existsSync(join(LIB, d, 'en', 'pack.json'))) : undefined;
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const MATH_ID = 'math26-g4-t3-w01';
const NOTE = 'Net B is deliberately invalid for comparison; do not force it closed.';
const KINDS = ['slides', 'guide', 'plans', 'exercises', 'solutions', 'diagrams', 'templates'] as const;

const review = (packId: string, language: string, contentSha256: string) => ({
  packId,
  language,
  contentSha256,
  autoChecks: { state: 'pass', checkerVersion: 'test', failures: [], warnings: [], at: '2026-11-21T00:00:00Z' },
  modelCritique: { state: 'pass', model: 'test-model', rounds: 1, openIssues: [], resolvedIssues: 0, at: '2026-11-21T00:00:00Z' },
  teacherReview: null,
  expertReview: null,
  verbiage: null,
  publication: 'draft',
  publicationBy: null,
});
const counts = (draft: number) => ({ targets: draft, approved: 0, draft, needsWork: 0, failed: 0, notBuilt: 0 });

/** `<root>/packs` is a Science library with one real week as a draft; `<root>/packs-math` is the pilot, when asked. */
function fixture(options: { math?: boolean; mathClaimsScience?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tala-math-'));
  const science = join(root, 'packs');
  const id = sample!;
  const real = readFileSync(join(LIB, id, 'en', 'pack.json'), 'utf8');

  const writeVersion = (base: string, library: string, packId: string, lang: 'en' | 'fil', content: string, files: Array<{ kind: string; name: string; data: Buffer }>, previews: string[]) => {
    mkdirSync(join(base, library, packId, lang), { recursive: true });
    writeFileSync(join(base, library, packId, lang, 'pack.json'), content);
    writeFileSync(join(base, library, packId, lang, 'review.json'), JSON.stringify(review(packId, lang, sha(content))));
    mkdirSync(join(base, 'artifacts', packId, lang, 'previews'), { recursive: true });
    for (const f of files) writeFileSync(join(base, 'artifacts', packId, lang, f.name), f.data);
    for (const p of previews) writeFileSync(join(base, 'artifacts', packId, lang, 'previews', p), Buffer.from(`picture ${p}`));
    writeFileSync(
      join(base, 'artifacts', packId, lang, 'manifest.json'),
      JSON.stringify({ packId, language: lang, contentSha256: sha(content), previews: previews.length, files: files.map((f) => ({ kind: f.kind, name: f.name, bytes: f.data.length, sha256: sha(f.data) })) })
    );
  };
  const variant = (language: 'en' | 'fil', title: string | null, files: Array<{ kind: string; data: Buffer; note?: string }>) => ({
    language,
    status: title ? 'draft' : 'not_built',
    title,
    viewable: Boolean(title),
    files: files.map((f) => ({ kind: f.kind, bytes: f.data.length, sha256: sha(f.data), ...(f.note ? { note: f.note } : {}) })),
    slideCount: title ? 12 : null,
    illustratedSlides: title ? 2 : null,
    review: title ? { autoChecks: 'pass', modelCritique: 'pass', teacherReview: false, expertReview: false } : null,
  });

  // Science: one real week, English only.
  const deck = [{ kind: 'slides', name: 'deck.pptx', data: Buffer.from('PK science deck') }];
  writeVersion(science, 'science-bow-2026', id, 'en', real, deck, ['thumb-01.webp']);
  writeFileSync(
    join(science, 'index.json'),
    JSON.stringify({
      curriculumVersion: 'science-bow-2026',
      libraryVersion: '2026-11-19',
      reviewerView: true,
      counts: { ...counts(1), targets: 2, notBuilt: 1 },
      packs: [{ packId: id, grade: '4', term: 1, week: 8, topic: 'Science topic', competencyIds: [], status: 'draft', viewable: true, variants: { en: variant('en', JSON.parse(real).title, deck), fil: variant('fil', null, []) } }],
    })
  );

  if (options.math) {
    const math = join(root, 'packs-math');
    const variants: Record<string, unknown> = {};
    for (const lang of ['en', 'fil'] as const) {
      const pack = JSON.parse(real);
      Object.assign(pack, {
        packId: MATH_ID,
        learningAreaId: options.mathClaimsScience ? 'science' : 'mathematics',
        curriculumVersion: 'mathematics-bow-2026',
        grade: '4',
        term: 3,
        week: 1,
        language: lang,
        title: lang === 'en' ? 'Dissimilar fractions' : 'Mga fraction',
      });
      // Diagrams drawn by code keep their real provenance: the contract accepts it rather than relabelling them.
      for (const i of pack.illustrations) Object.assign(i, { v05Status: 'pilot_code_generated', check: { ...i.check, method: 'code_and_visual' } });
      const files = KINDS.map((kind) => ({ kind, name: `${kind}-${lang}.${kind === 'slides' ? 'pptx' : 'pdf'}`, data: Buffer.from(`${kind} ${lang}`), ...(kind === 'templates' ? { note: NOTE } : {}) }));
      writeVersion(math, 'mathematics-bow-2026', MATH_ID, lang, JSON.stringify(pack), files, ['thumb-01.png', 'thumb-02.png']);
      variants[lang] = variant(lang, pack.title, files);
    }
    writeFileSync(
      join(math, 'index.json'),
      JSON.stringify({
        subject: 'mathematics',
        curriculumVersion: 'mathematics-bow-2026',
        libraryVersion: '2026-11-21',
        reviewerView: false,
        counts: counts(2),
        packs: [{ packId: MATH_ID, grade: '4', term: 3, week: 1, topic: 'Operations on Dissimilar Fractions', competencyIds: [], status: 'draft', viewable: true, variants }],
      })
    );
  }
  // Only the Science folders are named, as on the host: Mathematics is found beside them.
  const opts = { libraryDir: join(science, 'science-bow-2026'), artifactsDir: join(science, 'artifacts') };
  return { root, science, id, opts };
}

test('pack ids name their learning area', () => {
  assert.equal(packSubjectOf('sci26-g4-t2-w10'), 'science');
  assert.equal(packSubjectOf(MATH_ID), 'mathematics');
  assert.ok(PACK_ID_PATTERN.test(MATH_ID) && PACK_ID_PATTERN.test('sci26-g10-t3-w11'));
  assert.ok(!PACK_ID_PATTERN.test('eng26-g4-t3-w01') && !PACK_ID_PATTERN.test('math26-g4-t3-w1'));
});

test('Mathematics pilot: its own index beside Science, Science unchanged', { skip: !sample }, async () => {
  const f = fixture({ math: true });
  const t = createTestServer({ modules: [createPacksModule(f.opts)], quiet: true });
  try {
    const teacher = await t.registerUser();
    const science = await t.ok('packs.index', { token: teacher.token });
    assert.equal(science.subject, 'science');
    assert.deepEqual(science.packs.map((p) => p.packId), [f.id]);
    const math = await t.ok('packs.index', { query: { subject: 'mathematics' }, token: teacher.token });
    assert.equal(math.subject, 'mathematics');
    assert.equal(math.curriculumVersion, 'mathematics-bow-2026');
    assert.deepEqual(math.packs.map((p) => p.packId), [MATH_ID]);
    assert.deepEqual(math.counts, counts(2));
    assert.equal(math.packs[0]!.variants.fil.status, 'draft');
    // The author's instructions travel with the file they belong to.
    assert.equal(math.packs[0]!.variants.en.files.find((x) => x.kind === 'templates')?.note, NOTE);
  } finally {
    t.close();
  }
});

test('Mathematics pilot: a draft is closed to visitors and open to a signed-in teacher', { skip: !sample }, async () => {
  const f = fixture({ math: true });
  const t = createTestServer({ modules: [createPacksModule(f.opts)], quiet: true });
  try {
    const visitor = await t.ok('packs.index', { query: { subject: 'mathematics' } });
    const v = visitor.packs[0]!.variants.en;
    assert.deepEqual([v.status, v.viewable, v.title, v.files.length], ['draft', false, null, 0]);
    assert.equal((await t.call('packs.detail', { params: { packId: MATH_ID }, query: { lang: 'en' } })).status, 404);
    assert.equal((await t.request('GET', `/packs/${MATH_ID}/files/solutions?lang=en`, {})).status, 404);
    assert.equal((await t.request('GET', `/packs/${MATH_ID}/previews/1?lang=en`, {})).status, 404);

    const teacher = await t.registerUser();
    for (const lang of ['en', 'fil'] as const) {
      const d = await t.ok('packs.detail', { params: { packId: MATH_ID }, query: { lang }, token: teacher.token });
      assert.equal(d.content.learningAreaId, 'mathematics');
      assert.equal(d.content.language, lang);
      assert.equal(d.review.publication, 'draft');
      assert.equal(d.review.teacherReview, null);
      assert.ok(WeeklyPackContent.safeParse(d.content).success);
      for (const i of d.content.illustrations) assert.deepEqual([i.v05Status, i.check.method], ['pilot_code_generated', 'code_and_visual']);
    }
  } finally {
    t.close();
  }
});

test('Mathematics pilot: every file kind and the slide pictures are served as built', { skip: !sample }, async () => {
  const f = fixture({ math: true });
  const t = createTestServer({ modules: [createPacksModule(f.opts)], quiet: true });
  try {
    const teacher = await t.registerUser();
    for (const kind of KINDS) {
      const res = await t.request('GET', `/packs/${MATH_ID}/files/${kind}?lang=fil`, { token: teacher.token });
      assert.equal(res.status, 200, kind);
      assert.equal(Buffer.from(await res.arrayBuffer()).toString(), `${kind} fil`);
      assert.equal(res.headers.get('content-type'), kind === 'slides' ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation' : 'application/pdf');
    }
    assert.equal((await t.request('GET', `/packs/${MATH_ID}/files/answers?lang=fil`, { token: teacher.token })).status, 404);
    for (const n of [1, 2]) {
      const res = await t.request('GET', `/packs/${MATH_ID}/previews/${n}?lang=en`, { token: teacher.token });
      assert.deepEqual([res.status, res.headers.get('content-type')], [200, 'image/png']);
      assert.equal(Buffer.from(await res.arrayBuffer()).toString(), `picture thumb-0${n}.png`);
    }
    assert.equal((await t.request('GET', `/packs/${MATH_ID}/previews/3?lang=en`, { token: teacher.token })).status, 404);
    // Science previews are still the small WebP thumbnails.
    const sci = await t.request('GET', `/packs/${f.id}/previews/1?lang=en`, { token: teacher.token });
    assert.deepEqual([sci.status, sci.headers.get('content-type')], [200, 'image/webp']);
  } finally {
    t.close();
  }
});

test('Mathematics pilot: replacing the Science library wholesale leaves it in place', { skip: !sample }, async () => {
  const f = fixture({ math: true });
  const t = createTestServer({ modules: [createPacksModule(f.opts)], quiet: true });
  try {
    const teacher = await t.registerUser();
    // The host's refresh: the Science folder is swapped for a new one.
    const fresh = fixture();
    renameSync(f.science, join(f.root, 'packs.prev'));
    renameSync(fresh.science, f.science);
    assert.deepEqual((await t.ok('packs.index', { token: teacher.token })).packs.map((p) => p.packId), [fresh.id]);
    const math = await t.ok('packs.index', { query: { subject: 'mathematics' }, token: teacher.token });
    assert.deepEqual(math.packs.map((p) => p.packId), [MATH_ID]);
    assert.equal((await t.request('GET', `/packs/${MATH_ID}/files/exercises?lang=en`, { token: teacher.token })).status, 200);
  } finally {
    t.close();
  }
});

test('where the Mathematics pilot is not installed, Science is all there is', { skip: !sample }, async () => {
  const f = fixture();
  const t = createTestServer({ modules: [createPacksModule(f.opts)], quiet: true });
  try {
    const teacher = await t.registerUser();
    assert.equal((await t.call('packs.index', { query: { subject: 'mathematics' }, token: teacher.token })).status, 404);
    const missing = await t.call('packs.detail', { params: { packId: MATH_ID }, query: { lang: 'en' }, token: teacher.token });
    assert.equal(missing.status, 404);
    assert.equal((await t.ok('packs.index', { token: teacher.token })).packs.length, 1);
    assert.ok((await t.call('packs.detail', { params: { packId: f.id }, query: { lang: 'en' }, token: teacher.token })).ok);
  } finally {
    t.close();
  }
});

test('a pack filed under Mathematics that says it is Science is never served', { skip: !sample }, async () => {
  const f = fixture({ math: true, mathClaimsScience: true });
  const t = createTestServer({ modules: [createPacksModule(f.opts)], quiet: true });
  try {
    const teacher = await t.registerUser();
    const d = await t.call('packs.detail', { params: { packId: MATH_ID }, query: { lang: 'en' }, token: teacher.token });
    assert.equal(d.status, 404);
  } finally {
    t.close();
  }
});

test('a Mathematics pilot deck is not copied for editing', { skip: !sample }, async () => {
  const f = fixture({ math: true });
  const t = createTestServer({ modules: [createPacksModule(f.opts), createDecksModule(f.opts)], quiet: true });
  try {
    const teacher = await t.registerUser();
    const made = await t.call('decks.create', { body: { packId: MATH_ID, lang: 'en' }, token: teacher.token });
    assert.equal(made.ok, false);
    assert.equal(made.status, 404);
    assert.match(made.error?.message ?? '', /Download the PowerPoint/);
    assert.equal((await t.ok('decks.list', { token: teacher.token })).decks.length, 0);
  } finally {
    t.close();
  }
});
