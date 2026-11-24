/**
 * Files and edits made to stop the site (hostile-files.ts), sent through the same routes a teacher's browser uses,
 * with the real worker threads behind them.
 *
 * What is held to: every file comes to the end written beside it (a deck like any other, or a plain refusal);
 * no request takes long; and this thread, which is the web server's one thread in production, is never kept from
 * its other work for more than a moment, whatever the file says.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { UPLOAD_LIMITS } from '@hiraia/tala-core/contracts';
import type { UploadedDeck } from '@hiraia/tala-core/contracts';
import { syntheticDeckParts } from '@hiraia/tala-core/pptx/testing';
import { createTestServer } from '../../testing';
import type { TestServer, TestUser } from '../../testing';
import { createDecksModule, type DecksOptions } from './index';
import { HOSTILE_FILES } from './hostile-files';
import { readUploadedDeck, UPLOAD_ZIP_LIMITS, UploadRefused } from './upload-file';
import { UploadWorkError, uploadWorkers, type UploadWork } from './upload-jobs';
import { envBytes, UPLOAD_DEFAULTS } from './uploads';
import { readZip, writeZip } from './zip';

/** The longest this thread may go without a turn while a request is answered. Before: 30 seconds and more. */
const HELD_MS = 500;
/** The longest any one request may take here (the worker's own limits are 10 s to read and 20 s to write). */
const REQUEST_MS = 12_000;

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const pptx = (extra: Record<string, string | Uint8Array | null> = {}): Uint8Array => writeZip(Object.entries(syntheticDeckParts(extra)).map(([name, data]) => ({ name, data })));
const server = (uploads: DecksOptions['uploads'] = {}): TestServer => createTestServer({ quiet: true, modules: [createDecksModule({ uploads: { renderer: null, startsPerHour: 1000, ...uploads } })] });
const reason = (r: { error: { details?: unknown } | null }) => (r.error?.details as { reason?: string } | undefined)?.reason;

/** Watches this thread while a request is answered: the longest it went without getting a turn. */
function watchThread(): { longest(): number } {
  let longest = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 5);
  return {
    longest: () => {
      clearInterval(timer);
      return Math.round(Math.max(longest, performance.now() - last));
    },
  };
}

async function sendFile(t: TestServer, user: TestUser, file: Uint8Array, fileName: string) {
  const session = await t.ok('decks.uploads.begin', { body: { fileName, bytes: file.length, sha256: sha(file) }, token: user.token });
  for (let i = 0; i < session.chunkCount; i++) {
    const piece = file.subarray(i * UPLOAD_LIMITS.chunkBytes, (i + 1) * UPLOAD_LIMITS.chunkBytes);
    await t.ok('decks.uploads.chunk', { params: { sessionId: session.sessionId, index: String(i) }, body: { data: Buffer.from(piece).toString('base64') }, token: user.token });
  }
  return session.sessionId;
}

