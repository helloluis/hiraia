// Real PowerPoint files through the REAL HTTP API of a running tala-web, the way the browser sends them: in pieces,
// checked, read, edited, exported, deleted. For every file of a corpus directory:
//   - the server takes or refuses it, and that must agree with what the reader alone said (the corpus report of
//     packages/tala-server/scripts/decks/pptx-corpus.ts);
//   - "the file I uploaded" comes back byte for byte;
//   - one edit is saved (new words in the first editable text box, slides in reverse order) and the edited download
//     is read back: same number of slides, reversed, with the new words where they were typed.
//
//   pnpm exec tsx scripts/uploads-corpus-http.mjs <baseUrl> <corpusDir> <corpus-report.json> <out.json> [--db <TALA_DB_PATH>]
//
// Local servers only: it creates accounts (fictional, @example.com; one per 15 files because an account may start
// 20 uploads an hour) and deletes every upload again. --db is where the server keeps its local mail outbox, read
// only to confirm each account's email the way the link in the email would; a server that verifies accounts by
// itself (TALA_AUTH_AUTO_VERIFY=1) needs none.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { createTalaClient, UPLOAD_LIMITS } = await import('@hiraia/tala-core/contracts');
const { readUploadedDeck } = await import('../../tala-server/src/modules/decks/upload-file.ts');

const argv = process.argv.slice(2);
const [base, corpusDir, reportFile, outFile] = argv;
const dbPath = argv.includes('--db') ? argv[argv.indexOf('--db') + 1] : '';
if (!base || !corpusDir || !reportFile || !outFile) throw new Error('usage: uploads-corpus-http.mjs <baseUrl> <corpusDir> <corpus-report.json> <out.json> [--db <TALA_DB_PATH>]');
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error('local servers only (this script creates accounts)');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const engine = new Map(JSON.parse(readFileSync(reportFile, 'utf8')).results.map((r) => [r.file, r]));
const stamp = Date.now().toString(36);

async function teacher(n) {
  const jar = { cookie: '' };
  const fetchWithCookies = async (input, init) => {
    const req = new Request(input, init);
    if (jar.cookie) req.headers.set('cookie', jar.cookie);
    const res = await fetch(req);
    const set = res.headers.get('set-cookie');
    if (set) jar.cookie = set.split(';')[0];
    return res;
  };
  const client = createTalaClient({ baseUrl: base, fetch: fetchWithCookies, validateResponses: true });
  const email = `teacher.corpus.${stamp}.${n}@example.com`;
  const registered = await client.call('auth.register', { body: { email, password: `tala-corpus-${stamp}-Aa1!`, displayName: `Corpus teacher ${n} (test)`, uiLanguage: 'en', deviceLabel: 'corpus run' } });
  if (!registered.user.emailVerified) {
    if (!dbPath) throw new Error('this server wants new accounts confirmed by mail: give --db <the running server’s database> so the link can be read from its outbox');
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare("select vars from core_mail_outbox where to_email=? and template='verify_email' order by rowid desc limit 1").get(email);
    db.close();
    if (!row) throw new Error('no verification mail in the outbox (is --db the running server’s database?)');
    await client.call('auth.verifyEmail', { body: { token: JSON.parse(row.vars).link.split('#token=')[1] } });
  }
  const binary = async (path) => {
    const res = await fetchWithCookies(`${base}/api/v1${path}`);
    return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()), name: res.headers.get('content-disposition') ?? '' };
  };
  return { client, binary };
}

const reasonOf = (err) => err?.details?.reason ?? err?.code ?? String(err).slice(0, 80);

