// English curriculum walk (release owner, 26 Nov 2026): the English (G2-10) and Grade 1 Reading and Literacy
// curriculum packs in Tala's teacher views, in a real browser, signed in.
//
// Seeds through the real API and sync engine (everything invented, rooms marked "synthetic test"):
//   - "Grade 4 – Luna (English, synthetic test)": English for Grade 4, Mon–Fri, with pacing tracks for every term;
//   - "Grades 1, 2 and 3 – Bonifacio (multigrade English, synthetic test)": English for Grades 2 and 3 and Reading and
//     Literacy for Grade 1 at the same time, with pacing tracks, and each grade's own lesson for the walk's day tagged
//     with two of that grade's current-term competencies.
// Then, in Chromium: Setup offers English / Reading and Literacy for the right grades and proposes a start from the
// English pack (nothing saved); This Week shows the English session's topic; a new English lesson starts with the
// day's competencies; the picker lists the term's competencies, filters by words and by term, shows the standards and
// the source; her choice is kept after a reload and on the server; the print page and the Word file carry the
// competency and its source; "All grades together" combines Grade 1 Reading and Literacy with Grade 2–3 English and the
// editor, print and Word show competencies, not ids; Library lists no English packs; Community filters by English;
// Filipino and phone screens.
//
//   local:      tsx scripts/english-walk.mjs http://127.0.0.1:PORT <outDir> --local --db <TALA_DB_PATH>
//   production: tsx scripts/english-walk.mjs https://tala.hiraia.org <outDir>   (TALA_TEST_EMAIL, TALA_TEST_PASSWORD)
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const [base, out] = argv;
const local = argv.includes('--local');
const dbPath = argv.includes('--db') ? argv[argv.indexOf('--db') + 1] : '';
if (!base || !out) throw new Error('usage: english-walk.mjs <baseUrl> <outDir> [--local --db <path>]');
if (local && (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base) || !dbPath)) throw new Error('--local needs a local base URL and --db');
if (!local && base !== 'https://tala.hiraia.org') throw new Error('without --local this walk is for the production site only');
const { createTalaClient } = await import('@hiraia/tala-core/contracts');
const { createSyncEngine, createMemoryStore } = await import('@hiraia/tala-core/sync');
const { newPlan, defaultTemplateFor } = await import('../src/data/plans.ts');
const { en } = await import('../src/i18n/en.ts');
const { fil } = await import('../src/i18n/fil.ts');
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright-core');
mkdirSync(join(out, 'files'), { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 400) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${String(detail).slice(0, 200)}` : ''}`);
};
const stamp = Date.now().toString(36);
let n = 0;
const newId = () => `enw-${stamp}-${(++n).toString(36).padStart(4, '0')}`;
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); // Manila date
const addDays = (iso, k) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
};
const weekdayOf = (iso) => ((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
const monday = addDays(today, 1 - weekdayOf(today));
const walkDate = weekdayOf(today) <= 5 ? today : monday;

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
let email = process.env.TALA_TEST_EMAIL;
let password = process.env.TALA_TEST_PASSWORD;
if (local) {
  email = `teacher.english.${stamp}@example.com`;
  password = `Tala-en-${stamp}-Aa1!`;
  await client.call('auth.register', { body: { email, password, displayName: 'Gng. Rosa Dizon', uiLanguage: 'en', deviceLabel: 'english walk seed' } });
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare("select vars from core_mail_outbox where to_email=? and template='verify_email' order by rowid desc limit 1").get(email);
  db.close();
  if (row) await client.call('auth.verifyEmail', { body: { token: JSON.parse(row.vars).link.split('#token=')[1] } });
}
if (!email || !password) throw new Error('TALA_TEST_EMAIL and TALA_TEST_PASSWORD are needed');
if (!local) await client.call('auth.login', { body: { email, password, deviceLabel: 'release owner English check' } });
const engine = createSyncEngine({ store: createMemoryStore(), transport: client.syncTransport, deviceId: `en-seed-${stamp}`, now: () => new Date(), newId });
for (let k = 0; k < 8; k++) await engine.sync();
let year;
if (local) {
  const presets = (await client.call('calendar.presets')).presets;
  const preset = await client.call('calendar.preset', { params: { presetId: presets[0].id } });
  year = {
    id: newId(), label: `${preset.startDate.slice(0, 4)}-${preset.endDate.slice(0, 4)}`, schoolName: 'Malaya Elementary School (demo)', startDate: preset.startDate, endDate: preset.endDate,
    terms: preset.terms.map((t) => ({ id: newId(), index: t.index, name: t.name, startDate: t.startDate, endDate: t.endDate })),
    teachingWeekdays: [1, 2, 3, 4, 5], presetId: preset.id, presetVersion: preset.version, provisional: preset.provisional,
  };
  await engine.put('school_year', year);
  await engine.put('profile', { id: 'profile', displayName: 'Gng. Rosa Dizon', uiLanguage: 'en', schoolName: year.schoolName, region: 'Region IV-A', dataSaver: false, activeSchoolYearId: year.id, pacingParams: {} });
} else {
  const profile = (await engine.get('profile', 'profile'))?.data;
  year = profile && (await engine.get('school_year', profile.activeSchoolYearId))?.data;
  if (!year) throw new Error('the test account has no active school year');
}
const term = year.terms.find((t) => t.startDate <= walkDate && t.endDate >= walkDate);
check('the account signs in and its school year has a term on the walk day', Boolean(term), `${local ? 'new local account' : 'the release owner\'s test account'}; ${year.label}; ${walkDate} in ${term?.name ?? 'no term'}`);

// The curriculum as the server serves it.
const index = await client.call('curriculum.index');
const areaOf = Object.fromEntries(index.learningAreas.map((a) => [a.id, a]));
check('the curriculum lists English for Grades 2–10 and Reading and Literacy for Grade 1, beside Science', JSON.stringify(areaOf.english?.grades) === JSON.stringify(['2', '3', '4', '5', '6', '7', '8', '9', '10']) && JSON.stringify(areaOf['reading-and-literacy']?.grades) === JSON.stringify(['1']) && Boolean(areaOf.science), index.learningAreas.map((a) => `${a.name.en}: ${a.grades.join(',')}`).join(' | '));
const packMeta = (grade, area) => index.packs.find((p) => p.grade === grade && p.learningAreaId === area && p.schoolYears.includes(year.label));
const packs = {};
for (const [grade, area] of [['1', 'reading-and-literacy'], ['2', 'english'], ['3', 'english'], ['4', 'english'], ['4', 'science']]) {
  const meta = packMeta(grade, area);
  packs[`${area}:${grade}`] = meta ? await client.call('curriculum.pack', { params: { packId: meta.packId } }) : null;
}
const termComps = (grade, area) => (packs[`${area}:${grade}`]?.competencies ?? []).filter((c) => c.termIndex === term.index).sort((a, b) => a.sequence - b.sequence);
check('each pack of the walk is served with its competencies for the current term', Object.values(packs).every((p) => p && p.competencies.length) && termComps('4', 'english').length > 0, Object.entries(packs).map(([k, p]) => `${k} ${p?.competencies.length ?? 0} (term ${term.index}: ${p ? p.competencies.filter((c) => c.termIndex === term.index).length : 0})`).join(', '));

const room = (name, grades) => ({
  id: newId(), schoolYearId: year.id, name, curriculum: 'deped', gradeGroups: grades.map((grade) => ({ id: newId(), grade, learnerCount: 12 })), languages: ['en'],
  profile: { materials: ['chalkboard', 'manila paper'], textbooks: [], electricity: true, projector: false, printing: true, outdoorSpace: true, notes: '' }, isSample: false, archived: false,
});
const subject = (cls, learningAreaId, subjectName, groupIds, startTime, minutes) => ({
  id: newId(), classId: cls.id, learningAreaId, subjectName, gradeGroupIds: groupIds, language: 'en',
  slots: [1, 2, 3, 4, 5].map((weekday) => ({ id: newId(), weekday, startTime, minutes, rotation: null })),
});
const g4 = room('Grade 4 – Luna (English, synthetic test)', ['4']);
const mg = room('Grades 1, 2 and 3 – Bonifacio (multigrade English, synthetic test)', ['1', '2', '3']);
const [mg1, mg2, mg3] = mg.gradeGroups;
const g4English = subject(g4, 'english', 'English', [g4.gradeGroups[0].id], '07:30', 50);
const mgEnglish = subject(mg, 'english', 'English', [mg2.id, mg3.id], '09:00', 60);
const mgReading = subject(mg, 'reading-and-literacy', 'Reading and Literacy', [mg1.id], '09:00', 60);
const g4Science = subject(g4, 'science', 'Science', [g4.gradeGroups[0].id], '13:00', 50);
for (const r of [g4, mg]) await engine.put('class', r);
for (const a of [g4English, mgEnglish, mgReading, g4Science]) await engine.put('assignment', a);
// Pacing tracks as setup writes them: one per subject, grade and term, each with its own grade's curriculum version.
const tracks = [];
for (const [cls, a] of [[g4, g4English], [mg, mgEnglish], [mg, mgReading], [g4, g4Science]])
  for (const gid of a.gradeGroupIds) {
    const grade = cls.gradeGroups.find((g) => g.id === gid).grade;
    for (const t of year.terms) tracks.push({ id: newId(), classId: cls.id, assignmentId: a.id, gradeGroupId: gid, termId: t.id, curriculumVersion: packMeta(grade, a.learningAreaId)?.curriculumVersion ?? null, startPosition: null, params: {}, overrides: {}, allocation: null });
  }
for (const tr of tracks) await engine.put('pacing_track', tr);
// Each grade's own lesson for the walk's day in the multi-grade room, tagged with two of its current-term competencies.
const seeded = {};
for (const [group, a, area, label] of [[mg1, mgReading, 'reading-and-literacy', 'Reading and Literacy'], [mg2, mgEnglish, 'english', 'English'], [mg3, mgEnglish, 'english', 'English']]) {
  const one = { ...a, gradeGroupIds: [group.id] };
  const comps = termComps(group.grade, area).slice(0, 2);
  const { plan, sections } = newPlan({ template: defaultTemplateFor(mg, one), cls: mg, assignment: one, dates: [walkDate], language: 'en', competencies: { [group.id]: comps.map((c) => c.id) }, curriculumVersion: packMeta(group.grade, area).curriculumVersion, newId, title: `Grade ${group.grade} ${label}: ${comps[0]?.shortTitle ?? ''} (synthetic test)` });
  await engine.batch([{ op: 'put', entity: 'plan', data: plan }, ...sections.map((s) => ({ op: 'put', entity: 'plan_section', data: s }))]);
  seeded[group.grade] = { planId: plan.id, groupId: group.id, comps };
}
{
  // A Science lesson beside the English ones (the same class), tagged with two of this term's Science competencies.
  const comps = termComps('4', 'science').slice(0, 2);
  const { plan, sections } = newPlan({ template: defaultTemplateFor(g4, g4Science), cls: g4, assignment: g4Science, dates: [walkDate], language: 'en', competencies: { [g4.gradeGroups[0].id]: comps.map((c) => c.id) }, curriculumVersion: packMeta('4', 'science').curriculumVersion, newId, title: `Grade 4 Science: ${comps[0]?.shortTitle ?? ''} (synthetic test)` });
  await engine.batch([{ op: 'put', entity: 'plan', data: plan }, ...sections.map((x) => ({ op: 'put', entity: 'plan_section', data: x }))]);
  seeded.science = { planId: plan.id, comps };
}
for (let i = 0; i < 20 && (await engine.status()).pending; i++) await engine.sync();
check('seed: a Grade 4 English room and a Grade 1–3 room (Grade 1 Reading and Literacy, Grades 2–3 English) with tracks and each grade’s lesson are on the server', (await engine.status()).pending === 0, `${tracks.length} tracks; lessons on ${walkDate}: ${Object.entries(seeded).map(([g, s]) => `G${g} ${s.comps.length} competencies`).join(', ')}`);

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
  await page.goto(base + '/sign-in', { waitUntil: 'networkidle', timeout: 120000 });
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(password);
  await page.locator('button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 60000 });
  await page.waitForTimeout(3000); // the first sync pulls her records onto this device
  return { ctx, page, view, lang };
}
const shots = [];
async function shot(s, name, fullPage = false) {
  await s.page.evaluate(() => document.fonts.ready).catch(() => {});
  await s.page.waitForTimeout(350);
  const file = `${name}-${s.view}-${s.lang}.png`;
  await s.page.screenshot({ path: join(out, file), fullPage });
  const overflowX = await s.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  shots.push({ file, overflowX });
  if (overflowX) check(`no sideways scrolling: ${file}`, false);
}
const bodyText = (s) => s.page.evaluate(() => `${document.body.innerText}\n${[...document.querySelectorAll('input,textarea,select')].map((e) => e.value).join('\n')}`);
const has = (hay, needle) => String(hay).replace(/\s+/g, ' ').includes(String(needle).replace(/\s+/g, ' ').trim());
const rawIdPattern = /\b(english|reading-and-literacy)-bow-2026\.[a-z-]+\.g\d+\.t\d\.\d+/;
const serverPlan = async (planId) => {
  const e2 = createSyncEngine({ store: createMemoryStore(), transport: client.syncTransport, deviceId: `en-check-${stamp}-${++n}`, now: () => new Date(), newId });
  for (let k = 0; k < 6; k++) await e2.sync();
  return (await e2.get('plan', planId))?.data ?? null;
};
async function printPdf(s, planId, paper, layout, file) {
  await s.page.goto(`${base}/lessons/${planId}/print?paper=${paper}${layout ? `&layout=${layout}` : ''}`, { waitUntil: 'networkidle', timeout: 120000 });
  await s.page.waitForFunction(() => (document.querySelector('#print-frame')?.getAttribute('srcdoc') ?? '').length > 200, null, { timeout: 60000 });
  const html = await s.page.locator('#print-frame').getAttribute('srcdoc');
  const printer = await s.ctx.newPage();
  await printer.setContent(html, { waitUntil: 'load' });
  const path = join(out, 'files', file);
  await printer.pdf({ path, preferCSSPageSize: true, printBackground: true });
  await printer.close();
  return { html, path };
}
async function wordFile(s, planId, file) {
  await s.page.goto(`${base}/lessons/${planId}`, { waitUntil: 'networkidle', timeout: 120000 });
  await s.page.getByRole('button', { name: en['editor.moreActions'] }).click();
  await s.page.getByText(en['editor.pdf'], { exact: true }).first().click();
  await s.page.locator('[data-download-word]').waitFor({ timeout: 15000 });
  const [dl] = await Promise.all([s.page.waitForEvent('download', { timeout: 60000 }), s.page.locator('[data-download-word]').click()]);
  const path = join(out, 'files', file);
  await dl.saveAs(path);
  await s.page.keyboard.press('Escape').catch(() => {});
  return { path, name: dl.suggestedFilename() };
}
const expected = { walkDate, term: term.index, files: {}, plans: {}, science: null };
try {
  const d = await open('desktop', 'en');

  // 1. Setup offers the right subjects for Grades 1 and 2 and proposes a start from the English pack. Nothing is saved.
  try {
    await d.page.goto(base + '/setup', { waitUntil: 'networkidle', timeout: 120000 });
    await d.page.getByRole('button', { name: new RegExp(`^(${en['common.next']}|${en['class.addClass']})$`) }).first().click();
    await d.page.getByLabel(en['setup.className']).fill('Setup check, not saved (synthetic test)');
    const gradeSelects = d.page.getByLabel(en['setup.grade'], { exact: true });
    await gradeSelects.first().selectOption('1');
    await d.page.getByRole('button', { name: `+ ${en['setup.addGrade']}` }).click();
    await gradeSelects.nth(1).selectOption('2');
    await d.page.getByRole('button', { name: en['common.next'], exact: true }).click();
    const addSubject = d.page.getByLabel(en['setup.addSubject']);
    await addSubject.waitFor({ timeout: 15000 });
    const offered = await addSubject.locator('option').allTextContents();
    check('Setup offers English and Reading and Literacy for a Grade 1–2 class (and not Science, which starts in Grade 3)', offered.includes('English') && offered.includes('Reading and Literacy') && !offered.includes('Science'), offered.join(' | '));
    await d.page.getByRole('button', { name: en['common.back'], exact: true }).click();
    await d.page.getByRole('button', { name: `+ ${en['setup.addGrade']}` }).click();
    await gradeSelects.nth(2).selectOption('4');
    await d.page.getByRole('button', { name: en['common.next'], exact: true }).click();
    await addSubject.waitFor({ timeout: 15000 });
    const offered4 = await addSubject.locator('option').allTextContents();
    check('with a Grade 4 group added, Setup also offers Science', offered4.includes('Science') && offered4.includes('English'), offered4.join(' | '));
    for (const label of ['English', 'Reading and Literacy', 'Science']) {
      await addSubject.selectOption({ label });
      await d.page.getByRole('button', { name: `+ ${en['common.add']}` }).click();
    }
    await shot(d, 'en-01-setup-subjects');
    await d.page.getByRole('button', { name: en['common.next'], exact: true }).click();
    await d.page.getByText(en['setup.startingPositions']).waitFor({ timeout: 30000 });
    const text = await bodyText(d);
    const g2Start = d.page.getByLabel('English · Grade 2');
    const g2Options = (await g2Start.count()) ? await g2Start.locator('option').count() : 0;
    const r1Start = d.page.getByLabel('Reading and Literacy · Grade 1');
    const r1Options = (await r1Start.count()) ? await r1Start.locator('option').count() : 0;
    check('Setup proposes where to start from the English Grade 2 and Reading and Literacy Grade 1 packs (this term’s competencies)', g2Options === termComps('2', 'english').length && r1Options === termComps('1', 'reading-and-literacy').length, `English G2: ${g2Options} of ${termComps('2', 'english').length}; Reading and Literacy G1: ${r1Options} of ${termComps('1', 'reading-and-literacy').length}`);
    check('Setup says plainly where a grade has no pack for a subject (English in Grade 1, Reading and Literacy in Grade 2)', text.includes(`English · Grade 1: ${en['setup.noPack']}`) && text.includes(`Reading and Literacy · Grade 2: ${en['setup.noPack']}`));
    const s4 = d.page.getByLabel('Science · Grade 4');
    const s4Options = (await s4.count()) ? await s4.locator('option').count() : 0;
    const e4 = d.page.getByLabel('English · Grade 4');
    const e4Options = (await e4.count()) ? await e4.locator('option').count() : 0;
    check('in the same class Science Grade 4 starts from the Science pack and English Grade 4 from the English pack (each its own curriculum version)', s4Options === termComps('4', 'science').length && e4Options === termComps('4', 'english').length, `Science G4: ${s4Options} of ${termComps('4', 'science').length}; English G4: ${e4Options} of ${termComps('4', 'english').length}`);
    await shot(d, 'en-02-setup-starts');
  } catch (e) {
    check('the Setup steps ran', false, String(e?.message ?? e).slice(0, 300));
  }
  await d.page.goto(base + '/week', { waitUntil: 'networkidle', timeout: 120000 }); // leave setup without finishing

  // 2. This Week shows the English sessions with a topic from the English pack.
  await d.page.waitForTimeout(2500);
  const weekText = await bodyText(d);
  // Subject lines are set in capitals by CSS (innerText reads them so), with a no-break space before the dot.
  const weekUpper = weekText.toUpperCase().replace(/\s+/g, ' ');
  const g4Titles = termComps('4', 'english').map((c) => c.shortTitle);
  const shown = g4Titles.filter((t) => weekText.includes(t));
  check('This Week lists the Grade 4 English sessions with topics from the English pack', weekUpper.includes(`ENGLISH · ${g4.name.toUpperCase()}`) && shown.length > 0, `${shown.length} topic(s) shown, e.g. ${shown.slice(0, 3).join(' | ')}`);
  const sciShown = termComps('4', 'science').map((c) => c.shortTitle).filter((t) => t && weekText.includes(t));
  check('…and, in the same week, the Grade 4 Science sessions with topics from the Science pack', weekUpper.includes(`SCIENCE · ${g4.name.toUpperCase()}`) && sciShown.length > 0, `${sciShown.length} Science topic(s), e.g. ${sciShown.slice(0, 2).join(' | ')}`);
  await shot(d, 'en-03-week');

  // 3. A new English lesson starts with the day's competencies from the pacing.
  await d.page.goto(`${base}/lessons/new?classId=${g4.id}&assignmentId=${g4English.id}&date=${walkDate}`, { waitUntil: 'networkidle', timeout: 120000 });
  await d.page.waitForTimeout(2000);
  const newText = await bodyText(d);
  check('New lesson shows the English competencies scheduled for that day', newText.includes(`${en['editor.competencies']}:`) && g4Titles.some((t) => newText.includes(t)), newText.split('\n').find((l) => l.startsWith(`${en['editor.competencies']}:`)) ?? 'none');
  await shot(d, 'en-04-new-lesson');
  await d.page.getByRole('button', { name: en['lessons.write'] }).click();
  await d.page.waitForURL(/\/lessons\/(?!new|combine)[^/]+$/, { timeout: 60000 });
  const planId = decodeURIComponent(new URL(d.page.url()).pathname.split('/').pop());
  await d.page.waitForTimeout(2500);
  const before = await serverPlan(planId).catch(() => null);
  const startIds = Object.values(before?.competencies ?? {}).flat();
  const editorText = await bodyText(d);
  const firstStart = termComps('4', 'english').find((c) => startIds.includes(c.id));
  check('the lesson opens in the editor with that English competency, its full wording under its topic', Boolean(firstStart) && has(editorText, firstStart.text) && !rawIdPattern.test(editorText), firstStart ? `${firstStart.shortTitle}: ${firstStart.text.slice(0, 90)}` : `ids ${startIds.join(',')}`);
  await shot(d, 'en-05-editor');

  // 4. The picker: this term's English competencies, word filter, term filter, standards and source.
  await d.page.getByRole('button', { name: en['editor.pickCompetency'], exact: true }).first().click();
  const sheet = d.page.locator('dialog[open]');
  await sheet.locator('[data-competency]').first().waitFor({ timeout: 30000 });
  const listed = await sheet.locator('[data-competency]').count();
  check('the picker lists this term’s Grade 4 English competencies, all of them', listed === termComps('4', 'english').length, `${listed} listed, ${termComps('4', 'english').length} in term ${term.index}`);
  // A word that narrows the list (from the term's own wording).
  const words = {};
  for (const c of termComps('4', 'english')) for (const w of new Set(c.text.toLowerCase().match(/[a-z]{5,}/g) ?? [])) words[w] = (words[w] ?? 0) + 1;
  const word = Object.entries(words).filter(([, k]) => k >= 2 && k <= Math.max(2, Math.floor(termComps('4', 'english').length / 3))).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'words';
  const wantWord = termComps('4', 'english').filter((c) => `${c.code ?? ''} ${c.text}`.toLowerCase().includes(word)).length;
  await sheet.getByLabel(en['common.search']).fill(word);
  await d.page.waitForTimeout(500);
  const afterWord = await sheet.locator('[data-competency]').count();
  check(`the picker’s search narrows the list to the competencies with that word ("${word}")`, afterWord === wantWord && afterWord < listed, `${afterWord} of ${listed}`);
  await shot(d, 'en-06-picker-search');
  await sheet.getByLabel(en['common.search']).fill('');
  await sheet.getByText(new RegExp(`^${en['lessons.all']} \\(`)).click();
  await d.page.waitForTimeout(800);
  const allTerms = await sheet.locator('[data-competency]').count();
  check('"All" terms shows the whole Grade 4 English pack', allTerms === packs['english:4'].competencies.length, `${allTerms} of ${packs['english:4'].competencies.length}`);
  await sheet.getByText(new RegExp(`^${en['lessons.all']} \\(`)).click();
  await d.page.waitForTimeout(500);
  const target = termComps('4', 'english').find((c) => !startIds.includes(c.id));
  const item = sheet.locator(`[data-competency="${target.id}"]`);
  await item.locator('[data-competency-standards] summary').click();
  const cs = ((await item.locator('[data-content-standard]').textContent()) ?? '').replace(/\s+/g, ' ');
  const ps = (await item.locator('[data-performance-standard]').count()) ? ((await item.locator('[data-performance-standard]').textContent()) ?? '').replace(/\s+/g, ' ') : '';
  const src = ((await item.locator('[data-competency-source]').textContent()) ?? '').replace(/\s+/g, ' ');
  const href = await item.locator('[data-competency-source] a').getAttribute('href');
  const norm = (x) => (x ?? '').replace(/\s+/g, ' ').trim();
  check('a competency’s content and performance standards are shown word for word from the pack', cs.includes(norm(target.contentStandard)) && (!target.performanceStandard || ps.includes(norm(target.performanceStandard))), `${cs.slice(0, 120)} …`);
  check('its source is shown: the DepEd document, its edition and page, linked to the published file', src.includes(target.source.document) && src.includes(target.source.edition) && src.includes(`page ${target.source.page}`) && href === target.source.url, src);
  await shot(d, 'en-07-picker-standards');
  await item.locator('input[type=checkbox]').check();
  await sheet.getByRole('button', { name: en['common.save'] }).click();
  await d.page.waitForTimeout(3000);
  await d.page.reload({ waitUntil: 'networkidle', timeout: 120000 });
  await d.page.waitForTimeout(2500);
  const kept = await bodyText(d);
  check('after a reload the lesson has her added competency, shown with its wording', has(kept, target.text) && !rawIdPattern.test(kept), target.shortTitle);
  let onServer = null;
  for (let i = 0; i < 12 && !onServer; i++) {
    const p = await serverPlan(planId);
    if (Object.values(p?.competencies ?? {}).flat().includes(target.id)) onServer = p;
    else await d.page.waitForTimeout(1500);
  }
  check('her choice is on the server (and reaches another device)', Boolean(onServer), onServer ? Object.values(onServer.competencies).flat().join(', ') : 'not yet');
  expected.plans.g4 = { planId, competencies: Object.values(onServer?.competencies ?? {}).flat(), texts: termComps('4', 'english').filter((c) => Object.values(onServer?.competencies ?? {}).flat().includes(c.id)).map((c) => ({ text: c.text, document: c.source.document, edition: c.source.edition, page: c.source.page })) };

  // 5. Print and Word carry the competency and where it is printed.
  const a4 = await printPdf(d, planId, 'a4', null, 'g4-english-a4.pdf');
  // The single-grade lesson print lists each competency's wording (source references are printed by the multi-grade
  // table layout only, as for Science).
  const flat = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
  const a4Text = flat(a4.html);
  check('the print page (A4) lists the lesson’s English competencies word for word under its learning area', a4Text.includes('Learning area') && a4Text.includes('English') && expected.plans.g4.texts.every((x) => a4Text.includes(x.text.replace(/\s+/g, ' '))), `${expected.plans.g4.texts.length} competencies`);
  await shot(d, 'en-08-print');
  const w4 = await wordFile(d, planId, 'g4-english.docx');
  check('Download as Word gives a .docx made on the device', /\.docx$/.test(w4.name), w4.name);
  expected.files.g4 = { pdf: a4.path, docx: w4.path };

  // 6. Multi-grade: Grade 1 Reading and Literacy with Grades 2 and 3 English, all grades together.
  await d.page.goto(`${base}/lessons/combine?classId=${mg.id}&date=${walkDate}`, { waitUntil: 'networkidle', timeout: 120000 });
  await d.page.locator('[data-mg-screen]').waitFor({ timeout: 60000 });
  await d.page.locator('[data-mg-subject]').selectOption('');
  await d.page.waitForFunction(() => [...document.querySelectorAll('[data-mg-pick]')].filter((e) => e.value).length === 3, null, { timeout: 30000 }).catch(() => {});
  const picks = await d.page.locator('[data-mg-pick]').evaluateAll((els) => els.map((e) => ({ group: e.getAttribute('data-mg-pick'), value: e.value })));
  const want = { [mg1.id]: seeded['1'].planId, [mg2.id]: seeded['2'].planId, [mg3.id]: seeded['3'].planId };
  check('"All grades together": each grade’s own lesson of the day is chosen (Grade 1 Reading and Literacy, Grades 2–3 English)', picks.length === 3 && picks.every((p) => p.value === want[p.group]), JSON.stringify(picks));
  await shot(d, 'en-09-combine');
  await d.page.locator('[data-mg-make]').click();
  await d.page.waitForURL(/\/lessons\/(?!combine|new)[^/]+$/, { timeout: 60000 });
  const mgPlanId = decodeURIComponent(new URL(d.page.url()).pathname.split('/').pop());
  await d.page.getByLabel(en['editor.sessionNote']).waitFor({ timeout: 60000 });
  await d.page.waitForTimeout(2500);
  const mgText = await bodyText(d);
  const allSeeded = [...seeded['1'].comps, ...seeded['2'].comps, ...seeded['3'].comps];
  check('one combined plan: a turn with the teacher for each of the three grades', ['Grade 1 with the teacher', 'Grade 2 with the teacher', 'Grade 3 with the teacher'].every((w) => mgText.includes(w)));
  check('the combined plan shows every grade’s competencies by their wording, never by id', allSeeded.every((c) => has(mgText, c.text)) && !rawIdPattern.test(mgText), `${allSeeded.filter((c) => has(mgText, c.text)).length} of ${allSeeded.length} shown; ids shown: ${rawIdPattern.test(mgText)}`);
  await shot(d, 'en-10-combined-editor');
  await shot(d, 'en-10b-combined-editor-whole', true);
  const mgLong = await printPdf(d, mgPlanId, 'long', 'table', 'mg-english-long.pdf');
  const refs = [`${seeded['1'].comps[0].source.document} (${seeded['1'].comps[0].source.edition}), p. ${seeded['1'].comps[0].source.page}`, `${seeded['2'].comps[0].source.document} (${seeded['2'].comps[0].source.edition}), p.`, `${seeded['3'].comps[0].source.document} (${seeded['3'].comps[0].source.edition}), p.`];
  const mgFlat = flat(mgLong.html);
  check('the combined print (long bond, table) carries each grade’s competencies and their sources', refs.every((r) => mgFlat.includes(r)) && allSeeded.every((c) => mgFlat.includes(c.text.replace(/\s+/g, ' '))) && !rawIdPattern.test(mgLong.html), refs.filter((r) => !mgFlat.includes(r)).join(' | ') || 'all three sources and all six competencies');
  await shot(d, 'en-11-combined-print');
  const wmg = await wordFile(d, mgPlanId, 'mg-english.docx');
  check('the combined plan downloads as Word', /\.docx$/.test(wmg.name), wmg.name);
  const mgServer = await serverPlan(mgPlanId);
  check('the combined plan on the server keeps each grade’s competencies', [mg1.id, mg2.id, mg3.id].every((g) => (mgServer?.competencies?.[g] ?? []).length === 2), JSON.stringify(Object.fromEntries(Object.entries(mgServer?.competencies ?? {}).map(([k, v]) => [k.slice(-4), v.length]))));
  expected.files.mg = { pdf: mgLong.path, docx: wmg.path };
  expected.plans.mg = { planId: mgPlanId, texts: allSeeded.map((c) => ({ grade: c.grade, text: c.text, document: c.source.document, edition: c.source.edition, page: c.source.page })) };

  // 6b. A Science lesson still shows its competencies by their wording.
  await d.page.goto(`${base}/lessons/${seeded.science.planId}`, { waitUntil: 'networkidle', timeout: 120000 });
  await d.page.waitForTimeout(2500);
  const sciText = await bodyText(d);
  check('a Science lesson shows its Science competencies by their wording (not ids)', seeded.science.comps.every((c) => has(sciText, c.text)) && !/science-bow-2026\.science\.g\d+\.t\d\.\d+/.test(sciText), seeded.science.comps.map((c) => c.shortTitle).join(' | '));
  await shot(d, 'en-11b-science-lesson');
  if (!local) {
    await d.page.goto(base + '/library', { waitUntil: 'networkidle', timeout: 120000 });
    await d.page.waitForTimeout(1500);
    const sciPacks = await d.page.locator('a[href^="/library/sci26-"]').count();
    await d.page.goto(base + '/library?subject=mathematics', { waitUntil: 'networkidle', timeout: 120000 });
    await d.page.waitForTimeout(1500);
    const mathPacks = await d.page.locator('a[href^="/library/math26-"]').count();
    check('the Library still has its Science weeks and its Mathematics weeks', sciPacks > 0 && mathPacks > 0, `Science links ${sciPacks}, Mathematics links ${mathPacks}`);
    await shot(d, 'en-12b-library-math');
  }

  // 7. Library: no English packs are claimed. Community: English is a subject to filter by.
  await d.page.goto(base + '/library', { waitUntil: 'networkidle', timeout: 120000 });
  await d.page.waitForTimeout(1500);
  const libText = await bodyText(d);
  const subjectButtons = await d.page.locator('main').getByRole('radio').allTextContents().catch(() => []);
  check('the Library offers no English teaching packs (none exist yet)', !subjectButtons.some((x) => /english/i.test(x)) && !/\bEnglish\b.*\b(week|pack)/i.test(libText.split('\n').slice(0, 12).join(' ')), subjectButtons.join(' | ') || 'no subject switch');
  await shot(d, 'en-12-library');
  await d.page.goto(base + '/community', { waitUntil: 'networkidle', timeout: 120000 });
  await d.page.waitForTimeout(1500);
  await d.page.getByRole('button', { name: new RegExp(`^${en['com.filters']}`) }).first().click();
  await d.page.waitForTimeout(500);
  const comSubject = d.page.getByLabel(en['com.subject'], { exact: true });
  const comOptions = (await comSubject.count()) ? await comSubject.locator('option').allTextContents() : [];
  check('Community can filter shared lessons by English and by Reading and Literacy', comOptions.includes('English') && comOptions.includes('Reading and Literacy'), comOptions.join(' | '));
  if (comOptions.includes('English')) {
    await comSubject.selectOption({ label: 'English' });
    await d.page.waitForTimeout(2000);
  }
  await shot(d, 'en-13-community-english');
  await d.ctx.close();

  // 8. Filipino screens and the phone.
  const f = await open('desktop', 'fil');
  await f.page.goto(`${base}/lessons/${planId}`, { waitUntil: 'networkidle', timeout: 120000 });
  await f.page.getByRole('button', { name: fil['editor.pickCompetency'], exact: true }).first().click();
  const fsheet = f.page.locator('dialog[open]');
  await fsheet.locator('[data-competency]').first().waitFor({ timeout: 30000 });
  const fitem = fsheet.locator(`[data-competency="${target.id}"]`);
  await fitem.locator('[data-competency-standards] summary').click();
  const fText = (await fitem.innerText()).replace(/\s+/g, ' ');
  check('on the Filipino screen the picker’s line reads in the Filipino owner’s wording (“Mga standard at sanggunian”, “Sanggunian”) and the competency keeps its official English wording', fText.includes(fil['editor.standards']) && fText.includes(fil['editor.contentStandard']) && fText.includes(fil['editor.source']) && has(fText, target.text), fText.slice(0, 160));
  await shot(f, 'en-14-picker');
  await f.ctx.close();
  const p = await open('phone', 'en');
  await p.page.goto(`${base}/lessons/${planId}`, { waitUntil: 'networkidle', timeout: 120000 });
  await p.page.getByRole('button', { name: en['editor.pickCompetency'], exact: true }).first().click();
  const psheet = p.page.locator('dialog[open]');
  await psheet.locator('[data-competency]').first().waitFor({ timeout: 30000 });
  await psheet.locator(`[data-competency="${target.id}"] [data-competency-standards] summary`).click();
  await shot(p, 'en-15-picker');
  check('on a phone the picker and its standards open', (await psheet.locator(`[data-competency="${target.id}"] [data-content-standard]`).count()) === 1);
  await p.ctx.close();
} catch (e) {
  check('the walk ran to the end', false, String(e?.stack ?? e).slice(0, 380));
}
await browser.close();
check('no errors in the browser and no server errors', errors.length === 0, errors.slice(0, 4).join(' | '));
const failed = results.filter((r) => !r.ok);
writeFileSync(join(out, 'english-walk.json'), JSON.stringify({ base, local, walkDate, checks: results.length, failed: failed.length, results, shots, expected, seeded: { g4: g4.id, mg: mg.id } }, null, 1));
console.log(`\n${results.length - failed.length}/${results.length} checks passed; ${shots.length} screenshots in ${out}`);
process.exit(failed.length ? 1 : 0);