test('hostile files: each is read or refused as it should be, quickly, and the server goes on answering all the while', async () => {
  const drawn: number[] = [];
  const t = server({ renderer: { render: async (_file, slides) => (drawn.push(slides), Array.from({ length: slides }, () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))) } });
  const table: string[] = [];
  try {
    const ana = await t.registerUser();
    for (const hostile of HOSTILE_FILES) {
      // Building the file is this test's own work, not the server's: it is done before the watch starts.
      const file = hostile.build();
      const sessionId = await sendFile(t, ana, file, `${hostile.name}.pptx`);
      const watch = watchThread();
      const started = performance.now();
      const r = await t.call('decks.uploads.finish', { params: { sessionId }, token: ana.token });
      const ms = Math.round(performance.now() - started);
      const held = watch.longest();
      table.push(`${hostile.name}: ${r.ok ? 'accepted' : reason(r)} in ${ms} ms, this thread held ${held} ms at most`);
      assert.equal(r.ok ? 'accepted' : reason(r), hostile.expect, `${hostile.name}: ${hostile.about}`);
      assert.ok(ms < REQUEST_MS, `${hostile.name} took ${ms} ms`);
      assert.ok(held < HELD_MS, `${hostile.name} held this thread for ${held} ms`);
      // A refusal is a plain 400 with its reason, and nothing of the file is kept.
      if (!r.ok) {
        assert.equal(r.status, 400, hostile.name);
        assert.equal((t.db.prepare('SELECT COUNT(*) AS n FROM decks_upload_sessions').get() as { n: number }).n, 0, hostile.name);
        continue;
      }
      const deck = r.data as UploadedDeck;
      assert.ok(deck.base.slides.length >= 1 && JSON.stringify(deck).length < 2_500_000, hostile.name);
      // The edited download of an accepted file, as uploaded, is written like any other.
      const plainWatch = watchThread();
      const plain = await t.call('decks.uploads.pptx', { params: { uploadId: deck.id }, token: ana.token });
      assert.equal(plain.status, 200, hostile.name);
      assert.ok(plainWatch.longest() < HELD_MS, hostile.name);
      assert.deepEqual(readUploadedDeck(new Uint8Array(plain.data as ArrayBuffer)).slides.map((s) => s.id), deck.base.slides.map((s) => s.id), hostile.name);
      if (hostile.then) {
        const saved = await t.call('decks.uploads.save', { params: { uploadId: deck.id }, body: { baseRev: 1, slides: hostile.then.edits(deck) }, token: ana.token });
        assert.ok(saved.ok, `${hostile.name}: ${JSON.stringify(saved.error)}`);
        const watchWrite = watchThread();
        const startedWrite = performance.now();
        const out = await t.call('decks.uploads.pptx', { params: { uploadId: deck.id }, token: ana.token });
        const msWrite = Math.round(performance.now() - startedWrite);
        const heldWrite = watchWrite.longest();
        table.push(`${hostile.name}, then ${hostile.then.about}: ${out.ok ? 'written' : reason(out)} in ${msWrite} ms, this thread held ${heldWrite} ms at most`);
        assert.ok(msWrite < 22_000 && heldWrite < HELD_MS, `${hostile.name}: ${msWrite} ms, held ${heldWrite} ms`);
        if (hostile.then.download === 'written') {
          assert.equal(out.status, 200, hostile.name);
          const zip = readZip(new Uint8Array(out.data as ArrayBuffer));
          if (hostile.then.contains) assert.ok(zip.names.some((n) => /^ppt\/slides\/[^/]+$/.test(n) && zip.text(n).includes(hostile.then!.contains!)), hostile.name);
        } else {
          // Edits that would make the file grow without end: no download, said plainly; the deck and its original stay.
          assert.deepEqual([out.status, reason(out)], [503, 'export_failed'], hostile.name);
          const before = drawn.length;
          assert.equal((await t.ok('decks.uploads.render', { params: { uploadId: deck.id }, token: ana.token })).state, 'failed', hostile.name);
          assert.equal(drawn.length, before, 'nothing is handed to the drawing service when the file cannot be written');
          assert.equal((await t.call('decks.uploads.original', { params: { uploadId: deck.id }, token: ana.token })).status, 200, hostile.name);
          assert.equal((await t.call('decks.uploads.get', { params: { uploadId: deck.id }, token: ana.token })).status, 200, hostile.name);
        }
      }
      await t.ok('decks.uploads.delete', { params: { uploadId: deck.id }, token: ana.token });
    }
    // Nothing of any of them is left, and nothing went wrong inside the server.
    assert.equal((t.db.prepare('SELECT COUNT(*) AS n FROM decks_upload_files').get() as { n: number }).n, 0);
    assert.deepEqual(t.errors, []);
    // After all of it, an ordinary file is read as ever.
    const ordinary = pptx();
    const again = await t.ok('decks.uploads.finish', { params: { sessionId: await sendFile(t, ana, ordinary, 'Plants.pptx') }, token: ana.token });
    assert.equal(again.slideCount, 3);
  } finally {
    t.close();
    if (process.env.TALA_TEST_VERBOSE) console.log(table.join('\n'));
  }
});

