// Walk of "One plan for a multi-grade class" in a real browser against a running LOCAL tala-web.
//
// It first seeds a fictional teacher through the real API and sync engine: a school year, a Grade 4–5 room and a
// Grade 3–4–5 room, a Science subject for each, and each grade's lesson for today made from the REAL teaching packs
// of the running server the way "Add to my class" makes them (data/pack-plans.ts). Then, in Chromium:
//   Lessons → Combine → the lessons of the day are offered → one combined draft opens in the lesson editor →
//   she changes the note → it is still there after a reload and on a second device → print page in the table
//   layout on A4 and long bond (saved as PDF) → Download as Word (saved) → a three-grade room with one grade left
//   empty → the phone and the Filipino screens.
// Every step is a named check in multigrade-walk.json; the saved files are judged afterwards by
// scripts/multigrade-walk-verify.py (python-docx, pypdf).
//
//   PLAYWRIGHT_PATH=… CHROMIUM_PATH=… pnpm exec tsx scripts/multigrade-walk.mjs <baseUrl> <outDir> --db <TALA_DB_PATH>
//        [--email x@example.com --password …]   (the account to create; random by default)
//        [--browser-base https://…]             (the same server's https address: a server whose public origin is
//                                                https only gives its session cookie to a browser over https)
//
// Local servers only: it creates an account. Everything typed or seeded is invented (@example.com).
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const [base, out] = argv;
const dbPath = argv.includes('--db') ? argv[argv.indexOf('--db') + 1] : '';
if (!base || !out || !dbPath) throw new Error('usage: multigrade-walk.mjs <baseUrl> <outDir> --db <TALA_DB_PATH>');
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error('local servers only (this script creates an account)');
const { createTalaClient } = await import('@hiraia/tala-core/contracts');
const { createSyncEngine, createMemoryStore } = await import('@hiraia/tala-core/sync');
const { planFromPackDay } = await import('../src/data/pack-plans.ts');
const { en } = await import('../src/i18n/en.ts');
const { fil } = await import('../src/i18n/fil.ts');
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright-core');
mkdirSync(join(out, 'files'), { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${String(detail).slice(0, 180)}` : ''}`);
};
const stamp = Date.now().toString(36);
let n = 0;
const newId = () => `mgw-${stamp}-${(++n).toString(36).padStart(4, '0')}`;
const today = new Date().toISOString().slice(0, 10);
const addDays = (iso, k) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
};
const weekdayOf = (iso) => ((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
const monday = addDays(today, 1 - weekdayOf(today));
// The day the walk combines: today on a school day, else this week's Monday.
const walkDate = weekdayOf(today) <= 5 ? today : monday;
const option = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
const site = option('browser-base', base).replace(/\/$/, '');
const email = option('email', `teacher.multigrade.${stamp}@example.com`);
const password = option('password', `Tala-mg-${stamp}-Aa1!`);

/* ------------------------------------------------ seed, through the real API */
const jar = { cookie: '' };
const fetchWithCookies = async (input, init) => {
  const req = new Request(input, init);
  if (jar.cookie) req.headers.set('cookie', jar.cookie);
  const res = await fetch(req);
  const set = res.headers.get('set-cookie');
  if (set) jar.cookie = set.split(';')[0];
  return res;
};
const client = createTalaClient({ baseUrl: base, fetch: fetchWithCookies, validateResponses: false });
await client.call('auth.register', { body: { email, password, displayName: 'Gng. Liza Ramos', uiLanguage: 'en', deviceLabel: 'multigrade walk seed' } });
{
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare("select vars from core_mail_outbox where to_email=? and template='verify_email' order by rowid desc limit 1").get(email);
  db.close();
  if (row) await client.call('auth.verifyEmail', { body: { token: JSON.parse(row.vars).link.split('#token=')[1] } });
}
const engine = createSyncEngine({ store: createMemoryStore(), transport: client.syncTransport, deviceId: `mg-seed-${stamp}`, now: () => new Date(), newId });
const presets = (await client.call('calendar.presets')).presets;
const preset = await client.call('calendar.preset', { params: { presetId: presets[0].id } });
const year = {
  id: newId(), label: `${preset.startDate.slice(0, 4)}-${preset.endDate.slice(0, 4)}`, schoolName: 'Malaya Elementary School (demo)', startDate: preset.startDate, endDate: preset.endDate,
  terms: preset.terms.map((t) => ({ id: newId(), index: t.index, name: t.name, startDate: t.startDate, endDate: t.endDate })),
  teachingWeekdays: [1, 2, 3, 4, 5], presetId: preset.id, presetVersion: preset.version, provisional: preset.provisional,
};
await engine.put('school_year', year);
await engine.put('profile', { id: 'profile', displayName: 'Gng. Liza Ramos', uiLanguage: 'en', schoolName: year.schoolName, region: 'Region IV-A', dataSaver: false, activeSchoolYearId: year.id, pacingParams: {} });
const room = (name, grades) => ({
  id: newId(), schoolYearId: year.id, name, curriculum: 'deped', gradeGroups: grades.map((grade) => ({ id: newId(), grade, learnerCount: 9 })), languages: ['en'],
  profile: { materials: ['chalkboard', 'manila paper'], textbooks: [], electricity: true, projector: false, printing: true, outdoorSpace: true, notes: '' }, isSample: false, archived: false,
});
const subject = (cls, minutes) => ({
  id: newId(), classId: cls.id, learningAreaId: 'science', subjectName: 'Science', gradeGroupIds: cls.gradeGroups.map((g) => g.id), language: 'en',
  slots: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ id: newId(), weekday, startTime: '08:00', minutes, rotation: null })),
});
const two = room('Grades 4 and 5 – Mabini (multigrade)', ['4', '5']);
const three = room('Grades 3, 4 and 5 – Rizal (multigrade)', ['3', '4', '5']);
const twoScience = subject(two, 45);
const threeScience = subject(three, 60);
for (const r of [two, three]) await engine.put('class', r);
for (const a of [twoScience, threeScience]) await engine.put('assignment', a);
// Each grade's lessons for this week (Monday to Friday), from the server's real packs, exactly as "Add to my
// class" writes them: one single-grade lesson per day.
const PACKS = { '4': 'sci26-g4-t1-w08', '5': 'sci26-g5-t3-w07' };
const details = {};
for (const [grade, packId] of Object.entries(PACKS)) details[grade] = await client.call('packs.detail', { params: { packId }, query: { lang: 'en' } });
const seeded = [];
for (const [cls, assignment] of [[two, twoScience], [three, threeScience]])
  for (const g of cls.gradeGroups) {
    const detail = details[g.grade];
    if (!detail) continue; // Grade 3 has no lesson yet: the teacher will write it.
    for (let day = 0; day < 5; day++) {
      const date = addDays(monday, day);
      const built = planFromPackDay({ pack: detail.content, review: detail.review, day: detail.content.days[day], cls, gradeGroupId: g.id, assignmentId: assignment.id, date, newId });
      await engine.batch([{ op: 'put', entity: 'plan', data: built.plan }, ...built.sections.map((s) => ({ op: 'put', entity: 'plan_section', data: s }))]);
      if (date === walkDate) seeded.push({ classId: cls.id, grade: g.grade, groupId: g.id, planId: built.plan.id, title: built.plan.title });
    }
  }
