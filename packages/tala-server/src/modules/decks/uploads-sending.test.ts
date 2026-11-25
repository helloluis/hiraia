/**
 * Downloads and pictures on their way to clients.
 *
 * An answer is a block of memory until its client has taken all of it, and a client can take as long as it likes
 * or nothing at all. So:
 *   - "the file I uploaded" is never in memory whole for a download: it is stored in pieces and sent a piece at a
 *     time from the database, as the connection takes it;
 *   - the edited file and the slide pictures, which do exist whole, are counted while they are on their way (for
 *     everybody and for each account), handed out in pieces, and cut short when not taken in time.
 * However many clients sit on their downloads, the server holds no more than it has decided to.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { UPLOAD_LIMITS } from '@hiraia/tala-core/contracts';
import { syntheticDeckParts } from '@hiraia/tala-core/pptx/testing';
import { binaryResponse } from '../../kernel/http';
import { createTestServer } from '../../testing';
import type { TestServer, TestUser } from '../../testing';
import { createDecksModule, type DecksOptions } from './index';
import { readUploadedDeck } from './upload-file';
import { uploadsMigrations } from './uploads';
import { writeZip } from './zip';

const PIECE = 512 * 1024;
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
/** The invented deck with a picture that does not compress, so that it is a few pieces long. */
const pptx = (photoBytes: number, extra: Record<string, string | Uint8Array | null> = {}): Uint8Array =>
  writeZip(Object.entries(syntheticDeckParts({ 'ppt/media/photo.png': new Uint8Array(randomBytes(photoBytes)), ...extra })).map(([name, data]) => ({ name, data })));
