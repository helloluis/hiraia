import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { UPLOAD_LIMITS } from '@hiraia/tala-core/contracts';
import type { UploadedDeck, UploadSlideEdit } from '@hiraia/tala-core/contracts';
import { syntheticDeckParts, SYNTHETIC } from '@hiraia/tala-core/pptx/testing';
import { createTestServer } from '../../testing';
import type { TestServer, TestUser } from '../../testing';
import { createDecksModule, type DecksOptions } from './index';
import { readUploadedDeck, UploadRefused } from './upload-file';
import { RenderError, type DeckRenderer } from './upload-render';
import { readZip, writeZip } from './zip';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** The invented deck as a real .pptx. `photoBytes` adds a picture that does not compress, to make a file of several pieces. */
function pptx(extra: Record<string, string | Uint8Array | null> = {}, photoBytes = 0): Uint8Array {
  const parts = syntheticDeckParts({ ...(photoBytes ? { 'ppt/media/photo.png': new Uint8Array(randomBytes(photoBytes)) } : {}), ...extra });
  return writeZip(Object.entries(parts).map(([name, data]) => ({ name, data })));
}

function server(uploads: DecksOptions['uploads'] = {}): TestServer {
  return createTestServer({ modules: [createDecksModule({ uploads: { renderer: null, ...uploads } })] });
}

async function begin(t: TestServer, user: TestUser, file: Uint8Array, fileName = 'Plants Grade 4.pptx', claimedSha = sha(file)) {
  return t.call('decks.uploads.begin', { body: { fileName, bytes: file.length, sha256: claimedSha }, token: user.token });
}
async function sendPieces(t: TestServer, user: TestUser, sessionId: string, file: Uint8Array, only?: number[]) {
  const count = Math.ceil(file.length / UPLOAD_LIMITS.chunkBytes);
  for (const i of only ?? Array.from({ length: count }, (_, k) => k)) {
    const piece = file.subarray(i * UPLOAD_LIMITS.chunkBytes, (i + 1) * UPLOAD_LIMITS.chunkBytes);
    await t.ok('decks.uploads.chunk', { params: { sessionId, index: String(i) }, body: { data: Buffer.from(piece).toString('base64') }, token: user.token });
  }
}
/** The whole upload, as the browser does it. */
async function upload(t: TestServer, user: TestUser, file: Uint8Array, fileName?: string) {
  const session = await begin(t, user, file, fileName);
  assert.ok(session.ok, JSON.stringify(session.error));
  await sendPieces(t, user, session.data.sessionId, file);
  return t.call('decks.uploads.finish', { params: { sessionId: session.data.sessionId }, token: user.token });
}
async function uploaded(t: TestServer, user: TestUser, file: Uint8Array = pptx(), fileName?: string): Promise<UploadedDeck> {
  const r = await upload(t, user, file, fileName);
  assert.ok(r.ok, JSON.stringify(r.error));
  return r.data;
}
const reason = (r: { error: { details?: unknown } | null }) => (r.error?.details as { reason?: string } | undefined)?.reason;
const identity = (d: UploadedDeck): UploadSlideEdit[] => d.base.slides.map((s) => ({ id: s.id, source: s.id }));
const body = async (t: TestServer, route: 'decks.uploads.pptx' | 'decks.uploads.original', user: TestUser, uploadId: string) =>
  new Uint8Array(await t.ok(route, { params: { uploadId }, token: user.token }));

