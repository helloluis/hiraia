// Files and edits made to stop the site, sent to a RUNNING tala-web through its real HTTP API, the way a browser
// sends them, while the site's health route is asked ten times a second by this script.
//
// It holds the server to this:
//   - every hostile file (packages/tala-server/src/modules/decks/hostile-files.ts, and any given with --file)
//     comes to its end quickly: a deck like any other, or a plain refusal with its reason;
//   - edits that would make a file grow without end give "no download", plainly, and nothing else is lost;
//   - downloads that nobody takes cost little and are counted: "the file I uploaded" is sent from the database a
//     piece at a time, so any number of clients sitting on it hold next to nothing; the edited file is counted,
//     and past what one account may have on its way the next is told to come back; when the clients go away the
//     room is free again;
//   - all the while the health route answers, promptly, and the web process is the same one at the end.
//
//   pnpm exec tsx scripts/uploads-hostile-http.mjs <baseUrl> <out.json> [--db <TALA_DB_PATH>] [--server-pid PID]
//        [--file some.pptx]... [--only name,name] [--no-sending] [--health-ms 1000]
//
// --db           the running server's database: only needed where a new account confirms its address by mail
//                (the link is read from the mail outbox). A server with TALA_AUTH_AUTO_VERIFY=1 needs none.
// --server-pid   the web process: checked to be alive, and its memory high-water mark noted, before and after
// --file         one more file to send (as often as wanted): it must be read or refused without disturbing anybody.
//                Nothing is expected of it but that; what the server said is in the output.
// --no-sending   leave out the part that sits on downloads (it uploads a file of 20 MB)
// --health-ms    the longest a health answer may take (default 1000)
// --stress N     then, for N seconds, everything at once at the limits: several accounts (--stress-accounts, default
//                4), each with a deck near the largest size (--stress-file-mb, default 29), sitting on downloads,
//                downloading, uploading more (another large file, and the heaviest file the reader still takes)
//                and having slides drawn. What is held to: the health route answers throughout and the web process
//                is the same one afterwards. Its memory at the peak is reported (--server-pid), and its control
//                group's high-water mark with --server-cgroup /sys/fs/cgroup/<path of the service>.
//
// Local or staging servers only: it creates accounts (fictional, @example.com; one for every ten files, because
// an account may start 20 uploads an hour) and deletes its uploads again.
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { basename } from 'node:path';

const require = createRequire(import.meta.url);
const { createTalaClient } = await import('@hiraia/tala-core/contracts');
const { syntheticDeckParts } = await import('@hiraia/tala-core/pptx/testing');
const { HOSTILE_FILES } = await import('../../tala-server/src/modules/decks/hostile-files.ts');
const { writeZip } = await import('../../tala-server/src/modules/decks/zip.ts');

const argv = process.argv.slice(2);
const [base, outFile] = argv;
const opt = (name) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : '');
const all = (name) => argv.flatMap((a, i) => (a === `--${name}` ? [argv[i + 1]] : []));
const flag = (name) => argv.includes(`--${name}`);
const dbPath = opt('db');
const serverPid = opt('server-pid');
const healthMs = Number(opt('health-ms') || 1000);
if (!base || !outFile) throw new Error('usage: see the top of this file');
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error('local servers only (this script creates accounts and sends hostile files)');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = Date.now().toString(36);
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const reasonOf = (err) => err?.details?.reason ?? err?.code ?? String(err).slice(0, 80);

/* ---------------- the site's pulse, all the while ---------------- */
const pulse = { asked: 0, failed: 0, longest: 0, slow: 0, stop: false, during: '' };
const beating = (async () => {
  while (!pulse.stop) {
    const started = performance.now();
    let ok = false;
    try {
      const res = await fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(30_000) });
      ok = res.status === 200;
      await res.arrayBuffer();
    } catch {
      ok = false;
    }
    const took = performance.now() - started;
    pulse.asked += 1;
    if (!ok) pulse.failed += 1;
    if (took > healthMs) pulse.slow += 1;
    if (took > pulse.longest) {
      pulse.longest = took;
      pulse.longestDuring = pulse.during;
    }
    await sleep(Math.max(0, 100 - took));
  }
})();
/** The process's memory high-water mark in MiB, or null when no pid was given or it is not ours to read. */
const serverMemory = () => {
  if (!serverPid) return null;
  try {
    const status = readFileSync(`/proc/${serverPid}/status`, 'utf8');
    return { rssMiB: Math.round(Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) / 1024), peakMiB: Math.round(Number(/^VmHWM:\s+(\d+)/m.exec(status)?.[1] ?? 0) / 1024) };
  } catch {
    return null;
  }
};
const serverAlive = () => !serverPid || existsSync(`/proc/${serverPid}`);

