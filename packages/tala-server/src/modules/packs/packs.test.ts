import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PackIndex } from '@hiraia/tala-core';
import { createTestServer } from '@hiraia/tala-server/testing';
import { createPacksModule } from './index';

const LIB = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../tala-packs/library/science-bow-2026');
const sample = existsSync(LIB) ? readdirSync(LIB).find((d) => existsSync(join(LIB, d, 'en', 'pack.json'))) : undefined;
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

/** A throwaway library with one real week (English built, Filipino not yet), its review in a chosen state, and fake built files. */
function fixture(publication: 'draft' | 'approved') {
  const root = mkdtempSync(join(tmpdir(), 'tala-packs-'));
  const library = join(root, 'library', 'science-bow-2026');
  const artifacts = join(root, 'artifacts');
  const id = sample!;
  mkdirSync(join(library, id, 'en'), { recursive: true });
  const content = readFileSync(join(LIB, id, 'en', 'pack.json'), 'utf8');
  const review = JSON.parse(readFileSync(join(LIB, id, 'en', 'review.json'), 'utf8'));
  review.contentSha256 = sha(content);
  review.autoChecks.state = 'pass';
  review.modelCritique.state = 'pass';
  review.publication = publication;
  review.teacherReview = publication === 'approved' ? { reviewer: 'Test Teacher', role: 'Grade 4 teacher', verdict: 'approve', notes: '', at: '2026-11-19T00:00:00Z' } : null;
  review.publicationBy = publication === 'approved' ? 'Test Teacher' : null;
  writeFileSync(join(library, id, 'en', 'pack.json'), content);
  writeFileSync(join(library, id, 'en', 'review.json'), JSON.stringify(review));
  mkdirSync(join(artifacts, id, 'en', 'previews'), { recursive: true });
  const deck = Buffer.from('PK fake deck');
  writeFileSync(join(artifacts, id, 'en', 'deck.pptx'), deck);
  writeFileSync(join(artifacts, id, 'en', 'previews', 'thumb-01.webp'), Buffer.from('RIFF fake'));
  writeFileSync(
    join(artifacts, id, 'en', 'manifest.json'),
    JSON.stringify({ packId: id, language: 'en', contentSha256: review.contentSha256, previews: 1, files: [{ kind: 'slides', name: 'deck.pptx', bytes: deck.length, sha256: sha(deck) }] })
  );
  const status = publication === 'approved' ? 'approved' : 'draft';
  const variant = (language: 'en' | 'fil', built: boolean) => ({
    language,
    status: built ? status : 'not_built',
    title: built ? JSON.parse(content).title : null,
    viewable: built,
    files: built ? [{ kind: 'slides', bytes: deck.length, sha256: sha(deck) }] : [],
    slideCount: built ? 10 : null,
    illustratedSlides: built ? 3 : null,
    review: built ? { autoChecks: 'pass', modelCritique: 'pass', teacherReview: publication === 'approved', expertReview: false } : null,
  });
  const index = {
    curriculumVersion: 'science-bow-2026',
    libraryVersion: '2026-11-19',
    reviewerView: true,
    counts: { targets: 4, approved: publication === 'approved' ? 1 : 0, draft: publication === 'approved' ? 0 : 1, needsWork: 0, failed: 0, notBuilt: 3 },
    packs: [
      { packId: id, grade: '4', term: 1, week: 8, topic: 'Plant and Animal Systems', competencyIds: [], status, viewable: true, variants: { en: variant('en', true), fil: variant('fil', false) } },
      { packId: 'sci26-g4-t1-w09', grade: '4', term: 1, week: 9, topic: 'Plant and Animal Systems', competencyIds: [], status: 'not_built', viewable: false, variants: { en: variant('en', false), fil: variant('fil', false) } },
    ],
  };
  PackIndex.parse(index);
  writeFileSync(join(root, 'library', 'index.json'), JSON.stringify(index));
  return { id, library, artifacts, deck };
}

test('drafts stay out of the public library; reviewers can open them', { skip: !sample }, async () => {
  const f = fixture('draft');
  const t = createTestServer({ modules: [createPacksModule({ libraryDir: f.library, artifactsDir: f.artifacts })], quiet: true });
  try {
    const pub = await t.ok('packs.index');
    assert.equal(pub.reviewerView, false);
    const entry = pub.packs.find((p) => p.packId === f.id)!;
    assert.equal(entry.viewable, false);
    assert.equal(entry.variants.en.title, null, 'a draft title is not public');
    assert.deepEqual(entry.variants.en.files, []);
    const denied = await t.call('packs.detail', { params: { packId: f.id } });
    assert.equal(denied.ok, false);
    const file = await t.request('GET', `/packs/${f.id}/files/slides`);
    assert.equal(file.status, 404);

    const user = await t.registerUser();
    const asReviewer = await t.client(user.token).call('packs.index');
    assert.equal(asReviewer.reviewerView, true, 'any signed-in account reviews outside production');
    assert.equal(asReviewer.packs.find((p) => p.packId === f.id)!.variants.en.viewable, true);
    assert.equal(asReviewer.packs.find((p) => p.packId === f.id)!.variants.fil.viewable, false, 'an unbuilt language stays closed');
    const detail = await t.client(user.token).call('packs.detail', { params: { packId: f.id }, query: { lang: 'en' } });
    assert.equal(detail.content.packId, f.id);
    assert.equal(detail.language, 'en');
    const fil = await t.client(user.token).call('packs.detail', { params: { packId: f.id }, query: { lang: 'fil' } }).catch((e) => e);
    assert.ok(fil instanceof Error, 'the Filipino version is not built in this fixture');
    const dl = await t.request('GET', `/packs/${f.id}/files/slides?lang=en`, { token: user.token });
    assert.equal(dl.status, 200);
    assert.equal(dl.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    assert.match(dl.headers.get('content-disposition') ?? '', /attachment/);
    assert.deepEqual(Buffer.from(await dl.arrayBuffer()), f.deck);
    const preview = await t.request('GET', `/packs/${f.id}/previews/1`, { token: user.token });
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get('content-disposition'), null, 'previews display inline');
    const unbuilt = await t.client(user.token).call('packs.detail', { params: { packId: 'sci26-g4-t1-w09' } }).catch((e) => e);
    assert.ok(unbuilt instanceof Error);
  } finally {
    t.close();
  }
});