const server = (uploads: DecksOptions['uploads'] = {}): TestServer => createTestServer({ quiet: true, modules: [createDecksModule({ uploads: { renderer: null, downloadsPerMinute: 1000, ...uploads } })] });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function uploaded(t: TestServer, user: TestUser, file: Uint8Array) {
  const session = await t.ok('decks.uploads.begin', { body: { fileName: 'Plants.pptx', bytes: file.length, sha256: sha(file) }, token: user.token });
  for (let i = 0; i < session.chunkCount; i++) {
    const piece = file.subarray(i * UPLOAD_LIMITS.chunkBytes, (i + 1) * UPLOAD_LIMITS.chunkBytes);
    await t.ok('decks.uploads.chunk', { params: { sessionId: session.sessionId, index: String(i) }, body: { data: Buffer.from(piece).toString('base64') }, token: user.token });
  }
  return t.ok('decks.uploads.finish', { params: { sessionId: session.sessionId }, token: user.token });
}
const reasonOf = async (r: Response) => ((await r.json()) as { error: { details?: { reason?: string } } }).error.details?.reason;
const count = (t: TestServer, table: string) => (t.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

test('the kernel hands a counted answer out in pieces as they are asked for, and says exactly once when it has gone', async () => {
  const bytes = new Uint8Array(randomBytes(200_000));
  const answer = (withinMs = 60_000) => {
    const released = { times: 0 };
    const response = binaryResponse({ binary: bytes, contentType: 'application/octet-stream', held: { release: () => void (released.times += 1), withinMs } }, 'req-1');
    return { released, response };
  };
  // Taken whole: the same bytes, their length announced, released once.
  const whole = answer();
  assert.equal(whole.response.headers.get('content-length'), '200000');
  assert.deepEqual(new Uint8Array(await whole.response.arrayBuffer()), bytes);
  assert.equal(whole.released.times, 1);

  // Taken piece by piece: nothing is made ahead of being asked for, no piece is larger than 64 KiB, and none is
  // a view of the answer itself (so the answer can be let go while a piece still waits in a connection).
  const slow = answer();
  const reader = slow.response.body!.getReader();
  const first = await reader.read();
  assert.ok(first.value && first.value.length === 64 * 1024 && first.value.buffer !== bytes.buffer);
  await sleep(20);
  assert.equal(slow.released.times, 0, 'not released while most of it has not been asked for');
  const pieces = [first.value!];
  for (let r = await reader.read(); !r.done; r = await reader.read()) pieces.push(r.value);
  assert.deepEqual(pieces.map((p) => p.length), [65536, 65536, 65536, 200_000 - 3 * 65536]);
  assert.deepEqual(new Uint8Array(Buffer.concat(pieces)), bytes);
  assert.equal(slow.released.times, 1);

  // A client that goes away: released at once.
  const gone = answer();
  const goneReader = gone.response.body!.getReader();
  await goneReader.read();
  await goneReader.cancel();
  assert.equal(gone.released.times, 1);

  // A client that takes nothing: cut short when its time is up, released then, and never a second time.
  const silent = answer(30);
  await sleep(80);
  assert.equal(silent.released.times, 1);
  await assert.rejects(silent.response.arrayBuffer());
  assert.equal(silent.released.times, 1);
  // A client that started and stopped: the same.
  const stalled = answer(30);
  const stalledReader = stalled.response.body!.getReader();
  assert.equal((await stalledReader.read()).value!.length, 65536);
  await sleep(80);
  assert.equal(stalled.released.times, 1);
  await assert.rejects(stalledReader.read());

  // Nothing to send: released, and an empty answer.
  let empty = 0;
  const none = binaryResponse({ binary: new Uint8Array(0), contentType: 'image/jpeg', held: { release: () => void (empty += 1), withinMs: 1000 } }, 'req-2');
  assert.equal((await none.arrayBuffer()).byteLength, 0);
  assert.equal(empty, 1);

  // An answer that is not counted is sent as before.
  const plain = binaryResponse({ binary: bytes, contentType: 'application/pdf' }, 'req-3');
  assert.deepEqual(new Uint8Array(await plain.arrayBuffer()), bytes);
});

test('the kernel can take a counted answer from a source, a piece at a time, and never sends a short or a long one as whole', async () => {
  const parts = [new Uint8Array(randomBytes(70_000)), new Uint8Array(randomBytes(70_000)), new Uint8Array(randomBytes(10_000))];
  const answer = (given: Uint8Array[], bytes: number, withinMs = 60_000) => {
    const state = { released: 0, asked: 0 };
    const queue = [...given];
    const response = binaryResponse(
      { binary: new Uint8Array(0), contentType: 'application/octet-stream', held: { release: () => void (state.released += 1), withinMs, pieces: { bytes, next: () => (state.asked += 1, queue.shift() ?? null) } } },
      'req-4'
    );
    return { state, response };
  };
  // Taken whole: the pieces in order, the length announced before the first is fetched, released once.
  const whole = answer(parts, 150_000);
  assert.equal(whole.response.headers.get('content-length'), '150000');
  assert.equal(whole.state.asked, 0, 'nothing is fetched before the connection asks');
  assert.deepEqual(new Uint8Array(await whole.response.arrayBuffer()), new Uint8Array(Buffer.concat(parts)));
  assert.deepEqual([whole.state.released, whole.state.asked], [1, 3]);
  // One piece taken, then the client stops: only that one was fetched; let go when its time is up.
  const stalled = answer(parts, 150_000, 30);
  const reader = stalled.response.body!.getReader();
  assert.equal((await reader.read()).value!.length, 70_000);
  assert.equal(stalled.state.asked, 1);
  await sleep(80);
  assert.equal(stalled.state.released, 1);
  await assert.rejects(reader.read());
  // A source that ends early (the file was deleted meanwhile), gives too much, or fails: the answer breaks off.
  for (const [given, bytes] of [[parts.slice(0, 2), 150_000], [parts, 100_000], [[], 150_000]] as const) {
    const bad = answer([...given], bytes);
    await assert.rejects(bad.response.arrayBuffer());
    assert.equal(bad.state.released, 1);
  }
  const failing = binaryResponse({ binary: new Uint8Array(0), contentType: 'application/octet-stream', held: { release: () => undefined, withinMs: 1000, pieces: { bytes: 10, next: () => { throw new Error('database gone'); } } } }, 'req-5');
  await assert.rejects(failing.arrayBuffer());
});

test('the kernel lets a counted answer go as soon as its client has gone, and when the connection stops taking it', async () => {
  const bytes = new Uint8Array(randomBytes(200_000));
  const answer = (signal: AbortSignal | undefined, stallMs?: number) => {
    const state = { released: 0 };
    const response = binaryResponse({ binary: bytes, contentType: 'application/octet-stream', held: { release: () => void (state.released += 1), withinMs: 60_000, stallMs } }, 'req-6', signal);
    return { state, response };
  };
  // The client left before its answer was ready (the job took a while): nothing is held for it at all.
  const early = answer(AbortSignal.abort());
  assert.equal(early.state.released, 1);
  await assert.rejects(early.response.arrayBuffer());
  // It leaves while nothing has been taken yet, or after a piece: let go at that moment, once.
  for (const takeOne of [false, true]) {
    const leaving = new AbortController();
    const a = answer(leaving.signal);
    const reader = a.response.body!.getReader();
    if (takeOne) assert.equal((await reader.read()).value!.length, 65536);
    assert.equal(a.state.released, 0);
    leaving.abort();
    assert.equal(a.state.released, 1);
    await assert.rejects(reader.read());
    assert.equal(a.state.released, 1);
  }
  // A connection that stays but stops taking: let go after the stall time, long before the answer's whole time.
  const stalled = answer(undefined, 40);
  const reader = stalled.response.body!.getReader();
  assert.equal((await reader.read()).value!.length, 65536);
  await sleep(15);
  assert.equal((await reader.read()).value!.length, 65536, 'a connection that keeps taking is not cut');
  assert.equal(stalled.state.released, 0);
  await sleep(100);
  assert.equal(stalled.state.released, 1);
  await assert.rejects(reader.read());
  // One that never takes the first piece: the same.
  const never = answer(undefined, 40);
  await sleep(100);
  assert.equal(never.state.released, 1);
  // A whole download with a signal that never fires is as before.
  const fine = answer(new AbortController().signal);
  assert.deepEqual(new Uint8Array(await fine.response.arrayBuffer()), bytes);
  assert.equal(fine.state.released, 1);
});

test('a client that asks for the edited file and leaves before it is written does not keep its room', async () => {
  const file = pptx(700_000);
  // Room for one edited file on its way, for her and for everybody.
  const t = server({ sendingBytesPerAccount: file.length + 1000, sendingBytes: file.length + 1000 });
  try {
    const ana = await t.registerUser();
    const deck = await uploaded(t, ana, file);
    const url = `http://tala.test/api/v1/deck-uploads/${deck.id}/pptx`;
    for (let i = 0; i < 4; i++) {
      // She asks and is gone before the worker has written the file.
      const leaving = new AbortController();
      const asked = t.server.handle(new Request(url, { headers: { authorization: `Bearer ${ana.token}` }, signal: leaving.signal }));
      leaving.abort();
      const response = await asked;
      if (response.status === 200) await assert.rejects(response.arrayBuffer());
    }
    // Her next download finds the room free: nothing waited for a timer.
    const next = await t.request('GET', `/deck-uploads/${deck.id}/pptx`, { token: ana.token });
    assert.equal(next.status, 200);
    assert.equal(readUploadedDeck(new Uint8Array(await next.arrayBuffer())).slides.length, 3);
    assert.deepEqual(t.errors, []);
  } finally {
    t.close();
  }
});

test('"the file I uploaded" is kept in pieces and sent a piece at a time: a download nobody takes holds one piece, not the file', async () => {
  const file = pptx(1_300_000);
  // Room for six pieces on their way for one account: far less than six of these files.
  const t = server({ sendingBytesPerAccount: 6 * PIECE, sendingBytes: 6 * PIECE });
  try {
    const ana = await t.registerUser();
    const ben = await t.registerUser();
    const deck = await uploaded(t, ana, file);
    const pieces = Math.ceil(file.length / PIECE);
    assert.ok(pieces >= 3);
    assert.equal(count(t, 'decks_upload_file_pieces'), pieces);
    assert.deepEqual(t.db.prepare('SELECT LENGTH(bytes) AS held, size FROM decks_upload_files').all(), [{ held: 0, size: file.length }]);
    const original = (user: TestUser, id: string) => t.request('GET', `/deck-uploads/${id}/original`, { token: user.token });
    // Six downloads of it that nobody reads: each counts for one piece. The seventh is told to come back.
    const sitting = [];
    for (let i = 0; i < 6; i++) sitting.push(await original(ana, deck.id));
    assert.deepEqual(sitting.map((r) => [r.status, r.headers.get('content-length')]), Array.from({ length: 6 }, () => [200, String(file.length)]));
    const seventh = await original(ana, deck.id);
    assert.deepEqual([seventh.status, await reasonOf(seventh)], [503, 'download_busy']);
    // One taken to the end is the file, bit for bit; its room is free again.
    assert.equal(sha(new Uint8Array(await sitting[0]!.arrayBuffer())), deck.originalSha256);
    const again = await original(ana, deck.id);
    assert.equal(sha(new Uint8Array(await again.arrayBuffer())), sha(file));
    for (const r of sitting.slice(1)) await r.body!.cancel();

    // The same file uploaded by another teacher is stored once; it goes when the last upload of it goes.
    const his = await uploaded(t, ben, file);
    assert.deepEqual([count(t, 'decks_upload_files'), count(t, 'decks_upload_file_pieces')], [1, pieces]);
    await t.ok('decks.uploads.delete', { params: { uploadId: deck.id }, token: ana.token });
    assert.deepEqual([count(t, 'decks_upload_files'), count(t, 'decks_upload_file_pieces')], [1, pieces]);
    // A download under way when the file is deleted breaks off; it is never a short file passed off as whole.
    const half = await original(ben, his.id);
    const reader = half.body!.getReader();
    assert.equal((await reader.read()).value!.length, PIECE);
    await t.ok('decks.uploads.delete', { params: { uploadId: his.id }, token: ben.token });
    assert.deepEqual([count(t, 'decks_upload_files'), count(t, 'decks_upload_file_pieces')], [0, 0]);
    await assert.rejects(reader.read());
    assert.deepEqual(t.errors, []);
  } finally {
    t.close();
  }
});

test('files stored whole before are cut into the same pieces (migration decks:004)', async () => {
  const t = server();
  try {
    const ana = await t.registerUser();
    const file = pptx(1_300_000);
    const deck = await uploaded(t, ana, file);
    const asStored = t.db.prepare('SELECT idx, bytes FROM decks_upload_file_pieces ORDER BY idx').all() as Array<{ idx: number; bytes: Buffer }>;
    // Put the database back to how hand-over 7 stored a file: whole, in decks_upload_files, and no pieces.
    t.db.prepare('UPDATE decks_upload_files SET bytes = ? WHERE sha256 = ?').run(Buffer.from(file), deck.originalSha256);
    t.db.prepare('DELETE FROM decks_upload_file_pieces').run();
    // The migration's own statements, without the one that makes the table.
    const sql = uploadsMigrations.find((m) => m.id === 'decks:004_upload_file_pieces')!.sql;
    t.db.exec(sql.slice(sql.indexOf('INSERT INTO decks_upload_file_pieces')));
    assert.deepEqual(t.db.prepare('SELECT idx, bytes FROM decks_upload_file_pieces ORDER BY idx').all(), asStored);
    assert.equal((t.db.prepare('SELECT LENGTH(bytes) AS n FROM decks_upload_files').get() as { n: number }).n, 0);
    const back = await t.request('GET', `/deck-uploads/${deck.id}/original`, { token: ana.token });
    assert.equal(sha(new Uint8Array(await back.arrayBuffer())), sha(file));
    // And the edited download is written from the pieces.
    const edited = await t.request('GET', `/deck-uploads/${deck.id}/pptx`, { token: ana.token });
    assert.equal(readUploadedDeck(new Uint8Array(await edited.arrayBuffer())).slides.length, 3);
  } finally {
    t.close();
  }
});

test('edited downloads nobody takes: one account can only have so much on its way, and everybody together only so much', async () => {
  const hers = pptx(700_000);
  const his = pptx(700_000, { 'docProps/core.xml': null });
  const size = Math.max(hers.length, his.length);
  const t = server({ sendingBytesPerAccount: 2 * size + 1000, sendingBytes: 3 * size + 2000 });
  try {
    const ana = await t.registerUser();
    const ben = await t.registerUser();
    const a = await uploaded(t, ana, hers);
    const b = await uploaded(t, ben, his);
    const original = (user: TestUser, id: string) => t.request('GET', `/deck-uploads/${id}/original`, { token: user.token });
    const edited = (user: TestUser, id: string) => t.request('GET', `/deck-uploads/${id}/pptx`, { token: user.token });

    // Two edited downloads of hers that nobody reads; a third has no room, and neither has a piece of her original.
    const first = await edited(ana, a.id);
    const second = await edited(ana, a.id);
    assert.deepEqual([first.status, second.status], [200, 200]);
    for (const ask of [edited, original]) {
      const third = await ask(ana, a.id);
      assert.deepEqual([third.status, await reasonOf(third)], [503, 'download_busy']);
    }
    // Ben still has his own room, until everybody's is used up.
    const bens = await edited(ben, b.id);
    assert.equal(bens.status, 200);
    const fourth = await edited(ben, b.id);
    assert.deepEqual([fourth.status, await reasonOf(fourth)], [503, 'download_busy']);
    // Everything else of the site answers as ever meanwhile.
    assert.equal((await t.ok('decks.uploads.get', { params: { uploadId: a.id }, token: ana.token })).slideCount, 3);
    assert.equal((await t.ok('decks.uploads.list', { token: ben.token })).decks.length, 1);

    // One is taken to the end: its room is free again, and it is her deck.
    assert.equal(readUploadedDeck(new Uint8Array(await first.arrayBuffer())).slides.length, 3);
    const again = await edited(ana, a.id);
    assert.equal(again.status, 200);
    // The others are given up by their clients: free again.
    await second.body!.cancel();
    await again.body!.cancel();
    await bens.body!.cancel();
    const afterwards = await Promise.all([original(ana, a.id), edited(ana, a.id), edited(ben, b.id)]);
    assert.deepEqual(afterwards.map((r) => r.status), [200, 200, 200]);
    assert.equal(sha(new Uint8Array(await afterwards[0]!.arrayBuffer())), a.originalSha256);
    for (const r of afterwards.slice(1)) await r.arrayBuffer();
    assert.deepEqual(t.errors, []);
  } finally {
    t.close();
  }
});

test('downloads nobody takes are cut short when their time is up, and the room is free again', async () => {
  const file = pptx(700_000);
  const t = server({ sendingBytesPerAccount: file.length + 1000, sendingBytes: file.length + 1000, sendGraceMs: 40, sendBytesPerSecond: 1e9 });
  try {
    const ana = await t.registerUser();
    const deck = await uploaded(t, ana, file);
    for (const kind of ['pptx', 'original'] as const) {
      const ask = () => t.request('GET', `/deck-uploads/${deck.id}/${kind}`, { token: ana.token });
      const silent = await ask();
      assert.equal(silent.status, 200, kind);
      // The edited file fills her room; her original holds a piece of it.
      if (kind === 'pptx') assert.equal((await ask()).status, 503);
      await sleep(120);
      // The silent one is over: what its client gets now is a broken download, not the file.
      await assert.rejects(silent.arrayBuffer(), kind);
      const next = await ask();
      assert.equal(next.status, 200, kind);
      const bytes = new Uint8Array(await next.arrayBuffer());
      if (kind === 'original') assert.equal(sha(bytes), deck.originalSha256);
      else assert.equal(readUploadedDeck(bytes).slides.length, 3);
    }
  } finally {
    t.close();
  }
});

test('pictures are counted the same way, for the account they belong to', async () => {
  const picture = (n: number) => {
    const p = new Uint8Array(n).fill(9);
    p.set([0xff, 0xd8, 0xff], 0);
    return p;
  };
  const t = server({ renderer: { render: async (_file, slides) => Array.from({ length: slides }, () => picture(40_000)) }, sendingBytesPerAccount: 100_000, sendingBytes: 150_000 });
  try {
    const ana = await t.registerUser();
    const ben = await t.registerUser();
    const a = await uploaded(t, ana, pptx(10));
    const b = await uploaded(t, ben, pptx(10, { 'docProps/core.xml': null }));
    for (const [user, deck] of [[ana, a], [ben, b]] as const) assert.equal((await t.ok('decks.uploads.render', { params: { uploadId: deck.id }, token: user.token })).state, 'ready');
    const pictureOf = (user: TestUser, id: string, slide: string) => t.request('GET', `/deck-uploads/${id}/previews/${slide}`, { token: user.token });
    // Her editor asks for all three at once and reads none yet: two fit in what one account may have on its way.
    const asked = await Promise.all(['s256', 's257', 's258'].map((s) => pictureOf(ana, a.id, s)));
    assert.deepEqual(asked.map((r) => r.status), [200, 200, 503]);
    // Ben gets one of his; then everybody's room is used up.
    const bens = [await pictureOf(ben, b.id, 's256'), await pictureOf(ben, b.id, 's257')];
    assert.deepEqual(bens.map((r) => r.status), [200, 503]);
    // Read, they make room: the third is there on the next try, as when a browser asks again.
    assert.equal((await asked[0]!.arrayBuffer()).byteLength, 40_000);
    assert.equal((await asked[1]!.arrayBuffer()).byteLength, 40_000);
    assert.equal((await pictureOf(ana, a.id, 's258')).status, 200);
  } finally {
    t.close();
  }
});

test('the room for sending is never set below one whole answer by default', async () => {
  // With nothing set, the largest edited file that can be written can also be sent.
  const t = server();
  try {
    const ana = await t.registerUser();
    const deck = await uploaded(t, ana, pptx(300_000));
    const r = await t.request('GET', `/deck-uploads/${deck.id}/pptx`, { token: ana.token });
    assert.equal(r.status, 200);
    assert.ok(Number(r.headers.get('content-length')) > 300_000);
    assert.equal((await r.arrayBuffer()).byteLength, Number(r.headers.get('content-length')));
  } finally {
    t.close();
  }
});
