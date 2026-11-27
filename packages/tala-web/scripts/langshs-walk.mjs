// Grade 1 Language + Senior High Effective Communication walk (release owner, 26 Nov 2026): the two curriculum packs
// released in tala-v1-demo.18, in Tala's teacher views, in a real browser, signed in. (Header below: the English walk's
// helpers, reused; the seed and the checks are this release's.)
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
if (!base || !out) throw new Error('usage: langshs-walk.mjs <baseUrl> <outDir> [--local --db <path>]');
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
const newId = () => `lsw-${stamp}-${(++n).toString(36).padStart(4, '0')}`;
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
  email = `teacher.langshs.${stamp}@example.com`;
  password = `Tala-ls-${stamp}-Aa1!`;
  await client.call('auth.register', { body: { email, password, displayName: 'Gng. Rosa Dizon', uiLanguage: 'en', deviceLabel: 'language-shs walk seed' } });
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare("select vars from core_mail_outbox where to_email=? and template='verify_email' order by rowid desc limit 1").get(email);
  db.close();
  if (row) await client.call('auth.verifyEmail', { body: { token: JSON.parse(row.vars).link.split('#token=')[1] } });
}
if (!email || !password) throw new Error('TALA_TEST_EMAIL and TALA_TEST_PASSWORD are needed');
if (!local) await client.call('auth.login', { body: { email, password, deviceLabel: 'release owner Language/SHS check' } });
const engine = createSyncEngine({ store: createMemoryStore(), transport: client.syncTransport, deviceId: `ls-seed-${stamp}`, now: () => new Date(), newId });
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
const gradesOf = (id) => JSON.stringify(areaOf[id]?.grades ?? null);
check('the curriculum lists Language for Grade 1 and Effective Communication for Grade 11 (senior high core), beside English, Reading and Literacy and Science',
  gradesOf('language') === '["1"]' && JSON.stringify(areaOf.language?.stages) === '["elementary"]' && areaOf.language?.name?.en === 'Language'
  && gradesOf('shs-effective-communication') === '["11"]' && JSON.stringify(areaOf['shs-effective-communication']?.stages) === '["shs_core"]' && areaOf['shs-effective-communication']?.name?.en === 'Effective Communication'
  && gradesOf('english') === JSON.stringify(['2', '3', '4', '5', '6', '7', '8', '9', '10']) && gradesOf('reading-and-literacy') === '["1"]' && gradesOf('science') === JSON.stringify(['3', '4', '5', '6', '7', '8', '9', '10']),
  index.learningAreas.map((a) => `${a.name.en}: ${a.grades.join(',')}`).join(' | '));
