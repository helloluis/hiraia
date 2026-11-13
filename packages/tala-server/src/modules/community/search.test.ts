import test from 'node:test';
import assert from 'node:assert/strict';
import type { ArtifactTags } from '@hiraia/tala-core';
import { createTestServer } from '../../testing';
import { createCommunityModule } from './index';
import type { VersionMeta } from './publish';
import { encodeCursor, parseQuery } from './search';
import { insertArtifact, insertVersion } from './store';
import type { ArtifactStatus } from './store';
import { createFakeLlm, fid } from './testing';

function server() {
  return createTestServer({
    modules: [createCommunityModule({ recheckIntervalMs: 0 })],
    services: { llm: createFakeLlm() },
    quiet: true,
  });
}

type Seed = Partial<ArtifactTags> & {
  title?: string;
  summary?: string;
  status?: ArtifactStatus;
  author?: string;
  copies?: number;
  updatedAt?: string;
};

function seed(db: ReturnType<typeof server>['db'], s: Seed = {}): string {
  const tags: ArtifactTags = {
    grades: ['4'],
    learningAreaId: 'science',
    subjectName: 'Science',
    termIndex: 1,
    competencyIds: ['C1'],
    curriculumVersion: 'science-bow-2026',
    language: 'fil',
    templateKind: 'dlp',
    durationMinutes: 50,
    multigrade: null,
    region: null,
    ...s,
  };
  const meta: VersionMeta = {
    title: s.title ?? 'Lesson',
    summary: s.summary ?? '',
    authorDisplayName: 'T',
    authorSchool: null,
    tags,
    provenance: { aiDrafted: false, adapted: false },
    lineage: null,
  };
  const id = fid('art');
  const versionId = fid('ver');
  const now = s.updatedAt ?? '2026-11-16T00:00:00.000Z';
  insertArtifact(db, {
    id,
    authorId: s.author ?? 'author-0001',
    sourcePlanId: fid('plan'),
    versionId,
    status: s.status ?? 'visible',
    meta,
    decision: { decision: 'allow', reasons: [], guidelineVersion: 1 },
    now,
  });
  insertVersion(db, {
    id: versionId,
    artifactId: id,
    number: 1,
    status: 'allowed',
    planRevision: 1,
    revisionCode: 'X',
    content: {
      templateId: 'tpl.dlp.v1',
      gradeGroups: [],
      competencies: {},
      customObjectives: [],
      sections: [],
    },
    meta,
    createdAt: now,
  });
  if (s.copies)
    db.prepare('UPDATE community_artifacts SET copy_count = ? WHERE id = ?').run(s.copies, id);
  return id;
}

test('20 per page, at most 200 per query, then no cursor', async () => {
  const t = server();
  const u = await t.registerUser();
  for (let i = 0; i < 230; i++) seed(t.db);
  const seen = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await t.ok('community.search', {
      query: cursor ? { cursor } : {},
      token: u.token,
    });
    assert.ok(page.items.length <= 20);
    for (const item of page.items) seen.add(item.id);
    cursor = page.nextCursor ?? undefined;
    pages++;
  } while (cursor && pages < 50);
  assert.equal(pages, 10);
  assert.equal(seen.size, 200);
  // A forged cursor past the cap returns nothing; garbage is a plain error.
  assert.deepEqual(
    await t.ok('community.search', { query: { cursor: encodeCursor(200) }, token: u.token }),
    { items: [], nextCursor: null }
  );
  assert.equal(
    (await t.call('community.search', { query: { cursor: 'not-a-cursor' }, token: u.token })).error
      ?.code,
    'invalid_input'
  );
  assert.equal(
    (await t.call('community.search', { query: { cursor: encodeCursor(5000) }, token: u.token }))
      .error?.code,
    'invalid_input'
  );
  t.close();
});

test('the configured page size is honoured but never exceeds the contract', async () => {
  const t = createTestServer({
    modules: [createCommunityModule({ recheckIntervalMs: 0 })],
    services: { llm: createFakeLlm() },
    config: { limits: { pageSize: 5 } },
    quiet: true,
  });
  const u = await t.registerUser();
  for (let i = 0; i < 7; i++) seed(t.db);
  const first = await t.ok('community.search', { query: {}, token: u.token });
  assert.equal(first.items.length, 5);
  const second = await t.ok('community.search', {
    query: { cursor: first.nextCursor! },
    token: u.token,
  });
  assert.equal(second.items.length, 2);
  assert.equal(second.nextCursor, null);
  t.close();
});

