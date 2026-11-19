// Acceptance walk for "My copy" slide decks over the real HTTP API of a running tala-web, with two fictional
// teachers. Proves: a copy is private to its owner; edits persist across sign-out/sign-in; the shared original and
// another teacher's copy never change; the edited copy exports as PowerPoint with the edited words; and (with
// --library/--snapshot) a copy survives a new library snapshot swapped in the way the host does it.
//
//   node scripts/decks-acceptance.mjs <baseUrl> [--pack sci26-g4-t2-w10] [--lang en]
//        [--library <dir that holds index.json> --snapshot <dir of a NEW snapshot to swap in>]
//
// Refuses to run against anything but localhost: it creates accounts. Accounts are deleted at the end.
// Emails are @example.com; nothing here is real data.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const argv = process.argv.slice(2);
const base = (argv[0] && !argv[0].startsWith('--') ? argv[0] : 'http://localhost:3410').replace(/\/$/, '');
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error('local servers only (this script creates accounts)');
const packId = opt('pack', 'sci26-g4-t2-w10');
const lang = opt('lang', 'en');
const library = opt('library', '');
const snapshot = opt('snapshot', '');
const API = `${base}/api/v1`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

function session() {
  let cookie = '';
  return async (method, path, body) => {
    const headers = { accept: 'application/json', origin: base };
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') ?? '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, type, clear: () => (cookie = '') };
  };
}

