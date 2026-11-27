// Motion walk (27 Nov 2026): the timetable reorder, the next-step cue and the AI working state, measured on a LOCAL
// production build, signed in as an invented teacher. It reads what the browser actually renders: element boxes
// frame by frame while something moves, the running animations, focus, scroll position and the records the device
// and the server hold afterwards. A screenshot or a DOM assertion alone never counts as "it moved".
//
// Phases (same local account and database; the account is kept in <out>/account.json):
//   seed      register a local teacher, a multi-grade class and a single-grade class, and their lessons
//   reorder   Session Flow blocks and Procedure steps: movement, identity, focus, persistence, failed saves
//   cue       the next-step arrow: where it appears, how long, what it never does
//   ai-standin  the waiting state against the REAL Tala server, job queue, polling and cancel, with a SIMULATED MODEL:
//             the server is started with its lesson route on a local stand-in endpoint that this script answers
//             (--standin-port, default 3339). Every check from this phase is labelled as using the stand-in model.
//   ai-real   one real draft with the provider the server was started with (needs --real; counted and bounded)
//   reduced   the same screens with prefers-reduced-motion: reduce
//   record    short recordings (WebM) and frame strips for the report
//
//   tsx scripts/motion-walk.mjs <phase> http://127.0.0.1:PORT <outDir> --db <TALA_DB_PATH> [--real] [--label before|after]
//
// Local servers only: it creates an account. Everything typed or seeded is invented (@example.com).
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const [phase, base, out] = argv;
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback = '') => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
const dbPath = option('db');
const PHASES = ['seed', 'reorder', 'cue', 'ai-standin', 'ai-real', 'reduced', 'record'];
if (!PHASES.includes(phase) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base ?? '') || !out || !dbPath)
  throw new Error(`usage: motion-walk.mjs <${PHASES.join('|')}> http://127.0.0.1:PORT <outDir> --db <path>`);
const label = option('label', 'after');

const { createTalaClient } = await import('@hiraia/tala-core/contracts');
const { createSyncEngine, createMemoryStore } = await import('@hiraia/tala-core/sync');
const { newPlan, defaultTemplateFor } = await import('../src/data/plans.ts');
const { en } = await import('../src/i18n/en.ts');
const { fil } = await import('../src/i18n/fil.ts');
const Database = require('better-sqlite3');
mkdirSync(join(out, 'shots'), { recursive: true });
mkdirSync(join(out, 'video'), { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ phase, label, name, ok: Boolean(ok), detail: String(detail).slice(0, 600) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${String(detail).slice(0, 260)}` : ''}`);
};
const note = (name, detail = '') => {
  results.push({ phase, label, name, ok: null, detail: String(detail).slice(0, 900) });
  console.log(`NOTE  ${name}${detail ? `  — ${String(detail).slice(0, 320)}` : ''}`);
};
const stamp = Date.now().toString(36);
let n = 0;
const newId = () => `mw-${stamp}-${(++n).toString(36).padStart(4, '0')}`;
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
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
const accountFile = join(out, 'account.json');
const engineFor = (tag) => createSyncEngine({ store: createMemoryStore(), transport: client.syncTransport, deviceId: `mw-${tag}-${stamp}`, now: () => new Date(), newId });
const syncAll = async (engine) => {
  for (let k = 0; k < 8; k++) await engine.sync();
  for (let i = 0; i < 20 && (await engine.status()).pending; i++) await engine.sync();
};
const db = () => new Database(dbPath, { readonly: true });
const finish = () => {
  const file = join(out, `motion-walk-${phase}-${label}.json`);
  writeFileSync(file, JSON.stringify(results, null, 1));
  const failed = results.filter((r) => r.ok === false);
  console.log(`\n${phase} (${label}): ${results.filter((r) => r.ok === true).length} passed, ${failed.length} failed, ${results.filter((r) => r.ok === null).length} notes → ${file}`);
  process.exit(failed.length ? 1 : 0);
};

/* ------------------------------------------------ seed, through the real API and sync engine */
const p = (text) => [{ t: 'p', spans: [{ text }] }];
const OWN_OBJECTIVE = 'The teacher’s own objective: every learner touches a real seed today.';
if (phase === 'seed') {
  const email = `teacher.motionwalk.${stamp}@example.com`;
  const password = `Tala-mw-${stamp}-Aa1!`;
  await client.call('auth.register', { body: { email, password, displayName: 'Gng. Liza Ramos (synthetic)', uiLanguage: 'en', deviceLabel: 'motion walk seed' } });
  const d = db();
  const row = d.prepare("select vars from core_mail_outbox where to_email=? and template='verify_email' order by rowid desc limit 1").get(email);
  d.close();
  if (row) await client.call('auth.verifyEmail', { body: { token: JSON.parse(row.vars).link.split('#token=')[1] } });
  const engine = engineFor('seed');
  await syncAll(engine);
  const presets = (await client.call('calendar.presets')).presets;
  const preset = await client.call('calendar.preset', { params: { presetId: presets[0].id } });
  const year = {
    id: newId(), label: `${preset.startDate.slice(0, 4)}-${preset.endDate.slice(0, 4)}`, schoolName: 'Malaya Elementary School (synthetic)', startDate: preset.startDate, endDate: preset.endDate,
    terms: preset.terms.map((t) => ({ id: newId(), index: t.index, name: t.name, startDate: t.startDate, endDate: t.endDate })),
    teachingWeekdays: [1, 2, 3, 4, 5], presetId: preset.id, presetVersion: preset.version, provisional: preset.provisional,
  };
  await engine.put('school_year', year);
  await engine.put('profile', { id: 'profile', displayName: 'Gng. Liza Ramos (synthetic)', uiLanguage: 'en', schoolName: year.schoolName, region: 'Region IV-A', dataSaver: false, activeSchoolYearId: year.id, pacingParams: {} });
  const term = year.terms.find((t) => t.startDate <= today && t.endDate >= today) ?? year.terms[0];
  const index = await client.call('curriculum.index');
  const packFor = async (grade) => {
    const meta = index.packs.find((x) => x.grade === grade && x.learningAreaId === 'science' && x.schoolYears.includes(year.label));
    const pack = await client.call('curriculum.pack', { params: { packId: meta.packId } });
    return { meta, comps: pack.competencies.filter((c) => c.termIndex === term.index).sort((a, b) => a.sequence - b.sequence) };
  };
  const g4 = await packFor('4');
  const g5 = await packFor('5');
  const profile = { materials: ['chalkboard', 'manila paper', 'crayons', 'seed packets', 'hand lens', 'plastic cups'], textbooks: [], electricity: true, projector: false, printing: true, outdoorSpace: true, notes: '' };
  const single = { id: newId(), schoolYearId: year.id, name: 'Grade 4 – Sampaguita (synthetic test)', curriculum: 'deped', gradeGroups: [{ id: newId(), grade: '4', learnerCount: 30 }], languages: ['en'], profile, isSample: false, archived: false };
  const multi = { id: newId(), schoolYearId: year.id, name: 'Grades 4 and 5 – Mabini (synthetic test)', curriculum: 'deped', gradeGroups: [{ id: newId(), grade: '4', learnerCount: 12 }, { id: newId(), grade: '5', learnerCount: 11 }], languages: ['en'], profile, isSample: false, archived: false };
  const subject = (cls, minutes, startTime) => ({ id: newId(), classId: cls.id, learningAreaId: 'science', subjectName: 'Science', gradeGroupIds: cls.gradeGroups.map((g) => g.id), language: 'en', slots: [1, 2, 3, 4, 5].map((weekday) => ({ id: newId(), weekday, startTime, minutes, rotation: null })) });
  const aSingle = subject(single, 50, '08:00');
  const aMulti = subject(multi, 45, '10:00');
  for (const c of [single, multi]) await engine.put('class', c);
  for (const a of [aSingle, aMulti]) await engine.put('assignment', a);
  const [gid4, gid5] = multi.gradeGroups.map((g) => g.id);
  const plans = {};
  const save = async (key, plan, sections) => {
    await engine.batch([{ op: 'put', entity: 'plan', data: plan }, ...sections.map((s) => ({ op: 'put', entity: 'plan_section', data: s }))]);
    plans[key] = { planId: plan.id, title: plan.title };
  };
  // 1. A multi-grade Session Flow with four time blocks that add up to the class time exactly (45 minutes).
  {
    const made = newPlan({ template: defaultTemplateFor(multi, aMulti), cls: multi, assignment: aMulti, dates: [today], language: 'en', competencies: { [gid4]: g4.comps.slice(0, 1).map((c) => c.id), [gid5]: g5.comps.slice(0, 1).map((c) => c.id) }, curriculumVersion: g4.meta.curriculumVersion, newId, title: 'Grades 4 and 5 Science: plants and their parts (synthetic test)' });
    const block = (label, minutes, teacherWith, a4, a5, m4, m5) => ({ id: newId(), label, minutes, transitionMinutes: teacherWith === 'all' ? 0 : 1, teacherWith, pairedGroupIds: teacherWith === 'all' ? [gid4, gid5] : [], groups: { [gid4]: { mode: m4, activity: p(a4) }, [gid5]: { mode: m5, activity: p(a5) } } });
    const blocks = [
      block('Opening song and review', 5, 'all', 'Sing the plant song together and name one plant near the school.', 'Sing the plant song together and name one plant near the school.', 'shared', 'shared'),
      block('Grade 4 with the teacher', 15, gid4, 'Look at a seed with a hand lens. Say what you see.', 'Draw a plant from the garden and label three parts on manila paper.', 'direct', 'independent'),
      block('Grade 5 with the teacher', 15, gid5, 'Sort seed packets into two groups and tell a partner why.', 'Talk about how each plant part helps the plant live.', 'independent', 'direct'),
      block('Wrap-up and sharing', 10, 'all', 'Each group shows one drawing to the class.', 'Each group shows one drawing to the class.', 'shared', 'shared'),
    ];
    const sections = made.sections.map((s) => {
      if (s.key === 'multigrade') return { ...s, content: { type: 'multigrade', blocks }, editedByTeacher: true };
      if (s.content.type === 'pergroup' && ['objectives', 'materials', 'assessment'].includes(s.key))
        return { ...s, content: { type: 'pergroup', groups: { [gid4]: p(s.key === 'materials' ? 'hand lens, seed packets' : 'Name the parts of a plant.'), [gid5]: p(s.key === 'materials' ? 'manila paper, crayons' : 'Explain what each plant part does.') } }, editedByTeacher: true };
      return s;
    });
    await save('multigrade', made.plan, sections);
    plans.multigrade.blockIds = blocks.map((b) => b.id);
    plans.multigrade.blockLabels = blocks.map((b) => b.label);
  }
  // 2. A single-grade lesson whose Procedure has four steps (50 minutes).
  {
    const made = newPlan({ template: defaultTemplateFor(single, aSingle), cls: single, assignment: aSingle, dates: [today], language: 'en', competencies: { [single.gradeGroups[0].id]: g4.comps.slice(0, 2).map((c) => c.id) }, curriculumVersion: g4.meta.curriculumVersion, newId, title: 'Grade 4 Science: what plants need (synthetic test)' });
    const steps = [['Review', 5, 'Ask what the class remembers about seeds.'], ['Activity', 20, 'Groups observe seeds with a hand lens and draw what they see on manila paper.'], ['Discussion', 15, 'The class talks about what plants need to grow.'], ['Closing', 10, 'Each learner says one thing a plant needs.']].map(([title, minutes, body]) => ({ id: newId(), title, minutes, body: p(body) }));
    const sections = made.sections.map((s) => {
      if (s.key === 'procedure') return { ...s, content: { type: 'procedure', steps }, editedByTeacher: true };
      if (s.key === 'objectives') return { ...s, content: { type: 'list', items: ['Name what plants need to grow.'] }, editedByTeacher: true };
      if (s.key === 'materials') return { ...s, content: { type: 'list', items: ['hand lens', 'seed packets'] }, editedByTeacher: true };
      return s;
    });
    await save('procedure', made.plan, sections);
    plans.procedure.stepIds = steps.map((s) => s.id);
    plans.procedure.stepTitles = steps.map((s) => s.title);
  }
  // 3. Lessons to draft with AI. `draftOwn` already has one objective the teacher wrote herself; the others are empty.
  for (const key of ['draftPlain', 'draftRetry', 'draftCancel', 'draftAway', 'draftQueue', 'draftOwn', 'draftReal', 'draftRealMulti']) {
    const multiGrade = key === 'draftRealMulti';
    const cls = multiGrade ? multi : single;
    const asg = multiGrade ? aMulti : aSingle;
    const competencies = multiGrade ? { [gid4]: g4.comps.slice(1, 2).map((c) => c.id), [gid5]: g5.comps.slice(1, 2).map((c) => c.id) } : { [single.gradeGroups[0].id]: g4.comps.slice(2, 4).map((c) => c.id) };
    const made = newPlan({ template: defaultTemplateFor(cls, asg), cls, assignment: asg, dates: [today], language: 'en', competencies, curriculumVersion: g4.meta.curriculumVersion, newId, title: `${multiGrade ? 'Grades 4 and 5' : 'Grade 4'} Science: ${g4.comps[2]?.shortTitle ?? 'lesson'} (synthetic test, ${key})` });
    const sections = made.sections.map((s) => (key === 'draftOwn' && s.key === 'objectives' ? { ...s, content: { type: 'list', items: [OWN_OBJECTIVE] }, editedByTeacher: true } : s));
    await save(key, made.plan, sections);
  }
  await syncAll(engine);
  check('seed: a local teacher, a multi-grade class and a single-grade class, a four-block Session Flow, a four-step Procedure and eight lessons to draft', (await engine.status()).pending === 0, JSON.stringify(Object.fromEntries(Object.entries(plans).map(([k, v]) => [k, v.planId]))));
  writeFileSync(accountFile, JSON.stringify({ email, password, plans, groups: { gid4, gid5 }, classIds: { single: single.id, multi: multi.id } }, null, 1));
  finish();
}