test('upload: a file sent in pieces is read into slides the teacher can edit, with an honest list of what is only kept', async () => {
  const t = server();
  try {
    const ana = await t.registerUser();
    const file = pptx({}, 700_000);
    assert.ok(file.length > UPLOAD_LIMITS.chunkBytes, 'the fixture must need more than one piece');
    const session = await t.ok('decks.uploads.begin', { body: { fileName: 'Plants Grade 4.pptx', bytes: file.length, sha256: sha(file) }, token: ana.token });
    assert.deepEqual([session.chunkBytes, session.chunkCount, session.received], [UPLOAD_LIMITS.chunkBytes, 2, []]);
    // Pieces may arrive in any order, and sending one again is harmless.
    await sendPieces(t, ana, session.sessionId, file, [1]);
    const early = await t.call('decks.uploads.finish', { params: { sessionId: session.sessionId }, token: ana.token });
    assert.deepEqual([early.status, reason(early)], [409, 'upload_incomplete']);
    await sendPieces(t, ana, session.sessionId, file, [0, 0]);
    const deck = await t.ok('decks.uploads.finish', { params: { sessionId: session.sessionId }, token: ana.token });

    assert.equal(deck.title, 'Plants — Grade 4');
    assert.equal(deck.fileName, 'Plants Grade 4.pptx');
    assert.deepEqual([deck.kind, deck.slideCount, deck.changedSlides, deck.rev, deck.bytes], ['presentation', 3, 0, 1, file.length]);
    assert.equal(deck.originalSha256, sha(file));
    assert.deepEqual(deck.base.slides.map((s) => s.title), ['Parts of a plant', 'Roots & shoots', 'Back to roots']);
    assert.deepEqual(deck.base.slides[0]!.blocks[1]!.paragraphs, SYNTHETIC.body1);
    assert.deepEqual(deck.edits.slides, identity(deck));
    assert.deepEqual(deck.previews, { available: false, rev: null, slideIds: [] });
    const kept = Object.fromEntries(deck.base.features.map((f) => [f.feature, f.slides]));
    assert.deepEqual([kept.chart, kept.animation, kept.transition, kept.hiddenSlide, kept.readOnlyText], [[2], [2], [2], [3], [2]]);

    const list = await t.ok('decks.uploads.list', { token: ana.token });
    assert.deepEqual(list.decks.map((d) => [d.id, d.title, d.slideCount]), [[deck.id, deck.title, 3]]);
    assert.deepEqual(list.allowance, { fileBytes: UPLOAD_LIMITS.fileBytes, remainingBytes: UPLOAD_LIMITS.bytesPerAccount - file.length, remainingUploads: UPLOAD_LIMITS.uploadsPerAccount - 1 });
    assert.deepEqual(await t.ok('decks.uploads.get', { params: { uploadId: deck.id }, token: ana.token }), deck);
    // The session is used up, and nothing of the upload text or file name was logged.
    assert.equal((await t.call('decks.uploads.finish', { params: { sessionId: session.sessionId }, token: ana.token })).status, 404);
    assert.ok(!JSON.stringify(t.logs).includes('Plants'));
    assert.deepEqual(t.errors, []);
  } finally {
    t.close();
  }
});

test('upload: an interrupted upload carries on where it stopped', async () => {
  const t = server();
  try {
    const ana = await t.registerUser();
    const file = pptx({}, 1_200_000);
    const first = await t.ok('decks.uploads.begin', { body: { fileName: 'big.pptx', bytes: file.length, sha256: sha(file) }, token: ana.token });
    assert.equal(first.chunkCount, 3);
    await sendPieces(t, ana, first.sessionId, file, [0, 2]);
    // The page reloads: the same file is offered again and the server says what it already has.
    const again = await t.ok('decks.uploads.begin', { body: { fileName: 'big.pptx', bytes: file.length, sha256: sha(file) }, token: ana.token });
    assert.deepEqual([again.sessionId, again.received], [first.sessionId, [0, 2]]);
    await sendPieces(t, ana, again.sessionId, file, [1]);
    const deck = await t.ok('decks.uploads.finish', { params: { sessionId: again.sessionId }, token: ana.token });
    assert.equal(deck.originalSha256, sha(file));
    // A wrong-sized or malformed piece is refused and changes nothing.
    const other = await t.ok('decks.uploads.begin', { body: { fileName: 'other.pptx', bytes: 1000, sha256: 'a'.repeat(64) }, token: ana.token });
    for (const data of ['AAAA', '!!!!', Buffer.alloc(1001).toString('base64')]) {
      const r = await t.call('decks.uploads.chunk', { params: { sessionId: other.sessionId, index: '0' }, body: { data }, token: ana.token });
      assert.deepEqual([r.status, reason(r)], [400, 'bad_chunk'], data.slice(0, 8));
    }
    assert.equal((await t.call('decks.uploads.chunk', { params: { sessionId: other.sessionId, index: '7' }, body: { data: 'AAAA' }, token: ana.token })).status, 400);
    assert.deepEqual(await t.ok('decks.uploads.cancel', { params: { sessionId: other.sessionId }, token: ana.token }), { ok: true });
    assert.equal((await t.call('decks.uploads.cancel', { params: { sessionId: other.sessionId }, token: ana.token })).status, 404);
  } finally {
    t.close();
  }
});