const sourced = [...new Set(index.packs.filter((p) => !p.curriculumVersion.startsWith('fixture-')).map((p) => p.learningAreaId))].sort();
check('no other held area came with them: the sourced areas are exactly English, Language, Reading and Literacy, Science, Effective Communication', JSON.stringify(sourced) === JSON.stringify(['english', 'language', 'reading-and-literacy', 'science', 'shs-effective-communication']), `${sourced.join(', ')}${index.learningAreas.length > sourced.length ? ` (+ ${index.learningAreas.length - sourced.length} sample-data area(s) on a developer server)` : ''}`);
const packMeta = (grade, area) => index.packs.find((p) => p.grade === grade && p.learningAreaId === area && p.schoolYears.includes(year.label));
const packs = {};
for (const [grade, area] of [['1', 'language'], ['1', 'reading-and-literacy'], ['11', 'shs-effective-communication'], ['2', 'english']]) {
  const meta = packMeta(grade, area);
  packs[`${area}:${grade}`] = meta ? await client.call('curriculum.pack', { params: { packId: meta.packId } }) : null;
}
const L = packs['language:1'], EC = packs['shs-effective-communication:11'];
const termComps = (grade, area) => (packs[`${area}:${grade}`]?.competencies ?? []).filter((c) => c.termIndex === term.index).sort((a, b) => a.sequence - b.sequence);
const byTerm = (p) => [1, 2, 3].map((t) => p?.competencies.filter((c) => c.termIndex === t).length ?? 0).join('/');
check('the two packs are served whole: Language G1 141 (46/46/49), Effective Communication G11 44 (20/14/10)', L?.competencies.length === 141 && byTerm(L) === '46/46/49' && EC?.competencies.length === 44 && byTerm(EC) === '20/14/10', `Language ${L?.competencies.length} (${byTerm(L)}); Effective Communication ${EC?.competencies.length} (${byTerm(EC)}); this term (${term.index}): ${termComps('1', 'language').length} and ${termComps('11', 'shs-effective-communication').length}`);
const docs = [L, EC].map((p) => p?.sourceDocuments?.[0]);
check('each pack names its DepEd source: the document, edition, pages, link and SHA-256 of the archived file', docs[0]?.sha256?.startsWith('24157544ae0c') && docs[0]?.edition === '2026-04-23' && docs[1]?.sha256?.startsWith('c0837f6b40f4') && docs[1]?.edition === '2026-04-17' && [L, EC].every((p) => p.competencies.every((c) => c.source.page && c.source.url === p.sourceDocuments[0].url && c.source.sha256 === p.sourceDocuments[0].sha256 && c.contentStandard && c.code == null)), docs.map((d) => `${d?.title} (${d?.edition}, ${d?.pages} pp, ${d?.sha256?.slice(0, 12)})`).join(' · '));

const room = (name, grades) => ({
  id: newId(), schoolYearId: year.id, name, curriculum: 'deped', gradeGroups: grades.map((grade) => ({ id: newId(), grade, learnerCount: 12 })), languages: ['en'],
  profile: { materials: ['chalkboard', 'manila paper'], textbooks: [], electricity: true, projector: false, printing: true, outdoorSpace: true, notes: '' }, isSample: false, archived: false,
});
const subject = (cls, learningAreaId, subjectName, groupIds, startTime, minutes) => ({
  id: newId(), classId: cls.id, learningAreaId, subjectName, gradeGroupIds: groupIds, language: 'en',
  slots: [1, 2, 3, 4, 5].map((weekday) => ({ id: newId(), weekday, startTime, minutes, rotation: null })),
});
const g1 = room('Grade 1 – Sampaguita (Language, Reading and Literacy; synthetic test)', ['1']);
const g11 = room('Grade 11 – Mabini (Effective Communication; synthetic test)', ['11']);
const g1Language = subject(g1, 'language', 'Language', [g1.gradeGroups[0].id], '07:30', 40);
const g1Reading = subject(g1, 'reading-and-literacy', 'Reading and Literacy', [g1.gradeGroups[0].id], '08:30', 40);
const g11Ec = subject(g11, 'shs-effective-communication', 'Effective Communication', [g11.gradeGroups[0].id], '10:00', 60);
for (const r of [g1, g11]) await engine.put('class', r);
for (const a of [g1Language, g1Reading, g11Ec]) await engine.put('assignment', a);
const tracks = [];
for (const [cls, a] of [[g1, g1Language], [g1, g1Reading], [g11, g11Ec]])
  for (const gid of a.gradeGroupIds) {
    const grade = cls.gradeGroups.find((g) => g.id === gid).grade;
    for (const t of year.terms) tracks.push({ id: newId(), classId: cls.id, assignmentId: a.id, gradeGroupId: gid, termId: t.id, curriculumVersion: packMeta(grade, a.learningAreaId)?.curriculumVersion ?? null, startPosition: null, params: {}, overrides: {}, allocation: null });
  }