const stamp = Date.now().toString(36);
const password = `tala-accept-${randomBytes(6).toString('hex')}-Aa1!`;
async function teacher(tag) {
  const call = session();
  const email = `teacher.accept.${tag}.${stamp}@example.com`;
  const r = await call('POST', '/auth/register', { email, password, displayName: `Teacher ${tag.toUpperCase()} (test)`, uiLanguage: 'en', deviceLabel: 'acceptance' });
  if (r.status >= 300) throw new Error(`register ${tag}: ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  return { call, email };
}

/** Minimal ZIP reader (central directory; stored and deflate), enough to look inside a .pptx. */
function unzip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + csize);
    out.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
const sha = (b) => createHash('sha256').update(b).digest('hex');
const xmlText = (xml) => [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")).join(' ');
function treeHash(dir) {
  const h = createHash('sha256');
  const walk = (d) => {
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else h.update(p.slice(dir.length)).update(readFileSync(p));
    }
  };
  walk(dir);
  return h.digest('hex');
}

const EDIT = `Classroom example changed by Teacher A ${stamp}`;
const NOTE = `Private note by Teacher A ${stamp}`;

const a = await teacher('a');
const b = await teacher('b');
const anon = session();

// --- the shared original, before ---
const originalBefore = await a.call('GET', `/packs/${packId}?lang=${lang}`);
check('teacher A can open the pack', originalBefore.status === 200, `status ${originalBefore.status}`);
const originalJson = JSON.stringify(originalBefore.data);
const libraryHashBefore = library ? treeHash(join(library, 'science-bow-2026', packId)) : null;

// --- signed out ---
for (const [m, p, body] of [
  ['GET', '/decks'],
  ['POST', '/decks', { packId, lang }],
  ['GET', '/decks/whatever'],
  ['GET', '/decks/whatever/pptx'],
]) {
  const r = await anon(m, p, body);
  check(`signed out: ${m} ${p} is refused`, r.status === 401, `status ${r.status}`);
}

// --- A makes a copy and edits it ---
const created = await a.call('POST', '/decks', { packId, lang });
check('A: "Edit my copy" creates a copy', created.status === 200 && created.data.deck?.slides?.length > 10, `status ${created.status}, ${created.data.deck?.slides?.length} slides`);
const deckA = created.data.deck;
const again = await a.call('POST', '/decks', { packId, lang });
check('A: asking again answers the same copy (no duplicates)', again.data.deck?.id === deckA.id);
const target = deckA.slides.findIndex((s) => s.kind === 'concept' && s.lines.length > 0);
const slides = structuredClone(deckA.slides);
slides[target].lines[0] = EDIT;
slides[target].notes = NOTE;
// basic slide operations: duplicate one slide, delete another, move one
const dup = { ...structuredClone(slides[target]), id: `n${randomBytes(4).toString('hex')}`, sourceId: null, title: `${slides[target].title} (copy)` };
slides.splice(target + 1, 0, dup);
const removable = slides.findIndex((s, i) => i > target + 2 && s.kind === 'summary');
const removedId = removable >= 0 ? slides.splice(removable, 1)[0].id : null;
const saved = await a.call('PUT', `/decks/${deckA.id}`, { baseRev: deckA.rev, slides });
check('A: save an edited example, a duplicated slide and a deleted slide', saved.status === 200 && saved.data.rev === deckA.rev + 1, `status ${saved.status} rev ${saved.data.rev} changedSlides ${saved.data.changedSlides}`);
const stale = await a.call('PUT', `/decks/${deckA.id}`, { baseRev: deckA.rev, slides });
check('A: a stale save is a conflict, not a silent overwrite', stale.status === 409, `status ${stale.status}`);

// --- persistence across sign-out / sign-in ---
await a.call('POST', '/auth/logout');
const afterLogout = await a.call('GET', `/decks/${deckA.id}`);
check('A: signed out, the copy is not readable', afterLogout.status === 401, `status ${afterLogout.status}`);
const login = await a.call('POST', '/auth/login', { email: a.email, password, deviceLabel: 'acceptance 2' });
check('A: signs in again', login.status === 200, `status ${login.status}`);
const reopened = await a.call('GET', `/decks/${deckA.id}`);
const re = reopened.data.deck;
check('A: reopened copy has the edited example', re?.slides?.some((s) => s.lines.includes(EDIT)) && re.slides.some((s) => s.notes === NOTE));
check('A: reopened copy has the duplicated slide and not the deleted one', re?.slides?.some((s) => s.id === dup.id) && (!removedId || !re.slides.some((s) => s.id === removedId)));
check('A: the copy remembers what it was copied from', Array.isArray(reopened.data.baseSlides) && reopened.data.baseSlides.length === deckA.slides.length && !JSON.stringify(reopened.data.baseSlides).includes(EDIT));
const listA = await a.call('GET', '/decks');
check('A: the copy is in "my copies"', listA.data.decks?.length === 1 && listA.data.decks[0].changedSlides >= 2, `changedSlides ${listA.data.decks?.[0]?.changedSlides}`);

// --- B cannot see or touch A's copy ---
const listB0 = await b.call('GET', '/decks');
check("B: sees none of A's copies", listB0.status === 200 && listB0.data.decks.length === 0);
const slugA = deckA.media[0]?.slug;
for (const [m, p, body] of [
  ['GET', `/decks/${deckA.id}`],
  ['PUT', `/decks/${deckA.id}`, { baseRev: re.rev, slides: re.slides, force: true }],
  ['POST', `/decks/${deckA.id}/reset`],
  ['DELETE', `/decks/${deckA.id}`],
  ['GET', `/decks/${deckA.id}/pptx`],
  ...(slugA ? [['GET', `/decks/${deckA.id}/media/${slugA}`]] : []),
]) {
  const r = await b.call(m, p, body);
  check(`B: ${m} on A's copy is "not found"`, r.status === 404, `status ${r.status}`);
}
const stillThere = await a.call('GET', `/decks/${deckA.id}`);
check("A: copy untouched by B's attempts", stillThere.status === 200 && stillThere.data.deck.rev === re.rev);

// --- B's own copy is the unedited original ---
const createdB = await b.call('POST', '/decks', { packId, lang });
const deckB = createdB.data.deck;
check("B: own copy is separate and has none of A's edits", createdB.status === 200 && deckB.id !== deckA.id && !JSON.stringify(deckB).includes(stamp) && deckB.slides.length === deckA.slides.length);

// --- the shared original is unchanged ---
const originalAfter = await b.call('GET', `/packs/${packId}?lang=${lang}`);
check('the shared original is byte-identical after the edits', JSON.stringify(originalAfter.data) === originalJson);
if (library) check('the library files on disk are unchanged', treeHash(join(library, 'science-bow-2026', packId)) === libraryHashBefore);

// --- export: A's edited copy as PowerPoint ---
async function exportCheck(label) {
  const pptx = await a.call('GET', `/decks/${deckA.id}/pptx`);
  const ok = pptx.status === 200 && Buffer.isBuffer(pptx.data) && pptx.data.subarray(0, 2).toString() === 'PK';
  check(`${label}: A downloads the edited copy as PowerPoint`, ok, `status ${pptx.status}, ${pptx.data.length ?? 0} bytes`);
  if (!ok) return;
  const zip = unzip(pptx.data);
  const slideParts = [...zip.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const all = slideParts.map((n) => xmlText(zip.get(n).toString('utf8'))).join(' ');
  const notes = [...zip.keys()].filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)).map((n) => xmlText(zip.get(n).toString('utf8'))).join(' ');
  check(`${label}: the file has one slide per slide of the copy`, slideParts.length === re.slides.length, `${slideParts.length} vs ${re.slides.length}`);
  check(`${label}: the edited example is editable text in the file`, all.includes(EDIT));
  check(`${label}: the private note is in the speaker notes, not on a slide`, notes.includes(NOTE) && !all.includes(NOTE));
  const media = [...zip.keys()].filter((n) => n.startsWith('ppt/media/'));
  const drawings = new Set(deckA.media.map((m) => m.sha256));
  check(`${label}: drawings are embedded unchanged (Hiraia mark intact)`, media.some((n) => drawings.has(sha(zip.get(n)))), `${media.length} media parts`);
  const b2 = await b.call('GET', `/decks/${deckB.id}/pptx`);
  check(`${label}: B's export has none of A's words`, b2.status === 200 && !xmlText([...unzip(b2.data).entries()].filter(([n]) => n.startsWith('ppt/slides/slide')).map(([, v]) => v.toString('utf8')).join(' ')).includes(stamp));
}
await exportCheck('now');
if (slugA) {
  const m = await a.call('GET', `/decks/${deckA.id}/media/${slugA}`);
  check("A: a drawing of the copy is served and is the embedded file", m.status === 200 && sha(m.data) === deckA.media[0].sha256);
}