test('upload safety: what is not a plain PowerPoint deck is refused before or at reading, plainly, and not kept', async () => {
  const t = server();
  try {
    const ana = await t.registerUser();
    // Refused by name or size before a byte is sent.
    for (const [fileName, why] of [['old.ppt', 'old_powerpoint'], ['macro.pptm', 'macros'], ['notes.docx', 'wrong_office_file'], ['scan.pdf', 'pdf'], ['photo.jpg', 'wrong_extension'], ['noextension', 'wrong_extension']] as const) {
      const r = await begin(t, ana, pptx(), fileName);
      assert.deepEqual([r.status, reason(r)], [400, why], fileName);
    }
    const tooBig = await t.call('decks.uploads.begin', { body: { fileName: 'huge.pptx', bytes: UPLOAD_LIMITS.fileBytes + 1, sha256: 'a'.repeat(64) }, token: ana.token });
    assert.equal(tooBig.status, 400);

    // Refused when the bytes are read: each with its own reason.
    const ct = syntheticDeckParts()['[Content_Types].xml'] as string;
    const ole = new Uint8Array(4096);
    ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const encrypted = new Uint8Array(4096);
    encrypted.set(ole.subarray(0, 8));
    encrypted.set(Buffer.from('EncryptedPackage', 'utf16le'), 512);
    const bomb = pptx();
    // An archive whose directory claims one part inflates to 2 GB: refused from the directory alone.
    const at = Buffer.from(bomb).lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    Buffer.from(bomb.buffer, bomb.byteOffset, bomb.byteLength).writeUInt32LE(0x7fffffff, at + 24);
    const cases: Array<[string, Uint8Array]> = [
      ['not_a_zip', new Uint8Array(randomBytes(2000))],
      ['old_powerpoint', ole],
      ['password_protected', encrypted],
      ['pdf', new Uint8Array(Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj'))],
      ['zip_bomb', bomb],
      ['macros', pptx({ 'ppt/vbaProject.bin': new Uint8Array([1, 2, 3]) })],
      ['macros', pptx({ '[Content_Types].xml': ct.replace('application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml', 'application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml') })],
      ['active_content', pptx({ 'ppt/activeX/activeX1.xml': '<x/>' })],
      ['signed', pptx({ '_xmlsignatures/sig1.xml': '<x/>' })],
      ['wrong_office_file', pptx({ '[Content_Types].xml': ct.replace('presentationml.presentation.main+xml', 'wordprocessingml.document.main+xml') })],
      ['damaged', pptx({ 'ppt/slides/slide1.xml': '<?xml version="1.0"?><!DOCTYPE s [<!ENTITY x SYSTEM "file:///etc/passwd">]><s>&x;</s>' })],
      ['damaged', pptx({ 'ppt/slides/slide3.xml': null })],
      ['not_a_presentation', pptx({ '_rels/.rels': null })],
    ];
    for (const [why, file] of cases) {
      const r = await upload(t, ana, file, `${why}.pptx`);
      assert.deepEqual([r.status, reason(r)], [400, why], why);
      assert.ok(r.error!.message.length > 20 && !/undefined|\bnull\b/.test(r.error!.message), `${why}: ${r.error!.message}`);
    }
    // The file that arrives is not the file that was announced.
    const real = pptx();
    const lied = await begin(t, ana, real, 'lied.pptx', 'b'.repeat(64));
    assert.ok(lied.ok);
    await sendPieces(t, ana, lied.data.sessionId, real);
    const mismatch = await t.call('decks.uploads.finish', { params: { sessionId: lied.data.sessionId }, token: ana.token });
    assert.deepEqual([mismatch.status, reason(mismatch)], [400, 'checksum_mismatch']);
    // Nothing of any refused file is kept: no upload, no stored file, no pieces, no open session.
    for (const table of ['decks_uploads', 'decks_upload_files', 'decks_upload_chunks', 'decks_upload_sessions'])
      assert.equal((t.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n, 0, table);
    assert.deepEqual((await t.ok('decks.uploads.list', { token: ana.token })).decks, []);
    assert.deepEqual(t.errors, []);
  } finally {
    t.close();
  }
});

test('upload safety: signed-out and unverified accounts cannot upload; allowances and rate limits hold', async () => {
  const t = server({ maxUploads: 1, startsPerHour: 3, maxFileBytes: 400_000 });
  try {
    const file = pptx();
    const anon = await t.call('decks.uploads.begin', { body: { fileName: 'a.pptx', bytes: file.length, sha256: sha(file) } });
    assert.equal(anon.status, 401);
    assert.equal((await t.call('decks.uploads.list')).status, 401);
    const unverified = await t.registerUser({ verified: false });
    const refused = await begin(t, unverified, file);
    assert.deepEqual([refused.status, reason(refused)], [403, 'email_not_verified']);

    const ana = await t.registerUser();
    const over = await t.call('decks.uploads.begin', { body: { fileName: 'big.pptx', bytes: 400_001, sha256: 'a'.repeat(64) }, token: ana.token });
    assert.deepEqual([over.status, reason(over)], [400, 'too_large']);
    await uploaded(t, ana, file);
    const second = await begin(t, ana, pptx({ 'docProps/core.xml': null }));
    assert.deepEqual([second.status, reason(second)], [429, 'quota']);
    assert.match(second.error!.message, /Delete a file/);
    // Another teacher is not affected by Ana's allowance, and hits her own rate limit only after her own starts.
    const ben = await t.registerUser();
    for (let i = 0; i < 3; i++) assert.ok((await begin(t, ben, new Uint8Array(randomBytes(100)), `try${i}.pptx`)).ok);
    const limited = await begin(t, ben, new Uint8Array(randomBytes(100)), 'try4.pptx');
    assert.equal(limited.status, 429);
    assert.equal(limited.error!.code, 'rate_limited');
    t.clock.advance({ hours: 1, minutes: 1 });
    assert.ok((await begin(t, ben, new Uint8Array(randomBytes(100)), 'later.pptx')).ok);
  } finally {
    t.close();
  }
});

test('isolation: a teacher can never see, change, download or continue another teacher’s upload', async () => {
  const t = server({ renderer: { render: async (file) => readUploadedDeck(file).slides.map((_s, i) => new Uint8Array([0xff, 0xd8, 0xff, i])) } });
  try {
    const ana = await t.registerUser();
    const ben = await t.registerUser();
    const file = pptx();
    const anas = await uploaded(t, ana, file);
    await t.ok('decks.uploads.render', { params: { uploadId: anas.id }, token: ana.token });
    const missing = await t.call('decks.uploads.get', { params: { uploadId: 'no-such-upload' }, token: ben.token });
    const p = { uploadId: anas.id };
    const attempts = [
      await t.call('decks.uploads.get', { params: p, token: ben.token }),
      await t.call('decks.uploads.save', { params: p, body: { baseRev: 1, slides: identity(anas), force: true }, token: ben.token }),
      await t.call('decks.uploads.delete', { params: p, token: ben.token }),
      await t.call('decks.uploads.original', { params: p, token: ben.token }),
      await t.call('decks.uploads.pptx', { params: p, token: ben.token }),
      await t.call('decks.uploads.render', { params: p, token: ben.token }),
      await t.call('decks.uploads.preview', { params: { ...p, slideId: 's256' }, token: ben.token }),
    ];
    // Exactly what an id that does not exist answers: no hint that the upload is there.
    for (const r of attempts) assert.deepEqual([r.status, r.error], [404, missing.error]);
    assert.deepEqual((await t.ok('decks.uploads.list', { token: ben.token })).decks, []);
    for (const signedOut of [await t.call('decks.uploads.get', { params: p }), await t.call('decks.uploads.original', { params: p }), await t.call('decks.uploads.preview', { params: { ...p, slideId: 's256' } })])
      assert.equal(signedOut.status, 401);

    // An unfinished upload is its owner's too.
    const session = await t.ok('decks.uploads.begin', { body: { fileName: 'b.pptx', bytes: file.length, sha256: sha(file) }, token: ana.token });
    for (const r of [
      await t.call('decks.uploads.chunk', { params: { sessionId: session.sessionId, index: '0' }, body: { data: Buffer.from(file).toString('base64') }, token: ben.token }),
      await t.call('decks.uploads.finish', { params: { sessionId: session.sessionId }, token: ben.token }),
      await t.call('decks.uploads.cancel', { params: { sessionId: session.sessionId }, token: ben.token }),
    ])
      assert.equal(r.status, 404);

    // Ben uploads the very same file: his own upload, his own edits; Ana's stay as they were.
    const bens = await uploaded(t, ben, file);
    assert.notEqual(bens.id, anas.id);
    await t.ok('decks.uploads.save', { params: { uploadId: bens.id }, body: { baseRev: 1, slides: identity(bens).map((s) => (s.id === 's256' ? { ...s, text: { b0: ['Ben’s title'] } } : s)) }, token: ben.token });
    assert.deepEqual(await t.ok('decks.uploads.get', { params: p, token: ana.token }), { ...anas, previews: { available: true, rev: 1, slideIds: ['s256', 's257', 's258'] } });
    assert.ok(!Buffer.from(await body(t, 'decks.uploads.pptx', ana, anas.id)).includes('Ben'));
    // One stored copy of the bytes serves both; it goes only when the last upload of it goes.
    const files = () => (t.db.prepare('SELECT COUNT(*) AS n FROM decks_upload_files').get() as { n: number }).n;
    assert.equal(files(), 1);
    await t.ok('decks.uploads.delete', { params: p, token: ana.token });
    assert.equal(files(), 1);
    assert.deepEqual(sha(await body(t, 'decks.uploads.original', ben, bens.id)), sha(file));
    await t.ok('decks.uploads.delete', { params: { uploadId: bens.id }, token: ben.token });
    assert.equal(files(), 0);
    assert.equal((t.db.prepare('SELECT COUNT(*) AS n FROM decks_upload_previews').get() as { n: number }).n, 0);
    assert.deepEqual(t.errors, []);
  } finally {
    t.close();
  }
});

test('edit and persist: saved changes come back, stale saves are a conflict, changes that do not fit are refused', async () => {
  const t = server();
  try {
    const ana = await t.registerUser();
    const deck = await uploaded(t, ana);
    const p = { uploadId: deck.id };
    const wanted = ['Plants need sunshine and water.', 'Second point', 'Third point'];
    const slides: UploadSlideEdit[] = [
      { id: 's258', source: 's258', notes: ['Notes on the hidden slide'] },
      { id: 's256', source: 's256', text: { b1: wanted, b0: [SYNTHETIC.title1] } },
      { id: 'ccopy0001', source: 's256', text: { b0: ['A copy'] } },
    ];
    const saved = await t.ok('decks.uploads.save', { params: p, body: { baseRev: 1, title: '  My   plants  deck ', slides }, token: ana.token });
    assert.deepEqual([saved.rev, saved.changedSlides, saved.slideCount], [2, 3, 3]);
    // A different session of the same teacher (another device) reads the same saved state.
    const again = await t.ok('decks.uploads.get', { params: p, token: ana.token });
    assert.equal(again.title, 'My plants deck');
    assert.deepEqual([again.rev, again.slideCount, again.changedSlides], [2, 3, 3]);
    // Only what differs from the file is stored: the unchanged title was dropped from the edit.
    assert.deepEqual(again.edits.slides, [slides[0], { id: 's256', source: 's256', text: { b1: wanted } }, slides[2]]);
    assert.deepEqual(again.base, deck.base, 'the uploaded file as read never changes');

    const stale = await t.call('decks.uploads.save', { params: p, body: { baseRev: 1, slides: identity(deck) }, token: ana.token });
    assert.deepEqual([stale.status, stale.error!.details], [409, { reason: 'deck_changed_elsewhere', rev: 2, updatedAt: saved.updatedAt }]);
    assert.equal((await t.ok('decks.uploads.get', { params: p, token: ana.token })).rev, 2, 'a refused save changes nothing');
    const forced = await t.ok('decks.uploads.save', { params: p, body: { baseRev: 1, slides: identity(deck), force: true }, token: ana.token });
    assert.deepEqual([forced.rev, forced.changedSlides, forced.slideCount], [3, 0, 3]);

    for (const [why, bad] of [
      ['unknown_block', [{ id: 's256', source: 's256', text: { b9: ['x'] } }]],
      ['block_not_editable', [{ id: 's257', source: 's257', text: { b5: ['Page 9'] } }]],
      ['slide_cannot_be_copied', [...identity(deck), { id: 'ccopy0002', source: 's257' }]],
      ['unknown_slide', [{ id: 's999', source: 's999' }]],
      ['duplicate_slide_id', [identity(deck)[0]!, identity(deck)[0]!]],
    ] as Array<[string, UploadSlideEdit[]]>) {
      const r = await t.call('decks.uploads.save', { params: p, body: { baseRev: 3, slides: bad }, token: ana.token });
      assert.deepEqual([r.status, reason(r)], [400, why], why);
    }
    assert.equal((await t.call('decks.uploads.save', { params: p, body: { baseRev: 3, slides: [] }, token: ana.token })).status, 400);
    assert.equal((await t.ok('decks.uploads.get', { params: p, token: ana.token })).rev, 3);
  } finally {
    t.close();
  }
});

test('export: the download is the uploaded file with the saved changes written in; the original is always there, bit for bit', async () => {
  const t = server();
  try {
    const ana = await t.registerUser();
    const file = pptx({}, 300_000);
    const deck = await uploaded(t, ana, file);
    const p = { uploadId: deck.id };

    // Nothing changed yet: the download holds exactly the uploaded parts.
    const untouched = await body(t, 'decks.uploads.pptx', ana, deck.id);
    const a = readZip(file);
    const b = readZip(untouched);
    assert.deepEqual(b.names, a.names);
    for (const name of a.names) assert.deepEqual(b.read(name), a.read(name), name);

    const wanted = ['Kailangan ng halaman ang araw at tubig.', 'Ikalawang punto: ñ & <ok>'];
    await t.ok('decks.uploads.save', {
      params: p,
      body: { baseRev: 1, slides: [{ id: 's256', source: 's256', text: { b1: wanted }, notes: ['Tanungin muna ang klase.'] }, { id: 'ccopy0001', source: 's256' }, { id: 's258', source: 's258' }] },
      token: ana.token,
    });
    const res = await t.call('decks.uploads.pptx', { params: p, token: ana.token });
    assert.equal(res.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="Plants-Grade-4-tala\.pptx"/);
    const edited = new Uint8Array(res.data as ArrayBuffer);
    const read = readUploadedDeck(edited);
    assert.deepEqual(read.slides.map((s) => s.title), ['Parts of a plant', 'Parts of a plant', 'Back to roots']);
    assert.deepEqual(read.slides[0]!.blocks[1]!.paragraphs, wanted);
    assert.deepEqual(read.slides[0]!.notes.paragraphs, ['Tanungin muna ang klase.']);
    assert.deepEqual(read.slides[1]!.blocks[1]!.paragraphs, SYNTHETIC.body1, 'the copy has the words of the file, not the edit');
    // Slide 2 (with the chart) was removed: its chart went with it. The big picture is carried over untouched.
    const out = readZip(edited);
    assert.ok(!out.has('ppt/charts/chart1.xml') && !out.has('ppt/slides/slide2.xml'));
    assert.deepEqual(out.read('ppt/media/photo.png'), a.read('ppt/media/photo.png'));
    assert.deepEqual(out.raw('ppt/media/photo.png').bytes, a.raw('ppt/media/photo.png').bytes, 'not even recompressed');
    assert.deepEqual(out.read('ppt/theme/theme1.xml'), a.read('ppt/theme/theme1.xml'));
    assert.deepEqual(sha(edited), sha(await body(t, 'decks.uploads.pptx', ana, deck.id)), 'the same saved state downloads as the same bytes');

    // Whatever was edited, the original comes back exactly.
    const original = await t.call('decks.uploads.original', { params: p, token: ana.token });
    assert.equal(sha(new Uint8Array(original.data as ArrayBuffer)), sha(file));
    assert.match(original.headers.get('content-disposition') ?? '', /filename="Plants-Grade-4\.pptx"/);
    assert.equal(original.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(t.errors, []);
  } finally {
    t.close();
  }
});

test('pictures: drawn only where a renderer is set up, for the saved version, and only for the owner', async () => {
  let fail = false;
  const calls: number[] = [];
  const renderer: DeckRenderer = {
    render: async (file) => {
      if (fail) throw new Error('renderer down');
      const n = readUploadedDeck(file).slides.length;
      calls.push(n);
      return Array.from({ length: n }, (_x, i) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, i, calls.length]));
    },
  };
  const t = server({ renderer });
  try {
    const ana = await t.registerUser();
    const deck = await uploaded(t, ana);
    const p = { uploadId: deck.id };
    assert.deepEqual(deck.previews, { available: true, rev: null, slideIds: [] });
    assert.equal((await t.call('decks.uploads.preview', { params: { ...p, slideId: 's256' }, token: ana.token })).status, 404);
    assert.deepEqual(await t.ok('decks.uploads.render', { params: p, token: ana.token }), { state: 'ready', rev: 1, slideIds: ['s256', 's257', 's258'] });
    const pic = await t.call('decks.uploads.preview', { params: { ...p, slideId: 's257' }, token: ana.token });
    assert.deepEqual([pic.headers.get('content-type'), [...new Uint8Array(pic.data as ArrayBuffer)]], ['image/jpeg', [0xff, 0xd8, 0xff, 0xe0, 1, 1]]);
    // Asking again for the same version draws nothing new.
    await t.ok('decks.uploads.render', { params: p, token: ana.token });
    assert.deepEqual(calls, [3]);
    // After a save the stored pictures are behind (and say so) until they are drawn again.
    await t.ok('decks.uploads.save', { params: p, body: { baseRev: 1, slides: [{ id: 's256', source: 's256' }, { id: 'ccopy0001', source: 's256' }] }, token: ana.token });
    assert.deepEqual((await t.ok('decks.uploads.get', { params: p, token: ana.token })).previews, { available: true, rev: 1, slideIds: ['s256', 's257', 's258'] });
    fail = true;
    assert.deepEqual(await t.ok('decks.uploads.render', { params: p, token: ana.token }), { state: 'failed', rev: 1, slideIds: ['s256', 's257', 's258'] });
    fail = false;
    assert.deepEqual(await t.ok('decks.uploads.render', { params: p, token: ana.token }), { state: 'ready', rev: 2, slideIds: ['s256', 'ccopy0001'] });
    assert.equal((await t.call('decks.uploads.preview', { params: { ...p, slideId: 's257' }, token: ana.token })).status, 404);

    const none = server();
    try {
      const cara = await none.registerUser();
      const hers = await uploaded(none, cara);
      assert.deepEqual(await none.ok('decks.uploads.render', { params: { uploadId: hers.id }, token: cara.token }), { state: 'unavailable', rev: null, slideIds: [] });
    } finally {
      none.close();
    }
  } finally {
    t.close();
  }
});

test('pictures: one teacher cannot keep the server drawing; past her allowance it answers busy and keeps the pictures it has', async () => {
  let drawn = 0;
  const t = server({
    rendersPerTenMinutes: 2,
    renderer: {
      render: async (file) => {
        drawn += 1;
        return readUploadedDeck(file).slides.map(() => new Uint8Array([0xff, 0xd8, drawn]));
      },
    },
  });
  try {
    const ana = await t.registerUser();
    const ben = await t.registerUser();
    const deck = await uploaded(t, ana);
    const p = { uploadId: deck.id };
    const slides = identity(deck);
    assert.equal((await t.ok('decks.uploads.render', { params: p, token: ana.token })).state, 'ready');
    // A version that is already drawn costs nothing and is not counted.
    assert.equal((await t.ok('decks.uploads.render', { params: p, token: ana.token })).state, 'ready');
    await t.ok('decks.uploads.save', { params: p, body: { baseRev: 1, slides: [...slides].reverse() }, token: ana.token });
    assert.deepEqual(await t.ok('decks.uploads.render', { params: p, token: ana.token }), { state: 'ready', rev: 2, slideIds: ['s258', 's257', 's256'] });
    await t.ok('decks.uploads.save', { params: p, body: { baseRev: 2, slides }, token: ana.token });
    assert.deepEqual(await t.ok('decks.uploads.render', { params: p, token: ana.token }), { state: 'busy', rev: 2, slideIds: ['s256', 's257', 's258'] });
    assert.equal(drawn, 2);
    // The pictures she has are still served, and another teacher is not held back by her.
    assert.equal((await t.call('decks.uploads.preview', { params: { ...p, slideId: 's256' }, token: ana.token })).status, 200);
    const his = await uploaded(t, ben);
    assert.equal((await t.ok('decks.uploads.render', { params: { uploadId: his.id }, token: ben.token })).state, 'ready');
    assert.equal(drawn, 3);
  } finally {
    t.close();
  }
});

test('pictures: a drawing service that is missing or unusable turns pictures off, is not asked on every request, and nothing is drawn another way', async () => {
  let mood: 'unavailable' | 'busy' | 'fine' = 'unavailable';
  const asked: number[] = [];
  const renderer: DeckRenderer = {
    render: async (file, slides) => {
      asked.push(slides);
      if (mood === 'unavailable') throw new RenderError('unavailable', 'the job refused to draw: sandbox check failed (no-network-device)');
      if (mood === 'busy') throw new RenderError('busy', 'the drawing service is busy');
      return readUploadedDeck(file).slides.map((_s, i) => new Uint8Array([0xff, 0xd8, 0xff, i]));
    },
  };
  const t = server({ renderer, renderRetryMs: 150 });
  try {
    const ana = await t.registerUser();
    const deck = await uploaded(t, ana);
    const p = { uploadId: deck.id };
    assert.equal(deck.previews.available, true);
    // The service is there by name but will not draw: the answer is "no pictures here", not an error.
    assert.deepEqual(await t.ok('decks.uploads.render', { params: p, token: ana.token }), { state: 'unavailable', rev: null, slideIds: [] });
    assert.deepEqual(asked, [3]);
    // For a while the server says so itself, and does not go back to the service for every teacher who asks.
    assert.equal((await t.ok('decks.uploads.get', { params: p, token: ana.token })).previews.available, false);
    assert.deepEqual(await t.ok('decks.uploads.render', { params: p, token: ana.token }), { state: 'unavailable', rev: null, slideIds: [] });
    assert.deepEqual(asked, [3]);
    // Everything else about the upload works without pictures: a save, and the edited download.
    await t.ok('decks.uploads.save', { params: p, body: { baseRev: 1, slides: [...identity(deck)].reverse() }, token: ana.token });
    assert.equal((await t.call('decks.uploads.pptx', { params: p, token: ana.token })).status, 200);
    assert.equal((t.db.prepare('SELECT COUNT(*) AS n FROM decks_upload_previews').get() as { n: number }).n, 0);
    // Later it is asked again. Busy is passed on as busy; then it draws.
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal((await t.ok('decks.uploads.get', { params: p, token: ana.token })).previews.available, true);
    mood = 'busy';
    assert.deepEqual(await t.ok('decks.uploads.render', { params: p, token: ana.token }), { state: 'busy', rev: null, slideIds: [] });
    assert.equal((await t.ok('decks.uploads.get', { params: p, token: ana.token })).previews.available, true);
    mood = 'fine';
    assert.deepEqual(await t.ok('decks.uploads.render', { params: p, token: ana.token }), { state: 'ready', rev: 2, slideIds: ['s258', 's257', 's256'] });
    assert.deepEqual(asked, [3, 3, 3]);
  } finally {
    t.close();
  }
});

test('pictures: a drawing that takes long does not hold the request; the editor is told busy, and the pictures are there when it asks again', async () => {
  let drawn = 0;
  let finish: () => void = () => undefined;
  const t = server({
    renderWaitMs: 40,
    renderer: {
      render: (file) =>
        new Promise((resolve) => {
          drawn += 1;
          finish = () => resolve(readUploadedDeck(file).slides.map((_s, i) => new Uint8Array([0xff, 0xd8, 0xff, i])));
        }),
    },
  });
  try {
    const ana = await t.registerUser();
    const ben = await t.registerUser();
    const deck = await uploaded(t, ana);
    const his = await uploaded(t, ben, pptx({ 'docProps/core.xml': null }));
    const p = { uploadId: deck.id };
    const started = Date.now();
    assert.deepEqual(await t.ok('decks.uploads.render', { params: p, token: ana.token }), { state: 'busy', rev: null, slideIds: [] });
    assert.ok(Date.now() - started < 2000);
    // While it is being drawn, asking again (her or anyone) starts nothing new.
    assert.equal((await t.ok('decks.uploads.render', { params: p, token: ana.token })).state, 'busy');
    assert.equal((await t.ok('decks.uploads.render', { params: { uploadId: his.id }, token: ben.token })).state, 'busy');
    assert.equal(drawn, 1);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(await t.ok('decks.uploads.render', { params: p, token: ana.token }), { state: 'ready', rev: 1, slideIds: ['s256', 's257', 's258'] });
    assert.equal(drawn, 1);
    assert.equal((await t.call('decks.uploads.preview', { params: { ...p, slideId: 's257' }, token: ana.token })).status, 200);
    // A save while a slow drawing is under way: the pictures of the older version are not kept as the new one's.
    await t.ok('decks.uploads.save', { params: p, body: { baseRev: 1, slides: [...identity(deck)].reverse() }, token: ana.token });
    assert.equal((await t.ok('decks.uploads.render', { params: p, token: ana.token })).state, 'busy');
    await t.ok('decks.uploads.save', { params: p, body: { baseRev: 2, slides: identity(deck) }, token: ana.token });
    finish();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual((await t.ok('decks.uploads.get', { params: p, token: ana.token })).previews, { available: true, rev: 1, slideIds: ['s256', 's257', 's258'] });
  } finally {
    finish();
    t.close();
  }
});

test('pictures: the time her drawings take counts against one teacher, not against everybody', async () => {
  let drawn = 0;
  const t = server({
    drawMsPerTenMinutes: 60,
    renderer: {
      render: async (file) => {
        drawn += 1;
        await new Promise((resolve) => setTimeout(resolve, 90));
        return readUploadedDeck(file).slides.map(() => new Uint8Array([0xff, 0xd8, drawn]));
      },
    },
  });
  try {
    const ana = await t.registerUser();
    const ben = await t.registerUser();
    const deck = await uploaded(t, ana);
    const p = { uploadId: deck.id };
    assert.equal((await t.ok('decks.uploads.render', { params: p, token: ana.token })).state, 'ready');
    // Her one slow drawing used up her time for now: the next is put off, and the pictures she has stay.
    await t.ok('decks.uploads.save', { params: p, body: { baseRev: 1, slides: [...identity(deck)].reverse() }, token: ana.token });
    assert.deepEqual(await t.ok('decks.uploads.render', { params: p, token: ana.token }), { state: 'busy', rev: 1, slideIds: ['s258', 's257', 's256'] });
    assert.equal(drawn, 1);
    // Another teacher is not held back by her.
    const his = await uploaded(t, ben, pptx({ 'docProps/core.xml': null }));
    assert.equal((await t.ok('decks.uploads.render', { params: { uploadId: his.id }, token: ben.token })).state, 'ready');
    assert.equal(drawn, 2);
  } finally {
    t.close();
  }
});

test('account: deleting an account removes its uploads, unfinished uploads and pictures', async () => {
  const t = server({ renderer: { render: async (file) => readUploadedDeck(file).slides.map(() => new Uint8Array([1])) } });
  try {
    const ana = await t.registerUser();
    const ben = await t.registerUser();
    const deck = await uploaded(t, ana);
    await t.ok('decks.uploads.render', { params: { uploadId: deck.id }, token: ana.token });
    const half = pptx({ 'docProps/core.xml': null });
    await t.ok('decks.uploads.begin', { body: { fileName: 'half.pptx', bytes: half.length, sha256: sha(half) }, token: ana.token });
    const bens = await uploaded(t, ben, pptx({ 'docProps/core.xml': null }));
    await t.ok('account.delete', { body: { password: ana.password, confirm: 'DELETE' }, token: ana.token });
    const count = (table: string) => (t.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    assert.deepEqual([count('decks_uploads'), count('decks_upload_files'), count('decks_upload_sessions'), count('decks_upload_chunks'), count('decks_upload_previews')], [1, 1, 0, 0, 0]);
    assert.equal((await t.ok('decks.uploads.get', { params: { uploadId: bens.id }, token: ben.token })).id, bens.id);
  } finally {
    t.close();
  }
});

test('the reader refuses on its own, without a server around it', () => {
  assert.throws(() => readUploadedDeck(new Uint8Array(3)), (e: unknown) => e instanceof UploadRefused && e.reason === 'empty');
  assert.throws(() => readUploadedDeck(new Uint8Array(randomBytes(64))), (e: unknown) => e instanceof UploadRefused && e.reason === 'not_a_zip');
  assert.equal(readUploadedDeck(pptx()).slides.length, 3);
});
