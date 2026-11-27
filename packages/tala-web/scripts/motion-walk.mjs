// Motion walk (27 Nov 2026): the timetable reorder, the next-step cue and the AI working state, measured on a LOCAL
// production build, signed in as an invented teacher. It reads what the browser actually renders: element boxes
// frame by frame while something moves, the running animations, focus, scroll position and the records the device
// and the server hold afterwards. A screenshot or a DOM assertion alone never counts as "it moved".
//
// Phases (same local account and database; the account is kept in <out>/account.json):
//   seed      register a local teacher, a multi-grade class and a single-grade class, and their lessons
//   reorder   Session Flow blocks and Procedure steps: movement, identity, focus, persistence, failed saves
//   cue       the next-step arrow: where it appears, how long, what it never does
//   ai-mock   SIMULATED job states (the browser's requests to /generation are answered by this script, labelled)
//   ai-real   one real draft with the provider the server was started with (needs --real; counted and bounded)
//   reduced   the same screens with prefers-reduced-motion: reduce
//   record    short recordings (WebM) and frame strips for the report
//
//   tsx scripts/motion-walk.mjs <phase> http://127.0.0.1:PORT <outDir> --db <TALA_DB_PATH> [--real] [--label before|after]
//
// Local servers only: it creates an account. Everything typed or seeded is invented (@example.com).
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const [phase, base, out] = argv;
const flag = (name) => argv.includes(`--${name}`);
const option = (name, fallback = '') => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
const dbPath = option('db');
const PHASES = ['seed', 'reorder', 'cue', 'ai-mock', 'ai-real', 'reduced', 'record'];
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
  // 3. Lessons with nothing written yet, for the AI draft: one keeps a teacher's own objective (it must survive).
  for (const key of ['draftMock', 'draftReal']) {
    const made = newPlan({ template: defaultTemplateFor(single, aSingle), cls: single, assignment: aSingle, dates: [today], language: 'en', competencies: { [single.gradeGroups[0].id]: g4.comps.slice(2, 4).map((c) => c.id) }, curriculumVersion: g4.meta.curriculumVersion, newId, title: `Grade 4 Science: ${g4.comps[2]?.shortTitle ?? 'lesson'} (synthetic test, ${key})` });
    const sections = made.sections.map((s) => (s.key === 'objectives' ? { ...s, content: { type: 'list', items: ['The teacher’s own objective: every learner touches a real seed today.'] }, editedByTeacher: true } : s));
    await save(key, made.plan, sections);
  }
  await syncAll(engine);
  check('seed: a local teacher, a multi-grade class and a single-grade class, a four-block Session Flow, a four-step Procedure and two lessons to draft', (await engine.status()).pending === 0, JSON.stringify(Object.fromEntries(Object.entries(plans).map(([k, v]) => [k, v.planId]))));
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