for (const tr of tracks) await engine.put('pacing_track', tr);
// A Grade 1 Language lesson for the walk's day, tagged with two of this term's Language competencies.
const seeded = {};
{
  const comps = termComps('1', 'language').slice(0, 2);
  const { plan, sections } = newPlan({ template: defaultTemplateFor(g1, g1Language), cls: g1, assignment: g1Language, dates: [walkDate], language: 'en', competencies: { [g1.gradeGroups[0].id]: comps.map((c) => c.id) }, curriculumVersion: packMeta('1', 'language').curriculumVersion, newId, title: `Grade 1 Language: ${comps[0]?.shortTitle ?? ''} (synthetic test)` });
  await engine.batch([{ op: 'put', entity: 'plan', data: plan }, ...sections.map((s) => ({ op: 'put', entity: 'plan_section', data: s }))]);
  seeded.language = { planId: plan.id, comps };
}
for (let i = 0; i < 20 && (await engine.status()).pending; i++) await engine.sync();
check('seed: a Grade 1 room (Language, Reading and Literacy) and a Grade 11 room (Effective Communication) with tracks and a Grade 1 Language lesson are on the server', (await engine.status()).pending === 0 && tracks.every((t) => t.curriculumVersion), `${tracks.length} tracks (${[...new Set(tracks.map((t) => t.curriculumVersion))].join(', ')}); lesson on ${walkDate}: ${seeded.language.comps.map((c) => c.shortTitle).join(' | ')}`);

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
  await page.waitForTimeout(3000);
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
const rawIdPattern = /\b(language|shs-effective-communication|reading-and-literacy|english)-bow-2026\.[a-z-]+\.g\d+\.t\d\.\d+/;
const serverPlan = async (planId) => {
  const e2 = createSyncEngine({ store: createMemoryStore(), transport: client.syncTransport, deviceId: `ls-check-${stamp}-${++n}`, now: () => new Date(), newId });
  for (let k = 0; k < 6; k++) await e2.sync();
  return (await e2.get('plan', planId))?.data ?? null;
};
async function printPdf(s, planId, paper, file) {
  await s.page.goto(`${base}/lessons/${planId}/print?paper=${paper}`, { waitUntil: 'networkidle', timeout: 120000 });
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
const flat = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&rsquo;|&#8217;/g, '’').replace(/\s+/g, ' ');
const norm = (x) => (x ?? '').replace(/\s+/g, ' ').trim();
const expected = { walkDate, term: term.index, files: {}, plans: {} };
/** Setup, not saved: a class with the given grades, the subjects offered, then the starting positions for `add`. */
async function setupProbe(s, name, grades, add) {
  await s.page.goto(base + '/setup', { waitUntil: 'networkidle', timeout: 120000 });
  await s.page.getByRole('button', { name: new RegExp(`^(${en['common.next']}|${en['class.addClass']})$`) }).first().click();
  await s.page.getByLabel(en['setup.className']).fill(name);
  const gradeSelects = s.page.getByLabel(en['setup.grade'], { exact: true });
  for (let i = 0; i < grades.length; i++) {
    if (i > 0) await s.page.getByRole('button', { name: `+ ${en['setup.addGrade']}` }).click();
    await gradeSelects.nth(i).selectOption(grades[i]);
  }
  await s.page.getByRole('button', { name: en['common.next'], exact: true }).click();
  const addSubject = s.page.getByLabel(en['setup.addSubject']);
  await addSubject.waitFor({ timeout: 15000 });
  const offered = await addSubject.locator('option').allTextContents();
  for (const label of add) {
    await addSubject.selectOption({ label });
    await s.page.getByRole('button', { name: `+ ${en['common.add']}` }).click();
  }
  return { offered, addSubject };
}
async function startOptions(s, label) {
  const sel = s.page.getByLabel(label);
  return (await sel.count()) ? await sel.locator('option').count() : 0;
}
try {
  const d = await open('desktop', 'en');

  // 1. Setup offers Language for Grade 1 and Effective Communication for Grade 11, and starts each from its pack. Nothing is saved.
  try {
    const a = await setupProbe(d, 'Setup check, not saved (synthetic test)', ['1', '2'], ['Language', 'Reading and Literacy', 'English']);
    check('Setup offers Language and Reading and Literacy (and English for Grade 2) for a Grade 1–2 class, not Effective Communication or Science', ['Language', 'Reading and Literacy', 'English'].every((x) => a.offered.includes(x)) && !a.offered.includes('Effective Communication') && !a.offered.includes('Science'), a.offered.join(' | '));
    await shot(d, 'ls-01-setup-subjects-g1');
    await d.page.getByRole('button', { name: en['common.next'], exact: true }).click();
    await d.page.getByText(en['setup.startingPositions']).waitFor({ timeout: 30000 });
    const text = await bodyText(d);
    const l1 = await startOptions(d, 'Language · Grade 1'), r1 = await startOptions(d, 'Reading and Literacy · Grade 1');
    check('Setup proposes where to start from the Language Grade 1 pack (this term’s competencies), beside Reading and Literacy', l1 === termComps('1', 'language').length && r1 === termComps('1', 'reading-and-literacy').length, `Language G1: ${l1} of ${termComps('1', 'language').length}; Reading and Literacy G1: ${r1} of ${termComps('1', 'reading-and-literacy').length}`);
    check('Setup says plainly that Language has no pack for Grade 2', text.includes(`Language · Grade 2: ${en['setup.noPack']}`));
    await shot(d, 'ls-02-setup-starts-g1');
    await d.page.goto(base + '/week', { waitUntil: 'networkidle', timeout: 120000 });
    const b = await setupProbe(d, 'Setup check SHS, not saved (synthetic test)', ['11'], ['Effective Communication']);
    check('Setup offers Effective Communication for a Grade 11 class (and not English, Language or Science)', b.offered.includes('Effective Communication') && !b.offered.includes('English') && !b.offered.includes('Language') && !b.offered.includes('Science'), b.offered.join(' | '));
    await shot(d, 'ls-03-setup-subjects-g11');
    await d.page.getByRole('button', { name: en['common.next'], exact: true }).click();
    await d.page.getByText(en['setup.startingPositions']).waitFor({ timeout: 30000 });
    const e11 = await startOptions(d, 'Effective Communication · Grade 11');
    check('Setup proposes where to start from the Effective Communication Grade 11 pack (this term’s competencies)', e11 === termComps('11', 'shs-effective-communication').length && e11 > 0, `Effective Communication G11: ${e11} of ${termComps('11', 'shs-effective-communication').length}`);
    await shot(d, 'ls-04-setup-starts-g11');
  } catch (e) {
    check('the Setup steps ran', false, String(e?.message ?? e).slice(0, 300));
  }
  await d.page.goto(base + '/week', { waitUntil: 'networkidle', timeout: 120000 }); // leave setup without finishing

  // 2. This Week: the Language and Effective Communication sessions with topics from their packs.
  await d.page.waitForTimeout(2500);
  const weekText = await bodyText(d);
  const lShown = termComps('1', 'language').map((c) => c.shortTitle).filter((t) => t && weekText.includes(t));
  const eShown = termComps('11', 'shs-effective-communication').map((c) => c.shortTitle).filter((t) => t && weekText.includes(t));
  const weekUpper = weekText.toUpperCase().replace(/\s+/g, ' '); // subject lines: capitals by CSS (innerText reads them so), a no-break space before the dot
writeFileSync(join(out, 'week-text.txt'), weekText);
check('This Week lists the Grade 1 Language sessions with topics from the Language pack', weekUpper.includes(`LANGUAGE · ${g1.name.toUpperCase()}`) && lShown.length > 0, `${lShown.length} topic(s), e.g. ${lShown.slice(0, 2).join(' | ')}`);
  check('…and the Grade 11 Effective Communication sessions with topics from its pack', weekUpper.includes(`EFFECTIVE COMMUNICATION · ${g11.name.toUpperCase()}`) && eShown.length > 0, `${eShown.length} topic(s), e.g. ${eShown.slice(0, 2).join(' | ')}`);
  await shot(d, 'ls-05-week');

  // 3. A new Effective Communication lesson starts with the day's competencies from the pacing.
  const ecTerm = termComps('11', 'shs-effective-communication');
  await d.page.goto(`${base}/lessons/new?classId=${g11.id}&assignmentId=${g11Ec.id}&date=${walkDate}`, { waitUntil: 'networkidle', timeout: 120000 });
  await d.page.waitForTimeout(2000);
  const newText = await bodyText(d);
  check('New lesson shows the Effective Communication competencies scheduled for that day', newText.includes(`${en['editor.competencies']}:`) && ecTerm.some((c) => newText.includes(c.shortTitle)), newText.split('\n').find((l) => l.startsWith(`${en['editor.competencies']}:`)) ?? 'none');
  await shot(d, 'ls-06-new-lesson-g11');
  await d.page.getByRole('button', { name: en['lessons.write'] }).click();
  await d.page.waitForURL(/\/lessons\/(?!new|combine)[^/]+$/, { timeout: 60000 });
  const planId = decodeURIComponent(new URL(d.page.url()).pathname.split('/').pop());
  await d.page.waitForTimeout(2500);
  const before = await serverPlan(planId).catch(() => null);
  const startIds = Object.values(before?.competencies ?? {}).flat();
  const editorText = await bodyText(d);
  const firstStart = ecTerm.find((c) => startIds.includes(c.id));
  check('the lesson opens in the editor with that competency’s full wording under its topic (no ids)', Boolean(firstStart) && has(editorText, firstStart.text) && !rawIdPattern.test(editorText), firstStart ? `${firstStart.shortTitle}: ${firstStart.text.slice(0, 90)}` : `ids ${startIds.join(',')}`);
  await shot(d, 'ls-07-editor-g11');

  // 4. The picker: this term's Effective Communication competencies, word filter, all terms, standards and source.
  await d.page.getByRole('button', { name: en['editor.pickCompetency'], exact: true }).first().click();
  const sheet = d.page.locator('dialog[open]');
  await sheet.locator('[data-competency]').first().waitFor({ timeout: 30000 });
  const listed = await sheet.locator('[data-competency]').count();
  check('the picker lists this term’s Grade 11 Effective Communication competencies, all of them', listed === ecTerm.length, `${listed} listed, ${ecTerm.length} in term ${term.index}`);
  const words = {};
  for (const c of ecTerm) for (const w of new Set(c.text.toLowerCase().match(/[a-z]{5,}/g) ?? [])) words[w] = (words[w] ?? 0) + 1;
  const word = Object.entries(words).filter(([, k]) => k >= 2 && k <= Math.max(2, Math.floor(ecTerm.length / 3))).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'communication';
  const wantWord = ecTerm.filter((c) => `${c.code ?? ''} ${c.text}`.toLowerCase().includes(word)).length;
  await sheet.getByLabel(en['common.search'], { exact: true }).fill(word);
  await d.page.waitForTimeout(500);
  const afterWord = await sheet.locator('[data-competency]').count();
  check(`the picker’s search narrows the list to the competencies with that word ("${word}")`, afterWord === wantWord && afterWord < listed, `${afterWord} of ${listed}`);
  await sheet.getByLabel(en['common.search'], { exact: true }).fill('');
  await sheet.getByText(new RegExp(`^${en['lessons.all']} \\(`)).click();
  await d.page.waitForTimeout(800);
  const allTerms = await sheet.locator('[data-competency]').count();
  check('"All" terms shows the whole Effective Communication pack (44)', allTerms === EC.competencies.length && allTerms === 44, `${allTerms} of ${EC.competencies.length}`);
  await sheet.getByText(new RegExp(`^${en['lessons.all']} \\(`)).click();
  await d.page.waitForTimeout(500);
  const target = ecTerm.find((c) => !startIds.includes(c.id));
  const item = sheet.locator(`[data-competency="${target.id}"]`);
  await item.locator('[data-competency-standards] summary').click();
  const cs = norm(await item.locator('[data-content-standard]').textContent());
  const ps = (await item.locator('[data-performance-standard]').count()) ? norm(await item.locator('[data-performance-standard]').textContent()) : '';
  const src = norm(await item.locator('[data-competency-source]').textContent());
  const href = await item.locator('[data-competency-source] a').getAttribute('href');
  check('a competency’s content and performance standards are shown word for word from the pack', cs.includes(norm(target.contentStandard)) && ps.includes(norm(target.performanceStandard)), `${cs.slice(0, 120)} …`);
  check('its source is shown: the DepEd document, its edition and page, linked to the published file', src.includes(target.source.document) && src.includes(target.source.edition) && src.includes(`page ${target.source.page}`) && href === target.source.url, src);
  await shot(d, 'ls-08-picker-standards-g11');
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
  const ecIds = Object.values(onServer?.competencies ?? {}).flat();
  expected.plans.g11 = { planId, texts: EC.competencies.filter((c) => ecIds.includes(c.id)).map((c) => ({ text: c.text, document: c.source.document, edition: c.source.edition, page: c.source.page })) };

  // 5. Print (A4 and long bond) and Word carry the Effective Communication competencies.
  const a4 = await printPdf(d, planId, 'a4', 'g11-effective-communication-a4.pdf');
  const a4Text = flat(a4.html);
  check('the print page (A4) lists the lesson’s Effective Communication competencies word for word under its learning area', a4Text.includes('Learning area') && a4Text.includes('Effective Communication') && expected.plans.g11.texts.length >= 2 && expected.plans.g11.texts.every((x) => a4Text.includes(norm(x.text))), `${expected.plans.g11.texts.length} competencies`);
  await shot(d, 'ls-09-print-g11');
  const long = await printPdf(d, planId, 'long', 'g11-effective-communication-long.pdf');
  check('…and on long bond', expected.plans.g11.texts.every((x) => flat(long.html).includes(norm(x.text))));
  const w11 = await wordFile(d, planId, 'g11-effective-communication.docx');
  check('Download as Word gives a .docx made on the device', /\.docx$/.test(w11.name), w11.name);
  expected.files.g11 = { a4: a4.path, long: long.path, docx: w11.path };

  // 6. The Grade 1 Language lesson: editor, print and Word.
  await d.page.goto(`${base}/lessons/${seeded.language.planId}`, { waitUntil: 'networkidle', timeout: 120000 });
  await d.page.waitForTimeout(2500);
  const lText = await bodyText(d);
  check('the Grade 1 Language lesson shows its Language competencies by their wording (not ids)', seeded.language.comps.length === 2 && seeded.language.comps.every((c) => has(lText, c.text)) && !rawIdPattern.test(lText), seeded.language.comps.map((c) => c.shortTitle).join(' | '));
  await shot(d, 'ls-10-editor-g1-language');
  const la4 = await printPdf(d, seeded.language.planId, 'a4', 'g1-language-a4.pdf');
  check('its print page (A4) lists the Language competencies word for word under “Language”', flat(la4.html).includes('Learning area') && flat(la4.html).includes('Language') && seeded.language.comps.every((c) => flat(la4.html).includes(norm(c.text))));
  const lw = await wordFile(d, seeded.language.planId, 'g1-language.docx');
  check('the Grade 1 Language lesson downloads as Word', /\.docx$/.test(lw.name), lw.name);
  expected.plans.g1 = { planId: seeded.language.planId, texts: seeded.language.comps.map((c) => ({ text: c.text, document: c.source.document, edition: c.source.edition, page: c.source.page })) };
  expected.files.g1 = { a4: la4.path, docx: lw.path };

  // 7. Library: curriculum only, no teaching packs for these subjects; Science and Mathematics weeks still there.
  await d.page.goto(base + '/library', { waitUntil: 'networkidle', timeout: 120000 });
  await d.page.waitForTimeout(1500);
  const subjectButtons = await d.page.locator('main').getByRole('radio').allTextContents().catch(() => []);
  const sciPacks = await d.page.locator('a[href^="/library/sci26-"]').count();
  check('the Library offers no Language or Effective Communication teaching packs (none exist) and still lists its Science weeks', !subjectButtons.some((x) => /language|effective communication/i.test(x)) && (local || sciPacks > 0), `${subjectButtons.join(' | ') || 'no subject switch'} · Science links ${sciPacks}`);
  await shot(d, 'ls-11-library');
  if (!local) {
    await d.page.goto(base + '/library?subject=mathematics', { waitUntil: 'networkidle', timeout: 120000 });
    await d.page.waitForTimeout(1500);
    check('the Library still has its Mathematics weeks', (await d.page.locator('a[href^="/library/math26-"]').count()) > 0);
  }
  await d.page.goto(base + '/community', { waitUntil: 'networkidle', timeout: 120000 });
  await d.page.waitForTimeout(1500);
  await d.page.getByRole('button', { name: new RegExp(`^${en['com.filters']}`) }).first().click();
  await d.page.waitForTimeout(500);
  const comSubject = d.page.getByLabel(en['com.subject'], { exact: true });
  const comOptions = (await comSubject.count()) ? await comSubject.locator('option').allTextContents() : [];
  check('Community can filter shared lessons by Language and by Effective Communication', comOptions.includes('Language') && comOptions.includes('Effective Communication'), comOptions.join(' | '));
  await d.ctx.close();

  // 8. Filipino screen and phone.
  const f = await open('desktop', 'fil');
  await f.page.goto(`${base}/lessons/${planId}`, { waitUntil: 'networkidle', timeout: 120000 });
  await f.page.getByRole('button', { name: fil['editor.pickCompetency'], exact: true }).first().click();
  const fsheet = f.page.locator('dialog[open]');
  await fsheet.locator('[data-competency]').first().waitFor({ timeout: 30000 });
  const fitem = fsheet.locator(`[data-competency="${target.id}"]`);
  await fitem.locator('[data-competency-standards] summary').click();
  const fText = norm(await fitem.innerText());
  check('on the Filipino screen the picker reads in the Filipino owner’s wording and the competency keeps its official English wording', fText.includes(fil['editor.standards']) && fText.includes(fil['editor.contentStandard']) && fText.includes(fil['editor.source']) && has(fText, target.text), fText.slice(0, 160));
  await shot(f, 'ls-12-picker');
  await f.ctx.close();
  const p = await open('phone', 'en');
  await p.page.goto(`${base}/lessons/${planId}`, { waitUntil: 'networkidle', timeout: 120000 });
  await p.page.getByRole('button', { name: en['editor.pickCompetency'], exact: true }).first().click();
  const psheet = p.page.locator('dialog[open]');
  await psheet.locator('[data-competency]').first().waitFor({ timeout: 30000 });
  await psheet.locator(`[data-competency="${target.id}"] [data-competency-standards] summary`).click();
  await shot(p, 'ls-13-picker');
  check('on a phone the picker and its standards open', (await psheet.locator(`[data-competency="${target.id}"] [data-content-standard]`).count()) === 1);
  await p.ctx.close();
} catch (e) {
  check('the walk ran to the end', false, String(e?.stack ?? e).slice(0, 380));
}
await browser.close();
check('no errors in the browser and no server errors', errors.length === 0, errors.slice(0, 4).join(' | '));
const failed = results.filter((r) => !r.ok);
writeFileSync(join(out, 'langshs-walk.json'), JSON.stringify({ base, local, walkDate, checks: results.length, failed: failed.length, results, shots, expected, seeded: { g1: g1.id, g11: g11.id } }, null, 1));
console.log(`\n${results.length - failed.length}/${results.length} checks passed; ${shots.length} screenshots in ${out}`);
process.exit(failed.length ? 1 : 0);