// --- a new library snapshot, swapped in the way the host does it ---
if (library && snapshot) {
  if (!existsSync(join(snapshot, 'index.json'))) throw new Error('--snapshot must hold index.json');
  const prev = `${library}.prev`;
  rmSync(prev, { recursive: true, force: true });
  renameSync(library, prev);
  renameSync(snapshot, library);
  const after = await a.call('GET', `/decks/${deckA.id}`);
  check('after a new library snapshot: A still has the copy with its edits', after.status === 200 && after.data.deck.slides.some((s) => s.lines.includes(EDIT)), `original: ${JSON.stringify(after.data.original)}`);
  const afterB = await b.call('GET', `/decks/${deckB.id}`);
  check("after a new library snapshot: B's copy is still there, unedited", afterB.status === 200 && !JSON.stringify(afterB.data.deck).includes(stamp));
  await exportCheck('after the snapshot');
  const now = await a.call('GET', `/packs/${packId}?lang=${lang}`);
  console.log(`      (pack in the new snapshot: status ${now.status}; copy says original ${JSON.stringify(after.data.original)})`);
  console.log(`      (previous library kept at ${prev})`);
}

// --- clean up: delete both accounts; their copies must go with them ---
for (const t of [a, b]) {
  const r = await t.call('POST', '/account/delete', { password, confirm: 'DELETE' });
  check(`account ${t.email.split('.')[2]} deleted`, r.status === 200, `status ${r.status}`);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