test('the worker: a file that takes longer than is allowed is stopped, and so is one that needs more memory; the next file is read as ever', async () => {
  const heavy = HOSTILE_FILES.find((f) => f.name === 'eight-slides-each-within-the-limits')!.build();
  const small = pptx();
  // With the standing limits both are read. How long each takes on this machine sets a time limit between the two.
  const standing = uploadWorkers();
  const timeOf = async (file: Uint8Array, slides: number) => {
    const started = performance.now();
    assert.equal((await standing.read(file)).slides.length, slides);
    return performance.now() - started;
  };
  const [quick, long] = [await timeOf(small, 3), await timeOf(heavy, 8)];
  assert.ok(long > 3 * quick, `the heavy file (${Math.round(long)} ms) must take much longer than an ordinary one (${Math.round(quick)} ms) for this test to say anything`);
  const readMs = Math.round(Math.sqrt(quick * long));
  for (const [limits, kind] of [[{ readMs }, 'time'], [{ heapMb: 40 }, 'memory'], [{ heapMb: 40 }, 'memory']] as const) {
    const work = uploadWorkers(limits);
    const watch = watchThread();
    const started = performance.now();
    await assert.rejects(work.read(heavy), (err: unknown) => err instanceof UploadWorkError && err.kind === kind, `${kind} limit`);
    assert.ok(performance.now() - started < 5000, `stopped at the ${kind} limit after ${Math.round(performance.now() - started)} ms`);
    assert.ok(watch.longest() < HELD_MS);
    // Same workers, same limits, next job: an ordinary file is read as ever.
    assert.equal((await work.read(small)).slides.length, 3);
    assert.equal(await work.check(), null);
  }
  // A job that is stopped is stopped at its limit, not some time after: 40 ms allowed, back within a quarter of a second.
  const started = performance.now();
  await assert.rejects(uploadWorkers({ readMs: 40 }).read(heavy), (err: unknown) => err instanceof UploadWorkError && err.kind === 'time');
  assert.ok(performance.now() - started < 250, `${Math.round(performance.now() - started)} ms`);
});

test('the worker is given the file and nothing else: not the server\'s settings, and no way to print into its log', async () => {
  const before = process.env.TALA_TEST_SECRET_FOR_WORKER;
  process.env.TALA_TEST_SECRET_FOR_WORKER = 'must-not-be-seen';
  try {
    // The worker's own job file is the only thing it runs; what it would see of this process is asked of a
    // worker started the same way, with a script that reports instead of reading a deck.
    const { Worker } = await import('node:worker_threads');
    const seen = await new Promise<{ env: string[]; argv: string[] }>((resolve, reject) => {
      const w = new Worker('const { parentPort } = require("node:worker_threads"); parentPort.postMessage({ env: Object.keys(process.env), argv: process.execArgv });', { eval: true, execArgv: [], env: {}, stdout: true, stderr: true });
      w.once('message', resolve);
      w.once('error', reject);
    });
    assert.deepEqual(seen, { env: [], argv: [] });
    // And the real one is started exactly so (upload-jobs.ts): the options are read from its source, so that a
    // change there is a change here.
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./upload-jobs.ts', import.meta.url), 'utf8');
    for (const option of ['execArgv: []', 'env: {}', 'stdout: true', 'stderr: true', 'resourceLimits: { maxOldGenerationSizeMb: heapMb']) assert.ok(source.includes(option), option);
    assert.ok(!/inspectDeck|applyEdits|readUploadedDeck\(|writeEditedDeck\(/.test(readFileSync(new URL('./uploads.ts', import.meta.url), 'utf8')), 'the routes never read or write a file themselves');
  } finally {
    if (before === undefined) delete process.env.TALA_TEST_SECRET_FOR_WORKER;
    else process.env.TALA_TEST_SECRET_FOR_WORKER = before;
  }
});

test('the worker: one job at a time, a short queue, and beyond that "come back in a moment"', async () => {
  const small = pptx();
  const work = uploadWorkers({ waiting: 2 });
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => work.read(small)));
  assert.deepEqual(results.map((r) => (r.status === 'fulfilled' ? 'read' : r.reason instanceof UploadWorkError ? r.reason.kind : 'error')), ['read', 'read', 'read', 'busy', 'busy', 'busy']);
  // A job that waits longer than it may is told the same, and the queue is not left blocked.
  const slow = uploadWorkers({ waitMs: 1 });
  const heavy = HOSTILE_FILES.find((f) => f.name === 'eight-slides-each-within-the-limits')!.build();
  const [first, second] = await Promise.allSettled([slow.read(heavy), slow.read(small)]);
  assert.equal(first.status, 'fulfilled');
  assert.ok(second.status === 'rejected' && second.reason instanceof UploadWorkError && second.reason.kind === 'busy');
  assert.equal((await slow.read(small)).slides.length, 3);
});