/* ------------------------------------------------ browser phases */
if (!existsSync(accountFile)) throw new Error(`no ${accountFile}: run the seed phase first`);
const acct = JSON.parse(readFileSync(accountFile, 'utf8'));
await client.call('auth.login', { body: { email: acct.email, password: acct.password, deviceLabel: `motion walk ${phase}` } });
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright-core');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
const VIEW = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  foldable: { viewport: { width: 673, height: 841 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 },
};
const L = (lang) => (lang === 'fil' ? fil : en);
/** `^Time block \d+$` from the interface's own words, so the walk finds the cards in either language and on either build. */
const cardPattern = (lang, kind) => `^${L(lang)[kind === 'block' ? 'editor.block' : 'editor.step'].replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\{n\\}', '\\d+')}$`;

/** Helpers that live in the page: they read boxes, never write to the lesson. They work on the build before the motion change too. */
function pageHelpers() {
  const mw = (window.__mwx = {});
  mw.cards = (kind, pattern) => {
    const sec = document.querySelector(`section[aria-labelledby="s-${kind === 'block' ? 'multigrade' : 'procedure'}"]`);
    if (!sec) return [];
    const re = new RegExp(pattern);
    return [...sec.querySelectorAll('strong')].filter((x) => re.test(x.textContent.trim())).map((x) => x.closest('.rounded.border'));
  };
  mw.key = (card) => card.querySelector('input')?.value ?? '';
  mw.segments = () => {
    const bar = [...document.querySelectorAll('[aria-hidden="true"]')].find((x) => x.classList.contains('h-9'));
    return bar ? [...bar.children].filter((c) => c.style.left && c.style.width) : [];
  };
  mw.snapshot = (kind, pattern) => {
    const cards = mw.cards(kind, pattern);
    const a = document.activeElement;
    return {
      order: cards.map(mw.key),
      tops: cards.map((c) => c.getBoundingClientRect().top + window.scrollY),
      heights: cards.map((c) => c.getBoundingClientRect().height),
      tags: cards.map((c) => c.__mwTag ?? null),
      scrollY: window.scrollY,
      docHeight: document.documentElement.scrollHeight,
      sections: [...document.querySelectorAll('section[aria-labelledby]')].map((x) => { const r = x.getBoundingClientRect(); return [x.getAttribute('aria-labelledby'), Math.round((r.top + window.scrollY) * 10) / 10, Math.round(r.height * 10) / 10]; }),
      active: a ? (a.getAttribute('aria-label') ?? a.tagName) : null,
      activeDisabled: a ? a.disabled === true : null,
      activeVisible: a && a !== document.body ? (() => { const r = a.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; })() : null,
      leftovers: cards.filter((c) => c.style.transform || c.style.willChange || c.hasAttribute('data-reorder-lifted')).length,
      marked: cards.filter((c) => c.hasAttribute('data-reorder-settled')).length + mw.segments().filter((x) => x.hasAttribute('data-flow-moved')).length,
      running: document.getAnimations().filter((x) => x.playState === 'running').length,
      status: [...document.querySelectorAll('[role="status"].sr-only')].map((x) => x.textContent.trim()).filter(Boolean),
      sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  };
  mw.tag = (kind, pattern) => mw.cards(kind, pattern).forEach((c) => (c.__mwTag = mw.key(c)));
  /** Every animation frame for `ms`: where each card and each bar segment is drawn, and the page scroll. */
  mw.arm = (kind, pattern, ms) => {
    mw.samples = [];
    mw.done = false;
    // The elements are looked up once: a moved card is the same element afterwards, and reading must stay cheap
    // (a slow reader would itself drop the frames it is counting).
    const cards = mw.cards(kind, pattern).map((c) => [mw.key(c), c]);
    const segs = mw.segments();
    const t0 = performance.now();
    const tick = (now) => {
      mw.samples.push({
        t: Math.round((now - t0) * 10) / 10,
        y: window.scrollY,
        cards: cards.map(([k, c]) => [k, Math.round(c.getBoundingClientRect().top * 100) / 100, c.style.transform ? 1 : 0]),
        segs: segs.map((x) => { const r = x.getBoundingClientRect(); return [Math.round(r.left * 10) / 10, Math.round(r.width * 10) / 10]; }),
      });
      if (now - t0 < ms) requestAnimationFrame(tick);
      else mw.done = true;
    };
    requestAnimationFrame(tick);
  };
}

async function open(view, lang, extra = {}) {
  const ctx = await browser.newContext({ ...VIEW[view], locale: 'en-PH', timezoneId: 'Asia/Manila', acceptDownloads: true, ...extra });
  await ctx.addInitScript((l) => { try { localStorage.setItem('tala.lang', l); } catch {} }, lang);
  await ctx.addInitScript(pageHelpers);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${view}/${lang}: pageerror: ${String(e).slice(0, 240)}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${view}/${lang}: console: ${m.text().slice(0, 240)}`); });
  page.on('response', (r) => { if (r.status() >= 500 && !new URL(r.url()).pathname.includes('/generation')) errors.push(`${view}/${lang}: ${r.status()} ${new URL(r.url()).pathname}`); });
  await page.goto(base + '/sign-in', { waitUntil: 'networkidle', timeout: 120000 });
  await page.locator('input[type=email]').fill(acct.email);
  await page.locator('input[type=password]').fill(acct.password);
  await page.locator('button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 60000 });
  await page.waitForTimeout(2500);
  return { ctx, page, view, lang };
}
const openLesson = async (s, key) => {
  await s.page.goto(`${base}/lessons/${acct.plans[key].planId}`, { waitUntil: 'networkidle', timeout: 120000 });
  await s.page.waitForTimeout(2000);
};
const shot = async (s, name, fullPage = false) => {
  await s.page.evaluate(() => document.fonts.ready).catch(() => {});
  await s.page.waitForTimeout(300);
  await s.page.screenshot({ path: join(out, 'shots', `${name}-${s.view}-${s.lang}-${label}.png`), fullPage });
};
const snap = (s, kind) => s.page.evaluate(([k, p]) => window.__mwx.snapshot(k, p), [kind, cardPattern(s.lang, kind)]);
const moveLabel = (lang, kind, dir, n) => L(lang)[`editor.move${kind === 'block' ? 'Block' : 'Step'}${dir === 'up' ? 'Up' : 'Down'}`].replace('{n}', String(n));
const serverOrder = async (planKey, kind) => {
  const e = engineFor(`check-${++n}`);
  await syncAll(e);
  const sec = (await e.list('plan_section')).find((x) => x.data.planId === acct.plans[planKey].planId && x.data.key === (kind === 'block' ? 'multigrade' : 'procedure'));
  return kind === 'block' ? sec?.data.content.blocks.map((b) => b.label) : sec?.data.content.steps.map((st) => st.title);
};

/**
 * One press of an arrow, read frame by frame. `via`: mouse | touch | keyboard.
 * Returns what was drawn: how many frames showed the neighbour on its way, how long it took, how far the pressed card
 * strayed from where it was pressed, what the page scroll did, and the state afterwards.
 */
async function measureMove(s, { kind, dir, position, via, settleMs = 1800, place = 0.5 }) {
  const page = s.page;
  const pattern = cardPattern(s.lang, kind);
  const btn = page.getByRole('button', { name: moveLabel(s.lang, kind, dir, position), exact: true });
  await btn.scrollIntoViewIfNeeded();
  await btn.evaluate((el, at) => window.scrollBy(0, el.getBoundingClientRect().top - window.innerHeight * at), place);
  await page.waitForTimeout(400);
  await page.evaluate(([k, p]) => window.__mwx.tag(k, p), [kind, pattern]);
  const before = await snap(s, kind);
  const held = before.order[position - 1];
  const other = before.order[dir === 'up' ? position - 2 : position];
  const box = await btn.boundingBox();
  if (via === 'keyboard') await btn.focus();
  await page.evaluate(([k, p, ms]) => window.__mwx.arm(k, p, ms), [kind, pattern, settleMs]);
  await page.waitForTimeout(120);
  if (via === 'touch') await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  else if (via === 'keyboard') await page.keyboard.press('Enter');
  else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(() => window.__mwx.done, null, { timeout: settleMs + 8000 });
  const samples = await page.evaluate(() => window.__mwx.samples);
  const after = await snap(s, kind);
  const topOf = (sample, key) => sample.cards.find((c) => c[0] === key)?.[1];
  const first = samples[0];
  const last = samples[samples.length - 1];
  const otherStart = topOf(first, other);
  const otherEnd = topOf(last, other);
  const lo = Math.min(otherStart, otherEnd) + 2;
  const hi = Math.max(otherStart, otherEnd) - 2;
  const onTheWay = samples.filter((x) => { const v = topOf(x, other); return v > lo && v < hi; });
  const heldStart = topOf(first, held);
  // The first frame in which anything is drawn differently from the start, and the last one that differs from the end.
  const differs = (a, b) => a.cards.some((c) => Math.abs(c[1] - (topOf(b, c[0]) ?? c[1])) > 0.5) || Math.abs(a.y - b.y) > 0.5;
  const startIdx = samples.findIndex((x) => differs(x, first));
  let endIdx = samples.length - 1;
  while (endIdx > 0 && !differs(samples[endIdx], last)) endIdx--;
  const pressFrame = startIdx > 0 ? samples[startIdx - 1].t : 0;
  return {
    held, other, before, after, samples: samples.length,
    framesOnTheWay: onTheWay.length,
    distinctOnTheWay: new Set(onTheWay.map((x) => Math.round(topOf(x, other)))).size,
    durationMs: startIdx < 0 ? 0 : Math.round(samples[Math.min(endIdx + 1, samples.length - 1)].t - pressFrame),
    heldDrift: Math.max(...samples.map((x) => Math.abs((topOf(x, held) ?? heldStart) - heldStart))),
    heldMoved: Math.round((topOf(last, held) - heldStart) * 10) / 10,
    otherTravel: Math.round(otherEnd - otherStart),
    scrollBy: Math.round(last.y - first.y),
    scrollSteps: new Set(samples.map((x) => Math.round(x.y))).size,
    barLayouts: new Set(samples.map((x) => JSON.stringify(x.segs))).size,
    transformFrames: samples.filter((x) => x.cards.some((c) => c[2])).length,
    outsideShift: Math.max(0, ...after.sections.map((x) => { const b = before.sections.find((y) => y[0] === x[0]); return b ? Math.max(Math.abs(b[1] - x[1]), Math.abs(b[2] - x[2])) : 0; })),
  };
}
/* ------------------------------------------------ the stand-in model (SIMULATED) */
/**
 * Answers the Tala server's own `/chat/completions` call in place of a cloud model. Only the model's answer is
 * simulated: the request, the job, its queued/running/done/failed/cancelled states, the time-out, the cancel and the
 * browser are the real ones. It reads the lesson request out of the server's prompt and writes an answer the server's
 * checks accept (the exact objective texts, the class's own materials, minutes that add up), marked STAND-IN.
 */
function balanced(text, from, open, close) {
  const start = text.indexOf(open, from);
  let depth = 0, inString = false;
  for (let i = start; i >= 0 && i < text.length; i++) {
    const ch = text[i];
    if (inString) { if (ch === '\\') i++; else if (ch === '"') inString = false; continue; }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error('stand-in: could not read the request from the prompt');
}
/** The server hands each variable to the model as `UNTRUSTED_DATA {"name":…,"value":"<JSON text>"}`. */
function promptVariable(prompt, name) {
  for (let at = prompt.indexOf('UNTRUSTED_DATA'); at >= 0; at = prompt.indexOf('UNTRUSTED_DATA', at + 1)) {
    const wrapped = JSON.parse(balanced(prompt, at, '{', '}'));
    if (wrapped.name === name) return JSON.parse(wrapped.value);
  }
  throw new Error(`stand-in: the prompt has no "${name}"`);
}
function standinAnswer(prompt) {
  const input = promptVariable(prompt, 'input');
  const schema = promptVariable(prompt, 'schema');
  const objectives = input.gradeGroups.flatMap((g) => (input.resolvedObjectives?.[g.id] ?? []).filter((t) => !(input.competencies[g.id] ?? []).includes(t)).map((t) => { const id = (input.competencies[g.id] ?? []).find((x) => t.startsWith(`${x}:`)); return id ? t.slice(id.length + 1).trimStart() : t; })).concat(input.customObjectives ?? []);
  const T = input.timeBudgetMinutes;
  const para = (text) => [{ t: 'p', spans: [{ text }] }];
  const make = (spec) => {
    if (spec.key === 'objectives') return { type: 'list', items: objectives.length ? objectives : ['STAND-IN objective'] };
    if (spec.key === 'materials') return { type: 'list', items: (input.classProfile.materials ?? []).slice(0, 2) };
    if (spec.key === 'procedure') return { type: 'procedure', steps: [['STAND-IN review', 5], ['STAND-IN activity', T - 15], ['STAND-IN closing', 10]].map(([title, minutes], i) => ({ id: `standin-${stamp}-${i + 1}`, title, minutes, body: para(`STAND-IN text for step ${i + 1}.`) })) };
    if (spec.key === 'assessment') return { type: 'text', blocks: para(`STAND-IN assessment. ${objectives.join(' ')}`) };
    return spec.contentType === 'list' ? { type: 'list', items: ['STAND-IN item'] } : { type: 'text', blocks: para(`STAND-IN text for ${spec.key}.`) };
  };
  return { title: 'STAND-IN draft', sections: schema.map((spec) => ({ key: spec.key, content: make(spec) })) };
}
async function startStandin(port) {
  const st = { mode: 'ok', delayMs: 3000, calls: 0, answered: 0, aborted: 0, open: 0, errors: [], pending: [] };
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) return void res.writeHead(404).end();
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      st.calls++;
      st.open++;
      const mode = st.mode;
      let over = false;
      const end = (status, payload) => {
        if (over) return;
        over = true;
        st.open--;
        st.answered++;
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(payload));
      };
      res.on('close', () => { if (!over) { over = true; st.open--; st.aborted++; } });
      const answer = () => {
        try {
          if (mode === 'error') return end(500, { error: { code: 'other', message: 'stand-in error' } });
          const content = mode === 'garbage' ? 'this is not JSON' : JSON.stringify(standinAnswer(JSON.parse(body).messages[0].content));
          end(200, { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100 } });
        } catch (err) {
          st.errors.push(String(err));
          console.log(`stand-in could not answer: ${String(err).slice(0, 200)}`);
          if (process.env.MW_DUMP_PROMPT) writeFileSync(process.env.MW_DUMP_PROMPT, body);
          end(500, { error: { code: 'other' } });
        }
      };
      if (mode === 'hang') return; // never answers: the server's own time-out ends the wait
      const timer = setTimeout(answer, st.delayMs);
      st.pending.push(() => { clearTimeout(timer); answer(); });
    });
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolve));
  /** Answer whatever is waiting now (the walk has seen what it wanted to see). */
  st.release = () => { for (const f of st.pending.splice(0)) f(); };
  st.close = () => new Promise((resolve) => server.close(resolve));
  return st;
}
/** The waiting state as drawn. Works on the build before the change too (there it finds the old one-line state). */
const aiState = (s) => s.page.evaluate((working) => {
  const el = document.querySelector('.tala-ai');
  if (!el) {
    const old = [...document.querySelectorAll('[role="status"]')].find((x) => x.textContent.includes(working));
    return old ? { old: true, text: old.textContent.trim(), running: document.getAnimations().filter((a) => a.playState === 'running').length } : null;
  }
  const bar = el.querySelector('.tala-ai-bar > span');
  const mark = el.querySelector('.tala-ai-mark');
  const cap = el.querySelector('[role="status"]');
  const cancel = [...el.querySelectorAll('button')][0];
  return {
    phase: el.dataset.aiPhase, status: el.dataset.aiStatus, caption: cap?.textContent.trim() ?? '', live: cap?.getAttribute('aria-live'), atomic: cap?.getAttribute('aria-atomic'),
    elapsed: el.querySelector('[data-ai-elapsed]')?.textContent.trim() ?? '', elapsedHidden: el.querySelector('[data-ai-elapsed]')?.getAttribute('aria-hidden'),
    barAnim: bar ? getComputedStyle(bar).animationName : null, barState: bar ? getComputedStyle(bar).animationPlayState : null, barWidth: bar ? Math.round(bar.getBoundingClientRect().width) : null, trackWidth: bar ? Math.round(bar.parentElement.getBoundingClientRect().width) : null, barHidden: bar?.parentElement.getAttribute('aria-hidden'),
    markAnim: mark ? getComputedStyle(mark).animationName : null, markState: mark ? getComputedStyle(mark).animationPlayState : null,
    height: Math.round(el.getBoundingClientRect().height * 10) / 10, cancelHeight: cancel ? Math.round(cancel.getBoundingClientRect().height) : null,
    sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
}, L(s.lang)['gen.working'].slice(0, 12));
/** Every change of the waiting state while it is on screen: when, which state, which words, how tall, where the next button is. */
const watchAi = (s) => s.page.evaluate(() => {
  const mw = window.__mwx;
  mw.aiLog = [];
  const t0 = Date.now();
  let last = '';
  clearInterval(mw.aiTimer);
  mw.aiTimer = setInterval(() => {
    const el = document.querySelector('.tala-ai');
    const cur = el ? `${el.dataset.aiPhase}/${el.dataset.aiStatus}` : 'gone';
    if (cur === last) return;
    last = cur;
    const next = el?.nextElementSibling;
    mw.aiLog.push({ t: Date.now() - t0, state: cur, caption: el?.querySelector('[role="status"]')?.textContent.trim() ?? null, height: el ? Math.round(el.getBoundingClientRect().height * 10) / 10 : null, nextTop: next ? Math.round((next.getBoundingClientRect().top + window.scrollY) * 10) / 10 : null });
  }, 40);
});
const aiLog = (s) => s.page.evaluate(() => window.__mwx.aiLog ?? []);
/** Where the bar's moving piece and the mark are drawn, every frame for `ms`. */
const sampleAi = (s, ms) => s.page.evaluate((ms) => new Promise((resolve) => {
  const bar = document.querySelector('.tala-ai-bar > span');
  const mark = document.querySelector('.tala-ai-mark');
  const out = [];
  const t0 = performance.now();
  const tick = (now) => {
    out.push([bar ? Math.round(bar.getBoundingClientRect().left * 10) / 10 : null, mark ? Math.round(parseFloat(getComputedStyle(mark).opacity) * 100) / 100 : null]);
    if (now - t0 < ms) requestAnimationFrame(tick);
    else resolve({ frames: out.length, barPositions: new Set(out.map((x) => x[0])).size, markLevels: new Set(out.map((x) => x[1])).size });
  };
  requestAnimationFrame(tick);
}), ms);
const jobsOf = (planKey) => {
  const d = db();
  const rows = d.prepare("select status, json_extract(job,'$.failure.reason') reason from generation_jobs where json_extract(input,'$.planId')=? order by rowid").all(acct.plans[planKey].planId);
  d.close();
  return rows;
};
const openGenerate = async (s, planKey) => {
  await s.page.goto(`${base}/generate?planId=${acct.plans[planKey].planId}`, { waitUntil: 'networkidle', timeout: 120000 });
  await s.page.waitForTimeout(1500);
  return s.page.getByRole('button', { name: L(s.lang)['gen.start'], exact: true });
};
const waitAi = (s, status, timeout = 15000) => s.page.waitForFunction((st) => document.querySelector('.tala-ai')?.dataset.aiStatus === st, status, { timeout });
const SIM = 'STAND-IN MODEL';

const brief = (m) => `${m.framesOnTheWay} frames on the way (${m.distinctOnTheWay} distinct positions) over ${m.durationMs} ms (${m.durationMs ? Math.round((m.framesOnTheWay / m.durationMs) * 1000) : 0} drawn per second in this headless browser); the neighbour travelled ${m.otherTravel} px; the pressed card strayed ${m.heldDrift.toFixed(2)} px; page scrolled ${m.scrollBy} px in ${m.scrollSteps} steps; bar ${m.barLayouts} layouts`;
const swapped = (order, i, j) => { const o = [...order]; [o[i], o[j]] = [o[j], o[i]]; return o; };
/** `before` runs of this walk only record what the old build does; `after` runs judge. */
const judge = (name, ok, detail) => (label === 'before' ? note(`(before the change) ${name}`, `${ok ? 'holds' : 'does NOT hold'} — ${detail}`) : check(name, ok, detail));

try {
  if (phase === 'reorder') {
    /* ---- desktop, mouse: the Session Flow's time blocks ---- */
    const d = await open('desktop', 'en');
    await openLesson(d, 'multigrade');
    const start = (await snap(d, 'block')).order;
    check('the seeded Session Flow has four time blocks', start.length === 4, start.join(' | '));
    await shot(d, 'r1-before-move');
    let m = await measureMove(d, { kind: 'block', dir: 'up', position: 3, via: 'mouse' });
    await shot(d, 'r1-after-move');
    const want1 = swapped(start, 1, 2);
    check('desktop, mouse: “Move block 3 up” changes the order (blocks 2 and 3 trade places)', JSON.stringify(m.after.order) === JSON.stringify(want1), m.after.order.join(' | '));
    judge('desktop, mouse: the move is DRAWN — the block it passes is seen on its way, frame by frame, not swapped in one frame', m.framesOnTheWay >= 8 && m.distinctOnTheWay >= 6, brief(m));
    judge('desktop, mouse: the movement is quick (0.2–0.5 s)', m.durationMs >= 200 && m.durationMs <= 500, `${m.durationMs} ms`);
    judge('desktop, mouse: the block that was pressed stays where it was pressed (within a pixel, in every frame)', m.heldDrift <= 1 && Math.abs(m.heldMoved) <= 1, `strayed ${m.heldDrift.toFixed(2)} px over ${m.samples} frames; ended ${m.heldMoved} px from where it was`);
    judge('desktop, mouse: the page reaches its new scroll position smoothly, in step with the blocks (not in one jump)', m.scrollSteps >= 8, `${m.scrollBy} px in ${m.scrollSteps} steps`);
    judge('desktop, mouse: the timeline bar’s segments glide to their new places', m.barLayouts >= 6, `${m.barLayouts} distinct layouts`);
    check('desktop, mouse: the SAME cards moved — each card is the same element as before, with its own content (stable identity)', m.after.tags.every((tag, i) => tag === m.after.order[i]), m.after.tags.join(' | '));
    check('desktop, mouse: nothing outside the list shifted (every section starts and ends where it did; page height unchanged; no sideways scroll)', m.outsideShift <= 0.5 && m.after.docHeight === m.before.docHeight && !m.after.sideways, `largest shift ${m.outsideShift} px; height ${m.before.docHeight} → ${m.after.docHeight}`);
    check('desktop, mouse: focus stays on the arrow that was pressed, now named for the block’s new place', m.after.active === moveLabel('en', 'block', 'up', 2) && m.after.activeVisible === true, String(m.after.active));
    judge('desktop, mouse: once it has settled nothing is left running or marked (no transform, no animation, no highlight)', m.after.leftovers === 0 && m.after.marked === 0 && m.after.running === 0, `leftovers ${m.after.leftovers}, marked ${m.after.marked}, running animations ${m.after.running}`);

    /* ---- persistence: the device after a reload, and the server (what another device gets) ---- */
    await d.page.waitForTimeout(2500);
    const savedLine = await d.page.locator('p[aria-live="polite"]').first().innerText();
    await d.page.reload({ waitUntil: 'networkidle', timeout: 120000 });
    await d.page.waitForTimeout(2500);
    const reloaded = (await snap(d, 'block')).order;
    const onServer = await serverOrder('multigrade', 'block');
    check('persistence: after a reload the blocks are in the moved order, and the server has the same order', JSON.stringify(reloaded) === JSON.stringify(want1) && JSON.stringify(onServer) === JSON.stringify(want1), `status line “${savedLine}”; device ${reloaded.join(' | ')}; server ${(onServer ?? []).join(' | ')}`);

    /* ---- keyboard: to the top, where the pressed arrow switches off ---- */
    m = await measureMove(d, { kind: 'block', dir: 'up', position: 2, via: 'keyboard' });
    const want2 = swapped(want1, 0, 1);
    check('keyboard: Enter on “Move block 2 up” moves the block to the top', JSON.stringify(m.after.order) === JSON.stringify(want2), m.after.order.join(' | '));
    judge('keyboard: at the top the Up arrow is switched off and focus passes to the same block’s Down arrow (never lost to the page)', m.after.active === moveLabel('en', 'block', 'down', 1) && m.after.activeDisabled === false && m.after.activeVisible === true, `focus is on: ${m.after.active}${m.after.activeDisabled ? ' (disabled)' : ''}`);
    judge('keyboard: the move is drawn the same way', m.framesOnTheWay >= 8 && m.heldDrift <= 1, brief(m));
    judge('keyboard: a screen reader is told the block’s new place once, in the interface’s own words', m.after.status.includes(en['editor.block'].replace('{n}', '1')) || m.before.status.length === 0, `live region during the move: ${JSON.stringify(m.after.status)} (read 1.8 s after the press; it is cleared after 2.5 s)`);
    // Enter again: focus is on a working control, so the keyboard keeps working.
    await d.page.keyboard.press('Enter');
    await d.page.waitForTimeout(900);
    const afterSecond = await snap(d, 'block');
    judge('keyboard: pressing Enter again acts on the block that was just moved (it goes down one place)', JSON.stringify(afterSecond.order) === JSON.stringify(want1), afterSecond.order.join(' | '));
    if (JSON.stringify(afterSecond.order) !== JSON.stringify(want1)) {
      // The old build drops focus at the top: put the lesson in the order the rest of the walk expects.
      const b = d.page.getByRole('button', { name: moveLabel('en', 'block', 'down', 1), exact: true });
      await b.click();
      await d.page.waitForTimeout(900);
    }

    /* ---- two presses in quick succession: the second starts while the first is still moving ---- */
    {
      const pattern = cardPattern('en', 'block');
      const b = d.page.getByRole('button', { name: moveLabel('en', 'block', 'down', 2), exact: true });
      await b.scrollIntoViewIfNeeded();
      await b.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - window.innerHeight * 0.3));
      await d.page.waitForTimeout(400);
      const before = await snap(d, 'block');
      const held = before.order[1];
      const box = await b.boundingBox();
      await d.page.evaluate(([k, p, ms]) => window.__mwx.arm(k, p, ms), ['block', pattern, 2200]);
      await d.page.waitForTimeout(100);
      await d.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await d.page.waitForTimeout(130);
      await d.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await d.page.waitForFunction(() => window.__mwx.done, null, { timeout: 12000 });
      const samples = await d.page.evaluate(() => window.__mwx.samples);
      const after = await snap(d, 'block');
      const tops = samples.map((x) => x.cards.find((c) => c[0] === held)?.[1]).filter((v) => v !== undefined);
      const drift = Math.max(...tops.map((v) => Math.abs(v - tops[0])));
      const want = [before.order[0], before.order[2], before.order[3], before.order[1]];
      judge('two quick presses: the block ends two places down (both presses counted, in order)', JSON.stringify(after.order) === JSON.stringify(want), after.order.join(' | '));
      judge('two quick presses: the second move continues from where the first had got to — the pressed block stays under the pointer throughout, and nothing is left running', drift <= 1.5 && after.leftovers === 0 && after.running === 0, `pressed card strayed ${drift.toFixed(2)} px over ${samples.length} frames; leftovers ${after.leftovers}`);
      await d.page.waitForTimeout(2500);
      const srv = await serverOrder('multigrade', 'block');
      check('two quick presses: the device and the server agree on the final order (no save race)', JSON.stringify(srv) === JSON.stringify(after.order), `device ${after.order.join(' | ')}; server ${(srv ?? []).join(' | ')}`);
      // Back to the seeded order for the next views (only when the two presses did what they should).
      if (JSON.stringify(after.order) === JSON.stringify(want))
        for (const [dir, pos] of [['up', 4], ['up', 3]]) {
          await d.page.getByRole('button', { name: moveLabel('en', 'block', dir, pos), exact: true }).click();
          await d.page.waitForTimeout(900);
        }
    }

    /* ---- add a block, then remove it (it is empty, so no confirmation): the others make room and close up ---- */
    {
      const pattern = cardPattern('en', 'block');
      const add = d.page.getByRole('button', { name: `+ ${en['editor.addBlock']}`, exact: true });
      await add.scrollIntoViewIfNeeded();
      await d.page.waitForTimeout(300);
      const before = await snap(d, 'block');
      await add.click();
      const entering = await d.page.evaluate(([k, p]) => { const c = window.__mwx.cards(k, p); const lastCard = c[c.length - 1]; return { n: c.length, enter: lastCard?.hasAttribute('data-reorder-enter') ?? false, anim: lastCard ? getComputedStyle(lastCard).animationName : '' }; }, ['block', pattern]);
      judge('adding a block: the new block arrives with a short fade (it is there at once; nothing waits for it)', entering.n === before.order.length + 1 && entering.enter && entering.anim !== 'none', JSON.stringify(entering));
      await d.page.waitForTimeout(700);
      // Remove block 2 of 5 instead of the new one: the three below it must close the gap.
      const five = await snap(d, 'block');
      check('adding a block: there are five blocks now', five.order.length === 5, five.order.join(' | '));
      const rm = d.page.getByRole('button', { name: en['editor.removeBlock'].replace('{n}', '5'), exact: true });
      await rm.scrollIntoViewIfNeeded();
      await rm.click();
      await d.page.waitForTimeout(900);
      const back = await snap(d, 'block');
      check('removing the empty block needs no confirmation and leaves the four seeded blocks', JSON.stringify(back.order) === JSON.stringify(before.order) && back.leftovers === 0, back.order.join(' | '));
      // The next device starts from the server: wait until this device has sent the removal.
      let srv = null;
      for (let i = 0; i < 12 && JSON.stringify(srv) !== JSON.stringify(before.order); i++) {
        await d.page.waitForTimeout(1000);
        srv = await serverOrder('multigrade', 'block');
      }
      check('add and remove reached the server (four blocks, in the same order)', JSON.stringify(srv) === JSON.stringify(before.order), (srv ?? []).join(' | '));
    }
    await d.ctx.close();

    /* ---- phone, touch ---- */
    const ph = await open('phone', 'en');
    await openLesson(ph, 'multigrade');
    const phStart = (await snap(ph, 'block')).order;
    m = await measureMove(ph, { kind: 'block', dir: 'down', position: 2, via: 'touch' });
    const phWant = swapped(phStart, 1, 2);
    check('phone, touch: tapping “Move block 2 down” changes the order', JSON.stringify(m.after.order) === JSON.stringify(phWant), m.after.order.join(' | '));
    judge('phone, touch: the move is drawn frame by frame, quickly', m.framesOnTheWay >= 8 && m.distinctOnTheWay >= 6 && m.durationMs >= 200 && m.durationMs <= 520, brief(m));
    judge('phone, touch: the block that was tapped stays under the finger (within a pixel, in every frame)', m.heldDrift <= 1 && Math.abs(m.heldMoved) <= 1, `strayed ${m.heldDrift.toFixed(2)} px; ended ${m.heldMoved} px from where it was`);
    check('phone, touch: nothing outside the list shifted, no sideways scroll, and the arrows are still touch-sized', m.outsideShift <= 0.5 && !m.after.sideways && (await ph.page.getByRole('button', { name: moveLabel('en', 'block', 'down', 3), exact: true }).boundingBox()).height >= 43, `largest shift ${m.outsideShift} px`);
    await shot(ph, 'r3-after-touch-move');
    m = await measureMove(ph, { kind: 'block', dir: 'up', position: 3, via: 'touch' });
    check('phone, touch: tapping “Move block 3 up” puts it back', JSON.stringify(m.after.order) === JSON.stringify(phStart), m.after.order.join(' | '));
    // The last block, pressed low on the screen (just above the bottom bar).
    m = await measureMove(ph, { kind: 'block', dir: 'up', position: 4, via: 'touch', place: 0.72 });
    judge('phone, touch: the last block moved up from low on the screen: right order, held in place, nothing left running', JSON.stringify(m.after.order) === JSON.stringify(swapped(phStart, 2, 3)) && m.heldDrift <= 1 && m.after.leftovers === 0, `${brief(m)}; ended ${m.heldMoved} px from where it was`);
    m = await measureMove(ph, { kind: 'block', dir: 'down', position: 3, via: 'touch' });
    check('phone, touch: and back', JSON.stringify(m.after.order) === JSON.stringify(phStart), m.after.order.join(' | '));
    await ph.page.waitForTimeout(3000);
    await ph.ctx.close();

    /* ---- foldable width, Filipino: the same list in the other language ---- */
    const fo = await open('foldable', 'fil');
    await openLesson(fo, 'multigrade');
    const foStart = (await snap(fo, 'block')).order;
    m = await measureMove(fo, { kind: 'block', dir: 'up', position: 2, via: 'touch' });
    check('foldable, Filipino: the move works and is announced in Filipino words that already exist', JSON.stringify(m.after.order) === JSON.stringify(swapped(foStart, 0, 1)) && (label === 'before' || m.after.status.includes(fil['editor.block'].replace('{n}', '1'))), `${m.after.order.join(' | ')}; live region ${JSON.stringify(m.after.status)}`);
    judge('foldable, Filipino: drawn frame by frame, pressed block held in place, no sideways scroll', m.framesOnTheWay >= 6 && m.heldDrift <= 1 && !m.after.sideways, brief(m));
    m = await measureMove(fo, { kind: 'block', dir: 'down', position: 1, via: 'touch' });
    check('foldable, Filipino: moved back', JSON.stringify(m.after.order) === JSON.stringify(foStart), m.after.order.join(' | '));
    await fo.page.waitForTimeout(3000);
    await fo.ctx.close();

    /* ---- the Procedure's steps (single-grade lesson) ---- */
    const p2 = await open('desktop', 'en');
    await openLesson(p2, 'procedure');
    const steps = (await snap(p2, 'step')).order;
    check('the seeded Procedure has four steps', steps.length === 4, steps.join(' | '));
    m = await measureMove(p2, { kind: 'step', dir: 'down', position: 1, via: 'mouse' });
    check('Procedure: “Move step 1 down” changes the order', JSON.stringify(m.after.order) === JSON.stringify(swapped(steps, 0, 1)), m.after.order.join(' | '));
    judge('Procedure: the step’s move is drawn frame by frame and the pressed step stays in place', m.framesOnTheWay >= 6 && m.heldDrift <= 1 && m.after.leftovers === 0, brief(m));
    judge('Procedure: the steps’ timeline bar follows', m.barLayouts >= 6, `${m.barLayouts} layouts`);
    await p2.page.waitForTimeout(2500);
    const stepsServer = await serverOrder('procedure', 'step');
    check('Procedure: the new order of steps reached the server', JSON.stringify(stepsServer) === JSON.stringify(swapped(steps, 0, 1)), (stepsServer ?? []).join(' | '));
    m = await measureMove(p2, { kind: 'step', dir: 'up', position: 2, via: 'keyboard' });
    check('Procedure: moved back by keyboard; at the top, focus is on the step’s other arrow', JSON.stringify(m.after.order) === JSON.stringify(steps) && (label === 'before' || m.after.active === moveLabel('en', 'step', 'down', 1)), `${m.after.order.join(' | ')}; focus on ${m.after.active}`);
    await p2.ctx.close();
  }
  if (phase === 'ai-standin') {
    const st = await startStandin(Number(option('standin-port', '3339')));
    const isNew = label !== 'before';
    // --only A,C,Q runs some scenarios (letters as in the comments below); everything by default.
    const only = option('only') ? option('only').split(',') : null;
    const want = (k) => !only || only.includes(k);
    const drafted = (u) => u.pathname.startsWith('/lessons/') && u.searchParams.get('drafted') === '1';
    const procedureTitles = (s) => s.page.locator('section[aria-labelledby="s-procedure"] input').evaluateAll((els) => els.map((e) => e.value));
    try {
      const d = await open('desktop', 'en');
      // The browser's request that creates the job is held back 0.9 s (a network delay only: it still reaches the
      // real server), so the moment before the server has answered can be seen.
      let holdCreate = 900;
      // …and, for one scenario, dropped altogether (the request never reaches the server, as on a dead connection).
      let dropCreate = false;
      await d.ctx.route('**/api/v1/generation/jobs', async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        if (dropCreate) return route.abort('connectionfailed');
        if (holdCreate) await new Promise((r) => setTimeout(r, holdCreate));
        await route.continue();
      });

      let startBtn;
      /* ---- A. asked → sent → being written → in the lesson ---- */
      if (want('A')) {
      st.mode = 'ok';
      st.delayMs = 7000;
      startBtn = await openGenerate(d, 'draftPlain');
      await shot(d, 'a0-form');
      const calls0 = st.calls;
      const jobs0 = jobsOf('draftPlain').length;
      await watchAi(d);
      await startBtn.click();
      await startBtn.click({ timeout: 250 }).catch(() => {}); // a second press, as fast as a hand can
      if (!isNew) {
        await d.page.getByText(en['gen.working']).waitFor({ timeout: 8000 });
        await d.page.waitForTimeout(2500);
        const old = await aiState(d);
        note(`(before the change) ${SIM}: while Tala writes, the page shows one line beside a still grey dot — nothing moves and the words never change`, `“${old?.text}”; animations running on the page: ${old?.running}`);
        await shot(d, 'a1-writing');
        await d.page.waitForURL(drafted, { timeout: 30000 });
        note(`(before the change) ${SIM}: two fast presses`, `${jobsOf('draftPlain').length - jobs0} job(s) on the server, ${st.calls - calls0} call(s) to the model`);
      } else {
        await d.page.locator('.tala-ai').waitFor({ timeout: 3000 });
        const s0 = await aiState(d);
        check(`${SIM}: the waiting state appears at once and says the request is being sent (the server has not answered yet)`, s0.status === 'sending' && s0.caption === en['ai.status.sending'], `${s0.phase}: “${s0.caption}”`);
        await waitAi(d, 'running');
        const s1 = await aiState(d);
        check(`${SIM}: once the server reports the job as running, it says the request arrived and Tala is writing`, s1.phase === 'running' && s1.caption === en['ai.status.running'], `${s1.phase}: “${s1.caption}”`);
        const motion = await sampleAi(d, 900);
        check(`${SIM}: the working bar and the mark really move while the request is open (drawn frame by frame)`, motion.barPositions >= 10 && motion.markLevels >= 4 && s1.barAnim === 'tala-ai-slide' && s1.barState === 'running' && s1.markAnim === 'tala-ai-breathe', `${motion.frames} frames: ${motion.barPositions} bar positions, ${motion.markLevels} mark levels`);
        await d.page.waitForTimeout(2200);
        const s2 = await aiState(d);
        check(`${SIM}: the time really waited is shown and counts up`, /^\d+:\d\d so far$/.test(s1.elapsed) && /^\d+:\d\d so far$/.test(s2.elapsed) && s1.elapsed !== s2.elapsed, `${s1.elapsed} → ${s2.elapsed}`);
        check(`${SIM}: for a screen reader the caption is one polite live region; the ticking time and the bar are hidden from it`, s1.live === 'polite' && s1.atomic === 'true' && s1.elapsedHidden === 'true' && s1.barHidden === 'true', JSON.stringify({ live: s1.live, time: s1.elapsedHidden, bar: s1.barHidden }));
        const bg = await d.page.getByRole('button', { name: en['gen.background'], exact: true }).boundingBox();
        check(`${SIM}: Cancel and “Run in background” stay available and touch-sized`, s1.cancelHeight >= 44 && bg && bg.height >= 44, `Cancel ${s1.cancelHeight} px, Run in background ${bg ? Math.round(bg.height) : 0} px`);
        await shot(d, 'a1-writing');
        await d.page.waitForURL(drafted, { timeout: 30000 });
        await d.page.waitForTimeout(1500);
        const log = await aiLog(d);
        const order = log.map((x) => x.state);
        const legal = ['sending/sending', 'queued/queued', 'running/running', 'gone'];
        check(`${SIM}: the states came in the request’s own order and the waiting state was taken away when the draft arrived`, order.every((x) => legal.includes(x)) && order.join(' ').replace(' queued/queued', '').endsWith('sending/sending running/running gone'), order.map((x, i) => `${log[i].t} ms ${x}`).join(' → '));
        check(`${SIM}: the words changed only when the state did (${log.filter((x) => x.caption).length} lines in all: nothing to flood a screen reader)`, log.filter((x) => x.caption).length <= 3);
        check(`${SIM}: nothing moved when the words changed (the box kept its height and the button below kept its place)`, new Set(log.filter((x) => x.height).map((x) => x.height)).size === 1 && new Set(log.filter((x) => x.nextTop).map((x) => x.nextTop)).size === 1, JSON.stringify(log.filter((x) => x.height).map((x) => [x.height, x.nextTop])));
        const toast = await d.page.getByText(en['gen.done']).count();
        const titles = await procedureTitles(d);
        check(`${SIM}: the draft is in the lesson, the page says “${en['gen.done']}”, and no working animation is left behind`, toast >= 1 && titles.includes('STAND-IN review') && (await aiState(d)) === null && (await d.page.evaluate(() => document.getAnimations().filter((a) => String(a.animationName ?? '').startsWith('tala-ai')).length)) === 0, titles.join(' | '));
        const jobs = jobsOf('draftPlain').slice(jobs0);
        check(`${SIM}: two fast presses made exactly one request (one job on the server, one call to the model)`, jobs.length === 1 && jobs[0].status === 'done' && st.calls - calls0 === 1, `${JSON.stringify(jobs)}; model calls ${st.calls - calls0}`);
        await shot(d, 'a2-drafted', true);
      }
      }

      /* ---- B. a slow answer, in real time: after 20 s the words change, nothing else does ---- */
      if (isNew && want('B')) {
        st.delayMs = 24000;
        startBtn = await openGenerate(d, 'draftPlain');
        await watchAi(d);
        const t0 = Date.now();
        await startBtn.click();
        await waitAi(d, 'still', 30000);
        const waited = Date.now() - t0;
        const s3 = await aiState(d);
        check(`${SIM}, REAL time: after 20 seconds of really waiting the caption changes to the reassurance, and the bar is still moving`, waited >= 19500 && waited <= 23000 && s3.caption === en['ai.status.still'] && s3.barState === 'running', `after ${(waited / 1000).toFixed(1)} s: “${s3.caption}” · ${s3.elapsed}`);
        await shot(d, 'b1-still-writing');
        await d.page.waitForURL(drafted, { timeout: 30000 });
        const log = await aiLog(d);
        check(`${SIM}, REAL time: through all of it the box and the buttons stayed exactly where they were`, new Set(log.filter((x) => x.height).map((x) => x.height)).size === 1 && new Set(log.filter((x) => x.nextTop).map((x) => x.nextTop)).size === 1, log.map((x) => `${(x.t / 1000).toFixed(1)} s ${x.state}`).join(' → '));
      }

      /* ---- C. the model fails: the real failure is shown and the waiting state stops ---- */
      if (want('C')) {
      st.mode = 'error';
      st.delayMs = 1500;
      startBtn = await openGenerate(d, 'draftRetry');
      const jobsC = jobsOf('draftRetry').length;
      await startBtn.click();
      await d.page.getByText(en['gen.failed.providers_unavailable']).waitFor({ timeout: 60000 });
      const failedJobs = jobsOf('draftRetry').slice(jobsC);
      const afterFail = await aiState(d);
      check(`${SIM} (the model answers with an error): the page says the writing service is not answering, offers the template, and the waiting state is gone`, afterFail === null && failedJobs.length === 1 && failedJobs[0].status === 'failed' && failedJobs[0].reason === 'providers_unavailable' && (await d.page.getByRole('button', { name: en['gen.usePrefilled'], exact: true }).count()) === 1, JSON.stringify(failedJobs));
      await shot(d, 'c1-failed');
      // “Queue it” after that failure: the model works again. The queue must ask AGAIN, not be handed the old failure.
      {
        st.mode = 'ok';
        st.delayMs = 1500;
        const callsQ = st.calls;
        const jobsQ = jobsOf('draftRetry').length;
        await d.page.getByRole('button', { name: en['gen.keepWaiting'], exact: true }).click();
        await d.page.waitForURL((u) => u.pathname.startsWith('/lessons/'), { timeout: 15000 });
        // The background runner looks every 20 s: give it three rounds.
        let titles = [];
        for (let i = 0; i < 70 && !titles.includes('STAND-IN review'); i++) {
          await d.page.waitForTimeout(1000);
          titles = await procedureTitles(d);
        }
        const rows = jobsOf('draftRetry').slice(jobsQ);
        const notice = await d.page.getByText(en['gen.failed.providers_unavailable']).count();
        judge(`${SIM}: “Queue it” after a failure asks the model again (a new request) and that draft is written into the lesson — it is not handed the old failure back`, st.calls - callsQ === 1 && rows.length === 1 && rows[0].status === 'done' && titles.includes('STAND-IN review') && notice === 0, `model calls after “Queue it”: ${st.calls - callsQ}; new jobs ${JSON.stringify(rows)}; procedure in the lesson: ${titles.join(' | ') || '(empty)'}; failure notices in the lesson: ${notice}`);
      }

      }

      /* ---- T. the model never answers: the server's own time-out ends it (REAL time-out) ---- */
      if (want('T')) {
      st.mode = 'hang';
      startBtn = await openGenerate(d, 'draftPlain');
      const jobsT = jobsOf('draftPlain').length;
      const tHang = Date.now();
      await startBtn.click();
      await d.page.getByText(en['gen.failed.providers_unavailable']).waitFor({ timeout: 120000 });
      const hung = jobsOf('draftPlain').slice(jobsT);
      check(`${SIM} (the model never answers): the server gives up by its own time-out and the page shows that failure; the waiting state does not run on`, (await aiState(d)) === null && hung.length === 1 && hung[0].status === 'failed', `${((Date.now() - tHang) / 1000).toFixed(1)} s until the failure was shown; ${JSON.stringify(hung)}`);

      }

      /* ---- D. cancel, then ask again ---- */
      if (want('D')) {
      st.mode = 'ok';
      st.delayMs = 20000;
      startBtn = await openGenerate(d, 'draftCancel');
      const jobsD = jobsOf('draftCancel').length;
      const aborted0 = st.aborted;
      await startBtn.click();
      if (isNew) await waitAi(d, 'running');
      else await d.page.getByText(en['gen.working']).waitFor({ timeout: 8000 });
      await d.page.waitForTimeout(1200);
      await d.page.getByRole('button', { name: en['common.cancel'], exact: true }).click();
      await d.page.getByText(en['gen.cancelled']).waitFor({ timeout: 10000 });
      await d.page.waitForTimeout(1500);
      const cancelled = jobsOf('draftCancel').slice(jobsD);
      check(`${SIM}: Cancel ends the request for real — the page says nothing was changed, the job is cancelled on the server and the model call was dropped`, (await aiState(d)) === null && cancelled.length === 1 && cancelled[0].status === 'cancelled' && st.aborted - aborted0 === 1, `${JSON.stringify(cancelled)}; model calls dropped ${st.aborted - aborted0}`);
      await shot(d, 'd1-cancelled');
      // Ask again on the same page: it must be a NEW request, not the cancelled one handed back.
      st.delayMs = 4000;
      await d.page.getByRole('button', { name: en['gen.start'], exact: true }).click();
      const again = await d.page.waitForURL(drafted, { timeout: 30000 }).then(() => true).catch(() => false);
      const afterAgain = jobsOf('draftCancel').slice(jobsD);
      judge(`${SIM}: asking again after a cancel starts a new request and the draft arrives`, again && afterAgain.length === 2 && afterAgain[1].status === 'done', `${JSON.stringify(afterAgain)}; page: ${new URL(d.page.url()).pathname}${new URL(d.page.url()).search}; says: ${JSON.stringify(await d.page.locator('[role="status"], [role="alert"]').allInnerTexts().then((x) => x.filter(Boolean).slice(0, 3)))}`);

      }

      /* ---- E. the connection drops while waiting ---- */
      if (isNew && want('E')) {
        st.delayMs = 60000;
        startBtn = await openGenerate(d, 'draftPlain');
        await startBtn.click();
        await waitAi(d, 'running');
        await d.ctx.setOffline(true);
        await waitAi(d, 'offline', 20000);
        const off = await aiState(d);
        check(`${SIM}: when the connection drops the page says so and stops claiming movement (bar and mark paused)`, off.caption === en['ai.status.offline'] && off.barState === 'paused' && off.markState === 'paused', `“${off.caption}” · bar ${off.barState}`);
        await shot(d, 'e1-offline');
        await d.ctx.setOffline(false);
        await waitAi(d, 'running', 45000);
        st.release();
        const back = await d.page.waitForURL(drafted, { timeout: 30000 }).then(() => true).catch(() => false);
        check(`${SIM}: when the connection is back the page goes on waiting and the draft arrives (the request was never lost)`, back, new URL(d.page.url()).pathname + new URL(d.page.url()).search);
      }

      /* ---- F. the teacher leaves the page while Tala is still writing ---- */
      if (want('F')) {
        st.mode = 'ok';
        st.delayMs = 6000;
        startBtn = await openGenerate(d, 'draftAway');
        await startBtn.click();
        if (isNew) await waitAi(d, 'running');
        else await d.page.waitForTimeout(2000);
        // She goes to This Week by the side rail.
        await d.page.getByRole('link', { name: en['nav.week'], exact: true }).first().click();
        await d.page.waitForURL((u) => u.pathname.startsWith('/week'), { timeout: 15000 });
        const gone = isNew ? (await aiState(d)) === null : true;
        // Watch where she is for the next 40 s (the model answers after 6 s; the background runner looks every 20 s).
        const places = new Set();
        for (let i = 0; i < 40; i++) {
          await d.page.waitForTimeout(1000);
          places.add(new URL(d.page.url()).pathname);
        }
        const awayJobs = jobsOf('draftAway');
        await openLesson(d, 'draftAway');
        const titles = await procedureTitles(d);
        judge(`${SIM}: leaving the page while Tala writes takes the waiting state away, never pulls her back to the lesson, and the draft is in the lesson when she opens it (one job, written once)`, gone && [...places].join() === '/week' && awayJobs.length === 1 && awayJobs[0].status === 'done' && titles.filter((x) => x === 'STAND-IN review').length === 1, `she was on: ${[...places].join(', ')}; jobs ${JSON.stringify(awayJobs)}; procedure: ${titles.join(' | ') || '(empty)'}`);
      }

      /* ---- Q. the request cannot reach Tala: it is kept on the device and written when Tala can be reached ---- */
      if (want('Q')) {
        st.mode = 'ok';
        st.delayMs = 1500;
        const callsQ = st.calls;
        startBtn = await openGenerate(d, 'draftQueue');
        dropCreate = true; // SIMULATED dead connection for this one call
        await startBtn.click();
        await d.page.waitForURL((u) => u.pathname.startsWith('/lessons/'), { timeout: 60000 });
        await d.page.waitForTimeout(1500);
        const prefilled = await d.page.locator('section[aria-labelledby="s-objectives"] input').evaluateAll((els) => els.map((e) => e.value));
        dropCreate = false;
        let titles = [];
        for (let i = 0; i < 80 && !titles.includes('STAND-IN review'); i++) {
          await d.page.waitForTimeout(1000);
          titles = await procedureTitles(d);
        }
        const rows = jobsOf('draftQueue');
        await d.page.waitForTimeout(1500);
        const afterQ = {
          objectives: await d.page.locator('section[aria-labelledby="s-objectives"] input').evaluateAll((els) => els.map((e) => e.value)),
          materials: await d.page.locator('section[aria-labelledby="s-materials"] input').evaluateAll((els) => els.map((e) => e.value)),
          says: await d.page.locator('main [role="status"], main [role="alert"]').allInnerTexts().then((x) => x.filter(Boolean)),
        };
        // The teacher typed nothing in this lesson: every part came from the pre-filled template.
        judge(`${SIM}: after that queued draft the lesson does not call the pre-filled template “your own text”`, !afterQ.says.some((x) => x.includes(en['gen.keptOwnText'].split('{sections}')[0].trim())), `says: ${afterQ.says.join(' | ') || '(nothing)'}; objectives ${JSON.stringify(afterQ.objectives.map((x) => x.slice(0, 40)))}; materials ${JSON.stringify(afterQ.materials)}`);
        judge(`${SIM}: a request that could not reach Tala opens the pre-filled template, and once Tala can be reached the draft is written into the lesson (one request, one model call)`, prefilled.length >= 1 && titles.includes('STAND-IN review') && rows.length === 1 && rows[0].status === 'done' && st.calls - callsQ === 1, `objectives pre-filled meanwhile: ${prefilled.length}; model calls ${st.calls - callsQ}; jobs ${JSON.stringify(rows)}; procedure after 80 s: ${titles.join(' | ') || '(still the empty pre-filled step)'}`);
      }

      /* ---- G. a lesson that already has the teacher's own objective ---- */
      if (want('G')) {
        st.mode = 'ok';
        st.delayMs = 2500;
        startBtn = await openGenerate(d, 'draftOwn');
        await startBtn.click();
        const arrived = await d.page.waitForURL(drafted, { timeout: 30000 }).then(() => true).catch(() => false);
        await d.page.waitForTimeout(1500);
        const says = await d.page.locator('main [role="status"], main [role="alert"]').allInnerTexts().then((x) => x.filter(Boolean));
        const url = new URL(d.page.url());
        if (!arrived) await openLesson(d, 'draftOwn');
        const own = await d.page.locator('section[aria-labelledby="s-objectives"] input').evaluateAll((els) => els.map((e) => e.value));
        const titles = await procedureTitles(d);
        check(`${SIM}: the teacher’s own objective is still exactly what she wrote after a draft was asked for`, own.length === 1 && own[0] === OWN_OBJECTIVE, own.join(' | '));
        judge(`${SIM}: the rest of that lesson is drafted, and the lesson says which part of hers was kept`, arrived && url.searchParams.get('kept') === 'objectives' && titles.includes('STAND-IN review') && says.some((x) => x.includes('Objectives')), `${url.pathname}${url.search}; procedure ${titles.join(' | ') || '(empty)'}; says: ${says.slice(-3).join(' | ')}`);
        await shot(d, 'g1-own-text-kept', true);
      }
      await d.ctx.close();

      /* ---- H. phone, Filipino ---- */
      if (isNew && want('H')) {
        const ph = await open('phone', 'fil');
        st.mode = 'ok';
        st.delayMs = 9000;
        const b = await openGenerate(ph, 'draftPlain');
        await b.scrollIntoViewIfNeeded();
        await b.tap();
        await waitAi(ph, 'running');
        const f = await aiState(ph);
        const bg = await ph.page.getByRole('button', { name: fil['gen.background'], exact: true }).boundingBox();
        check(`${SIM}, phone, Filipino: the same waiting state in Filipino, nothing wider than the screen, Cancel and the background button touch-sized`, f.caption === fil['ai.status.running'] && !f.sideways && f.cancelHeight >= 44 && bg && bg.height >= 44 && f.barState === 'running', `“${f.caption}” · ${f.elapsed}`);
        await ph.page.locator('.tala-ai').scrollIntoViewIfNeeded();
        await shot(ph, 'h1-writing');
        st.release();
        const ok = await ph.page.waitForURL(drafted, { timeout: 30000 }).then(() => true).catch(() => false);
        await ph.page.getByText(fil['gen.done']).first().waitFor({ timeout: 8000 }).catch(() => {});
        check(`${SIM}, phone, Filipino: the draft arrives and the lesson opens`, ok && (await ph.page.getByText(fil['gen.done']).count()) >= 1, `${new URL(ph.page.url()).pathname}${new URL(ph.page.url()).search}; says ${JSON.stringify(await ph.page.locator('[role="status"], [role="alert"]').allInnerTexts().then((x) => x.filter(Boolean).slice(0, 4)))}`);
        await ph.ctx.close();
      }
      check(`${SIM}: the stand-in answered every call it was asked to answer (no error of its own)`, st.errors.length === 0, st.errors.slice(0, 2).join(' | '));
    } finally {
      st.release();
      await st.close();
    }
  }
  if (phase === 'reduced') {
    /* ---- the teacher's device asks for reduced motion: nothing travels, everything still works ---- */
    const r = await open('desktop', 'en', { reducedMotion: 'reduce' });
    check('reduced motion: the browser reports the setting to the page', await r.page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches));
    await openLesson(r, 'multigrade');
    const start = (await snap(r, 'block')).order;
    // The still mark is read 150 ms after the press, while it is shown.
    const pattern = cardPattern('en', 'block');
    setTimeout(() => {
      r.page.evaluate(([k, p]) => {
        const c = window.__mwx.cards(k, p).find((x) => x.hasAttribute('data-reorder-settled'));
        const seg = window.__mwx.segments().find((x) => x.hasAttribute('data-flow-moved'));
        const cs = c ? getComputedStyle(c) : null;
        const ss = seg ? getComputedStyle(seg) : null;
        window.__mwx.still = { card: cs ? { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, animationName: cs.animationName } : null, segment: ss ? { boxShadow: ss.boxShadow !== 'none', animationName: ss.animationName, transitionDuration: ss.transitionDuration } : null };
      }, ['block', pattern]).catch(() => {});
    }, 950);
    let m = await measureMove(r, { kind: 'block', dir: 'up', position: 3, via: 'mouse' });
    const still = await r.page.evaluate(() => window.__mwx.still ?? null);
    check('reduced motion: the order changes at once', JSON.stringify(m.after.order) === JSON.stringify(swapped(start, 1, 2)), m.after.order.join(' | '));
    check('reduced motion: nothing travels — no frame shows a block on its way, no block ever carries a transform, the page does not glide', m.framesOnTheWay === 0 && m.transformFrames === 0 && m.scrollSteps <= 2 && m.barLayouts <= 2, brief(m));
    check('reduced motion: the pressed block is still where it was pressed (the page is placed there in the same frame)', m.heldDrift <= 1, `strayed ${m.heldDrift.toFixed(2)} px`);
    check('reduced motion: a still ring marks the block that moved and its segment (no animation), and is gone once settled', still?.card?.outlineStyle === 'solid' && still.card.animationName === 'none' && still.segment?.boxShadow === true && still.segment.animationName === 'none' && still.segment.transitionDuration === '0s' && m.after.marked === 0, JSON.stringify(still));
    check('reduced motion: focus and the screen-reader words are the same as with motion', m.after.active === moveLabel('en', 'block', 'up', 2) && m.after.status.includes(en['editor.block'].replace('{n}', '2')), `${m.after.active}; ${JSON.stringify(m.after.status)}`);
    m = await measureMove(r, { kind: 'block', dir: 'up', position: 2, via: 'keyboard' });
    check('reduced motion, keyboard: at the top, focus passes to the block’s Down arrow', m.after.active === moveLabel('en', 'block', 'down', 1) && m.framesOnTheWay === 0, String(m.after.active));
    // Put the blocks back.
    await r.page.keyboard.press('Enter');
    await r.page.waitForTimeout(600);
    m = await measureMove(r, { kind: 'block', dir: 'down', position: 2, via: 'mouse' });
    check('reduced motion: moved back to the seeded order (a down move holds the pressed block too)', JSON.stringify(m.after.order) === JSON.stringify(start) && m.heldDrift <= 1, m.after.order.join(' | '));
    await r.page.waitForTimeout(3000);
    await r.ctx.close();
  }
} catch (err) {
  check(`the ${phase} walk ran to its end`, false, String(err?.stack ?? err).slice(0, 500));
}
check('no page error, console error or server error during the walk', errors.length === 0, errors.slice(0, 6).join(' || '));
await browser.close();
finish();
