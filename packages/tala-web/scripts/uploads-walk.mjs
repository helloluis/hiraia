// Walk of "My own slides" in a real browser against a running tala-web: a teacher uploads a PowerPoint file, sees
// what Tala will and will not change, edits words and notes, moves, copies and removes slides, reloads, and downloads
// both her edited file and the untouched one. A second teacher then tries to reach her file. Screenshots at desktop
// and phone sizes; every step is a named check in walk.json. The downloaded files are left in <outDir>/downloads
// for an independent reader (packages/tala-server/scripts/decks/pptx-walk-verify.py).
//
//   PLAYWRIGHT_PATH=… CHROMIUM_PATH=… node scripts/uploads-walk.mjs <baseUrl> <outDir> \
//      --email a@example.com --password … --deck lesson.pptx [--lang en|fil] [--tag en]
//      [--refuse macros.pptm] [--other-email b@example.com --other-password …] [--extra other.pptx] [--keep] [--clean]
//
// The accounts must exist and have a confirmed email (scripts/ui-seed.mjs with --db). The uploaded deck is deleted
// at the end unless --keep is given; --clean first deletes whatever the account had uploaded before. Everything
// typed here is invented.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const argv = process.argv.slice(2);
const [base, out] = argv;
if (!base || !out || base.startsWith('--') || out.startsWith('--')) throw new Error('usage: uploads-walk.mjs <baseUrl> <outDir> --email … --password … --deck file.pptx');
const opt = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);
const email = opt('email');
const password = opt('password');
const deckFile = opt('deck');
const lang = opt('lang', 'en');
const tag = opt('tag', lang);
const refuseFile = opt('refuse');
const extraFile = opt('extra');
const other = opt('other-email') ? { email: opt('other-email'), password: opt('other-password') } : null;
if (!email || !password || !deckFile) throw new Error('--email, --password and --deck are required');

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright-core');
mkdirSync(join(out, 'downloads'), { recursive: true });
mkdirSync(join(out, 'tmp'), { recursive: true });
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 400) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${String(detail).slice(0, 200)}` : ''}`);
};
const shots = [];
const VIEW = {
  desktop: { viewport: { width: 1366, height: 860 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
/** Requests answered 4xx/5xx: `expected` when the step under way provoked them on purpose (a refused file, another teacher). */
const failures = [];
let onPurpose = null;

async function open(view, account, language = lang) {
  const ctx = await browser.newContext({ ...VIEW[view], locale: 'en-PH', timezoneId: 'Asia/Manila', acceptDownloads: true });
  await ctx.addInitScript((l) => {
    try {
      localStorage.setItem('tala.lang', l);
    } catch {}
  }, language);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${view}: pageerror: ${String(e).slice(0, 240)}`));
  page.on('console', (m) => {
    // A failed request is also logged by the browser as a console error; those are judged from `failures` below.
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${view}: console: ${m.text().slice(0, 240)}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) failures.push({ view, status: r.status(), method: r.request().method(), path: new URL(r.url()).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id'), expected: onPurpose });
  });
  page.on('dialog', (d) => void d.accept().catch(() => {}));
  await page.goto(base + '/sign-in', { waitUntil: 'networkidle', timeout: 120000 });
  await page.locator('input[type=email]').fill(account.email);
  await page.locator('input[type=password]').fill(account.password);
  await page.locator('button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 60000 });
  await page.waitForTimeout(1500);
  return { ctx, page, view, language };
}
async function shot(s, name, { fullPage = false } = {}) {
  await s.page.evaluate(() => document.fonts.ready.then(() => document.fonts.load("600 20px 'Fraunces'"))).catch(() => {});
  await s.page.waitForTimeout(350);
  const file = `${name}-${s.view}-${s.language}.png`;
  await s.page.screenshot({ path: join(out, file), fullPage });
  const overflowX = await s.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  shots.push({ file, overflowX });
  if (overflowX) check(`no sideways scrolling: ${file}`, false);
}
const api = (s, path, init) =>
  s.page.evaluate(
    async ([p, i]) => {
      const res = await fetch(`/api/v1${p}`, { credentials: 'same-origin', ...(i ?? {}) });
      const type = res.headers.get('content-type') ?? '';
      return { status: res.status, type, data: type.includes('json') ? await res.json() : null };
    },
    [path, init ?? null]
  );
/** Wait for a change just made to be saved: the screen says it is working on it, then that it is saved, and the server holds a newer version. */
let knownRev = 0;
const saved = async (s) => {
  await s.page.locator('[data-save-state="dirty"], [data-save-state="saving"]').first().waitFor({ timeout: 5000 }).catch(() => {});
  await s.page.locator('[data-save-state="saved"]').waitFor({ timeout: 30000 });
  const rev = (await api(s, `/deck-uploads/${uploadId}`)).data.rev;
  const newer = rev > knownRev;
  knownRev = rev;
  return newer;
};
const editorReady = (s) => s.page.locator('[data-slide-id]').first().waitFor({ timeout: 60000 });
const selectSlide = async (s, id) => {
  await s.page.locator(s.view === 'phone' ? `[data-slide-chip="${id}"]` : `[data-slide-thumb="${id}"]`).click();
  await s.page.locator(`[data-slide-id="${id}"]`).waitFor({ timeout: 10000 });
};
const order = (s) => s.page.locator(s.view === 'phone' ? '[data-slide-chip]' : '[data-slide-thumb]').evaluateAll((els) => els.map((e) => e.getAttribute('data-slide-chip') ?? e.getAttribute('data-slide-thumb')));
const sendFile = async (s, file) => {
  await s.page.locator('[data-upload-input]').setInputFiles(file);
};
const problemText = async (s) => {
  const el = s.page.locator('[data-upload-problem]');
  await el.waitFor({ timeout: 60000 });
  return (await el.textContent()) ?? '';
};
const clearProblem = async (s) => {
  await s.page.locator('[data-upload-problem-close]').click();
  await s.page.locator('[data-upload-problem]').waitFor({ state: 'detached', timeout: 10000 });
};
const closeSheet = async (s) => {
  await s.page.locator('dialog[open]').getByRole('button').first().click();
  await s.page.locator('dialog[open]').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
};

const expected = { lang, uploaded: basename(deckFile), uploadedSha256: sha(deckFile), slides: [], removed: [] };
let uploadId = null;
let extraId = null;
try {
  /* ------------------------------------------------ desktop: the whole flow */
  const d = await open('desktop', { email, password });
  await d.page.goto(base + '/library', { waitUntil: 'networkidle', timeout: 120000 });
  const way = d.page.locator('a[href="/library/mine"]').first();
  await way.scrollIntoViewIfNeeded();
  check('the Library shows a signed-in teacher the way to her own slides', await way.isVisible());
  await shot(d, '01-library');
  await way.click();
  await d.page.waitForURL('**/library/mine', { timeout: 30000 });
  await d.page.locator('[data-upload-input]').waitFor({ state: 'attached', timeout: 30000 });
  if (flag('clean')) {
    for (const old of (await api(d, '/deck-uploads')).data.decks) await api(d, `/deck-uploads/${old.id}`, { method: 'DELETE' });
    await d.page.reload({ waitUntil: 'networkidle', timeout: 120000 });
  }
  const had = (await api(d, '/deck-uploads')).data.decks.length;
  await d.page.waitForTimeout(800);
  await shot(d, '02-my-slides');

  if (refuseFile) {
    onPurpose = 'a refused file';
    // Known on the device from its name: said before anything is sent.
    await sendFile(d, refuseFile);
    const local = await problemText(d);
    check('a macro-enabled file is refused in plain words before anything is sent', local.length > 20, local);
    // The same bytes under an innocent name: only the server can know, and it does.
    const disguised = join(out, 'tmp', 'looks-fine.pptx');
    copyFileSync(refuseFile, disguised);
    await clearProblem(d);
    await sendFile(d, disguised);
    const remote = await problemText(d);
    check('the same file renamed to .pptx is refused by the server after reading it', remote.length > 20 && remote === local, remote);
    await shot(d, '03-refused');
    const notDeck = join(out, 'tmp', 'notes.pptx');
    writeFileSync(notDeck, 'This is only a text file with a PowerPoint name.\n');
    await clearProblem(d);
    await sendFile(d, notDeck);
    const junk = await problemText(d);
    check('a file that is not a PowerPoint file at all is refused', junk.length > 20 && junk !== remote, junk);
    const list = await api(d, '/deck-uploads');
    check('nothing of a refused file is kept', list.status === 200 && list.data.decks.length === had, `${list.data?.decks?.length} uploads, as before`);
    await clearProblem(d);
    onPurpose = null;
  }

  const t0 = Date.now();
  await sendFile(d, deckFile);
  await d.page.waitForURL(/\/slides\/mine\/[^/]+$/, { timeout: 180000 });
  uploadId = decodeURIComponent(new URL(d.page.url()).pathname.split('/').pop());
  await editorReady(d);
  check('choosing a file uploads it and opens it for editing', true, `${Date.now() - t0} ms to the editor`);
  const first = (await api(d, `/deck-uploads/${uploadId}`)).data;
  knownRev = first.rev;
  const slides = first.base.slides;
  check('the file is read: slides and text boxes', slides.length > 0 && first.base.totals.editableBlocks > 0, `${slides.length} slides, ${first.base.totals.editableBlocks} editable text boxes, kind ${first.kind}`);
  const pictures = first.previews.available;
  if (pictures) {
    await d.page.locator('[data-slide-id][data-has-picture="yes"]').first().waitFor({ timeout: 240000 });
    check('the server draws real pictures of the slides', true, `${Date.now() - t0} ms after choosing the file`);
  } else check('this server draws no pictures; the slide is shown as its text boxes', (await d.page.locator('[data-slide-id][data-has-picture="no"]').count()) === 1);
  await d.page.waitForTimeout(1200);
  await shot(d, '04-editor');

  const summary = (await d.page.locator('[data-kept-summary]').textContent()) ?? '';
  check('the editor says how much of the file can be changed', summary.includes(String(first.base.totals.slides)) && summary.includes(String(first.base.totals.editableBlocks)), summary);
  await d.page.locator('[data-kept-more]').click();
  await d.page.locator('dialog[open]').waitFor({ timeout: 10000 });
  const keptItems = await d.page.locator('dialog[open] [data-kept-list] li').allTextContents();
  check('it lists what is in the file that Tala only carries along', first.base.features.length === 0 || keptItems.length > 0, keptItems.join(' | '));
  await shot(d, '05-kept');
  await closeSheet(d);

  // Words: click the title in the picture, type in the field it leads to.
  const s1 = slides[0];
  const titleBlock = s1.blocks.find((b) => b.role === 'title' && b.editable) ?? s1.blocks.find((b) => b.editable);
  const newTitle = lang === 'fil' ? 'Mga Bahagi ng Halaman' : 'Parts of a Plant: roots, stem, leaves, flower';
  if (titleBlock.box) {
    await d.page.locator(`[data-slide-id="${s1.id}"] [data-block="${titleBlock.id}"]`).click();
    const focused = await d.page.evaluate(() => document.activeElement?.id ?? '');
    check('clicking words on the slide leads to the field that changes them', focused === `uf-${s1.id}-${titleBlock.id}-0`, focused);
  }
  await d.page.locator(`#uf-${s1.id}-${titleBlock.id}-0`).fill(newTitle);
  const t1 = Date.now();
  check('a change is saved by itself, about a second after typing stops', await saved(d), `server version ${knownRev} after ${Date.now() - t1} ms`);
  if (pictures) {
    const img = d.page.locator(`[data-slide-id="${s1.id}"] img`);
    await d.page.locator('[data-pictures="current"]').waitFor({ timeout: 60000 });
    const src = (await img.getAttribute('src')) ?? '';
    check('the picture follows the words by itself a moment after the save', src.endsWith(`v=${knownRev}`), `${Date.now() - t1} ms after typing; picture of version ${src.split('v=')[1]}`);
    await d.page.waitForTimeout(600);
    await shot(d, '05b-picture-follows');
  }

  // A list: change one line, add one; and the notes.
  const s2 = slides.find((s, i) => i > 0 && s.blocks.some((b) => b.role === 'body' && b.editable && b.paragraphs.length >= 2)) ?? slides[Math.min(1, slides.length - 1)];
  const body = s2.blocks.find((b) => b.role === 'body' && b.editable && b.paragraphs.length >= 2) ?? s2.blocks.find((b) => b.editable);
  await selectSlide(d, s2.id);
  const line2 = lang === 'fil' ? 'Sabihin ang gawain ng bawat bahagi' : 'Say what each part does, in your own words';
  const line4 = lang === 'fil' ? 'Gumuhit ng halaman at lagyan ng pangalan ang mga bahagi' : 'Draw a plant and label its parts';
  const lineIndex = Math.min(1, body.paragraphs.length - 1);
  await d.page.locator(`#uf-${s2.id}-${body.id}-${lineIndex}`).fill(line2);
  const bodyAfter = body.paragraphs.map((p, i) => (i === lineIndex ? line2 : p));
  if (body.role !== 'title') {
    await d.page.locator(`[data-block-fields="${body.id}"] [data-add-line]`).click();
    await d.page.locator(`#uf-${s2.id}-${body.id}-${body.paragraphs.length}`).fill(line4);
    bodyAfter.push(line4);
  }
  const noteText = lang === 'fil' ? 'Ipabasa nang sabay-sabay. Itanong: Alin ang alam na ninyo?' : 'Read these aloud together. Ask: which of these do you already know?';
  const notesEditable = s2.notes.editable;
  if (notesEditable) await d.page.locator(`#un-${s2.id}`).fill(noteText);
  await saved(d);
  await shot(d, '06-words-and-notes');

  // A table cell, when the deck has one.
  const tableSlide = slides.find((s) => s.blocks.some((b) => b.role === 'cell' && b.editable));
  let cellEdit = null;
  if (tableSlide) {
    const cell = tableSlide.blocks.filter((b) => b.role === 'cell' && b.editable).pop();
    await selectSlide(d, tableSlide.id);
    const cellText = lang === 'fil' ? 'Gumagawa ng buto para may bagong halaman.' : 'Makes seeds so that new plants can grow.';
    await d.page.locator(`#uf-${tableSlide.id}-${cell.id}-0`).fill(cellText);
    cellEdit = { slide: tableSlide.id, block: cell.id, text: cellText };
    await saved(d);
    check('the words in a table cell can be changed', true, cell.name);
  }

  // Slides: move, copy (and change the copy), remove, undo, redo.
  const op = (name) => d.page.locator(`[data-op="${name}"]`);
  const before = await order(d);
  await selectSlide(d, s2.id);
  await op('down').click();
  const moved = await order(d);
  const i2 = before.indexOf(s2.id);
  check('a slide can be moved', i2 < before.length - 1 ? moved[i2 + 1] === s2.id : true, moved.join(','));
  await selectSlide(d, s1.id);
  const copyButton = op('copy');
  let copyId = null;
  const copyTitle = lang === 'fil' ? 'Mga Bahagi ng Halaman (para sa Baitang 5)' : 'Parts of a Plant (for Grade 5 – Narra)';
  if (await copyButton.isEnabled()) {
    await copyButton.click();
    const withCopy = await order(d);
    copyId = withCopy.find((id) => !before.includes(id)) ?? null;
    check('a slide can be copied; the copy sits right after it', copyId !== null && withCopy.indexOf(copyId) === withCopy.indexOf(s1.id) + 1, withCopy.join(','));
    await d.page.locator(`#uf-${copyId}-${titleBlock.id}-0`).fill(copyTitle);
  } else check('this slide cannot be copied and the screen says why', (await d.page.getByText(/chart|diagram|tsart/i).count()) > 0);
  const last = slides.filter((s) => s.id !== s1.id && s.id !== s2.id && s.id !== tableSlide?.id && !s.hidden && s.duplicateBlockers.length === 0).pop();
  let removedId = null;
  if (last) {
    await selectSlide(d, last.id);
    await op('remove').click();
    const afterRemove = await order(d);
    check('a slide can be removed from her version', !afterRemove.includes(last.id), afterRemove.join(','));
    // Undo from the toast, then redo from the header: the removal is hers to take back.
    await d.page.keyboard.press('Escape').catch(() => {});
    await d.page.locator('body').click({ position: { x: 5, y: 400 } }).catch(() => {});
    await d.page.keyboard.press('Control+z');
    check('Ctrl+Z brings the slide back', (await order(d)).includes(last.id));
    await d.page.keyboard.press('Control+Shift+z');
    check('redo removes it again', !(await order(d)).includes(last.id));
    removedId = last.id;
  }
  const rename = lang === 'fil' ? 'Mga Bahagi ng Halaman – bersyon ko' : 'Parts of a Plant – my version';
  await d.page.locator('header input').fill(rename);
  await saved(d);
  await shot(d, '07-slides-changed');

  // What the walk expects the saved deck to be, slide by slide (used by the independent reader afterwards).
  const finalOrder = await order(d);
  const textOf = (slide, id) => {
    const blocks = {};
    for (const b of slide.blocks) blocks[b.id] = b.paragraphs;
    if (slide.id === s1.id || id === copyId) blocks[titleBlock.id] = [id === copyId ? copyTitle : newTitle];
    if (slide.id === s2.id && id === s2.id) blocks[body.id] = bodyAfter;
    if (cellEdit && slide.id === cellEdit.slide && id === cellEdit.slide) blocks[cellEdit.block] = [cellEdit.text];
    return blocks;
  };
  for (const id of finalOrder) {
    const source = id === copyId ? s1 : slides.find((s) => s.id === id);
    expected.slides.push({ id, source: source.id, blocks: textOf(source, id), notes: id === s2.id && notesEditable ? [noteText] : source.notes.paragraphs });
  }
  expected.removed = removedId ? [removedId] : [];
  expected.title = rename;

  if (pictures) {
    await selectSlide(d, s1.id);
    // Pictures follow a save by themselves; "Refresh pictures" is there for a slow file. Either way: wait for current.
    await d.page.locator('[data-refresh-pictures]').click({ timeout: 1500 }).catch(() => {});
    await d.page.locator('[data-pictures="current"]').waitFor({ timeout: 240000 });
    await d.page.waitForTimeout(800);
    const natural = await d.page.locator(`[data-slide-id="${s1.id}"] img`).evaluate((img) => img.complete && img.naturalWidth);
    check('the picture shown is of the saved, edited slide', natural > 0, `picture ${natural}px wide`);
    await shot(d, '08-picture-of-edited-slide');
    if (copyId) {
      await selectSlide(d, copyId);
      await d.page.waitForTimeout(800);
      await shot(d, '08b-picture-of-the-copy');
    }
  }

  // Persistence: a fresh load shows the same thing.
  await d.page.reload({ waitUntil: 'networkidle', timeout: 120000 });
  await editorReady(d);
  check('after a reload the slides are in the same order', JSON.stringify(await order(d)) === JSON.stringify(finalOrder));
  check('after a reload the changed words are there', (await d.page.locator(`#uf-${s1.id}-${titleBlock.id}-0`).inputValue()) === newTitle);
  check('after a reload the name of the slides is there', (await d.page.locator('header input').inputValue()) === rename);
  check('nothing is left unsaved (no draft offered)', (await d.page.locator('dialog[open]').count()) === 0);
  const stored = (await api(d, `/deck-uploads/${uploadId}`)).data;
  check('the server holds her differences, not a rewritten deck', stored.rev > first.rev && stored.changedSlides > 0 && stored.originalSha256 === expected.uploadedSha256, `rev ${stored.rev}, ${stored.changedSlides} slides changed`);
  expected.rev = stored.rev;

  // Downloads.
  const download = async (selector, name) => {
    await d.page.locator('[data-open-download]').click();
    await d.page.locator('dialog[open]').waitFor({ timeout: 10000 });
    if (name === 'edited') await shot(d, '09-download');
    const [file] = await Promise.all([d.page.waitForEvent('download', { timeout: 120000 }), d.page.locator(selector).click()]);
    const target = join(out, 'downloads', `${tag}-${name}.pptx`);
    await file.saveAs(target);
    return { target, suggested: file.suggestedFilename() };
  };
  const mine = await download('[data-download-mine]', 'edited');
  check('her edited file downloads as .pptx', /\.pptx$/.test(mine.suggested), mine.suggested);
  const orig = await download('[data-download-original]', 'original');
  check('the file she uploaded downloads byte for byte', sha(orig.target) === expected.uploadedSha256, `${orig.suggested} sha256 ${sha(orig.target).slice(0, 16)}…`);
  check('the edited file is a different file', sha(mine.target) !== expected.uploadedSha256);
  expected.files = { edited: mine.target, original: orig.target, editedName: mine.suggested, originalName: orig.suggested };

  await d.page.goto(base + '/library/mine', { waitUntil: 'networkidle', timeout: 120000 });
  const row = d.page.locator(`a[href="/slides/mine/${uploadId}"]`);
  await row.waitFor({ timeout: 30000 });
  const rowText = (await row.textContent()) ?? '';
  check('her list shows the file under its new name, with what changed', rowText.includes(rename) && rowText.includes(basename(deckFile)), rowText);
  await shot(d, '10-my-slides-list');

  if (extraFile) {
    await sendFile(d, extraFile);
    await d.page.waitForURL(/\/slides\/mine\/[^/]+$/, { timeout: 180000 });
    extraId = decodeURIComponent(new URL(d.page.url()).pathname.split('/').pop());
    await editorReady(d);
    const extra = (await api(d, `/deck-uploads/${extraId}`)).data;
    if (extra.previews.available) await d.page.locator('[data-slide-id][data-has-picture="yes"]').first().waitFor({ timeout: 240000 }).catch(() => {});
    await d.page.waitForTimeout(1200);
    check('a second, different file opens too', extraId !== uploadId, `${basename(extraFile)}: ${extra.base.totals.slides} slides, kept: ${extra.base.features.map((f) => f.feature).join(', ') || 'nothing special'}`);
    await shot(d, '11-second-file');
    await d.page.locator('[data-kept-more]').click();
    await d.page.locator('dialog[open]').waitFor({ timeout: 10000 });
    await shot(d, '11b-second-file-kept');
    await closeSheet(d);
    // Delete it again from the editor's own menu.
    await d.page.locator('[data-open-more]').click();
    await d.page.locator('[data-delete]').click();
    await d.page.locator('[data-delete-confirm]').waitFor({ timeout: 10000 });
    await d.page.waitForTimeout(400);
    await shot(d, '12-delete-asks-first');
    await d.page.locator('[data-delete-confirm]').click();
    await d.page.waitForURL('**/library/mine', { timeout: 30000 });
    onPurpose = 'a deleted file';
    const gone = await api(d, `/deck-uploads/${extraId}`);
    onPurpose = null;
    check('deleting a file removes it from Tala', gone.status === 404, `status ${gone.status}`);
    extraId = null;
  }
  await d.ctx.close();

  /* ------------------------------------------------ phone */
  const p = await open('phone', { email, password });
  await p.page.goto(base + '/library/mine', { waitUntil: 'networkidle', timeout: 120000 });
  await p.page.locator(`a[href="/slides/mine/${uploadId}"]`).waitFor({ timeout: 30000 });
  await shot(p, '20-my-slides');
  await p.page.goto(base + `/slides/mine/${uploadId}`, { waitUntil: 'networkidle', timeout: 120000 });
  await editorReady(p);
  if (pictures) await p.page.locator('[data-slide-id][data-has-picture="yes"]').first().waitFor({ timeout: 240000 }).catch(() => {});
  await p.page.waitForTimeout(1200);
  await shot(p, '21-editor');
  await shot(p, '21b-editor-whole-page', { fullPage: true });
  const phoneField = p.page.locator(`#uf-${s1.id}-${titleBlock.id}-0`);
  await phoneField.scrollIntoViewIfNeeded();
  check('on a phone the same words are in plain fields', (await phoneField.inputValue()) === newTitle);
  const fieldBox = await phoneField.boundingBox();
  check('fields are full width and tall enough to tap', fieldBox.width > 250 && fieldBox.height >= 40, `${Math.round(fieldBox.width)}×${Math.round(fieldBox.height)} px`);
  await shot(p, '22-editor-words');
  await p.page.locator('[data-open-download]').click();
  await p.page.locator('dialog[open]').waitFor({ timeout: 10000 });
  await shot(p, '23-download');
  check('the download button has a name for screen readers on a phone', ((await p.page.locator('[data-open-download]').getAttribute('aria-label')) ?? '').length > 3);
  await p.ctx.close();

  /* ------------------------------------------------ another teacher */
  if (other) {
    const o = await open('desktop', other);
    onPurpose = 'another teacher';
    await o.page.goto(base + '/library/mine', { waitUntil: 'networkidle', timeout: 120000 });
    await o.page.waitForTimeout(800);
    const theirs = await api(o, '/deck-uploads');
    check('another teacher’s list does not contain her file', theirs.status === 200 && !theirs.data.decks.some((x) => x.id === uploadId), `${theirs.data.decks.length} decks`);
    const tries = [];
    for (const path of [`/deck-uploads/${uploadId}`, `/deck-uploads/${uploadId}/original`, `/deck-uploads/${uploadId}/pptx`, `/deck-uploads/${uploadId}/previews/${s1.id}`]) tries.push((await api(o, path)).status);
    tries.push((await api(o, `/deck-uploads/${uploadId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseRev: expected.rev, slides: stored.edits.slides, force: true }) })).status);
    tries.push((await api(o, `/deck-uploads/${uploadId}`, { method: 'DELETE' })).status);
    check('another teacher cannot read, download, picture, change or delete it', tries.every((x) => x === 404), tries.join(','));
    await o.page.goto(base + `/slides/mine/${uploadId}`, { waitUntil: 'networkidle', timeout: 120000 });
    await o.page.waitForTimeout(1500);
    check('opening her link as another teacher shows nothing of it', (await o.page.locator('[data-slide-id]').count()) === 0);
    await shot(o, '30-another-teacher');
    await o.ctx.close();
    onPurpose = null;
    const again = await open('desktop', { email, password });
    const still = await api(again, `/deck-uploads/${uploadId}`);
    check('her file is untouched by those attempts', still.status === 200 && still.data.rev === expected.rev, `rev ${still.data?.rev}`);
    await again.ctx.close();
  }
} catch (e) {
  check('the walk ran to the end', false, String(e?.stack ?? e).slice(0, 380));
}

if (uploadId && !flag('keep')) {
  const c = await open('desktop', { email, password });
  for (const id of [uploadId, extraId].filter(Boolean)) await api(c, `/deck-uploads/${id}`, { method: 'DELETE' });
  await c.ctx.close();
}
await browser.close();
check('no errors in the browser console', errors.length === 0, errors.slice(0, 4).join(' | '));
// Judged: every request of this feature, and a server error anywhere. (A preview without built pack decks answers
// 404 for pack covers on the Library page; that is not this feature's.)
const surprise = failures.filter((f) => !f.expected && (f.status >= 500 || /\/deck-upload/.test(f.path)));
check('no request failed except the ones provoked on purpose', surprise.length === 0, `${failures.length - surprise.length} on purpose; unexpected: ${surprise.slice(0, 4).map((f) => `${f.status} ${f.method} ${f.path}`).join(' | ') || 'none'}`);
const failed = results.filter((r) => !r.ok);
writeFileSync(join(out, `walk-${tag}.json`), JSON.stringify({ base, lang, uploadId, checks: results.length, failed: failed.length, results, shots, failures, expected }, null, 1));
console.log(`\n${results.length - failed.length}/${results.length} checks passed; ${shots.length} screenshots in ${out}`);
process.exit(failed.length ? 1 : 0);