test('every contract filter narrows the results', async () => {
  const t = server();
  const u = await t.registerUser();
  const base = seed(t.db);
  const g6 = seed(t.db, { grades: ['6'] });
  const math = seed(t.db, { learningAreaId: 'mathematics', subjectName: 'Mathematics' });
  const q3 = seed(t.db, { termIndex: 3 });
  const c9 = seed(t.db, { competencyIds: ['C9', 'C1'] });
  const en = seed(t.db, { language: 'en' });
  const bicol = seed(t.db, { region: 'Bicol' });
  const mg = seed(t.db, { grades: ['2', '4'], multigrade: ['2', '4'] });
  const long = seed(t.db, { durationMinutes: 120 });
  const titled = seed(t.db, { title: 'Water cycle adventure' });
  seed(t.db, { status: 'pending_check' });
  seed(t.db, { status: 'hidden' });
  seed(t.db, { status: 'returned' });
  seed(t.db, { status: 'removed' });
  const mine = seed(t.db, { author: u.id, status: 'pending_check' });
  const mineRemoved = seed(t.db, { author: u.id, status: 'removed' });

  const ids = async (query: Record<string, unknown>) =>
    (await t.ok('community.search', { query, token: u.token })).items.map((i) => i.id).sort();
  const sorted = (...x: string[]) => [...x].sort();

  assert.deepEqual(await ids({ grade: '6' }), [g6]);
  assert.deepEqual(await ids({ grade: '2' }), [mg]);
  assert.deepEqual(await ids({ learningAreaId: 'mathematics' }), [math]);
  assert.deepEqual(await ids({ termIndex: 3 }), [q3]);
  assert.deepEqual(await ids({ competencyId: 'C9' }), [c9]);
  assert.deepEqual(await ids({ language: 'en' }), [en]);
  assert.deepEqual(await ids({ region: 'bicol' }), [bicol]);
  assert.deepEqual(await ids({ multigrade: '4, 2' }), [mg]);
  assert.ok(!(await ids({ maxMinutes: 60 })).includes(long));
  assert.deepEqual(await ids({ q: 'water cycle' }), [titled]);
  assert.deepEqual(await ids({ mine: true }), [mine]);
  assert.deepEqual(await ids({ mine: 'false' }), await ids({}));
  // Only visible ones, plus the caller's own non-removed.
  const all = await ids({});
  assert.ok(all.includes(mine) && !all.includes(mineRemoved));
  assert.equal(all.length, 11);
  assert.deepEqual(
    await ids({ q: 'grade 6 science' }),
    [g6],
    'free text sets the grade and learning-area filters'
  );
  assert.ok((await ids({ q: 'q3' })).every((id) => id === q3));
  assert.deepEqual(
    await ids({ grade: '4', competencyId: 'C9', language: 'fil', termIndex: 1 }),
    [c9],
    'filters combine'
  );
  assert.deepEqual(
    await ids({
      grade: '4',
      learningAreaId: 'science',
      termIndex: 1,
      language: 'fil',
      maxMinutes: 50,
    }),
    sorted(base, c9, bicol, mg, titled, mine)
  );
  t.close();
});

test('ranking: competency match first, then copy count; recency only breaks ties', async () => {
  const t = server();
  const u = await t.registerUser();
  const broadPopular = seed(t.db, {
    competencyIds: ['C1', 'C2', 'C3'],
    copies: 50,
    updatedAt: '2026-11-20T00:00:00.000Z',
  });
  const focusedOld = seed(t.db, {
    competencyIds: ['C1'],
    copies: 1,
    updatedAt: '2026-06-01T00:00:00.000Z',
  });
  const focusedPopular = seed(t.db, {
    competencyIds: ['C1'],
    copies: 9,
    updatedAt: '2026-07-01T00:00:00.000Z',
  });
  const order = (
    await t.ok('community.search', { query: { competencyId: 'C1' }, token: u.token })
  ).items.map((i) => i.id);
  assert.deepEqual(order, [focusedPopular, focusedOld, broadPopular]);

  const newest = seed(t.db, {
    competencyIds: ['C7'],
    copies: 0,
    updatedAt: '2026-12-01T00:00:00.000Z',
  });
  const popular = seed(t.db, {
    competencyIds: ['C7'],
    copies: 3,
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  const order2 = (
    await t.ok('community.search', { query: { competencyId: 'C7' }, token: u.token })
  ).items.map((i) => i.id);
  assert.deepEqual(order2, [popular, newest], 'a newer lesson does not outrank a more-copied one');
  t.close();
});

test('query parser: grade, quarter and learning area come out; other words stay keywords', () => {
  assert.deepEqual(parseQuery('Grade 4 Science Q2 water cycle'), {
    grade: '4',
    termIndex: 2,
    learningAreaId: 'science',
    keywords: ['water', 'cycle'],
  });
  assert.deepEqual(parseQuery('ikalawang markahan agham baitang 5 mga halaman'), {
    grade: '5',
    termIndex: 2,
    learningAreaId: 'science',
    keywords: ['halaman'],
  });
  assert.deepEqual(parseQuery('Araling Panlipunan bayani'), {
    grade: null,
    termIndex: null,
    learningAreaId: null,
    keywords: ['araling', 'panlipunan', 'bayani'],
  });
  assert.deepEqual(parseQuery('100% fractions_'), {
    grade: null,
    termIndex: null,
    learningAreaId: null,
    keywords: ['100', 'fractions'],
  });
});

test('keywords with LIKE wildcards are matched literally', async () => {
  const t = server();
  const u = await t.registerUser();
  const pct = seed(t.db, { title: 'Percent 50% off' });
  seed(t.db, { title: 'Fifty off' });
  assert.deepEqual(
    (await t.ok('community.search', { query: { q: '50%' }, token: u.token })).items.map(
      (i) => i.id
    ),
    [pct]
  );
  t.close();
});