for (let i = 0; i < 20 && (await engine.status()).pending; i++) await engine.sync();
check('seed: a teacher with two multi-grade rooms and each grade’s pack lessons for the week is on the server', (await engine.status()).pending === 0 && seeded.length === 4, `${walkDate}: ${seeded.map((s) => `G${s.grade}: ${s.title}`).join(' | ')}`);

/* ------------------------------------------------ the browser */
const VIEW = { desktop: { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 }, phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
async function open(view, lang) {
  const ctx = await browser.newContext({ ...VIEW[view], locale: 'en-PH', timezoneId: 'Asia/Manila', acceptDownloads: true });
  await ctx.addInitScript((l) => {
    try {
      localStorage.setItem('tala.lang', l);
    } catch {}
  }, lang);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${view}: pageerror: ${String(e).slice(0, 240)}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${view}: console: ${m.text().slice(0, 240)}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 500) errors.push(`${view}: ${r.status()} ${new URL(r.url()).pathname}`);
  });
  await page.goto(site + '/sign-in', { waitUntil: 'networkidle', timeout: 120000 });
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(password);
  await page.locator('button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 60000 });
  await page.waitForTimeout(2500); // first sync pulls her records onto this device
  return { ctx, page, view, lang };
}
const shots = [];
async function shot(s, name, fullPage = false) {
  await s.page.evaluate(() => document.fonts.ready.then(() => document.fonts.load("600 20px 'Fraunces'"))).catch(() => {});
  await s.page.waitForTimeout(350);
  const file = `${name}-${s.view}-${s.lang}.png`;
  await s.page.screenshot({ path: join(out, file), fullPage });
  const overflowX = await s.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  shots.push({ file, overflowX });
  if (overflowX) check(`no sideways scrolling: ${file}`, false);
}
const picks = (s) => s.page.locator('[data-mg-pick]').evaluateAll((els) => els.map((e) => ({ group: e.getAttribute('data-mg-pick'), value: e.value, options: e.options.length })));
/** Combine for a class and land in the editor; returns the new plan's id. */
async function combine(s, cls, expectPicked) {
  await s.page.goto(`${site}/lessons/combine?classId=${cls.id}&date=${walkDate}`, { waitUntil: 'networkidle', timeout: 120000 });
  await s.page.locator('[data-mg-screen]').waitFor({ timeout: 60000 });
  await s.page.waitForFunction((want) => [...document.querySelectorAll('[data-mg-pick]')].filter((e) => e.value).length === want, expectPicked, { timeout: 30000 }).catch(() => {});
  return picks(s);
}
/** Everything the editor shows: page text and what is in its fields (block names are fields). */
const allText = (s) => s.page.evaluate(() => `${document.body.innerText}\n${[...document.querySelectorAll('input,textarea')].map((e) => e.value).join('\n')}`);
const savedFiles = {};
const expected = { today, walkDate, email, plans: {} };
try {
  const d = await open('desktop', 'en');
  await d.page.goto(site + '/lessons', { waitUntil: 'networkidle', timeout: 120000 });
  const entry = d.page.locator('[data-mg-entry] a');
  await entry.waitFor({ timeout: 60000 });
  check('Lessons shows a teacher with a multi-grade room the way to one combined plan', (await entry.textContent())?.includes(en['mg.entry']));
  await shot(d, 'mg-01-lessons');

  // Two grades: the lessons of the day are already chosen.
  const chosen = await combine(d, two, 2);
  const want = Object.fromEntries(seeded.filter((x) => x.classId === two.id).map((x) => [x.groupId, x.planId]));
  check('each grade’s lesson for that day is offered and pre-selected', chosen.length === 2 && chosen.every((c) => c.value === want[c.group]), JSON.stringify(chosen));
  const splitText = (await d.page.locator('[data-mg-split]').textContent()) ?? '';
  check('the screen says how the period is shared', /5 min together/.test(splitText) && /18 \+ 17 min/.test(splitText), splitText);
  await shot(d, 'mg-02-combine');
  // "All grades together (no subject)" can be chosen and stays chosen, also when the class has one subject.
  await d.page.locator('[data-mg-subject]').selectOption('');
  await d.page.waitForTimeout(700);
  const noSubject = await d.page.locator('[data-mg-subject]').inputValue();
  check('"All grades together" can be chosen for a class with one subject, and the grades’ lessons are still offered', noSubject === '' && (await picks(d)).filter((c) => c.value).length === 2, `subject "${noSubject}"`);
  await d.page.locator('[data-mg-subject]').selectOption(twoScience.id);
  await d.page.waitForFunction(() => document.querySelector('[data-mg-minutes]')?.value === '45', null, { timeout: 15000 });
  await d.page.locator('[data-mg-make]').click();
  await d.page.waitForURL(/\/lessons\/(?!combine|new)[^/]+$/, { timeout: 60000 });
  const planId = decodeURIComponent(new URL(d.page.url()).pathname.split('/').pop());
  await d.page.getByLabel(en['editor.sessionNote']).waitFor({ timeout: 60000 });
  check('one combined draft opens in the lesson editor', true, planId);
  const pageText = await allText(d);
  const flowWords = ['Start together', 'Grade 4 with the teacher', 'Grade 5 with the teacher', 'Finish together'];
  check('the session has a shared start, one turn per grade and a shared finish', flowWords.every((w) => pageText.includes(w)), flowWords.filter((w) => !pageText.includes(w)).join(', '));
  await d.page.waitForTimeout(600);
  await shot(d, 'mg-03-editor');
  await shot(d, 'mg-03b-editor-whole', true);

  // She changes the note; it is kept on this device and reaches the server.
  const note = 'My note: Grade 5 sits by the window today. Bring the two thermometers.';
  await d.page.getByLabel(en['editor.sessionNote']).fill(note);
  await d.page.getByLabel(en['editor.sessionNote']).blur();
  await d.page.waitForTimeout(3500);
  await d.page.reload({ waitUntil: 'networkidle', timeout: 120000 });
  await d.page.getByLabel(en['editor.sessionNote']).waitFor({ timeout: 60000 });
  check('after a reload her change is there', (await d.page.getByLabel(en['editor.sessionNote']).inputValue()) === note);
  // Wait for the sync loop to send it, then look from a second device (a new browser profile).
  let onServer = false;
  for (let i = 0; i < 20 && !onServer; i++) {
    await d.page.waitForTimeout(1500);
    const second = createSyncEngine({ store: createMemoryStore(), transport: client.syncTransport, deviceId: `mg-check-${stamp}-${i}`, now: () => new Date(), newId });
    for (let k = 0; k < 6; k++) await second.sync();
    const sections = (await second.list('plan_section')).map((r) => r.data).filter((x) => x.planId === planId);
    const flow = sections.find((x) => x.content.type === 'multigrade');
    onServer = flow?.content.note === note;
    if (onServer) expected.plans.two = { planId, note, blocks: flow.content.blocks.map((b) => b.label), groups: ['Grade 4', 'Grade 5'], sources: seeded.filter((x) => x.classId === two.id).map((x) => x.title) };
  }
  check('her change is on the server and reaches another device', onServer);
  const phoneProfile = await open('desktop', 'en');
  await phoneProfile.page.goto(`${site}/lessons/${planId}`, { waitUntil: 'networkidle', timeout: 120000 });
  await phoneProfile.page.getByLabel(en['editor.sessionNote']).waitFor({ timeout: 60000 });
  check('a second browser shows the same plan with her change', (await phoneProfile.page.getByLabel(en['editor.sessionNote']).inputValue()) === note);
  await phoneProfile.ctx.close();

  // Her own lessons are untouched.
  const src = seeded.find((x) => x.classId === two.id);
  const again = createSyncEngine({ store: createMemoryStore(), transport: client.syncTransport, deviceId: `mg-src-${stamp}`, now: () => new Date(), newId });
  for (let k = 0; k < 6; k++) await again.sync();
  const stillSingle = (await again.get('plan', src.planId))?.data;
  check('the lessons it was made from are unchanged', stillSingle && stillSingle.templateId === 'tpl.dlp.v1' && stillSingle.title === src.title && stillSingle.gradeGroupIds.length === 1);

  // Print sheet: table layout chosen, Word download, plain page on A4 and long bond.
  await d.page.getByRole('button', { name: en['editor.moreActions'] }).click();
  await d.page.getByText(en['editor.pdf'], { exact: true }).first().click();
  await d.page.locator('[data-download-word]').waitFor({ timeout: 15000 });
  const tableChosen = await d.page.locator('dialog[open] input[type=radio]:checked').evaluateAll((els) => els.map((e) => e.closest('label')?.innerText.trim() ?? ''));
  const offered = await d.page.locator('dialog[open]').innerText();
  check('the print sheet offers A4 and long bond, and the table layout is chosen for a multi-grade plan', tableChosen.includes(en['pdf.a4']) && tableChosen.includes(en['mg.print.table']) && offered.includes(en['pdf.long']) && offered.includes(en['mg.print.stack']), tableChosen.join(' | '));
  await shot(d, 'mg-04-print-sheet');
  const [file] = await Promise.all([d.page.waitForEvent('download', { timeout: 60000 }), d.page.locator('[data-download-word]').click()]);
  savedFiles.word = join(out, 'files', 'two-grades.docx');
  await file.saveAs(savedFiles.word);
  check('Download as Word gives a .docx made on the device', /\.docx$/.test(file.suggestedFilename()), file.suggestedFilename());
  for (const paper of ['a4', 'long']) {
    await d.page.goto(`${site}/lessons/${planId}/print?paper=${paper}&layout=table`, { waitUntil: 'networkidle', timeout: 120000 });
    const frame = d.page.frameLocator('#print-frame');
    await frame.locator('table.flow').waitFor({ timeout: 60000 });
    const html = await d.page.locator('#print-frame').getAttribute('srcdoc');
    const printer = await d.ctx.newPage();
    await printer.setContent(html, { waitUntil: 'load' });
    savedFiles[`pdf_${paper}`] = join(out, 'files', `two-grades-${paper}.pdf`);
    await printer.pdf({ path: savedFiles[`pdf_${paper}`], preferCSSPageSize: true, printBackground: true });
    await printer.close();
    if (paper === 'a4') await shot(d, 'mg-05-print-page');
  }
  check('the print page shows the session as a table, on A4 and on long bond', true);

  // Three grades, one without a lesson yet.
  const three3 = await combine(d, three, 2);
  check('three grades: the two with a lesson are chosen, the third is left for her', three3.length === 3 && three3.filter((c) => c.value).length === 2 && three3.filter((c) => !c.value).length === 1, JSON.stringify(three3.map((c) => Boolean(c.value))));
  await shot(d, 'mg-06-combine-three');
  await d.page.locator('[data-mg-make]').click();
  await d.page.waitForURL(/\/lessons\/(?!combine|new)[^/]+$/, { timeout: 60000 });
  const plan3 = decodeURIComponent(new URL(d.page.url()).pathname.split('/').pop());
  await d.page.getByLabel(en['editor.sessionNote']).waitFor({ timeout: 60000 });
  const text3 = await allText(d);
  check('three grades: three turns in one session', ['Grade 3 with the teacher', 'Grade 4 with the teacher', 'Grade 5 with the teacher'].every((w) => text3.includes(w)));
  await d.page.waitForTimeout(600);
  await shot(d, 'mg-07-editor-three');
  await d.page.goto(`${site}/lessons/${plan3}/print?paper=long&layout=table`, { waitUntil: 'networkidle', timeout: 120000 });
  await d.page.frameLocator('#print-frame').locator('table.flow').waitFor({ timeout: 60000 });
  const html3 = await d.page.locator('#print-frame').getAttribute('srcdoc');
  const printer3 = await d.ctx.newPage();
  await printer3.setContent(html3, { waitUntil: 'load' });
  savedFiles.pdf_three_long = join(out, 'files', 'three-grades-long.pdf');
  await printer3.pdf({ path: savedFiles.pdf_three_long, preferCSSPageSize: true, printBackground: true });
  await printer3.close();
  await shot(d, 'mg-08-print-three');
  expected.plans.three = { planId: plan3, groups: ['Grade 3', 'Grade 4', 'Grade 5'] };
  await d.ctx.close();

  // Phone, then Filipino.
  const p = await open('phone', 'en');
  await combine(p, two, 2);
  await shot(p, 'mg-10-combine');
  await p.page.goto(`${site}/lessons/${planId}`, { waitUntil: 'networkidle', timeout: 120000 });
  await p.page.getByLabel(en['editor.sessionNote']).waitFor({ timeout: 60000 });
  await p.page.waitForTimeout(600);
  await shot(p, 'mg-11-editor');
  check('on a phone the combined plan opens with her note', (await p.page.getByLabel(en['editor.sessionNote']).inputValue()) === note);
  await p.ctx.close();
  const f = await open('desktop', 'fil');
  await combine(f, two, 2);
  const filText = await f.page.locator('[data-mg-screen]').innerText();
  check('the screen is in Filipino when the teacher uses Filipino', filText.includes(fil['mg.title']) && filText.includes(fil['mg.make']));
  await shot(f, 'mg-12-combine');
  await f.ctx.close();
} catch (e) {
  check('the walk ran to the end', false, String(e?.stack ?? e).slice(0, 280));
}
await browser.close();
check('no errors in the browser', errors.length === 0, errors.slice(0, 3).join(' | '));
const failed = results.filter((r) => !r.ok);
writeFileSync(join(out, 'multigrade-walk.json'), JSON.stringify({ base, site, checks: results.length, failed: failed.length, results, shots, files: savedFiles, expected }, null, 1));
console.log(`\n${results.length - failed.length}/${results.length} checks passed; ${shots.length} screenshots in ${out}`);
process.exit(failed.length ? 1 : 0);