test('the worker: the one place is shared out between accounts; one account cannot crowd the others out', async () => {
  const small = pptx();
  const heavy = HOSTILE_FILES.find((f) => f.name === 'eight-slides-each-within-the-limits')!.build();
  const work = uploadWorkers();
  // One account asks for six jobs at once: one is done, one waits, four are told to come back at once.
  const hers = await Promise.allSettled(Array.from({ length: 6 }, () => work.read(small, undefined, 'ana')));
  assert.deepEqual(hers.map((r) => (r.status === 'fulfilled' ? 'read' : r.reason instanceof UploadWorkError ? r.reason.kind : 'error')), ['read', 'read', 'busy', 'busy', 'busy', 'busy']);
  // Ana has a long job under way and another waiting. Ben comes last, and is served before Ana's second: the free
  // place goes to whoever has had the least of it lately, not to whoever queued first.
  const order: string[] = [];
  const done = (name: string) => () => void order.push(name);
  const jobs = [work.read(heavy, undefined, 'ana').then(done('ana 1')), work.read(heavy, undefined, 'ana').then(done('ana 2'))];
  await new Promise((resolve) => setTimeout(resolve, 20));
  jobs.push(work.read(small, undefined, 'ben').then(done('ben')));
  await Promise.all(jobs);
  assert.deepEqual(order, ['ana 1', 'ben', 'ana 2']);
  // Many accounts at once still only fill the short queue: the ninth to wait is told to come back.
  const crowd = await Promise.allSettled(Array.from({ length: 12 }, (_x, i) => work.read(small, undefined, `teacher ${i}`)));
  assert.deepEqual(crowd.filter((r) => r.status === 'fulfilled').length, 9);
  // Jobs that say no owner (tools, tests) are not held to one account's share.
  const tools = await Promise.allSettled(Array.from({ length: 5 }, () => work.read(small)));
  assert.equal(tools.filter((r) => r.status === 'fulfilled').length, 5);
});

test('the worker: a file put back together from its pieces is checked before anything is written from it', async () => {
  const work = uploadWorkers();
  const file = pptx();
  const deck = await work.read(file);
  const edits = { slides: deck.slides.map((s) => ({ id: s.id, source: s.id })) };
  assert.ok((await work.write(file, edits, sha(file))).pptx.length > 1000);
  const damaged = file.slice();
  damaged[damaged.length - 40] = damaged[damaged.length - 40]! ^ 0xff;
  await assert.rejects(work.write(damaged, edits, sha(file)), (err: unknown) => err instanceof UploadRefused && err.reason === 'checksum_mismatch');
});

test('the worker: bytes given as they are stay the caller\'s; bytes fetched for a job that writes are handed over, not copied', async () => {
  const work = uploadWorkers();
  const file = pptx();
  const deck = await work.read(file);
  const edits = { slides: deck.slides.map((s) => ({ id: s.id, source: s.id })) };
  // Given directly: still whole afterwards, for reading and for writing.
  const first = await work.write(file, edits);
  assert.equal(file.byteLength > 1000 && readUploadedDeck(file).slides.length, 3);
  // Fetched when the job's turn came: a reader's caller keeps its bytes (it stores them), a writer's are gone.
  const forRead = file.slice();
  assert.equal((await work.read(() => forRead)).slides.length, 3);
  assert.equal(forRead.byteLength, file.byteLength);
  const forWrite = file.slice();
  const second = await work.write(() => forWrite, edits);
  assert.equal(forWrite.byteLength, 0, 'the memory moved to the worker');
  assert.deepEqual(second.pptx, first.pptx);
  // A file that is read to be stored: handed over, and given back with its reading; nothing of it stays behind here.
  const forTaking = file.slice();
  const sum = createHash('sha256').update(file).digest('hex');
  const taken = await work.take(() => forTaking, sum);
  assert.equal(forTaking.byteLength, 0, 'the memory moved to the worker');
  assert.deepEqual([taken.inspection.slides.length, taken.file.byteLength], [3, file.byteLength]);
  assert.deepEqual(new Uint8Array(taken.file), file);
  // A file that is not the one announced is refused before it is read.
  await assert.rejects(work.take(() => file.slice(), 'a'.repeat(64)), (err: unknown) => err instanceof UploadRefused && err.reason === 'checksum_mismatch');
  // A view into a larger block is never handed over (the whole block would go): the worker gets exactly the file.
  const block = new Uint8Array(file.length + 4096);
  block.set(file, 1024);
  const view = block.subarray(1024, 1024 + file.length);
  assert.deepEqual((await work.write(() => view, edits)).pptx, first.pptx);
  assert.equal(block.byteLength, file.length + 4096);
  // What a job's fetching throws ends the job as it is, and the next job runs.
  await assert.rejects(work.write(() => { throw new Error('gone'); }, edits), /gone/);
  assert.equal((await work.read(file)).slides.length, 3);
});

