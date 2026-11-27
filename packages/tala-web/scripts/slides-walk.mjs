// Lesson presentations walk (27 Nov 2026, branch tala-v1-plan-slides): a lesson's slides in the Lesson Plan view,
// AI rewrite with preview / apply / earlier versions, the stale cue, an English lesson with no pack, and multi-grade
// sessions put together in block order. Local production build only; everything invented ("synthetic test").
//
//   tsx scripts/slides-walk.mjs <baseUrl> <outDir> --db <TALA_DB_PATH> --phase seed|science|english|failure|session2|session3|fil
//
// State (account, ids) is kept in <outDir>/walk-state.json between phases, so the failure phase can run against a
// server started with deliberately broken provider keys and the others against the real one.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const [base, out] = argv;
const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : '');
const dbPath = arg('--db');
const phase = arg('--phase') || 'seed';
if (!base || !out || !dbPath) throw new Error('usage: slides-walk.mjs <baseUrl> <outDir> --db <path> --phase <phase>');
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error('this walk is for a local server only');
const { createTalaClient, BUILTIN_TEMPLATES } = await import('@hiraia/tala-core/contracts');
const { createSyncEngine, createMemoryStore } = await import('@hiraia/tala-core/sync');
const { newPlan, defaultTemplateFor } = await import('../src/data/plans.ts');
const { planFromPackDay, weekdaysFrom } = await import('../src/data/pack-plans.ts');
const { en } = await import('../src/i18n/en.ts');
const { fil } = await import('../src/i18n/fil.ts');
const { readZip } = await import('../../tala-server/src/modules/decks/zip.ts');
const { slideParts, xmlUnescape } = await import('../../tala-server/src/modules/decks/pptx-read.ts');
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright-core');
mkdirSync(join(out, 'files'), { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ phase, name, ok: Boolean(ok), detail: String(detail).slice(0, 600) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${String(detail).slice(0, 260)}` : ''}`);
};
const statePath = join(out, 'walk-state.json');
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
const saveState = () => writeFileSync(statePath, JSON.stringify(state, null, 1));
const stamp = state.stamp ?? Date.now().toString(36);
let n = 0;
const newId = () => `slw-${stamp}-${phase.slice(0, 3)}-${(++n).toString(36).padStart(4, '0')}`;
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); // Manila date
const weekdayOf = (iso) => ((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
const addDays = (iso, k) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
};
const walkDate = weekdayOf(today) <= 5 ? today : addDays(today, 8 - weekdayOf(today));
const PACK = 'sci26-g4-t1-w08';

/* ------------------------------------------------ the API, signed in */
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
const p = (text, b) => ({ t: 'p', spans: [{ text, ...(b ? { b: true } : {}) }] });
const labelled = (label, text) => ({ t: 'p', spans: [{ text: `${label}: `, b: true }, { text }] });

/** A hand-written lesson with real parts (objectives, content, materials, steps, assessment), as a teacher writes one. */
function writtenLesson({ cls, assignment, groupId, title, objectives, content, materials, steps, assessment }) {
  const one = { ...assignment, gradeGroupIds: [groupId] };
  const { plan, sections } = newPlan({ template: defaultTemplateFor(cls, one), cls, assignment: one, dates: [walkDate], language: 'en', newId, title });
  const fill = {
    objectives: { type: 'list', items: objectives },
    content: { type: 'text', blocks: content.map((c) => p(c)) },
    materials: { type: 'list', items: materials },
    procedure: { type: 'procedure', steps: steps.map(([t, minutes, teacher, learners]) => ({ id: newId(), title: t, minutes, body: [labelled('Teacher', teacher), labelled('Learners', learners)] })) },
    assessment: { type: 'text', blocks: [p(assessment)] },
  };
  return { plan, sections: sections.map((s) => (fill[s.key] ? { ...s, content: fill[s.key], origin: 'manual', editedByTeacher: true } : s)) };
}

async function signIn() {
  await client.call('auth.login', { body: { email: state.email, password: state.password, deviceLabel: 'slides walk' } });
}
const engineFor = async () => {
  const e = createSyncEngine({ store: createMemoryStore(), transport: client.syncTransport, deviceId: `slw-${stamp}-${phase}-${Math.random().toString(36).slice(2, 6)}`, now: () => new Date(), newId });
  for (let k = 0; k < 8; k++) await e.sync();
  return e;
};
const pushAll = async (engine) => {
  for (let i = 0; i < 20 && (await engine.status()).pending; i++) await engine.sync();
  return (await engine.status()).pending === 0;
};

/* ------------------------------------------------ phase: seed */
async function seed() {
  state.stamp = stamp;
  state.email = `teacher.slides.${stamp}@example.com`;
  state.password = `Tala-sl-${stamp}-Aa1!`;
  await client.call('auth.register', { body: { email: state.email, password: state.password, displayName: 'Gng. Liza Ramos', uiLanguage: 'en', deviceLabel: 'slides walk seed' } });
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare("select vars from core_mail_outbox where to_email=? and template='verify_email' order by rowid desc limit 1").get(state.email);
  db.close();
  if (row) await client.call('auth.verifyEmail', { body: { token: JSON.parse(row.vars).link.split('#token=')[1] } });
  const engine = await engineFor();
  const presets = (await client.call('calendar.presets')).presets;
  const preset = await client.call('calendar.preset', { params: { presetId: presets[0].id } });
  const year = {
    id: newId(), label: `${preset.startDate.slice(0, 4)}-${preset.endDate.slice(0, 4)}`, schoolName: 'Malaya Elementary School (demo)', startDate: preset.startDate, endDate: preset.endDate,
    terms: preset.terms.map((t) => ({ id: newId(), index: t.index, name: t.name, startDate: t.startDate, endDate: t.endDate })),
    teachingWeekdays: [1, 2, 3, 4, 5], presetId: preset.id, presetVersion: preset.version, provisional: preset.provisional,
  };
  await engine.put('school_year', year);
  await engine.put('profile', { id: 'profile', displayName: 'Gng. Liza Ramos', uiLanguage: 'en', schoolName: year.schoolName, region: 'Region IV-A', dataSaver: false, activeSchoolYearId: year.id, pacingParams: {} });
  const room = (name, grades, languages = ['en']) => ({
    id: newId(), schoolYearId: year.id, name, curriculum: 'deped', gradeGroups: grades.map((grade) => ({ id: newId(), grade, learnerCount: 12 })), languages,
    profile: { materials: ['chalkboard', 'manila paper', 'crayons'], textbooks: [], electricity: true, projector: true, printing: true, outdoorSpace: true, notes: '' }, isSample: false, archived: false,
  });
  const subject = (cls, learningAreaId, subjectName, groupIds, startTime, minutes) => ({
    id: newId(), classId: cls.id, learningAreaId, subjectName, gradeGroupIds: groupIds, language: 'en',
    slots: [1, 2, 3, 4, 5].map((weekday) => ({ id: newId(), weekday, startTime, minutes, rotation: null })),
  });
  const g4 = room('Grade 4 – Rizal (Science, synthetic test)', ['4']);
  const mg2 = room('Grades 4 and 5 – Luna (multigrade Science, synthetic test)', ['4', '5']);
  const mg3 = room('Grades 1, 2 and 3 – Bonifacio (multigrade English, synthetic test)', ['1', '2', '3']);
  const g4Sci = subject(g4, 'science', 'Science', [g4.gradeGroups[0].id], '08:00', 50);
  const mg2Sci = subject(mg2, 'science', 'Science', mg2.gradeGroups.map((g) => g.id), '09:00', 60);
  const [m1, m2, m3] = mg3.gradeGroups;
  const mgEnglish = subject(mg3, 'english', 'English', [m2.id, m3.id], '10:00', 60);
  const mgReading = subject(mg3, 'reading-and-literacy', 'Reading and Literacy', [m1.id], '10:00', 60);
  for (const r of [g4, mg2, mg3]) await engine.put('class', r);
  for (const a of [g4Sci, mg2Sci, mgEnglish, mgReading]) await engine.put('assignment', a);

  // The Grade 4 Science week from the Library pack, Monday to Friday (as "Use for my class" adds it).
  const detail = await client.call('packs.detail', { params: { packId: PACK }, query: { lang: 'en' } });
  const dates = weekdaysFrom(walkDate);
  const week = detail.content.days.map((day, i) => planFromPackDay({ pack: detail.content, review: detail.review, day, cls: g4, gradeGroupId: g4.gradeGroups[0].id, assignmentId: g4Sci.id, date: dates[i] ?? null, newId }));
  for (const w of week) await engine.batch([{ op: 'put', entity: 'plan', data: w.plan }, ...w.sections.map((s) => ({ op: 'put', entity: 'plan_section', data: s }))]);
  // Two-grade room: Grade 4's lesson is Day 2 of the same pack; Grade 5's is her own and has no slides.
  const [l4, l5] = mg2.gradeGroups;
  const mg2g4 = planFromPackDay({ pack: detail.content, review: detail.review, day: detail.content.days[1], cls: mg2, gradeGroupId: l4.id, assignmentId: mg2Sci.id, date: walkDate, newId });
  const mg2g5 = writtenLesson({
    cls: mg2, assignment: mg2Sci, groupId: l5.id, title: 'Grade 5 Science: Weather signs around us (synthetic test)',
    objectives: ['Name three signs that a typhoon may be coming.', 'Explain why PAGASA wind signals matter to our family.'],
    content: ['Typhoons bring strong winds and heavy rain. PAGASA raises wind signals 1 to 5 so people can prepare.'],
    materials: ['manila paper', 'crayons'],
    steps: [['Activating prior knowledge', 10, 'Ask who remembers the last typhoon and what the sky looked like.', 'Share one sign they noticed.'], ['Developing and deepening understanding', 30, 'Show the five wind signals and what each means.', 'Draw a poster of what a family does at Signal 2.'], ['Evaluating learning', 10, 'Ask: what does Signal 3 mean?', 'Answer on a half sheet.']],
    assessment: 'Exit ticket: Name two things a family should do when Signal 2 is raised.',
  });
  for (const w of [mg2g4, mg2g5]) await engine.batch([{ op: 'put', entity: 'plan', data: w.plan }, ...w.sections.map((s) => ({ op: 'put', entity: 'plan_section', data: s }))]);
  // Three-grade room: Grade 1 Reading and Literacy, Grades 2 and 3 English, each her own written lesson for the day.
  const r1 = writtenLesson({
    cls: mg3, assignment: mgReading, groupId: m1.id, title: 'Grade 1 Reading: The sound of letter M (synthetic test)',
    objectives: ['Say the /m/ sound.', 'Name three things that begin with the letter M.'],
    content: ['The letter M makes the /m/ sound, as in mango, mat and moon.'],
    materials: ['letter cards', 'crayons'],
    steps: [['Activating prior knowledge', 10, 'Show a mango and ask what it is.', 'Say "mango" and hum the /m/ sound.'], ['Developing and deepening understanding', 35, 'Show letter cards M, m and say /m/.', 'Trace the letter M and draw one thing that starts with M.'], ['Evaluating learning', 15, 'Point to pictures and ask which begin with /m/.', 'Raise a hand for every /m/ word.']],
    assessment: 'Each learner says one word that begins with /m/.',
  });
  const e2 = writtenLesson({
    cls: mg3, assignment: mgEnglish, groupId: m2.id, title: 'Grade 2 English: Naming words (synthetic test)',
    objectives: ['Tell what a naming word (noun) is.', 'Find naming words for people, places and things in a sentence.'],
    content: ['A naming word, or noun, names a person, a place, an animal or a thing: teacher, school, carabao, pencil.'],
    materials: ['word cards', 'manila paper'],
    steps: [['Activating prior knowledge', 10, 'Ask learners to name things they see in the room.', 'Say the names of three things.'], ['Developing and deepening understanding', 35, 'Read sentences and underline the naming words with the class.', 'Sort word cards into people, places and things.'], ['Evaluating learning', 15, 'Write two sentences on the board.', 'Circle the naming words in each sentence.']],
    assessment: 'Circle the naming words: "The farmer feeds the carabao in the field."',
  });
  const e3 = writtenLesson({
    cls: mg3, assignment: mgEnglish, groupId: m3.id, title: 'Grade 3 English: Describing words (synthetic test)',
    objectives: ['Tell what a describing word (adjective) is.', 'Use describing words to tell about a person, place or thing.'],
    content: ['A describing word, or adjective, tells more about a naming word: a tall tree, a red ball, a noisy market.'],
    materials: ['picture cards', 'manila paper'],
    steps: [['Activating prior knowledge', 10, 'Show a picture of a market and ask how it looks and sounds.', 'Give one word about the market.'], ['Developing and deepening understanding', 35, 'Model sentences with describing words.', 'Write three sentences about a picture card using describing words.'], ['Evaluating learning', 15, 'Read a sentence aloud.', 'Name the describing word in it.']],
    assessment: 'Underline the describing word: "The big dog sleeps under the tree."',
  });
  for (const w of [r1, e2, e3]) await engine.batch([{ op: 'put', entity: 'plan', data: w.plan }, ...w.sections.map((s) => ({ op: 'put', entity: 'plan_section', data: s }))]);
  const pushed = await pushAll(engine);
  check('seed: a teacher, a Grade 4 Science week from the pack, a Grade 4–5 room and a Grade 1–3 room (Reading and Literacy + English), all on the server', pushed, `${walkDate}; pack ${PACK}: ${detail.content.title}`);
  state.walkDate = walkDate;
  state.classes = { g4: g4.id, mg2: mg2.id, mg3: mg3.id };
  state.groups = { mg2: mg2.gradeGroups.map((g) => g.id), mg3: mg3.gradeGroups.map((g) => g.id) };
  state.plans = { day2: week[1].plan.id, week: week.map((w) => w.plan.id), mg2g4: mg2g4.plan.id, mg2g5: mg2g5.plan.id, r1: r1.plan.id, e2: e2.plan.id, e3: e3.plan.id };
  state.packTitle = detail.content.title;
  saveState();
}

/* ------------------------------------------------ the browser */
const VIEW = { desktop: { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 }, phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };
let browser;
const errors = [];
async function open(view, lang = 'en') {
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
  await page.locator('input[type=email]').fill(state.email);
  await page.locator('input[type=password]').fill(state.password);
  await page.locator('button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 60000 });
  await page.waitForTimeout(3000);
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
  if (overflowX) check(`no sideways scrolling: ${file}`, false);
}
const goLesson = async (s, planId) => {
  await s.page.goto(`${base}/lessons/${planId}`, { waitUntil: 'networkidle', timeout: 120000 });
  await s.page.locator('[data-presentation-panel]').waitFor({ timeout: 60000 });
  await s.page.waitForTimeout(1500);
};
const panelText = (s) => s.page.locator('[data-presentation-panel]').innerText();
async function download(s, click, file) {
  const [dl] = await Promise.all([s.page.waitForEvent('download', { timeout: 90000 }), click()]);
  const path = join(out, 'files', file);
  await dl.saveAs(path);
  return { path, name: dl.suggestedFilename() };
}
function pptxPages(path) {
  const zip = readZip(new Uint8Array(readFileSync(path)));
  return slideParts(zip).map((part) => (zip.text(part).match(/<a:t>([^<]*)<\/a:t>/g) ?? []).map((x) => xmlUnescape(x.slice(5, -6))).join(' '));
}
const waitProposal = async (s, ms = 180000) => {
  await s.page.locator('[data-ai-proposal], [data-ai-failed]').first().waitFor({ timeout: ms });
  return (await s.page.locator('[data-ai-failed]').count()) ? await s.page.locator('[data-ai-failed]').first().getAttribute('data-ai-failed') : null;
};
const presentation = (planId) => client.call('decks.lesson.get', { params: { planId } });
async function present(s, name) {
  await s.page.locator('[data-present]').first().click();
  await s.page.waitForTimeout(1500);
  await shot(s, name);
  const shown = await s.page.evaluate(() => Boolean(document.fullscreenElement || document.querySelector('dialog[open]')));
  await s.page.keyboard.press('Escape');
  await s.page.waitForTimeout(600);
  return shown;
}

/* ------------------------------------------------ phase: science (a lesson made from a pack) */
async function science() {
  const d = await open('desktop');
  const planId = state.plans.day2;
  await goLesson(d, planId);
  const myTitle = 'Food’s journey in our own words (teacher edit)';
  let pres;
  let target;
  if (state.scienceDeck) {
    // Resumed run: the slides were linked, edited and rewritten with AI in an earlier run (walk-science-*.json).
    pres = await presentation(planId);
    target = pres.slides.slides.find((x) => x.id === state.targetSlide) ?? pres.slides.slides.find((x) => x.kind === 'concept');
  }
  if (!state.scienceDeck) {
  let text = await panelText(d);
  check('the Lesson Plan view opens with the slides panel at the top, offering the pack’s slides', text.includes(en['pp.none.title']) && (await d.page.locator('[data-use-pack]').count()) === 1, text.split('\n').slice(0, 6).join(' | '));
  const panelTop = await d.page.locator('[data-presentation-panel]').boundingBox();
  check('…prominently: within the first screen, above the competencies', panelTop && panelTop.y < 400, `top ${Math.round(panelTop?.y ?? -1)} px`);
  await shot(d, 'a1-pack-offer');
  await d.page.locator('[data-use-pack]').click();
  await d.page.locator('[data-lesson-thumbs]').waitFor({ timeout: 60000 });
  await d.page.waitForTimeout(1500);
  pres = await presentation(planId);
  check('“Use the slides of …” links Day 2 of her own copy: Day 2’s slides and the credits', pres.link?.day === 2 && pres.slides?.slides.every((x) => x.day === 2 || x.kind === 'credits'), `${pres.slides?.slides.length} slides; deck ${pres.slides?.deckId}`);
  text = await panelText(d);
  check('the cue says to make the slides match the lesson plan', text.includes(en['pp.align.title']));
  await shot(d, 'a2-pack-slides');
  await shot(d, 'a2b-pack-slides-page', true);
  state.scienceDeck = pres.slides.deckId;
  saveState();
  const p1 = await open('phone');
  await goLesson(p1, planId);
  await shot(p1, 'a2-pack-slides');
  await p1.ctx.close();

  // Edit a slide in the slide editor opened from the lesson.
  target = pres.slides.slides.find((x) => x.kind === 'concept');
  state.targetSlide = target.id;
  saveState();
  await d.page.locator('[data-edit-slides] a').click();
  await d.page.waitForURL(/\/slides\//, { timeout: 60000 });
  await d.page.goto(`${base}/slides/${pres.slides.deckId}?plan=${planId}&slide=${target.id}`, { waitUntil: 'networkidle', timeout: 120000 });
  await d.page.locator(`#f-${target.id}-title`).waitFor({ timeout: 60000 });
  await d.page.locator(`#f-${target.id}-title`).fill(myTitle);
  await d.page.locator('[data-save-state="saved"]').waitFor({ timeout: 30000 }).catch(() => {});
  await d.page.waitForTimeout(2500);
  const afterEdit = await client.call('decks.get', { params: { deckId: pres.slides.deckId } });
  check('a slide edited in the slide editor is saved to her copy', afterEdit.deck.slides.find((x) => x.id === target.id)?.title === myTitle);
  check('the editor opened from the lesson goes back to the lesson', (await d.page.locator(`a[href="/lessons/${planId}"]`).count()) > 0);
  await shot(d, 'a3-editor-edit');

  // Rewrite that slide with AI (a real model call), look at it, use it.
  await d.page.locator('[data-rewrite-slide]').click();
  const failedRewrite = await waitProposal(d);
  check('“Rewrite this slide with AI” answers a proposal (real model)', !failedRewrite, failedRewrite ?? '');
  await shot(d, 'a4-ai-proposal');
  const pending = await client.call('decks.get', { params: { deckId: pres.slides.deckId } });
  check('nothing is written while the proposal waits', pending.deck.slides.find((x) => x.id === target.id)?.title === myTitle && pending.deck.rev === afterEdit.deck.rev);
  await d.page.locator('[data-ai-use]').click();
  await d.page.waitForTimeout(3500);
  const applied = await client.call('decks.get', { params: { deckId: pres.slides.deckId } });
  const newTitle = applied.deck.slides.find((x) => x.id === target.id)?.title;
  check('“Use this slide” writes it into her copy, the rest unchanged', newTitle && newTitle !== myTitle && JSON.stringify(applied.deck.slides.filter((x) => x.id !== target.id)) === JSON.stringify(pending.deck.slides.filter((x) => x.id !== target.id)), `new title: ${newTitle}`);
  state.aiSlideTitle = newTitle;
  saveState();
  await shot(d, 'a4-ai-applied');
  } else {
    await d.page.goto(`${base}/slides/${pres.slides.deckId}?plan=${planId}&slide=${target.id}`, { waitUntil: 'networkidle', timeout: 120000 });
    await d.page.locator(`#f-${target.id}-title`).waitFor({ timeout: 60000 });
    await d.page.waitForTimeout(1500);
  }
  const before = await client.call('decks.get', { params: { deckId: pres.slides.deckId } });

  // Earlier versions: put her own words back.
  await d.page.getByRole('button', { name: en['sl.ed.more'] }).first().click();
  await d.page.locator('[data-revisions-open]').click();
  await d.page.locator('[data-revisions]').waitFor({ timeout: 30000 });
  await shot(d, 'a5-revisions');
  await d.page.locator('[data-revision-restore]').first().click();
  await d.page.waitForTimeout(3500);
  const restored = await client.call('decks.get', { params: { deckId: pres.slides.deckId } });
  check('“Put this version back” restores her own words', restored.deck.slides.find((x) => x.id === target.id)?.title === myTitle);
  const revs = await client.call('decks.revisions', { params: { deckId: pres.slides.deckId } });
  check('…and keeps the AI version as an earlier version too', revs.revisions.map((r) => r.reason).join(',') === 'restore,ai', revs.revisions.map((r) => r.reason).join(','));
  await shot(d, 'a5-restored');

  // Present and download from the lesson.
  await goLesson(d, planId);
  check('Present shows the lesson’s slides full screen', await present(d, 'a6-present'));
  const file = await download(d, () => d.page.locator('[data-download-lesson]').click(), 'science-day2.pptx');
  const pages = pptxPages(file.path);
  const lessonNow = await presentation(planId);
  check('Download gives the lesson’s slides as PowerPoint: its day, her words, the credits', pages.length === lessonNow.slides.slides.length && pages.some((x) => x.includes(myTitle)) && pages[pages.length - 1].includes('Drawings'), `${file.name}: ${pages.length} slides; first: ${pages[0].slice(0, 80)}`);
  state.files = { ...(state.files ?? {}), science: file.path };

  // She changes the lesson: the cue says so, nothing is overwritten.
  const revBefore = (await client.call('decks.get', { params: { deckId: pres.slides.deckId } })).deck.rev;
  const titleBox = d.page.locator('textarea[placeholder]').first();
  await titleBox.fill(`${await titleBox.inputValue()} — with our school garden`);
  await d.page.waitForTimeout(6000);
  await d.page.reload({ waitUntil: 'networkidle', timeout: 120000 });
  await d.page.locator('[data-stale-cue]').waitFor({ timeout: 30000 }).catch(() => {});
  const staleShown = (await d.page.locator('[data-stale-cue]').count()) === 1;
  const revAfter = (await client.call('decks.get', { params: { deckId: pres.slides.deckId } })).deck.rev;
  check('after the lesson changed, the panel says so (“Your lesson changed after these slides were made”)', staleShown, (await panelText(d)).split('\n').find((l) => l.includes('changed')) ?? 'no cue');
  check('…and the slides were not touched', revAfter === revBefore, `rev ${revBefore} → ${revAfter}`);
  await shot(d, 'a8-stale');
  const ps = await open('phone');
  await goLesson(ps, planId);
  await shot(ps, 'a8-stale');
  await ps.ctx.close();

  // Rewrite all of the lesson's slides from the changed lesson (a real model call), then use them.
  await d.page.locator('[data-rewrite]').first().click();
  await d.page.locator('[data-scope="lesson"]').check();
  await shot(d, 'a9-rewrite-scope');
  await d.page.locator('[data-rewrite-go]').click();
  await d.page.locator('[data-ai-working]').waitFor({ timeout: 15000 }).catch(() => {});
  await shot(d, 'a9-working');
  const failedAll = await waitProposal(d);
  check('“Rewrite all slides” answers a proposal for the lesson’s slides (real model)', !failedAll, failedAll ?? '');
  await shot(d, 'a9-proposal');
  await d.page.locator('[data-ai-use]').click();
  await d.page.waitForTimeout(4000);
  const after = await presentation(planId);
  check('using it replaces only Day 2’s slides and the lesson matches again', after.stale === false && after.slides.slides.every((x) => x.day === 2 || x.kind === 'credits'), `${after.slides.slides.length} slides, stale ${after.stale}`);
  const others = (await client.call('decks.get', { params: { deckId: pres.slides.deckId } })).deck.slides.filter((x) => x.day !== 2 && x.kind !== 'credits').length;
  check('…the other four days of her copy are as they were', others === before.deck.slides.filter((x) => x.day !== 2 && x.kind !== 'credits').length, `${others} slides on other days`);
  await shot(d, 'a9-rewritten');
  await d.ctx.close();
}

/* ------------------------------------------------ phase: english (a lesson with no pack) */
async function english() {
  const d = await open('desktop');
  const planId = state.plans.e2;
  await goLesson(d, planId);
  const text = await panelText(d);
  check('an English lesson (no pack exists): the panel offers to make slides from the lesson with AI, and no pack', (await d.page.locator('[data-make-slides]').count()) === 1 && (await d.page.locator('[data-use-pack]').count()) === 0, text.split('\n').slice(0, 5).join(' | '));
  await shot(d, 'b1-english-none');
  const p1 = await open('phone');
  await goLesson(p1, planId);
  await shot(p1, 'b1-english-none');
  await p1.ctx.close();
  await d.page.locator('[data-make-slides]').click();
  await d.page.locator('[data-ai-working]').waitFor({ timeout: 15000 }).catch(() => {});
  await shot(d, 'b2-working');
  const failed = await waitProposal(d);
  check('“Make slides from this lesson with AI” answers a proposal (real model)', !failed, failed ?? '');
  await shot(d, 'b2-proposal');
  const pending = await presentation(planId);
  check('nothing is kept until she says so', pending.slides === null && pending.job?.status === 'ready', `job ${pending.job?.status}; ${pending.job?.proposal?.slides.length} slides proposed`);
  state.englishProposal = pending.job?.proposal?.slides.map((x) => ({ kind: x.kind, title: x.title, lines: x.lines, choices: x.choices })) ?? [];
  await d.page.locator('[data-ai-use]').click();
  await d.page.locator('[data-lesson-thumbs]').waitFor({ timeout: 60000 });
  await d.page.waitForTimeout(1500);
  const made = await presentation(planId);
  check('“Use these slides” makes the lesson’s own slides, marked as made with AI', made.slides?.origin === 'lesson' && (await panelText(d)).includes(en['pp.madeWithAi']), `${made.slides?.slides.length} slides`);
  await shot(d, 'b2-english-slides');
  check('Present works for the English slides', await present(d, 'b3-english-present'));
  const file = await download(d, () => d.page.locator('[data-download-lesson]').click(), 'english-g2.pptx');
  const pages = pptxPages(file.path);
  check('their PowerPoint: every slide, the AI draft label on the cover', pages.length === made.slides.slides.length && pages[0].includes('DRAFT — made with AI from the lesson plan'), `${pages.length} slides; ${pages[0].slice(0, 100)}`);
  state.files = { ...(state.files ?? {}), english: file.path };
  saveState();
  const p2 = await open('phone');
  await goLesson(p2, planId);
  await shot(p2, 'b2-english-slides');
  await p2.ctx.close();
  await d.ctx.close();
}

/* ------------------------------------------------ phase: failure (server with broken provider keys) */
async function failure() {
  const d = await open('desktop');
  const planId = state.plans.day2;
  const before = await client.call('decks.get', { params: { deckId: state.scienceDeck } });
  await goLesson(d, planId);
  await d.page.locator('[data-rewrite]').first().click();
  await d.page.locator('[data-scope="slide"]').check();
  await d.page.locator('dialog[open] [data-slide-thumb]').nth(1).click();
  await d.page.locator('[data-rewrite-go]').click();
  const failed = await waitProposal(d, 240000);
  const text = await panelText(d);
  check('with the providers failing, the panel says so plainly and offers to try again', failed === 'providers_unavailable' && text.includes(en['pp.err.providers']) && text.includes(en['pp.ai.retry']), `${failed}: ${text.split('\n').find((l) => l.includes('AI')) ?? ''}`);
  await shot(d, 'c1-failure');
  const after = await client.call('decks.get', { params: { deckId: state.scienceDeck } });
  check('…and her slides are exactly as they were', after.deck.rev === before.deck.rev && JSON.stringify(after.deck.slides) === JSON.stringify(before.deck.slides), `rev ${before.deck.rev} → ${after.deck.rev}`);
  await d.page.reload({ waitUntil: 'networkidle', timeout: 120000 });
  await d.page.locator('[data-presentation-panel]').waitFor({ timeout: 60000 });
  await d.page.waitForTimeout(1500);
  check('a reload still shows what happened', (await d.page.locator('[data-ai-failed]').count()) === 1);
  const p1 = await open('phone');
  await goLesson(p1, planId);
  await shot(p1, 'c1-failure');
  await p1.ctx.close();
  await d.ctx.close();
}

/* ------------------------------------------------ multi-grade sessions */
async function combine(s, classId, allGrades) {
  await s.page.goto(`${base}/lessons/combine?classId=${classId}&date=${state.walkDate}`, { waitUntil: 'networkidle', timeout: 120000 });
  await s.page.locator('[data-mg-screen]').waitFor({ timeout: 60000 });
  if (allGrades) await s.page.locator('[data-mg-subject]').selectOption('');
  await s.page.waitForTimeout(2500);
  await s.page.locator('[data-mg-make]').click();
  await s.page.waitForURL(/\/lessons\/(?!combine|new)[^/]+$/, { timeout: 60000 });
  const id = decodeURIComponent(new URL(s.page.url()).pathname.split('/').pop());
  await s.page.locator('[data-presentation-panel="session"]').waitFor({ timeout: 60000 });
  await s.page.locator('[data-session-thumbs]').waitFor({ timeout: 60000 });
  await s.page.waitForTimeout(2500);
  return id;
}
const order = (pages, needles) => needles.map((x) => pages.findIndex((pg) => pg.includes(x)));

async function session2() {
  // Grade 4's lesson (Day 2 of the pack) gets its slides first; Grade 5's lesson has none.
  await client.call('decks.lesson.link', { params: { planId: state.plans.mg2g4 }, body: { packId: PACK, lang: 'en', day: 2 } });
  const d = await open('desktop');
  const planId = await combine(d, state.classes.mg2, false);
  state.plans.session2 = planId;
  saveState();
  const pres = await presentation(planId);
  check('two grades: each grade’s own lesson is found for its part (Grade 4 with slides, Grade 5 without)', pres.kind === 'session' && pres.parts.map((x) => `${x.grade}:${x.source?.planId === state.plans[x.grade === '4' ? 'mg2g4' : 'mg2g5']}:${Boolean(x.slides)}`).join(',') === '4:true:true,5:true:false', JSON.stringify(pres.parts.map((x) => [x.grade, x.source?.title, Boolean(x.slides)])));
  const text = await panelText(d);
  check('the panel says it is put together from each grade’s lesson, in block order', text.includes(en['pp.session.title']) && text.includes('Grade 4 with the teacher') && text.includes('Grade 5 with the teacher'), text.split('\n').slice(0, 8).join(' | '));
  await shot(d, 'd1-session2');
  await shot(d, 'd1b-session2-page', true);
  check('Present shows the session’s slides', await present(d, 'd2-session2-present'));
  const file = await download(d, () => d.page.locator('[data-download-session]').click(), 'session-g4-g5.pptx');
  const pages = pptxPages(file.path);
  const [start, t4, t5, finish] = order(pages, ['Start together', 'Grade 4 with the teacher', 'Grade 5 with the teacher', 'Finish together']);
  check('its PowerPoint follows the blocks: start together → Grade 4’s turn → Grade 5’s turn → finish together', start > 0 && start < t4 && t4 < t5 && t5 < finish, `slides ${pages.length}; at ${[start, t4, t5, finish].join(', ')}`);
  check('…with “Meanwhile, Grade 5” in Grade 4’s turn, Grade 4’s own slides labelled GRADE 4, and Grade 5’s missing slides said plainly', pages[t4 + 1]?.includes('Meanwhile, Grade 5') && pages.slice(t4 + 2, t5).every((x) => x.includes('GRADE 4')) && pages.some((x, i) => i > t5 && i < finish && x.includes("No slides yet for Grade 5's lesson")), pages.slice(t4, t5 + 3).map((x) => x.slice(0, 50)).join(' | '));
  check('…and ends with each slides’ credits', pages[pages.length - 1].includes("About Grade 4's slides"), pages[pages.length - 1].slice(0, 120));
  state.files = { ...(state.files ?? {}), session2: file.path };
  saveState();
  const p1 = await open('phone');
  await goLesson(p1, planId);
  await shot(p1, 'd1-session2');
  await p1.ctx.close();
  await d.ctx.close();
}

async function session3() {
  const d = await open('desktop');
  const planId = await combine(d, state.classes.mg3, true);
  state.plans.session3 = planId;
  saveState();
  let pres = await presentation(planId);
  check('three grades (Grade 1 Reading and Literacy, Grades 2–3 English): each grade’s lesson found; Grade 2 has its AI slides', pres.parts.map((x) => `${x.grade}:${Boolean(x.source)}:${Boolean(x.slides)}`).join(',') === '1:true:false,2:true:true,3:true:false', JSON.stringify(pres.parts.map((x) => [x.grade, x.source?.title, Boolean(x.slides)])));
  await shot(d, 'e1-session3');
  await shot(d, 'e1b-session3-page', true);
  // Make Grade 1's slides from the session panel (a real model call).
  await d.page.locator('[data-make-grade="1"]').click();
  const failed = await waitProposal(d);
  check('“Make slides for Grade 1 with AI” in the session panel answers a proposal (real model)', !failed, failed ?? '');
  await shot(d, 'e2-grade1-proposal');
  await d.page.locator('[data-ai-use]').click();
  await d.page.waitForTimeout(4000);
  pres = await presentation(planId);
  check('using it gives Grade 1’s part its slides; Grade 3 still has none', pres.parts.map((x) => `${x.grade}:${Boolean(x.slides)}`).join(',') === '1:true,2:true,3:false');
  await shot(d, 'e3-session3-assembled');
  // The plan changes (another device): Grade 3's task in Grade 1's turn is rewritten.
  const engine = await engineFor();
  const mgSection = (await engine.list('plan_section')).find((x) => x.data.planId === planId && x.data.key === 'multigrade');
  const blocks = mgSection.data.content.blocks;
  const turn1 = blocks.find((b) => b.teacherWith === state.groups.mg3[0]);
  const g3 = state.groups.mg3[2];
  const newTask = 'Read the market story with your buddy and list five describing words.';
  turn1.groups[g3] = { mode: 'peer', activity: [p(newTask)] };
  await engine.put('plan_section', { ...mgSection.data, content: { ...mgSection.data.content, blocks } });
  check('the session plan changed and reached the server', await pushAll(engine));
  await d.page.reload({ waitUntil: 'networkidle', timeout: 120000 });
  await d.page.locator('[data-session-thumbs]').waitFor({ timeout: 60000 });
  await d.page.waitForTimeout(2500);
  const file = await download(d, () => d.page.locator('[data-download-session]').click(), 'session-g1-g2-g3.pptx');
  const pages = pptxPages(file.path);
  const [start, t1, t2, t3, finish] = order(pages, ['Start together', 'Grade 1 with the teacher', 'Grade 2 with the teacher', 'Grade 3 with the teacher', 'Finish together']);
  check('its PowerPoint follows the three turns in block order', start > 0 && start < t1 && t1 < t2 && t2 < t3 && t3 < finish, `${pages.length} slides; at ${[start, t1, t2, t3, finish].join(', ')}`);
  const meanwhile3 = pages.slice(t1, t2).find((x) => x.includes('Meanwhile, Grade 3'));
  check('the changed plan shows: Grade 3’s new task is its “Meanwhile” slide in Grade 1’s turn', meanwhile3?.includes(newTask), meanwhile3?.slice(0, 160));
  check('Grade 1 Reading and Literacy and Grade 2 English slides are labelled with their grade; Grade 3’s missing slides are said plainly', pages.slice(t1 + 1, t2).some((x) => x.includes('GRADE 1')) && pages.slice(t2 + 1, t3).some((x) => x.includes('GRADE 2')) && pages.slice(t3, finish).some((x) => x.includes("No slides yet for Grade 3's lesson")), '');
  check('…and ends with each grade’s credits, saying the slides were made with AI', pages.filter((x) => x.includes('Made with AI from the teacher')).length === 2, pages.slice(-2).map((x) => x.slice(0, 90)).join(' | '));
  state.files = { ...(state.files ?? {}), session3: file.path };
  saveState();
  check('Present shows the session’s slides', await present(d, 'e4-session3-present'));
  // A thumbnail opens in the carousel: Grade 3's changed task.
  const p1 = await open('phone');
  await goLesson(p1, planId);
  await shot(p1, 'e3-session3-assembled');
  await shot(p1, 'e3b-session3-page', true);
  await p1.ctx.close();
  await d.ctx.close();
}

async function filipino() {
  const f = await open('desktop', 'fil');
  await goLesson(f, state.plans.e2);
  const text = await panelText(f);
  // The kicker is set in capitals by CSS (innerText reads it so): compare without case.
  const low = text.toLowerCase();
  check('in Filipino the panel reads in Filipino', low.includes(fil['pp.kicker'].toLowerCase()) && low.includes(fil['pp.align.title'].toLowerCase()) && low.includes(fil['pp.ai.rewrite'].toLowerCase()), text.split('\n').slice(0, 4).join(' | '));
  await shot(f, 'f1-panel');
  await goLesson(f, state.plans.session3);
  await shot(f, 'f2-session');
  await f.ctx.close();
}

try {
  if (phase === 'seed') await seed();
  else {
    await signIn();
    browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
    try {
      if (phase === 'science') await science();
      else if (phase === 'english') await english();
      else if (phase === 'failure') await failure();
      else if (phase === 'session2') await session2();
      else if (phase === 'session3') await session3();
      else if (phase === 'fil') await filipino();
      else throw new Error(`unknown phase ${phase}`);
    } finally {
      await browser.close();
    }
    check('no errors in the browser and no server errors', errors.length === 0, errors.slice(0, 4).join(' | '));
  }
} catch (e) {
  check(`the ${phase} phase ran to the end`, false, String(e?.stack ?? e).slice(0, 500));
}
const failedChecks = results.filter((r) => !r.ok);
const logPath = join(out, `walk-${phase}-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}.json`);
writeFileSync(logPath, JSON.stringify({ base, phase, walkDate: state.walkDate, checks: results.length, failed: failedChecks.length, results, shots }, null, 1));
console.log(`\n${results.length - failedChecks.length}/${results.length} checks passed (${phase}); ${shots.length} screenshots in ${out}`);
process.exit(failedChecks.length ? 1 : 0);
