// Saturday and Sunday classes walk (Luis, 27 Nov 2026, item 4: "Saturday and Sunday classes need to be supported …
// just make it selectable and then just do a best-guess on what they would need to cover on that day").
//
// Two synthetic local teachers, registered and verified through the mail outbox of the local database:
//   - Teacher S sets up "Grade 6 – Narra (weekend classes, synthetic test)" IN THE BROWSER: Science on Saturday and
//     Sunday only, English on Monday, Wednesday and Saturday. Then: the days are saved (server, after a reload); the
//     class screen keeps them and adds Sunday to English; This Week shows the weekend classes with topics, labelled as
//     Tala's suggestion, Saturday as Up next, a Monday-to-Sunday header and the Sunday→Monday turn; a new lesson for
//     Saturday starts with that day's competencies; a DLL for English lays out its own days.
//   - Teacher W has only "Grade 4 – Sampaguita (weekday-only, synthetic test)", Science Monday to Friday, seeded through
//     the sync engine: This Week is Monday to Friday with no weekend rows and no suggestion label.
// Screenshots at phone (390×844) and desktop (1366×900), English and Filipino.
//
//   tsx scripts/weekend-walk.mjs http://127.0.0.1:PORT <outDir> --db <TALA_DB_PATH>
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const [base, out] = argv;
const dbPath = argv.includes('--db') ? argv[argv.indexOf('--db') + 1] : '';
if (!base || !out || !dbPath) throw new Error('usage: weekend-walk.mjs <baseUrl> <outDir> --db <path>');
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error('this walk creates accounts: local servers only');
const { createTalaClient } = await import('@hiraia/tala-core/contracts');
const { createSyncEngine, createMemoryStore } = await import('@hiraia/tala-core/sync');
const { en } = await import('../src/i18n/en.ts');
const { fil } = await import('../src/i18n/fil.ts');
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright-core');
mkdirSync(out, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 500) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${String(detail).slice(0, 240)}` : ''}`);
};
const stamp = Date.now().toString(36);
let n = 0;
const newId = () => `wkd-${stamp}-${(++n).toString(36).padStart(4, '0')}`;
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); // Manila date
const addDays = (iso, k) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
};
const weekdayOf = (iso) => ((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
const mondayOf = (iso) => addDays(iso, 1 - weekdayOf(iso));
const monday = mondayOf(today);
const saturday = addDays(monday, 5);
const sunday = addDays(monday, 6);
const nextMonday = addDays(monday, 7);
const fmt = (iso, opts, locale = 'en-PH') => new Intl.DateTimeFormat(locale, opts).format(new Date(`${iso}T12:00:00Z`));
const short = (iso, locale) => fmt(iso, { day: 'numeric', month: 'short' }, locale);
const long = (iso, locale) => fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' }, locale);
if (weekdayOf(today) > 5) throw new Error('run this walk on a weekday: it checks the coming Saturday as "Up next"');

/* ------------------------------------------------ two local teachers, through the real API */
async function teacher(tag, displayName) {
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
  const email = `teacher.weekend.${tag}.${stamp}@example.com`;
  const password = `Tala-wk-${stamp}-${tag}-Aa1!`;
  await client.call('auth.register', { body: { email, password, displayName, uiLanguage: 'en', deviceLabel: `weekend walk seed ${tag}` } });
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare("select vars from core_mail_outbox where to_email=? and template='verify_email' order by rowid desc limit 1").get(email);
  db.close();
  if (row) await client.call('auth.verifyEmail', { body: { token: JSON.parse(row.vars).link.split('#token=')[1] } });
  const engine = createSyncEngine({ store: createMemoryStore(), transport: client.syncTransport, deviceId: `wk-seed-${tag}-${stamp}`, now: () => new Date(), newId });
  for (let k = 0; k < 6; k++) await engine.sync();
  const presets = (await client.call('calendar.presets')).presets;
  const preset = await client.call('calendar.preset', { params: { presetId: presets[0].id } });
  const year = {
    id: newId(), label: `${preset.startDate.slice(0, 4)}-${preset.endDate.slice(0, 4)}`, schoolName: 'Malaya Elementary School (demo)', startDate: preset.startDate, endDate: preset.endDate,
    terms: preset.terms.map((t) => ({ id: newId(), index: t.index, name: t.name, startDate: t.startDate, endDate: t.endDate })),
    teachingWeekdays: [1, 2, 3, 4, 5], presetId: preset.id, presetVersion: preset.version, provisional: preset.provisional,
  };
  await engine.put('school_year', year);
  for (const d of preset.days)
    await engine.put('calendar_day', { id: newId(), schoolYearId: year.id, date: d.date, kind: d.kind, label: d.label, classId: null, minutesOverride: null, source: 'preset', followsWeekday: null, assignmentIds: null });
  await engine.put('profile', { id: 'profile', displayName, uiLanguage: 'en', schoolName: year.schoolName, region: 'Region IV-A', dataSaver: false, activeSchoolYearId: year.id, pacingParams: {} });
  for (let i = 0; i < 20 && (await engine.status()).pending; i++) await engine.sync();
  /** A fresh device: what another phone of hers would see after syncing. */
  const fresh = async () => {
    const e2 = createSyncEngine({ store: createMemoryStore(), transport: client.syncTransport, deviceId: `wk-check-${tag}-${stamp}-${++n}`, now: () => new Date(), newId });
    for (let k = 0; k < 6; k++) await e2.sync();
    return e2;
  };
  return { client, engine, email, password, year, preset, fresh, displayName };
}
const S = await teacher('s', 'Gng. Liza Ramos');
const W = await teacher('w', 'G. Paolo Cruz');
const term = S.year.terms.find((t) => t.startDate <= today && t.endDate >= today);
const offDays = new Set(S.preset.days.map((d) => d.date));
check('two local teachers sign in; the school year has a term this week', Boolean(term), `${S.year.label}; ${today} in ${term?.name ?? 'no term'} (${term?.startDate}–${term?.endDate}); holidays this week: ${[...offDays].filter((d) => d >= monday && d <= sunday).join(', ') || 'none'}`);
const index = await S.client.call('curriculum.index');
const packMeta = (grade, area) => index.packs.find((p) => p.grade === grade && p.learningAreaId === area && p.schoolYears.includes(S.year.label));
const pack = async (grade, area) => (packMeta(grade, area) ? await S.client.call('curriculum.pack', { params: { packId: packMeta(grade, area).packId } }) : null);
const sci6 = await pack('6', 'science');
const eng6 = await pack('6', 'english');
const sci4 = await pack('4', 'science');
check('the curriculum has Grade 6 Science and English and Grade 4 Science', sci6 && eng6 && sci4, `${sci6?.competencies.length} / ${eng6?.competencies.length} / ${sci4?.competencies.length} competencies`);
const textOf = (p) => (id) => p?.competencies.find((c) => c.id === id);

// Teacher W: a weekday-only class, Science Monday to Friday at 07:30 (over by the afternoon), tracks for every term.
const wClass = { id: newId(), schoolYearId: W.year.id, name: 'Grade 4 – Sampaguita (weekday-only, synthetic test)', curriculum: 'deped', gradeGroups: [{ id: newId(), grade: '4', learnerCount: 30 }], languages: ['en'], profile: { materials: ['chalkboard'], textbooks: [], electricity: true, projector: false, printing: true, outdoorSpace: true, notes: '' }, isSample: false, archived: false };
const wSci = { id: newId(), classId: wClass.id, learningAreaId: 'science', subjectName: 'Science', gradeGroupIds: [wClass.gradeGroups[0].id], language: 'en', slots: [1, 2, 3, 4, 5].map((weekday) => ({ id: newId(), weekday, startTime: '07:30', minutes: 50, rotation: null })) };
await W.engine.put('class', wClass);
await W.engine.put('assignment', wSci);
for (const t of W.year.terms)
  await W.engine.put('pacing_track', { id: newId(), classId: wClass.id, assignmentId: wSci.id, gradeGroupId: wClass.gradeGroups[0].id, termId: t.id, curriculumVersion: packMeta('4', 'science')?.curriculumVersion ?? null, startPosition: null, params: {}, overrides: {}, allocation: null });
for (let i = 0; i < 20 && (await W.engine.status()).pending; i++) await W.engine.sync();
check('teacher W’s weekday-only class is on the server', (await W.engine.status()).pending === 0, `${wClass.name}: Science Mon–Fri 07:30`);

/* ------------------------------------------------ the browser */
const VIEW = { desktop: { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 }, phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
async function open(who, view, lang) {
  const ctx = await browser.newContext({ ...VIEW[view], locale: 'en-PH', timezoneId: 'Asia/Manila' });
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
  await page.locator('input[type=email]').fill(who.email);
  await page.locator('input[type=password]').fill(who.password);
  await page.locator('button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 60000 });
  await page.waitForTimeout(2500);
  return { ctx, page, view, lang };
}
const shots = [];
async function shot(s, name, fullPage = false) {
  await s.page.evaluate(() => document.fonts.ready).catch(() => {});
  await s.page.waitForTimeout(400);
  const file = `${name}-${s.view}-${s.lang}.png`;
  await s.page.screenshot({ path: join(out, file), fullPage });
  const overflowX = await s.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  shots.push({ file, overflowX });
  check(`no sideways scrolling: ${file}`, !overflowX);
}
const bodyText = (s) => s.page.evaluate(() => document.body.innerText);
const squash = (x) => String(x).replace(/\s+/g, ' ');
// Kickers and the week header are capitals by CSS, and innerText reads them so.
const sameText = (a, b) => squash(a).toUpperCase().includes(squash(b).toUpperCase());
/** The header names exactly this range (one line on wide screens, two on a phone). */
const rangeIs = (header, from, to) => sameText(`${header} `, `${short(from)} – ${short(to)} `);
const go = async (s, path) => {
  await s.page.goto(base + path, { waitUntil: 'networkidle', timeout: 120000 });
  await s.page.waitForTimeout(2500);
};
/** Wait until the day buttons show `days` (the sheet or card has its subject's own days), then return them. */
async function waitPressed(fieldset, days) {
  for (let i = 0; i < 40; i++) {
    if (JSON.stringify(await pressed(fieldset)) === JSON.stringify(days)) return days;
    await new Promise((r) => setTimeout(r, 100));
  }
  return pressed(fieldset);
}
const pressed = async (fieldset) => {
  const days = [];
  const buttons = fieldset.locator('button[aria-pressed]');
  for (let i = 0; i < (await buttons.count()); i++) if ((await buttons.nth(i).getAttribute('aria-pressed')) === 'true') days.push(i + 1);
  return days;
};
const dayFieldsets = (s) => s.page.locator('fieldset').filter({ has: s.page.locator('legend', { hasText: s.lang === 'fil' ? fil['setup.days'] : en['setup.days'] }) });
async function setDays(fieldset, want) {
  for (let d = 1; d <= 7; d++) {
    const b = fieldset.locator('button[aria-pressed]').nth(d - 1); // Monday first, in either language
    const on = (await b.getAttribute('aria-pressed')) === 'true';
    if (on !== want.includes(d)) await b.click();
  }
}
const expected = { today, monday, saturday, sunday, nextMonday };
let sClass = null, sSci = null, sEng = null;

try {
  /* 1. Setup in the browser: Saturday and Sunday are offered and saved. */
  const d = await open(S, 'desktop', 'en');
  await go(d, '/setup');
  await d.page.getByRole('button', { name: en['common.next'], exact: true }).first().click();
  await d.page.getByLabel(en['setup.className']).fill('Grade 6 – Narra (weekend classes, synthetic test)');
  await d.page.getByLabel(en['setup.grade'], { exact: true }).first().selectOption('6');
  await d.page.getByRole('button', { name: en['common.next'], exact: true }).click();
  const addSubject = d.page.getByLabel(en['setup.addSubject']);
  await addSubject.waitFor({ timeout: 15000 });
  for (const label of ['Science', 'English']) {
    await addSubject.selectOption({ label });
    await d.page.getByRole('button', { name: `+ ${en['common.add']}` }).click();
  }
  const sets = dayFieldsets(d);
  const offered = await sets.nth(0).locator('button[aria-pressed]').allTextContents();
  check('Setup offers all seven days, Saturday and Sunday included, and a new subject starts Monday to Friday', offered.length === 7 && offered[5] === 'Sat' && offered[6] === 'Sun' && JSON.stringify(await pressed(sets.nth(0))) === '[1,2,3,4,5]', offered.join(' '));
  await setDays(sets.nth(0), [6, 7]);
  await setDays(sets.nth(1), [1, 3, 6]);
  await d.page.getByLabel(en['setup.startTime']).nth(0).fill('08:00');
  await d.page.getByLabel(en['setup.startTime']).nth(1).fill('10:00');
  const hint = await sets.nth(0).innerText();
  check('choosing Saturday and Sunday shows the weekend note under the days', squash(hint).includes(en['setup.weekendHint']) && JSON.stringify(await pressed(sets.nth(0))) === '[6,7]' && JSON.stringify(await pressed(sets.nth(1))) === '[1,3,6]', squash(hint).slice(0, 200));
  await shot(d, 'w01-setup-days');
  await d.page.getByRole('button', { name: en['common.next'], exact: true }).click();
  await d.page.getByText(en['setup.startingPositions']).waitFor({ timeout: 30000 });
  const startText = await bodyText(d);
  check('Setup proposes where to start for both subjects on a weekend timetable', startText.includes('Science · Grade 6') && startText.includes('English · Grade 6') && (await d.page.locator('select').count()) >= 2, startText.split('\n').filter((l) => /· Grade 6/.test(l)).join(' | '));
  await shot(d, 'w02-setup-start');
  await d.page.getByRole('button', { name: en['setup.finish'] }).click();
  await d.page.waitForURL(/\/week/, { timeout: 60000 });
  await d.page.waitForTimeout(3000);

  // Saved: on the server, as another device sees it after syncing.
  let saved = null;
  for (let i = 0; i < 12 && !saved; i++) {
    const e2 = await S.fresh();
    const classes = (await e2.list('class')).map((r) => r.data).filter((c) => c.name.startsWith('Grade 6 – Narra'));
    const assignments = (await e2.list('assignment')).map((r) => r.data).filter((a) => classes.some((c) => c.id === a.classId));
    const tracks = (await e2.list('pacing_track')).map((r) => r.data).filter((t) => classes.some((c) => c.id === t.classId));
    if (classes.length === 1 && assignments.length === 2 && tracks.length) saved = { cls: classes[0], assignments, tracks };
    else await d.page.waitForTimeout(1500);
  }
  sClass = saved?.cls;
  sSci = saved?.assignments.find((a) => a.subjectName === 'Science');
  sEng = saved?.assignments.find((a) => a.subjectName === 'English');
  const days = (a) => JSON.stringify(a?.slots.map((x) => x.weekday) ?? null);
  check('the days are saved and reach another device: Science Saturday+Sunday, English Mon/Wed/Sat', days(sSci) === '[6,7]' && days(sEng) === '[1,3,6]', `Science ${days(sSci)} at ${sSci?.slots[0]?.startTime}; English ${days(sEng)} at ${sEng?.slots[0]?.startTime}; ${saved?.tracks.length ?? 0} tracks`);
  const yearOnServer = (await (await S.fresh()).get('school_year', S.year.id))?.data;
  check('no school-year record was rewritten: its teaching weekdays are still Monday to Friday', JSON.stringify(yearOnServer?.teachingWeekdays) === '[1,2,3,4,5]', JSON.stringify(yearOnServer?.teachingWeekdays));

  /* 2. This Week: the weekend classes on their dates, Saturday as Up next. */
  await go(d, '/week');
  const header = squash(await d.page.locator('nav p[aria-live]').innerText());
  check('the week header runs Monday to Sunday for a teacher with weekend classes', rangeIs(header, monday, sunday), header);
  const up = d.page.locator('[data-testid=up-next]');
  const upText = squash(await up.innerText());
  check('Up next is tomorrow, Saturday, with both Saturday classes', upText.includes(long(saturday)) && sameText(upText, en['wk.upNext.tomorrow']) && /2 lessons/.test(upText), upText.slice(0, 160));
  const satSci = sSci && saved.tracks.length ? upText.includes('SCIENCE') || upText.includes('Science') : false;
  const topicTitles = await up.locator('h3').allTextContents();
  check('the Saturday lessons show their topics (competencies from the pacing), not "No competency"', topicTitles.length >= 2 && topicTitles.every((t) => t.trim() && !t.includes(en['editor.noCompetency'])) && satSci, topicTitles.join(' | '));
  const notes = await up.locator('[data-testid=weekend-note]').allTextContents();
  check('each Saturday lesson says it is Tala’s suggestion, because DepEd plans its weeks Monday to Friday', notes.length === 2 && notes.every((x) => squash(x) === en['wk.weekend.note'].replace('{weekday}', 'Saturday')), notes[0] ?? 'none');
  const satLinks = await up.locator(`a[href*="/lessons/new"][href*="date=${saturday}"]`).count();
  check('each Saturday lesson offers "Write a plan" for that Saturday', satLinks === 2, `${satLinks} links`);
  await shot(d, 'w03-week-weekend');
  // Sunday is its own day row; open it.
  const sundayRow = d.page.locator('summary', { hasText: long(sunday) });
  await sundayRow.first().click();
  await d.page.waitForTimeout(500);
  const weekText = squash(await bodyText(d));
  writeFileSync(join(out, 'week-s-text.txt'), weekText);
  const sundayNotes = await d.page.locator('details[open] [data-testid=weekend-note]').allTextContents();
  check('Sunday’s Science class is on This Week with its topic and the same label', weekText.includes(long(sunday)) && sundayNotes.some((x) => squash(x) === en['wk.weekend.note'].replace('{weekday}', 'Sunday')), `${sundayNotes.length} note(s) in the open Sunday row`);
  await shot(d, 'w04-week-sunday-open', true);
  // Sunday → Monday: the next week starts on Monday.
  await d.page.getByRole('button', { name: en['week.next'], exact: true }).click();
  await d.page.waitForTimeout(1200);
  const nextHeader = squash(await d.page.locator('nav p[aria-live]').innerText());
  const nextText = squash(await bodyText(d));
  check('"Later" moves from Sunday to the next Monday: the next week is Monday to Sunday with its weekend classes', rangeIs(nextHeader, nextMonday, addDays(nextMonday, 6)) && nextText.includes(long(addDays(nextMonday, 5))) && nextText.includes(long(addDays(nextMonday, 6))), nextHeader);
  await shot(d, 'w05-week-next');
  await d.page.getByRole('button', { name: en['week.prev'], exact: true }).click();
  await d.page.waitForTimeout(800);

  /* 3. A new lesson for Saturday starts with that day's competencies. */
  await go(d, '/week');
  const href = await d.page.locator(`[data-testid=up-next] a[href*="/lessons/new"][href*="assignmentId=${sSci?.id}"]`).first().getAttribute('href');
  await go(d, href);
  const newText = await bodyText(d);
  const compLine = newText.split('\n').find((l) => l.startsWith(`${en['editor.competencies']}:`)) ?? '';
  check('New lesson for Saturday shows that day’s Science competencies, and says they are Tala’s suggestion', compLine.length > 20 && squash(newText).includes(en['wk.weekend.note'].replace('{weekday}', 'Saturday')), compLine.slice(0, 200));
  await shot(d, 'w06-new-lesson-saturday');
  await d.page.getByRole('button', { name: en['lessons.write'] }).click();
  await d.page.waitForURL(/\/lessons\/(?!new|combine)[^/?]+/, { timeout: 60000 });
  const satPlanId = decodeURIComponent(new URL(d.page.url()).pathname.split('/').pop());
  await d.page.waitForTimeout(2500);
  let satPlan = null;
  for (let i = 0; i < 12 && !satPlan; i++) {
    const p = (await (await S.fresh()).get('plan', satPlanId))?.data;
    if (p) satPlan = p;
    else await d.page.waitForTimeout(1500);
  }
  const satIds = Object.values(satPlan?.competencies ?? {}).flat();
  const editorText = squash(await bodyText(d));
  const firstSat = textOf(sci6)(satIds[0]);
  check('the Saturday lesson is saved on Saturday with those competencies, and the editor shows their wording', satPlan?.placements?.[0]?.dates?.join(',') === saturday && satIds.length > 0 && firstSat && editorText.includes(squash(firstSat.text).slice(0, 60)), `${satPlan?.placements?.[0]?.dates?.join(',')}: ${firstSat?.shortTitle ?? satIds.join(',')}`);
  await shot(d, 'w07-editor-saturday');
  // This Week now shows that plan on Saturday.
  await go(d, '/week');
  const upAfter = squash(await d.page.locator('[data-testid=up-next]').innerText());
  check('This Week shows the Saturday Science lesson as a draft plan', upAfter.includes(en['wk.openPlan']) && upAfter.includes(en['week.state.draft']), upAfter.slice(0, 200));

  /* 4. The class screen keeps the days; adding Sunday to English is saved too. */
  await go(d, '/class');
  if (await d.page.getByLabel(en['class.switch']).count()) await d.page.getByLabel(en['class.switch']).selectOption({ label: sClass.name });
  await d.page.waitForTimeout(800);
  await d.page.getByRole('button', { name: /^Science/ }).first().click();
  const sheet = d.page.locator('dialog[open]');
  await sheet.waitFor({ timeout: 15000 });
  const sciDays = await waitPressed(dayFieldsets(d).last(), [6, 7]);
  check('the class screen shows Science on Saturday and Sunday (all seven days offered)', JSON.stringify(sciDays) === '[6,7]' && (await dayFieldsets(d).last().locator('button[aria-pressed]').count()) === 7, JSON.stringify(sciDays));
  await shot(d, 'w08-class-science-days');
  await sheet.getByRole('button', { name: en['common.cancel'] }).click();
  await d.page.waitForTimeout(500);
  await d.page.getByRole('button', { name: /^English/ }).first().click();
  await sheet.waitFor({ timeout: 15000 });
  const engBefore = await pressed(dayFieldsets(d).last()); // read on the first frame the sheet is open
  check('opening English right after Science shows English’s own days at once (Mon/Wed/Sat)', JSON.stringify(engBefore) === '[1,3,6]', JSON.stringify(engBefore));
  await setDays(dayFieldsets(d).last(), [1, 3, 6, 7]);
  await sheet.getByRole('button', { name: en['common.save'] }).click();
  await d.page.waitForTimeout(2500);
  await d.page.reload({ waitUntil: 'networkidle', timeout: 120000 });
  await d.page.waitForTimeout(2500);
  if (await d.page.getByLabel(en['class.switch']).count()) await d.page.getByLabel(en['class.switch']).selectOption({ label: sClass.name });
  await d.page.waitForTimeout(800);
  await d.page.getByRole('button', { name: /^English/ }).first().click();
  await sheet.waitFor({ timeout: 15000 });
  const engDays = await waitPressed(dayFieldsets(d).last(), [1, 3, 6, 7]);
  let engOnServer = null;
  for (let i = 0; i < 12 && !engOnServer; i++) {
    const a = (await (await S.fresh()).get('assignment', sEng.id))?.data;
    if (JSON.stringify(a?.slots.map((x) => x.weekday)) === '[1,3,6,7]') engOnServer = a;
    else await d.page.waitForTimeout(1500);
  }
  check('adding Sunday to English is kept after a reload and on the server; its old periods keep their ids', JSON.stringify(engDays) === '[1,3,6,7]' && engOnServer && [1, 3, 6].every((wd) => engOnServer.slots.find((x) => x.weekday === wd)?.id === sEng.slots.find((x) => x.weekday === wd)?.id), `${JSON.stringify(engDays)}; server ${JSON.stringify(engOnServer?.slots.map((x) => x.weekday))}`);
  await shot(d, 'w09-class-english-days');
  await sheet.getByRole('button', { name: en['common.cancel'] }).click();

  /* 5. This Week after the change: English is on Sunday too. */
  await go(d, '/week');
  await d.page.locator('summary', { hasText: long(sunday) }).first().click();
  await d.page.waitForTimeout(600);
  const sundayOpen = squash(await d.page.locator('details[open]').filter({ has: d.page.locator('summary', { hasText: long(sunday) }) }).innerText());
  check('This Week then shows English on Sunday as well (two Sunday classes)', sundayOpen.includes('2 lessons'), sundayOpen.slice(0, 200));

  /* 6. A DLL for English is laid out on the days English meets: Mon, Wed, Sat, Sun. */
  await go(d, `/lessons/new?classId=${sClass.id}&assignmentId=${sEng.id}&date=${saturday}`);
  await d.page.getByLabel(en['lessons.template']).selectOption({ label: 'Daily Lesson Log (DLL)' });
  await d.page.getByRole('button', { name: en['lessons.write'] }).click();
  await d.page.waitForURL(/\/lessons\/(?!new|combine)[^/?]+/, { timeout: 60000 });
  const dllId = decodeURIComponent(new URL(d.page.url()).pathname.split('/').pop());
  await d.page.waitForTimeout(2500);
  const dllText = squash(await bodyText(d));
  const wantDays = [monday, addDays(monday, 2), saturday, sunday];
  const headings = wantDays.map((x) => `${fmt(x, { weekday: 'long' })} · ${short(x)}`);
  let dll = null;
  for (let i = 0; i < 12 && !dll; i++) {
    const e2 = await S.fresh();
    const p = (await e2.get('plan', dllId))?.data;
    const grid = (await e2.list('plan_section')).map((r) => r.data).find((x) => x.planId === dllId && x.key === 'weekgrid');
    if (p && grid) dll = { p, grid };
    else await d.page.waitForTimeout(1500);
  }
  check('the English DLL lays out Monday, Wednesday, Saturday and Sunday of the week, not Monday to Friday', headings.every((h) => dllText.includes(h)) && !dllText.includes(`${fmt(addDays(monday, 1), { weekday: 'long' })} · ${short(addDays(monday, 1))}`) && JSON.stringify(dll?.grid.content.days.map((x) => x.weekday)) === '[1,3,6,7]', `${headings.filter((h) => dllText.includes(h)).join(' | ')}; server grid ${JSON.stringify(dll?.grid.content.days.map((x) => x.weekday))}`);
  check('…and the DLL is placed on each of those days', JSON.stringify(dll?.p.placements[0]?.dates) === JSON.stringify(wantDays), JSON.stringify(dll?.p.placements[0]?.dates));
  await shot(d, 'w10-dll-weekend', true);
  await d.ctx.close();

  /* 7. Phone screens for teacher S (English) and the Filipino screens. */
  const p = await open(S, 'phone', 'en');
  await go(p, '/week');
  await shot(p, 'w03-week-weekend');
  await p.page.locator('[data-testid=up-next] [data-testid=weekend-note]').first().scrollIntoViewIfNeeded();
  await shot(p, 'w03b-week-weekend-note');
  await go(p, href);
  await shot(p, 'w06-new-lesson-saturday');
  await go(p, '/class');
  if (await p.page.getByLabel(en['class.switch']).count()) await p.page.getByLabel(en['class.switch']).selectOption({ label: sClass.name });
  await p.page.waitForTimeout(800);
  await p.page.getByRole('button', { name: /^English/ }).first().click();
  await p.page.locator('dialog[open]').waitFor({ timeout: 15000 });
  await shot(p, 'w09-class-english-days');
  await go(p, `/lessons/${dllId}`);
  await shot(p, 'w10-dll-weekend');
  await go(p, '/setup?new=class');
  await p.page.getByRole('button', { name: en['class.addClass'], exact: true }).first().click();
  await p.page.getByLabel(en['setup.className']).fill('Setup check, not saved (synthetic test)');
  await p.page.getByRole('button', { name: en['common.next'], exact: true }).click();
  await p.page.getByLabel(en['setup.addSubject']).selectOption('science');
  await p.page.getByRole('button', { name: `+ ${en['common.add']}` }).click();
  await setDays(dayFieldsets(p).first(), [1, 3, 6, 7]);
  await dayFieldsets(p).first().scrollIntoViewIfNeeded();
  await shot(p, 'w01-setup-days');
  await p.ctx.close();

  const f = await open(S, 'phone', 'fil');
  await go(f, '/week');
  const filNotes = await f.page.locator('[data-testid=up-next] [data-testid=weekend-note]').allTextContents();
  check('in Filipino the weekend note reads in Filipino with the day’s name ("Sabado")', filNotes.length === 2 && squash(filNotes[0]) === fil['wk.weekend.note'].replace('{weekday}', 'Sabado'), filNotes[0] ?? 'none');
  await f.page.locator('[data-testid=up-next] [data-testid=weekend-note]').first().scrollIntoViewIfNeeded();
  await shot(f, 'w11-week-weekend-note');
  await go(f, '/setup?new=class');
  await f.page.getByRole('button', { name: fil['class.addClass'], exact: true }).first().click();
  await f.page.getByLabel(fil['setup.className']).fill('Setup check, not saved (synthetic test)');
  await f.page.getByRole('button', { name: fil['common.next'], exact: true }).click();
  await f.page.getByLabel(fil['setup.addSubject']).selectOption('science');
  await f.page.getByRole('button', { name: `+ ${fil['common.add']}` }).click();
  const filDays = await dayFieldsets(f).first().locator('button[aria-pressed]').allTextContents();
  await setDays(dayFieldsets(f).first(), [6, 7]);
  const filHint = squash(await dayFieldsets(f).first().innerText());
  check('the Filipino day picker reads Lun … Sab, Lin and shows the Filipino weekend note', filDays.join(' ') === 'Lun Mar Miy Huw Biy Sab Lin' && filHint.includes(fil['setup.weekendHint']), filDays.join(' '));
  await dayFieldsets(f).first().scrollIntoViewIfNeeded();
  await shot(f, 'w12-setup-days');
  await f.ctx.close();

  /* 8. Teacher W: weekday-only, unchanged. */
  for (const view of ['desktop', 'phone']) {
    const w = await open(W, view, 'en');
    await go(w, '/week');
    const wHeader = squash(await w.page.locator('nav p[aria-live]').innerText());
    const wText = squash(await bodyText(w));
    const wNotes = await w.page.locator('[data-testid=weekend-note]').count();
    const homeMonday = weekdayOf(today) === 5 ? nextMonday : monday; // Friday afternoon: Up next is next week
    // The first school day of that week that is not a holiday in the calendar preset (30 Nov is Bonifacio Day).
    const firstClassDay = [0, 1, 2, 3, 4].map((k) => addDays(homeMonday, k)).find((x) => !offDays.has(x));
    if (view === 'desktop') writeFileSync(join(out, 'week-w-text.txt'), wText);
    check(`weekday-only teacher (${view}): the header is Monday to Friday, no weekend day and no suggestion label`, rangeIs(wHeader, homeMonday, addDays(homeMonday, 4)) && !wText.includes(long(addDays(homeMonday, 5))) && !wText.includes(long(addDays(homeMonday, 6))) && wNotes === 0, wHeader);
    if (view === 'desktop') {
      const upW = squash(await w.page.locator('[data-testid=up-next]').innerText());
      check('weekday-only teacher: Up next rolls past the weekend (and any holiday) to the next school day', upW.includes(long(firstClassDay)), `${firstClassDay}: ${upW.slice(0, 120)}`);
      await w.page.getByRole('button', { name: en['week.prev'], exact: true }).click();
      await w.page.waitForTimeout(1200);
      const prevHeader = squash(await w.page.locator('nav p[aria-live]').innerText());
      const prevText = squash(await bodyText(w));
      check('weekday-only teacher: this week is Monday to Friday too, with no Saturday or Sunday lesson', rangeIs(prevHeader, monday, addDays(monday, 4)) && !prevText.includes(long(saturday)) && !prevText.includes(long(sunday)), prevHeader);
    }
    await shot(w, 'w13-weekday-teacher-week');
    await w.ctx.close();
  }
} catch (e) {
  check('the walk ran to the end', false, String(e?.stack ?? e).slice(0, 480));
}
await browser.close();
check('no errors in the browser and no server errors', errors.length === 0, errors.slice(0, 4).join(' | '));
const failed = results.filter((r) => !r.ok);
writeFileSync(join(out, 'weekend-walk.json'), JSON.stringify({ base, today, checks: results.length, failed: failed.length, results, shots, expected, seeded: { s: { class: sClass?.id, science: sSci?.id, english: sEng?.id }, w: { class: wClass.id } } }, null, 1));
console.log(`\n${results.length - failed.length}/${results.length} checks passed; ${shots.length} screenshots in ${out}`);
process.exit(failed.length ? 1 : 0);