test('routes: a read stopped at a limit is a refusal and the file is not kept; a busy or broken reader keeps the upload for another try', async () => {
  const heavy = HOSTILE_FILES.find((f) => f.name === 'eight-slides-each-within-the-limits')!.build();
  const stopped = server({ work: uploadWorkers({ readMs: 60 }) });
  try {
    const ana = await stopped.registerUser();
    const r = await stopped.call('decks.uploads.finish', { params: { sessionId: await sendFile(stopped, ana, heavy, 'Heavy.pptx') }, token: ana.token });
    assert.deepEqual([r.status, reason(r)], [400, 'too_large']);
    assert.equal((stopped.db.prepare('SELECT COUNT(*) AS n FROM decks_upload_sessions').get() as { n: number }).n, 0);
    assert.equal((stopped.db.prepare('SELECT COUNT(*) AS n FROM decks_upload_files').get() as { n: number }).n, 0);
    const line = stopped.logs.find((l) => l.event === 'deck_upload_refused')!;
    assert.deepEqual([line.fields.reason, line.fields.why], ['too_large', 'stopped at the time limit']);
    assert.ok(!JSON.stringify(stopped.logs).includes('Heavy'));
  } finally {
    stopped.close();
  }

  // A reader that is busy, then broken, then well again.
  const real = uploadWorkers();
  const moods: Array<'busy' | 'fault' | 'well'> = ['busy', 'fault', 'well'];
  const moody: UploadWork = {
    read: real.read,
    take: (file, sha256) => {
      const mood = moods.shift() ?? 'well';
      return mood === 'well' ? real.take(file, sha256) : Promise.reject(new UploadWorkError(mood, mood === 'fault' ? 'ERR_SOMETHING' : ''));
    },
    write: real.write,
    check: real.check,
  };
  const t = server({ work: moody });
  try {
    const ana = await t.registerUser();
    const sessionId = await sendFile(t, ana, pptx(), 'Plants.pptx');
    const busy = await t.call('decks.uploads.finish', { params: { sessionId }, token: ana.token });
    assert.deepEqual([busy.status, reason(busy)], [503, 'upload_busy']);
    const broken = await t.call('decks.uploads.finish', { params: { sessionId }, token: ana.token });
    assert.deepEqual([broken.status, reason(broken)], [503, 'upload_reader_unavailable']);
    assert.equal(t.logs.find((l) => l.event === 'deck_upload_reader_failed')?.fields.detail, 'ERR_SOMETHING');
    // The pieces are still there: the same upload is finished without sending anything again.
    assert.equal((await t.ok('decks.uploads.finish', { params: { sessionId }, token: ana.token })).slideCount, 3);
  } finally {
    t.close();
  }
});