/* ---------------- a teacher ---------------- */
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
  const email = `teacher.hostile.${stamp}.${n}@example.com`;
  const registered = await client.call('auth.register', { body: { email, password: `tala-hostile-${stamp}-Aa1!`, displayName: `Hostile-file check teacher ${n} (test)`, uiLanguage: 'en', deviceLabel: 'hostile check' } });
  if (!registered.user.emailVerified) {
    if (!dbPath) throw new Error('this server wants new accounts confirmed by mail: give --db <the running server’s database> so the link can be read from its outbox');
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare("select vars from core_mail_outbox where to_email=? and template='verify_email' order by rowid desc limit 1").get(email);
    db.close();
    if (!row) throw new Error('no verification mail in the outbox (is --db the running server’s database?)');
    await client.call('auth.verifyEmail', { body: { token: JSON.parse(row.vars).link.split('#token=')[1] } });
  }
  /** The whole upload, as the browser does it. Resolves to what the server said at the end. */
  const upload = async (bytes, fileName) => {
    const session = await client.call('decks.uploads.begin', { body: { fileName, bytes: bytes.length, sha256: sha(bytes) } });
    for (let i = 0; i < session.chunkCount; i++) {
      await client.call('decks.uploads.chunk', { params: { sessionId: session.sessionId, index: String(i) }, body: { data: Buffer.from(bytes.subarray(i * session.chunkBytes, (i + 1) * session.chunkBytes)).toString('base64') } });
    }
    const started = performance.now();
    try {
      const deck = await client.call('decks.uploads.finish', { params: { sessionId: session.sessionId } });
      return { outcome: 'accepted', deck, ms: Math.round(performance.now() - started) };
    } catch (err) {
      return { outcome: reasonOf(err), status: err?.status ?? null, deck: null, ms: Math.round(performance.now() - started) };
    }
  };
  const binary = async (path) => {
    const started = performance.now();
    const res = await fetchWithCookies(`${base}/api/v1${path}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    let reason = '';
    if (res.status !== 200) {
      try {
        reason = JSON.parse(Buffer.from(bytes).toString('utf8')).error?.details?.reason ?? '';
      } catch {
        /* not JSON */
      }
    }
    return { status: res.status, bytes, reason, ms: Math.round(performance.now() - started) };
  };
  /** Asks for a download and takes nothing of it. Resolves when the answer's first line is there. */
  const sitOn = (path) =>
    new Promise((resolve, reject) => {
      const req = http.get(`${base}/api/v1${path}`, { headers: { cookie: jar.cookie }, agent: false }, (res) => {
        // Not one byte of the body is read: the connection fills up and the server has to hold the rest.
        res.pause();
        resolve({ status: res.statusCode, length: Number(res.headers['content-length'] ?? 0), letGo: () => req.destroy() });
      });
      req.on('error', reject);
    });
  return { client, upload, binary, sitOn };
}

const made = [];
const results = [];
const memoryBefore = serverMemory();
let teachers = 0;
let current = null;
let uploadsLeft = 0;
const nextTeacher = async () => {
  if (uploadsLeft === 0) {
    current = await teacher(++teachers);
    uploadsLeft = 10;
  }
  uploadsLeft -= 1;
  return current;
};

try {
  /* ---------------- the hostile files ---------------- */
  const only = opt('only') ? new Set(opt('only').split(',')) : null;
  for (const hostile of HOSTILE_FILES) {
    if (only && !only.has(hostile.name)) continue;
    const t = await nextTeacher();
    const file = hostile.build();
    pulse.during = hostile.name;
    const r = await t.upload(file, `${hostile.name}.pptx`);
    const line = { name: hostile.name, about: hostile.about, bytes: file.length, expected: hostile.expect, outcome: r.outcome, ms: r.ms };
    check(`${hostile.name}: ${hostile.expect === 'accepted' ? 'read like any other deck' : `refused (${hostile.expect})`}, quickly`, r.outcome === hostile.expect && r.ms < 12_000 && (r.outcome === 'accepted' || r.status === 400), `${r.outcome} in ${r.ms} ms; ${file.length} bytes; ${hostile.about}`);
    if (r.deck) {
      made.push([t, r.deck.id]);
      const plain = await t.binary(`/deck-uploads/${r.deck.id}/pptx`);
      line.plainDownload = { status: plain.status, bytes: plain.bytes.length, ms: plain.ms };
      let ok = plain.status === 200 && plain.bytes.length > 1000;
      let detail = `as uploaded: ${plain.status} in ${plain.ms} ms`;
      if (hostile.then) {
        pulse.during = `${hostile.name}, then ${hostile.then.about}`;
        await t.client.call('decks.uploads.save', { params: { uploadId: r.deck.id }, body: { baseRev: r.deck.rev, slides: hostile.then.edits(r.deck) } });
        const edited = await t.binary(`/deck-uploads/${r.deck.id}/pptx`);
        line.editedDownload = { about: hostile.then.about, expected: hostile.then.download, status: edited.status, reason: edited.reason, bytes: edited.bytes.length, ms: edited.ms };
        const original = await t.binary(`/deck-uploads/${r.deck.id}/original`);
        const kept = original.status === 200 && sha(original.bytes) === sha(file);
        ok = ok && edited.ms < 22_000 && kept && (hostile.then.download === 'written' ? edited.status === 200 && edited.bytes.length > 1000 : edited.status === 503 && edited.reason === 'export_failed');
        detail += `; then ${hostile.then.about}: ${edited.status}${edited.reason ? ` ${edited.reason}` : ''} in ${edited.ms} ms; the uploaded file is still there, bit for bit: ${kept}`;
      }
      check(`${hostile.name}: its download is ${hostile.then ? (hostile.then.download === 'written' ? 'written with the change' : 'refused for a change that would not end, and nothing else is lost') : 'written'}`, ok, detail);
    }
    results.push(line);
  }

  /* ---------------- files given on the command line ---------------- */
  for (const path of all('file')) {
    const t = await nextTeacher();
    const file = new Uint8Array(readFileSync(path));
    pulse.during = basename(path);
    const r = await t.upload(file, `${basename(path).replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9 _-]+/g, '-').slice(0, 80) || 'file'}.pptx`);
    if (r.deck) made.push([t, r.deck.id]);
    let download = null;
    if (r.deck) {
      const d = await t.binary(`/deck-uploads/${r.deck.id}/pptx`);
      download = { status: d.status, reason: d.reason, bytes: d.bytes.length, ms: d.ms };
    }
    results.push({ name: basename(path), given: true, bytes: file.length, sha256: sha(file), outcome: r.outcome, ms: r.ms, download });
    check(`${basename(path)} (given): read or refused, quickly`, r.ms < 12_000 && (r.outcome === 'accepted' || r.status === 400), `${r.outcome} in ${r.ms} ms; ${file.length} bytes${download ? `; its download: ${download.status} in ${download.ms} ms` : ''}`);
  }

  /* ---------------- downloads nobody takes ---------------- */
  if (!flag('no-sending')) {
    pulse.during = 'downloads nobody takes';
    const t = await nextTeacher();
    // 20 MB that do not compress: far more than a connection's own buffers swallow.
    const big = writeZip(Object.entries(syntheticDeckParts({ 'ppt/media/photo.png': new Uint8Array(randomBytes(20 * 1024 * 1024)) })).map(([name, data]) => ({ name, data })));
    const up = await t.upload(big, 'Twenty megabytes.pptx');
    if (!up.deck) check('a deck of 20 MB is taken (for the next checks)', false, up.outcome);
    else {
      made.push([t, up.deck.id]);
      const path = `/deck-uploads/${up.deck.id}/original`;
      // "The file I uploaded": ten clients ask for it and take nothing. It is sent from the database a piece at a
      // time, so each holds one piece: all ten are started, and the web process's memory hardly moves.
      const before = serverMemory();
      const idle = [];
      for (let i = 0; i < 10; i++) idle.push(await t.sitOn(path));
      await sleep(500);
      const during = serverMemory();
      check('ten downloads of a 20 MB original that nobody takes are all started, and cost the web process next to nothing', idle.every((s) => s.status === 200 && s.length === big.length) && (!before || !during || during.rssMiB - before.rssMiB < 60), `statuses ${idle.map((s) => s.status).join(',')}; memory of the web process before ${JSON.stringify(before)}, with all ten waiting ${JSON.stringify(during)}`);
      for (const s of idle) s.letGo();
      // The edited file exists whole while it is sent, so it is counted: one account may have 48 MiB on its way.
      const edited = `/deck-uploads/${up.deck.id}/pptx`;
      const sitting = [];
      let turnedAway = null;
      for (let i = 0; i < 6 && !turnedAway; i++) {
        const s = await t.sitOn(edited);
        if (s.status === 200) sitting.push(s);
        else {
          turnedAway = s;
          s.letGo();
        }
      }
      await sleep(500);
      const meanwhile = await t.client.call('decks.uploads.get', { params: { uploadId: up.deck.id } });
      check('edited downloads nobody takes: after a few, the next is told to come back (503), and the rest of the site answers', sitting.length >= 1 && sitting.length <= 4 && turnedAway?.status === 503 && meanwhile.id === up.deck.id, `${sitting.length} of ${big.length} bytes each were started and left; the next: ${turnedAway?.status ?? 'none was turned away'}; memory of the web process now: ${JSON.stringify(serverMemory())}`);
      for (const s of sitting) s.letGo();
      // The server notices the clients have gone and the room is free again.
      let whole = null;
      for (let i = 0; i < 20; i++) {
        await sleep(500);
        whole = await t.binary(edited);
        if (whole.status === 200) break;
      }
      const original = await t.binary(path);
      check('when those clients go away the room is free again; the edited file comes whole, and the original bit for bit', whole?.status === 200 && whole.bytes.length > big.length - 100_000 && original.status === 200 && sha(original.bytes) === sha(big), `edited ${whole?.status} ${whole?.bytes.length} bytes in ${whole?.ms} ms; original ${original.status} ${original.bytes.length} bytes in ${original.ms} ms`);
    }
  }

  /* ---------------- everything at once, at the limits ---------------- */
  const stressSeconds = Number(opt('stress') || 0);
  if (stressSeconds > 0) {
    pulse.during = 'everything at once';
    const accounts = Number(opt('stress-accounts') || 4);
    const fileMb = Number(opt('stress-file-mb') || 29);
    const bigOf = () => writeZip(Object.entries(syntheticDeckParts({ 'ppt/media/photo.png': new Uint8Array(randomBytes(fileMb * 1024 * 1024)) })).map(([name, data]) => ({ name, data })));
    const heavy = HOSTILE_FILES.find((f) => f.name === 'eight-slides-each-within-the-limits').build();
    // Fresh accounts, each with a deck near the largest size taken.
    const mine = [];
    for (let i = 0; i < accounts; i++) {
      const t = await teacher(++teachers);
      const up = await t.upload(bigOf(), 'Near the limit.pptx');
      if (up.deck) {
        mine.push([t, up.deck]);
        made.push([t, up.deck.id]);
      }
    }
    const counts = { satOn: 0, turnedAway: 0, downloads: 0, downloadsNotNow: 0, uploads: 0, uploadsRefused: 0, uploadsNotNow: 0, drawings: {}, errors: 0, errorKinds: {} };
    const count = (map, key) => (map[key] = (map[key] ?? 0) + 1);
    /** Something that should not happen at all (a refusal or "not now" is not an error). */
    const wrong = (where, err) => {
      // Told to slow down (the site's own limit on one account's requests): that is the site working, not an error.
      if (err?.code === 'rate_limited') return void count(counts, 'toldToSlowDown');
      count(counts, 'errors');
      count(counts.errorKinds, `${where}: ${String(err?.details?.reason ?? err?.code ?? err?.cause?.code ?? err?.message ?? err).slice(0, 60)}`);
    };
    let peakRss = 0;
    const failedBefore = pulse.failed;
    const until = Date.now() + stressSeconds * 1000;
    const going = () => Date.now() < until;
    const watching = (async () => {
      while (going()) {
        peakRss = Math.max(peakRss, serverMemory()?.rssMiB ?? 0);
        await sleep(200);
      }
    })();
    const loops = [watching];
    for (const [t, deck] of mine) {
      // Asks for her files again and again and takes none of them (the original and the edited file in turn); lets
      // go after a while and starts over.
      loops.push((async () => {
        while (going()) {
          const sitting = [];
          for (let i = 0; i < 6 && going(); i++) {
            const s = await t.sitOn(`/deck-uploads/${deck.id}/${i % 2 ? 'pptx' : 'original'}`).catch((err) => (wrong('a download nobody takes', err), null));
            if (!s) continue;
            if (s.status === 200) {
              sitting.push(s);
              count(counts, 'satOn');
            } else {
              s.letGo();
              count(counts, 'turnedAway');
            }
          }
          await sleep(6000);
          for (const s of sitting) s.letGo();
          await sleep(500);
        }
      })());
      // Downloads the edited file and takes it.
      loops.push((async () => {
        while (going()) {
          const r = await t.binary(`/deck-uploads/${deck.id}/pptx`).catch((err) => (wrong('a download', err), null));
          if (r) count(counts, r.status === 200 ? 'downloads' : 'downloadsNotNow');
          await sleep(1200);
        }
      })());
      // Uploads more: another file near the limit, and the heaviest file the reader still takes; deletes them again.
      loops.push((async () => {
        while (going()) {
          for (const [file, name] of [[bigOf(), 'Another.pptx'], [heavy, 'Heaviest.pptx']]) {
            if (!going()) break;
            let r = null;
            try {
              r = await t.upload(file, name);
            } catch (err) {
              // An hour's allowance of upload starts used up, or no room: wait.
              count(counts, 'uploadsNotNow');
              await sleep(4000);
              continue;
            }
            count(counts, r.deck ? 'uploads' : r.status === 400 || r.status === 429 ? 'uploadsRefused' : 'uploadsNotNow');
            if (r.deck) await t.client.call('decks.uploads.delete', { params: { uploadId: r.deck.id } }).catch(() => undefined);
          }
        }
      })());
      // Has her slides drawn after every change (where this server draws).
      if (deck.previews.available) {
        loops.push((async () => {
          while (going()) {
            try {
              const d = await t.client.call('decks.uploads.get', { params: { uploadId: deck.id } });
              await t.client.call('decks.uploads.save', { params: { uploadId: deck.id }, body: { baseRev: d.rev, slides: [...d.edits.slides].reverse() } });
              let r = await t.client.call('decks.uploads.render', { params: { uploadId: deck.id } });
              for (let i = 0; r.state === 'busy' && i < 10 && going(); i++) {
                await sleep(1000);
                r = await t.client.call('decks.uploads.render', { params: { uploadId: deck.id } });
              }
              count(counts.drawings, r.state);
            } catch (err) {
              wrong('a drawing', err);
            }
            await sleep(1500);
          }
        })());
      }
    }
    await Promise.all(loops);
    await sleep(1000);
    const cgroup = opt('server-cgroup');
    let group = '';
    if (cgroup) {
      try {
        group = `; its control group: now ${Math.round(Number(readFileSync(`${cgroup}/memory.current`, 'utf8')) / 1048576)} MiB, most ever ${Math.round(Number(readFileSync(`${cgroup}/memory.peak`, 'utf8')) / 1048576)} MiB, ceiling ${readFileSync(`${cgroup}/memory.max`, 'utf8').trim()}`;
      } catch {
        group = '; its control group could not be read';
      }
    }
    results.push({ name: 'everything at once', seconds: stressSeconds, accounts: mine.length, fileMb, counts, peakRssMiB: peakRss, memory: serverMemory(), group });
    check(
      `everything at once for ${stressSeconds} s (${mine.length} accounts with ${fileMb} MB decks: downloads nobody takes, downloads, uploads, the heaviest file, drawings): the site answered all the while and its process is the same`,
      mine.length === accounts && serverAlive() && pulse.failed === failedBefore && counts.errors === 0 && counts.satOn > 0 && counts.uploads > 0,
      `${JSON.stringify(counts)}; the web process: ${peakRss} MiB at most during it, ${JSON.stringify(serverMemory())} now${group}`
    );
  }
} finally {
  pulse.during = 'clearing up';
  for (const [t, id] of made) await t.client.call('decks.uploads.delete', { params: { uploadId: id } }).catch(() => undefined);
  pulse.stop = true;
  await beating;
}

const memoryAfter = serverMemory();
check(`the site answered its health route all the while, each time within ${healthMs} ms`, pulse.asked > 20 && pulse.failed === 0 && pulse.slow === 0, `${pulse.asked} asked, ${pulse.failed} failed, ${pulse.slow} slow; the longest took ${Math.round(pulse.longest)} ms (during: ${pulse.longestDuring || 'start'})`);
check('the web process is the same one as at the start', serverAlive(), serverPid ? `pid ${serverPid}; memory before ${JSON.stringify(memoryBefore)}, after ${JSON.stringify(memoryAfter)}` : 'no --server-pid given: not checked beyond its health');
const failed = checks.filter((c) => !c.ok);
writeFileSync(outFile, JSON.stringify({ base, at: new Date().toISOString(), teachers, pulse: { asked: pulse.asked, failed: pulse.failed, slow: pulse.slow, longestMs: Math.round(pulse.longest), longestDuring: pulse.longestDuring ?? '' }, memoryBefore, memoryAfter, results, checks }, null, 1));
console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed${failed.length ? `; FAILED: ${failed.map((c) => c.name).join(' | ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
