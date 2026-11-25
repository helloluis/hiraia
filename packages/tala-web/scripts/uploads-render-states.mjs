// What a teacher's editor gets from a running tala-web when the drawing service is there, stopped, busy, killed
// in the middle of a drawing, or too slow: through the REAL HTTP API, with two teachers.
//
// It holds the server to this: pictures only for their owner; with the service stopped the answer is "no pictures
// here" while saving, the edited download and the uploaded original all keep working; a killed or slow job is a
// failed drawing and nothing more; the web process never starts a program of its own to draw (there is no other
// way to a picture); and afterwards everything works as before.
//
//   pnpm exec tsx scripts/uploads-render-states.mjs <baseUrl> <out.json> [--db <TALA_DB_PATH>] --deck <small.pptx> --slow-deck <deck that takes seconds.pptx>
//        --socket-unit tala-render.socket --job-units 'tala-render@*.service' [--user] [--server-pid PID] [--only stopped,killed,slow,turns]
//
// --db            the running server's database: only needed where a new account has to confirm its address by
//                 mail (the link is read from the mail outbox). A server with TALA_AUTH_AUTO_VERIFY=1 needs none.
// --user          the drawing service runs under the per-user service manager (deploy/render/dev-units.mjs)
// --server-pid    the web process: its children are listed at every step (there must never be one that draws)
// --slow-only     the service this server talks to was started with a tiny time limit: only check that a drawing
//                 that runs out of time is a failed drawing (see deploy/render/README.md, "slow")
//
// Local or staging servers only: it creates two accounts (fictional, @example.com), confirms them from the mail
// outbox in --db where that is needed, and deletes its uploads again. It stops and starts the drawing service, so
// not on a live site.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { createTalaClient } = await import('@hiraia/tala-core/contracts');