test('settings: a size that cannot be read turns uploads off; it is never guessed, least of all upwards', async () => {
  const fallback = 30 * 1024 * 1024;
  for (const bad of ['10MB', '1e9', '-5', ' 100', '0', '10 000 000', '0x100', '1'.repeat(13)]) assert.equal(envBytes('X', fallback, fallback, { X: bad }), null, bad);
  assert.equal(envBytes('X', fallback, fallback, {}), fallback);
  assert.equal(envBytes('X', fallback, fallback, { X: '' }), fallback);
  assert.equal(envBytes('X', fallback, fallback, { X: '5000000' }), 5_000_000);
  assert.equal(envBytes('X', fallback, fallback, { X: '999999999999' }), fallback, 'a larger number than the most allowed is the most allowed');

  // With nothing set a server takes what it was measured to hold with room to spare, not the most the contract allows.
  assert.deepEqual(UPLOAD_DEFAULTS, { fileBytes: 15 * 1024 * 1024, accountBytes: 50 * 1024 * 1024 });
  assert.ok(UPLOAD_DEFAULTS.fileBytes < UPLOAD_LIMITS.fileBytes);
  const asSet = async (value: string | undefined) => {
    const was = process.env.TALA_DECK_UPLOAD_MAX_BYTES;
    if (value === undefined) delete process.env.TALA_DECK_UPLOAD_MAX_BYTES;
    else process.env.TALA_DECK_UPLOAD_MAX_BYTES = value;
    const s = createTestServer({ quiet: true, modules: [createDecksModule({ uploads: { renderer: null } })] });
    if (was === undefined) delete process.env.TALA_DECK_UPLOAD_MAX_BYTES;
    else process.env.TALA_DECK_UPLOAD_MAX_BYTES = was;
    try {
      const teacher = await s.registerUser();
      const allowance = (await s.ok('decks.uploads.list', { token: teacher.token })).allowance;
      const sixteen = await s.call('decks.uploads.begin', { body: { fileName: 'Sixteen.pptx', bytes: 16 * 1024 * 1024, sha256: 'a'.repeat(64) }, token: teacher.token });
      return [allowance.fileBytes, sixteen.status];
    } finally {
      s.close();
    }
  };
  assert.deepEqual(await asSet(undefined), [15 * 1024 * 1024, 400], 'nothing set: 15 MiB, and a file of 16 MiB is refused before a byte is sent');
  assert.deepEqual(await asSet(String(30 * 1024 * 1024)), [30 * 1024 * 1024, 200], 'a server may be set to the contract\'s 30 MiB');
  assert.deepEqual(await asSet(String(64 * 1024 * 1024)), [30 * 1024 * 1024, 200], 'and never to more');

  const before = process.env.TALA_DECK_UPLOAD_MAX_BYTES;
  process.env.TALA_DECK_UPLOAD_MAX_BYTES = '10MB';
  const t = createTestServer({ quiet: true, modules: [createDecksModule({ uploads: { renderer: null } })] });
  if (before === undefined) delete process.env.TALA_DECK_UPLOAD_MAX_BYTES;
  else process.env.TALA_DECK_UPLOAD_MAX_BYTES = before;
  try {
    const ana = await t.registerUser();
    const file = pptx();
    const r = await t.call('decks.uploads.begin', { body: { fileName: 'Plants.pptx', bytes: file.length, sha256: sha(file) }, token: ana.token });
    assert.deepEqual([r.status, reason(r)], [503, 'uploads_off']);
    // What she can still see says the same: no room for a file.
    assert.equal((await t.ok('decks.uploads.list', { token: ana.token })).allowance.fileBytes, 0);
    const line = t.logs.find((l) => l.event === 'deck_upload_settings_unreadable');
    assert.equal(line?.fields.names, 'TALA_DECK_UPLOAD_MAX_BYTES');
  } finally {
    t.close();
  }
});