async function one(t, file) {
  const bytes = new Uint8Array(readFileSync(join(corpusDir, file)));
  const expect = engine.get(file);
  const r = { file, bytes: bytes.length, expectTaken: Boolean(expect?.taken) };
  const started = Date.now();
  let deck;
  try {
    const session = await t.client.call('decks.uploads.begin', { body: { fileName: file.slice(0, UPLOAD_LIMITS.fileName), bytes: bytes.length, sha256: sha(bytes) } });
    for (let i = 0; i < session.chunkCount; i++) {
      const piece = bytes.subarray(i * session.chunkBytes, (i + 1) * session.chunkBytes);
      await t.client.call('decks.uploads.chunk', { params: { sessionId: session.sessionId, index: String(i) }, body: { data: Buffer.from(piece).toString('base64') } });
    }
    r.pieces = session.chunkCount;
    deck = await t.client.call('decks.uploads.finish', { params: { sessionId: session.sessionId } });
  } catch (err) {
    r.taken = false;
    r.refusal = reasonOf(err);
    r.agrees = !r.expectTaken;
    return r;
  }
  r.taken = true;
  r.uploadMs = Date.now() - started;
  r.agrees = r.expectTaken;
  r.slides = deck.base.slides.length;
  try {
    const original = await t.binary(`/deck-uploads/${deck.id}/original`);
    r.originalIdentical = original.status === 200 && sha(original.bytes) === sha(bytes);

    // One edit a teacher would make: new words in the first text box she may change, and the slides the other way round.
    const target = deck.base.slides.find((s) => s.blocks.some((b) => b.editable));
    const block = target?.blocks.find((b) => b.editable);
    const words = `Tala corpus edit ${stamp}`;
    const slides = [...deck.base.slides].reverse().map((s) => (s.id === target?.id ? { id: s.id, source: s.id, text: { [block.id]: [words, ...block.paragraphs.slice(1)] } } : { id: s.id, source: s.id }));
    const saved = await t.client.call('decks.uploads.save', { params: { uploadId: deck.id }, body: { baseRev: deck.rev, slides } });
    r.savedRev = saved.rev;
    const edited = await t.binary(`/deck-uploads/${deck.id}/pptx`);
    r.exportStatus = edited.status;
    if (edited.status === 200) {
      const back = readUploadedDeck(edited.bytes);
      // A slide keeps its id from the uploaded file, so the edited file read back names the same slides, reversed.
      r.readBack = {
        slides: back.slides.length === deck.base.slides.length,
        order: JSON.stringify(back.slides.map((s) => s.id)) === JSON.stringify([...deck.base.slides].reverse().map((s) => s.id)),
        words: !target || back.slides.find((s) => s.id === target.id)?.blocks.find((b) => b.id === block.id)?.paragraphs[0] === words,
        others: back.slides.every((s) => {
          const was = deck.base.slides.find((x) => x.id === s.id);
          return Boolean(was) && s.blocks.every((b, i) => (s.id === target?.id && b.id === block.id) || JSON.stringify(b.paragraphs) === JSON.stringify(was.blocks[i]?.paragraphs));
        }),
        differs: deck.base.slides.length === 1 && !target ? true : sha(edited.bytes) !== sha(bytes),
      };
      r.editedOk = Object.values(r.readBack).every(Boolean);
    } else r.editedOk = false;
  } catch (err) {
    r.error = reasonOf(err);
    r.editedOk = false;
  } finally {
    await t.client.call('decks.uploads.delete', { params: { uploadId: deck.id } }).catch(() => undefined);
  }
  r.totalMs = Date.now() - started;
  return r;
}

const files = readdirSync(corpusDir).filter((f) => /\.(pptx|potx|ppsx|pptm|ppsm|potm)$/i.test(f)).sort();
const results = [];
let t = null;
for (let i = 0; i < files.length; i++) {
  if (i % 15 === 0) t = await teacher(1 + i / 15);
  const r = await one(t, files[i]);
  results.push(r);
  console.log(`${String(i + 1).padStart(3)}/${files.length} ${r.taken ? (r.editedOk && r.originalIdentical ? 'ok     ' : 'PROBLEM') : `refused (${r.refusal})`.padEnd(7)} ${r.agrees ? '' : 'DISAGREES WITH THE READER '}${r.file}`);
}
const taken = results.filter((r) => r.taken);
const summary = {
  base,
  files: results.length,
  taken: taken.length,
  refused: results.length - taken.length,
  agreesWithTheReader: results.filter((r) => r.agrees).length,
  refusals: Object.fromEntries([...new Set(results.filter((r) => !r.taken).map((r) => r.refusal))].map((k) => [k, results.filter((r) => r.refusal === k).length])),
  originalIdentical: taken.filter((r) => r.originalIdentical).length,
  editedReadBack: taken.filter((r) => r.editedOk).length,
  sentInSeveralPieces: taken.filter((r) => r.pieces > 1).length,
  megabytesSent: Math.round(taken.reduce((n, r) => n + r.bytes, 0) / 1048576),
  slowestUploadMs: Math.max(...taken.map((r) => r.uploadMs)),
  problems: results.filter((r) => !r.agrees || (r.taken && !(r.editedOk && r.originalIdentical))).map((r) => r.file),
};
writeFileSync(outFile, JSON.stringify({ summary, results }, null, 1));
console.log(JSON.stringify(summary, null, 1));
process.exit(summary.problems.length ? 1 : 0);