const argv = process.argv.slice(2);
const [base, outFile] = argv;
const opt = (name) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : '');
const flag = (name) => argv.includes(`--${name}`);
const dbPath = opt('db');
const deckFile = opt('deck');
const slowFile = opt('slow-deck');
const socketUnit = opt('socket-unit');
const jobUnits = opt('job-units');
const serverPid = opt('server-pid');
const retryMs = Number(opt('retry-ms') || 30_000);
if (!base || !outFile || !deckFile || !slowFile || !socketUnit || !jobUnits) throw new Error('usage: see the top of this file');
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error('local servers only (this script creates accounts and stops the drawing service)');
const systemctl = (...args) => execFileSync('systemctl', [...(flag('user') ? ['--user'] : []), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = Date.now().toString(36);
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
/** Programs the web process itself has started (it must never start one to draw). */
const children = () => {
  if (!serverPid || !existsSync(`/proc/${serverPid}/task`)) return null;
  const pids = readdirSync(`/proc/${serverPid}/task`).flatMap((t) => {
    try {
      return readFileSync(`/proc/${serverPid}/task/${t}/children`, 'utf8').trim().split(/\s+/).filter(Boolean);
    } catch {
      return [];
    }
  });
  return pids.map((pid) => {
    try {
      return readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
    } catch {
      return 'gone';
    }
  });
};
const seenChildren = new Set();
const lookAtChildren = () => (children() ?? []).forEach((c) => seenChildren.add(c));

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
  const email = `teacher.render.${stamp}.${n}@example.com`;
  const registered = await client.call('auth.register', { body: { email, password: `tala-render-${stamp}-Aa1!`, displayName: `Render check teacher ${n} (test)`, uiLanguage: 'en', deviceLabel: 'render check' } });
  // A server that verifies accounts by itself (TALA_AUTH_AUTO_VERIFY=1) sends no mail: there is nothing to confirm.
  if (!registered.user.emailVerified) {
    if (!dbPath) throw new Error('this server wants new accounts confirmed by mail: give --db <the running server’s database> so the link can be read from its outbox');
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare("select vars from core_mail_outbox where to_email=? and template='verify_email' order by rowid desc limit 1").get(email);
    db.close();
    if (!row) throw new Error('no verification mail in the outbox (is --db the running server’s database?)');
    await client.call('auth.verifyEmail', { body: { token: JSON.parse(row.vars).link.split('#token=')[1] } });
  }
  const binary = async (path, cookies = true) => {
    const res = cookies ? await fetchWithCookies(`${base}/api/v1${path}`) : await fetch(`${base}/api/v1${path}`);
    return { status: res.status, type: res.headers.get('content-type') ?? '', bytes: new Uint8Array(await res.arrayBuffer()) };
  };
  const upload = async (file, name) => {
    const bytes = new Uint8Array(readFileSync(file));
    const session = await client.call('decks.uploads.begin', { body: { fileName: name, bytes: bytes.length, sha256: sha(bytes) } });
    for (let i = 0; i < session.chunkCount; i++) {
      await client.call('decks.uploads.chunk', { params: { sessionId: session.sessionId, index: String(i) }, body: { data: Buffer.from(bytes.subarray(i * session.chunkBytes, (i + 1) * session.chunkBytes)).toString('base64') } });
    }
    return { deck: await client.call('decks.uploads.finish', { params: { sessionId: session.sessionId } }), bytes };
  };
  const render = (id) => client.call('decks.uploads.render', { params: { uploadId: id } });
  /** Render, asking again while the answer is "busy" (as the editor does). */
  const renderWaiting = async (id, tries = 40) => {
    let r = await render(id);
    for (let i = 0; r.state === 'busy' && i < tries; i++) {
      await sleep(500);
      r = await render(id);
    }
    return r;
  };
  const get = (id) => client.call('decks.uploads.get', { params: { uploadId: id } });
  /** Save the deck with its slides the other way round (a real change that needs new pictures). */
  const saveReversed = async (id) => {
    const d = await get(id);
    return client.call('decks.uploads.save', { params: { uploadId: id }, body: { baseRev: d.rev, slides: [...d.edits.slides].reverse() } });
  };
  const remove = (id) => client.call('decks.uploads.delete', { params: { uploadId: id } }).catch(() => undefined);
  return { client, binary, upload, render, renderWaiting, get, saveReversed, remove };
}
const isJpeg = (b) => b.length > 100 && b[0] === 0xff && b[1] === 0xd8 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9;
const healthy = async () => (await fetch(`${base}/api/v1/health`)).status === 200;
const wanted = (name) => !opt('only') || opt('only').split(',').includes(name);

const ana = await teacher(1);
const ben = await teacher(2);
const made = [];
try {
  lookAtChildren();
  if (flag('slow-only')) {
    // The service behind this server was started with a tiny time limit.
    const { deck } = await ana.upload(slowFile, 'Slow deck.pptx');
    made.push([ana, deck.id]);
    const started = Date.now();
    const r = await ana.renderWaiting(deck.id);
    check('a drawing that runs out of time is a failed drawing, in bounded time', r.state === 'failed' && Date.now() - started < 60_000, `${r.state} after ${Date.now() - started} ms`);
    check('the editor still has the deck, can save it and can download it', (await ana.saveReversed(deck.id)).rev === 2 && (await ana.binary(`/deck-uploads/${deck.id}/pptx`)).status === 200);
    check('the site is healthy', await healthy());
  } else {
    /* ---- the service is there ---- */
    const a = await ana.upload(deckFile, 'Ana deck.pptx');
    made.push([ana, a.deck.id]);
    const n = a.deck.base.slides.length;
    check('a new upload says the server can draw pictures', a.deck.previews.available === true && a.deck.previews.rev === null);
    const first = await ana.renderWaiting(a.deck.id);
    check('the slides are drawn', first.state === 'ready' && first.rev === 1 && first.slideIds.length === n, `${first.state}, ${first.slideIds.length} of ${n}`);
    const pic = await ana.binary(`/deck-uploads/${a.deck.id}/previews/${first.slideIds[0]}`);
    check('her picture is a JPEG, served to her', pic.status === 200 && pic.type === 'image/jpeg' && isJpeg(pic.bytes), `${pic.status} ${pic.type} ${pic.bytes.length} bytes`);
    const strangers = [await ben.binary(`/deck-uploads/${a.deck.id}/previews/${first.slideIds[0]}`), await ana.binary(`/deck-uploads/${a.deck.id}/previews/${first.slideIds[0]}`, false)];
    const benRender = await ben.client.call('decks.uploads.render', { params: { uploadId: a.deck.id } }).then(() => 'answered', (e) => e?.code ?? 'error');
    check('another teacher and a signed-out visitor get nothing of it, and cannot have it drawn', strangers[0].status === 404 && strangers[1].status === 401 && benRender === 'not_found', `${strangers.map((s) => s.status).join(',')}; her render as him: ${benRender}`);
    lookAtChildren();

    if (wanted('turns')) {
      /* ---- two teachers at the same moment ---- */
      const b = await ben.upload(slowFile, 'Ben deck.pptx');
      made.push([ben, b.deck.id]);
      await ana.saveReversed(a.deck.id);
      const [ra, rb] = await Promise.all([ana.render(a.deck.id), ben.render(b.deck.id)]);
      check('two teachers ask at the same moment: one is drawn or drawing, the other is told "busy", nobody fails', [ra.state, rb.state].sort().join(',') === 'busy,ready' || (ra.state === 'ready' && rb.state === 'ready'), `${ra.state}, ${rb.state}`);
      const [ra2, rb2] = [await ana.renderWaiting(a.deck.id, 200), await ben.renderWaiting(b.deck.id, 200)];
      check('asked again, each gets her own pictures', ra2.state === 'ready' && ra2.slideIds.length === n && rb2.state === 'ready' && rb2.slideIds.length === b.deck.base.slides.length, `${ra2.state} ${ra2.slideIds.length}; ${rb2.state} ${rb2.slideIds.length}`);
      const cross = [await ana.binary(`/deck-uploads/${b.deck.id}/previews/${rb2.slideIds[0]}`), await ben.binary(`/deck-uploads/${a.deck.id}/previews/${ra2.slideIds[0]}`)];
      check('neither can fetch the other\'s pictures', cross.every((c) => c.status === 404), cross.map((c) => c.status).join(','));
      lookAtChildren();
    }

    if (wanted('killed')) {
      /* ---- a job is killed in the middle of a drawing ---- */
      const k = await ben.upload(slowFile, 'Ben slow deck.pptx');
      made.push([ben, k.deck.id]);
      const started = Date.now();
      const pending = ben.renderWaiting(k.deck.id);
      // Wait until a job is really running, then kill it. What counts is that the job that was drawing is gone:
      // systemctl can report an error for a unit that is already ending (its other processes vanish while it is
      // still sending them the signal), so its word is noted, not relied on.
      const running = () => systemctl('list-units', '--type=service', '--state=running', '--no-legend', '--plain', jobUnits).split('\n').map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
      let jobs = [];
      for (let i = 0; i < 100 && !jobs.length; i++) {
        await sleep(100);
        jobs = running();
      }
      await sleep(1500);
      let said = 'systemctl kill: ok';
      try {
        if (jobs.length) systemctl('kill', '--signal=KILL', ...jobs);
      } catch (err) {
        said = `systemctl kill said: ${String(err.stderr ?? err.message).trim().split('\n')[0]}`;
      }
      let left = jobs;
      for (let i = 0; i < 50 && left.length; i++) {
        await sleep(100);
        const now = running();
        left = jobs.filter((j) => now.includes(j));
      }
      const killed = !jobs.length ? 'no job was running' : left.length ? `still running: ${left.join(' ')}` : 'killed';
      const r = await pending;
      check('a job killed in the middle of a drawing is a failed drawing, at once', killed === 'killed' && r.state === 'failed' && Date.now() - started < 30_000, `${killed} (${jobs.join(' ') || 'none'}; ${said}); ${r.state} after ${Date.now() - started} ms`);
      check('no half-drawn pictures were kept', (await ben.get(k.deck.id)).previews.slideIds.length === 0);
      check('the site is healthy and still says it draws', (await healthy()) && (await ben.get(k.deck.id)).previews.available === true);
      await ana.saveReversed(a.deck.id);
      const after = await ana.renderWaiting(a.deck.id);
      check('the next drawing works', after.state === 'ready' && after.slideIds.length === n, after.state);
      lookAtChildren();
    }

    if (wanted('stopped')) {
      /* ---- the service is stopped ---- */
      const before = await ana.get(a.deck.id);
      systemctl('stop', socketUnit);
      try {
        const saved = await ana.saveReversed(a.deck.id);
        const r = await ana.render(a.deck.id);
        check('with the service stopped the answer is "no pictures here", not an error', r.state === 'unavailable' && r.rev === before.previews.rev, `${r.state}; stored pictures still of version ${r.rev}`);
        const d = await ana.get(a.deck.id);
        check('the upload now says this server draws no pictures', d.previews.available === false && d.rev === saved.rev);
        const again = await ana.render(a.deck.id);
        check('asked again at once, the same answer (the service is not tried for every request)', again.state === 'unavailable');
        const [edited, original, kept] = [await ana.binary(`/deck-uploads/${a.deck.id}/pptx`), await ana.binary(`/deck-uploads/${a.deck.id}/original`), await ana.binary(`/deck-uploads/${a.deck.id}/previews/${first.slideIds[0]}`)];
        check('saving, the edited download and the uploaded original all work without pictures', (await ana.saveReversed(a.deck.id)).rev === saved.rev + 1 && edited.status === 200 && edited.bytes.length > 1000 && original.status === 200 && sha(original.bytes) === sha(a.bytes), `edited ${edited.status}, original ${original.status} identical ${sha(original.bytes) === sha(a.bytes)}`);
        check('the pictures she already had are still served', kept.status === 200 && isJpeg(kept.bytes));
        const fresh = await ben.upload(deckFile, 'Ben while stopped.pptx');
        made.push([ben, fresh.deck.id]);
        check('a new upload works too, and says there are no pictures', fresh.deck.base.slides.length === n && fresh.deck.previews.available === false);
        check('the site is healthy', await healthy());
        lookAtChildren();
      } finally {
        systemctl('start', socketUnit);
      }
      /* ---- and started again ---- */
      console.log(`      waiting ${Math.round(retryMs / 1000)} s: the server asks the service again only after a while`);
      await sleep(retryMs + 1500);
      const d = await ana.get(a.deck.id);
      const r = await ana.renderWaiting(a.deck.id);
      check('started again: after a while the server draws as before, by itself', d.previews.available === true && r.state === 'ready' && r.rev === d.rev && r.slideIds.length === n, `available ${d.previews.available}; ${r.state} at version ${r.rev}`);
      lookAtChildren();
    }
  }
  const kids = children();
  check('the web process never started a program to draw with', kids === null ? false : ![...seenChildren].some((c) => /soffice|libreoffice|pdftoppm|pdfinfo|unshare|oosplash/i.test(c)), kids === null ? 'give --server-pid' : `children seen during the run: ${[...seenChildren].join(', ') || 'none'}`);
} finally {
  for (const [t, id] of made) await t.remove(id);
}
const failed = checks.filter((c) => !c.ok);
writeFileSync(outFile, JSON.stringify({ base, at: new Date().toISOString(), passed: checks.length - failed.length, failed: failed.length, checks }, null, 1));
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