test('room: unfinished uploads, downloads and pictures are all counted for the account that causes them', async () => {
  const pictures = (slides: number, each: number) => Array.from({ length: slides }, () => new Uint8Array(each).fill(7).map((v, i) => (i === 0 ? 0xff : i === 1 ? 0xd8 : v)));
  let each = 1000;
  const t = server({ maxAccountBytes: 3_000_000, downloadsPerMinute: 4, pictureBytesPerAccount: 10_000, renderer: { render: async (_file, slides) => pictures(slides, each) } });
  try {
    const ana = await t.registerUser();
    const ben = await t.registerUser();
    const open = () => (t.db.prepare('SELECT bytes FROM decks_upload_sessions WHERE owner_id = ? ORDER BY created_at, rowid').all(ana.id) as Array<{ bytes: number }>).map((s) => s.bytes);
    // Uploads begun and left: the newest and one other are kept, and never more than her account may hold.
    for (const bytes of [500_000, 600_000, 700_000]) await t.ok('decks.uploads.begin', { body: { fileName: 'A.pptx', bytes, sha256: sha(new Uint8Array([bytes & 255])) }, token: ana.token });
    assert.deepEqual(open(), [600_000, 700_000]);
    await t.ok('decks.uploads.begin', { body: { fileName: 'B.pptx', bytes: 2_500_000, sha256: 'b'.repeat(64) }, token: ana.token });
    assert.deepEqual(open(), [2_500_000], 'an older unfinished upload that no longer fits beside the new one makes room');
    // Ben's are his own.
    await t.ok('decks.uploads.begin', { body: { fileName: 'C.pptx', bytes: 100_000, sha256: 'c'.repeat(64) }, token: ben.token });
    assert.deepEqual(open(), [2_500_000]);

    // Downloads: so many a minute for one account, whichever of the two files is asked for.
    const first = await t.ok('decks.uploads.finish', { params: { sessionId: await sendFile(t, ana, pptx(), 'One.pptx') }, token: ana.token });
    const statuses: number[] = [];
    for (const route of ['decks.uploads.pptx', 'decks.uploads.original', 'decks.uploads.pptx', 'decks.uploads.original', 'decks.uploads.pptx', 'decks.uploads.original'] as const)
      statuses.push((await t.call(route, { params: { uploadId: first.id }, token: ana.token })).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 429, 429]);
    const bens = await t.ok('decks.uploads.finish', { params: { sessionId: await sendFile(t, ben, pptx({ 'docProps/core.xml': null }), 'His.pptx') }, token: ben.token });
    assert.equal((await t.call('decks.uploads.pptx', { params: { uploadId: bens.id }, token: ben.token })).status, 200, 'another teacher is not held back by her downloads');

    // Pictures are kept like a cache with a size for each account: those of the file she touched longest ago go.
    const second = await t.ok('decks.uploads.finish', { params: { sessionId: await sendFile(t, ana, pptx({ 'docProps/app.xml': '<x/>' }), 'Two.pptx') }, token: ana.token });
    const kept = () => (t.db.prepare('SELECT upload_id AS id, SUM(LENGTH(bytes)) AS bytes FROM decks_upload_previews GROUP BY upload_id').all() as Array<{ id: string; bytes: number }>).map((k) => [k.id, k.bytes]);
    each = 2000;
    assert.equal((await t.ok('decks.uploads.render', { params: { uploadId: first.id }, token: ana.token })).state, 'ready');
    assert.deepEqual(kept(), [[first.id, 6000]]);
    assert.equal((await t.ok('decks.uploads.render', { params: { uploadId: second.id }, token: ana.token })).state, 'ready');
    assert.deepEqual(kept(), [[second.id, 6000]], 'the pictures of the first file made room for those of the second');
    assert.equal((await t.ok('decks.uploads.get', { params: { uploadId: first.id }, token: ana.token })).previews.rev, null);
    // Pictures of one file that are more than an account may keep at all are not kept, and the others stay.
    each = 4000;
    assert.equal((await t.ok('decks.uploads.render', { params: { uploadId: first.id }, token: ana.token })).state, 'failed');
    assert.deepEqual(kept(), [[second.id, 6000]]);
    // Ben's pictures are counted for Ben.
    each = 3000;
    assert.equal((await t.ok('decks.uploads.render', { params: { uploadId: bens.id }, token: ben.token })).state, 'ready');
    assert.deepEqual(kept().sort((a, b) => Number(a[1]) - Number(b[1])), [[second.id, 6000], [bens.id, 9000]]);
    assert.deepEqual(t.errors, []);
  } finally {
    t.close();
  }
});

test('room: what a file is read into is kept with its size, and an account has a total for that too', async () => {
  const measure = server();
  let size = 0;
  try {
    const ana = await measure.registerUser();
    const deck = await measure.ok('decks.uploads.finish', { params: { sessionId: await sendFile(measure, ana, pptx(), 'One.pptx') }, token: ana.token });
    const row = measure.db.prepare('SELECT base_bytes AS kept, LENGTH(CAST(base_json AS BLOB)) AS really FROM decks_uploads WHERE id = ?').get(deck.id) as { kept: number; really: number };
    assert.ok(row.kept === row.really && row.kept > 1000, JSON.stringify(row));
    size = row.kept;
  } finally {
    measure.close();
  }
  // Room for one such reading and a little more: the second file is refused, and fits once the first is deleted.
  const t = server({ readingBytesPerAccount: size + 200 });
  try {
    const ana = await t.registerUser();
    const ben = await t.registerUser();
    const first = await t.ok('decks.uploads.finish', { params: { sessionId: await sendFile(t, ana, pptx(), 'One.pptx') }, token: ana.token });
    const other = pptx({ 'docProps/app.xml': '<x/>' });
    const second = await t.call('decks.uploads.finish', { params: { sessionId: await sendFile(t, ana, other, 'Two.pptx') }, token: ana.token });
    assert.deepEqual([second.status, reason(second)], [429, 'quota']);
    assert.equal((await t.call('decks.uploads.finish', { params: { sessionId: await sendFile(t, ben, other, 'His.pptx') }, token: ben.token })).status, 200, 'another account has its own total');
    await t.ok('decks.uploads.delete', { params: { uploadId: first.id }, token: ana.token });
    assert.equal((await t.call('decks.uploads.finish', { params: { sessionId: await sendFile(t, ana, other, 'Two.pptx') }, token: ana.token })).status, 200);
  } finally {
    t.close();
  }
});