test('a file whose bytes no longer match its build manifest is not served', { skip: !sample }, async () => {
  const f = fixture('approved');
  writeFileSync(join(f.artifacts, f.id, 'en', 'deck.pptx'), Buffer.from('tampered'));
  const t = createTestServer({ modules: [createPacksModule({ libraryDir: f.library, artifactsDir: f.artifacts })], quiet: true });
  try {
    const res = await t.request('GET', `/packs/${f.id}/files/slides`);
    assert.equal(res.status, 404);
  } finally {
    t.close();
  }
});

test('approved packs are public and downloadable without an account', { skip: !sample }, async () => {
  const f = fixture('approved');
  const t = createTestServer({ modules: [createPacksModule({ libraryDir: f.library, artifactsDir: f.artifacts })], quiet: true });
  try {
    const index = await t.ok('packs.index');
    assert.equal(index.packs.find((p) => p.packId === f.id)!.variants.en.viewable, true);
    const detail = await t.ok('packs.detail', { params: { packId: f.id } });
    assert.equal(detail.review.publication, 'approved');
    const dl = await t.request('GET', `/packs/${f.id}/files/slides`);
    assert.equal(dl.status, 200);
  } finally {
    t.close();
  }
});

test('in production only listed reviewers see drafts', { skip: !sample }, async () => {
  const f = fixture('draft');
  const t = createTestServer({ modules: [createPacksModule({ libraryDir: f.library, artifactsDir: f.artifacts })], quiet: true, config: { environment: 'production', publicOrigin: 'https://tala.test' }, core: { autoVerifyEmail: true } });
  const env = process.env.TALA_PACK_REVIEWERS;
  try {
    const user = await t.registerUser();
    assert.equal(t.config.environment, 'production');
    process.env.TALA_PACK_REVIEWERS = 'someone-else@example.org';
    const notListed = await t.client(user.token).call('packs.index');
    assert.equal(notListed.packs.find((p) => p.packId === f.id)!.variants.en.viewable, false);
    process.env.TALA_PACK_REVIEWERS = `someone-else@example.org, ${user.email.toUpperCase()}`;
    const listed = await t.client(user.token).call('packs.index');
    assert.equal(listed.packs.find((p) => p.packId === f.id)!.variants.en.viewable, true);
  } finally {
    if (env === undefined) delete process.env.TALA_PACK_REVIEWERS;
    else process.env.TALA_PACK_REVIEWERS = env;
    t.close();
  }
});

test('in production, TALA_PACK_DRAFT_PREVIEW=signed-in opens drafts to signed-in accounts only', { skip: !sample }, async () => {
  const f = fixture('draft');
  const t = createTestServer({ modules: [createPacksModule({ libraryDir: f.library, artifactsDir: f.artifacts })], quiet: true, config: { environment: 'production', publicOrigin: 'https://tala.test' }, core: { autoVerifyEmail: true } });
  const saved = { reviewers: process.env.TALA_PACK_REVIEWERS, preview: process.env.TALA_PACK_DRAFT_PREVIEW };
  try {
    delete process.env.TALA_PACK_REVIEWERS;
    process.env.TALA_PACK_DRAFT_PREVIEW = 'signed-in';
    const user = await t.registerUser();
    const signedIn = await t.client(user.token).call('packs.index');
    assert.equal(signedIn.reviewerView, true);
    assert.equal(signedIn.packs.find((p) => p.packId === f.id)!.variants.en.viewable, true);
    const detail = await t.client(user.token).call('packs.detail', { params: { packId: f.id }, query: { lang: 'en' } });
    assert.equal(detail.review.publication, 'draft', 'a previewed draft is still reported as a draft');
    // Signed out: still no draft content, only the honest status.
    const anon = await t.client().call('packs.index');
    assert.equal(anon.reviewerView, false);
    assert.equal(anon.packs.find((p) => p.packId === f.id)!.variants.en.viewable, false);
    await assert.rejects(() => t.client().call('packs.detail', { params: { packId: f.id }, query: { lang: 'en' } }));
    // Any other value keeps the allowlist rule.
    process.env.TALA_PACK_DRAFT_PREVIEW = 'yes';
    const other = await t.client(user.token).call('packs.index');
    assert.equal(other.packs.find((p) => p.packId === f.id)!.variants.en.viewable, false);
  } finally {
    for (const [k, v] of [['TALA_PACK_REVIEWERS', saved.reviewers], ['TALA_PACK_DRAFT_PREVIEW', saved.preview]] as const)
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    t.close();
  }
});