test('the list of her files is a line per file: what each file holds is not read for it', async () => {
  const t = server();
  try {
    const ana = await t.registerUser();
    const deck = await t.ok('decks.uploads.finish', { params: { sessionId: await sendFile(t, ana, pptx(), 'Plants.pptx') }, token: ana.token });
    // Were the stored reading fetched and parsed for the list, this would fail it.
    t.db.prepare("UPDATE decks_uploads SET base_json = 'not json at all' WHERE id = ?").run(deck.id);
    const list = await t.ok('decks.uploads.list', { token: ana.token });
    assert.deepEqual(list.decks.map((d) => [d.id, d.slideCount]), [[deck.id, 3]]);
    assert.equal((await t.call('decks.uploads.get', { params: { uploadId: deck.id }, token: ana.token })).status, 500);
    // Neither is it read to send her file, to write the edited one, to draw it or to send a picture of it.
    assert.equal((await t.call('decks.uploads.original', { params: { uploadId: deck.id }, token: ana.token })).status, 200);
    assert.equal((await t.call('decks.uploads.pptx', { params: { uploadId: deck.id }, token: ana.token })).status, 200);
    assert.equal((await t.ok('decks.uploads.render', { params: { uploadId: deck.id }, token: ana.token })).state, 'unavailable');
    assert.equal((await t.call('decks.uploads.preview', { params: { uploadId: deck.id, slideId: 's256' }, token: ana.token })).status, 404);
  } finally {
    t.close();
  }
});

test('a stored file that is no longer the file that was uploaded is not written from: no download, and the log says so', async () => {
  const t = server();
  try {
    const ana = await t.registerUser();
    const deck = await t.ok('decks.uploads.finish', { params: { sessionId: await sendFile(t, ana, pptx(), 'Plants.pptx') }, token: ana.token });
    assert.equal((await t.call('decks.uploads.pptx', { params: { uploadId: deck.id }, token: ana.token })).status, 200);
    // One byte of a stored piece changes (a damaged disk, a mistake by hand).
    const piece = t.db.prepare('SELECT bytes FROM decks_upload_file_pieces WHERE sha256 = ? AND idx = 0').get(deck.originalSha256) as { bytes: Buffer };
    const changed = Buffer.from(piece.bytes);
    changed[changed.length - 40] = changed[changed.length - 40]! ^ 0xff;
    t.db.prepare('UPDATE decks_upload_file_pieces SET bytes = ? WHERE sha256 = ? AND idx = 0').run(changed, deck.originalSha256);
    const r = await t.call('decks.uploads.pptx', { params: { uploadId: deck.id }, token: ana.token });
    assert.deepEqual([r.status, reason(r)], [503, 'export_failed']);
    assert.equal(t.logs.find((l) => l.event === 'deck_upload_file_damaged')?.fields.uploadId, deck.id);
    assert.equal(t.logs.find((l) => l.event === 'deck_upload_export_failed')?.fields.reason, 'checksum_mismatch');
  } finally {
    t.close();
  }
});

test('the limits fit what they protect: one job at its largest stays far below what the web process has', () => {
  // The numbers that together decide how much memory one job can take (see deploy/render/README.md).
  assert.ok(UPLOAD_ZIP_LIMITS.partBytes <= 8 * 1024 * 1024);
  assert.ok(UPLOAD_ZIP_LIMITS.readBytes <= 96 * 1024 * 1024);
  assert.ok(UPLOAD_ZIP_LIMITS.nodes <= 2_000_000 && UPLOAD_ZIP_LIMITS.chars <= 64 * 1024 * 1024);
  assert.ok(UPLOAD_ZIP_LIMITS.outputBytes <= UPLOAD_LIMITS.fileBytes + 18 * 1024 * 1024);
});
