// Lesson Plan walk for Luis's items 1, 5 and 6 (release owner, 27 Nov 2026), on a LOCAL production build, signed in.
//   item 1: the Materials "Rewrite with AI" never fails silently (prerequisite, real generation, persistence, one request
//           at a time, provider failure keeps the teacher's materials, retry);
//   item 5: a long title wraps and grows (no inner scrollbar, no clipping) at phone / foldable / desktop / 200% zoom;
//   item 6: Rewrite with AI at the top right of every pre-class section, Required beside the title.
// Phases (same local account and database; the account is kept in <out>/account.json):
//   seed     register a local teacher, a school year, two synthetic classes and two lessons
//   success  (server with the real provider keys) prerequisite + real rewrite + reload + layout + screenshots
//   failure  (server started with broken provider keys) the visible error, materials unchanged, safe retry
//   tsx scripts/lesson-walk.mjs <phase> http://127.0.0.1:PORT <outDir> --db <TALA_DB_PATH>
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const [phase, base, out] = argv;
const dbPath = argv.includes('--db') ? argv[argv.indexOf('--db') + 1] : '';
if (!['seed', 'success', 'failure', 'queued', 'savefail'].includes(phase) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base ?? '') || !out || !dbPath)
  throw new Error('usage: lesson-walk.mjs <seed|success|failure> http://127.0.0.1:PORT <outDir> --db <path>');
const { createTalaClient } = await import('@hiraia/tala-core/contracts');
const { createSyncEngine, createMemoryStore } = await import('@hiraia/tala-core/sync');
const { newPlan, defaultTemplateFor } = await import('../src/data/plans.ts');
const { en } = await import('../src/i18n/en.ts');
const { fil } = await import('../src/i18n/fil.ts');
const Database = require('better-sqlite3');
mkdirSync(join(out, 'shots'), { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ phase, name, ok: Boolean(ok), detail: String(detail).slice(0, 400) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${String(detail).slice(0, 220)}` : ''}`);
};
const stamp = Date.now().toString(36);
let n = 0;
const newId = () => `lw-${stamp}-${(++n).toString(36).padStart(4, '0')}`;
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
const engineFor = (label) => createSyncEngine({ store: createMemoryStore(), transport: client.syncTransport, deviceId: `lw-${label}-${stamp}`, now: () => new Date(), newId });
const syncAll = async (engine) => {
  for (let k = 0; k < 8; k++) await engine.sync();
  for (let i = 0; i < 20 && (await engine.status()).pending; i++) await engine.sync();
};
const db = () => new Database(dbPath, { readonly: true });

if (phase === 'seed') {
  const email = `teacher.lessonwalk.${stamp}@example.com`;
  const password = `Tala-lw-${stamp}-Aa1!`;
  await client.call('auth.register', { body: { email, password, displayName: 'Gng. Liza Ramos (synthetic)', uiLanguage: 'en', deviceLabel: 'lesson walk seed' } });
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
  const meta = index.packs.find((p) => p.grade === '4' && p.learningAreaId === 'science' && p.schoolYears.includes(year.label));
  const pack = await client.call('curriculum.pack', { params: { packId: meta.packId } });
  const comps = pack.competencies.filter((c) => c.termIndex === term.index).sort((a, b) => a.sequence - b.sequence);
  const profileOf = (materials) => ({ materials, textbooks: [], electricity: true, projector: false, printing: true, outdoorSpace: true, notes: '' });
  // Like setup makes it: no materials listed.
  const c1 = { id: newId(), schoolYearId: year.id, name: 'Grade 4 – Sampaguita (synthetic test)', curriculum: 'deped', gradeGroups: [{ id: newId(), grade: '4', learnerCount: 30 }], languages: ['en'], profile: profileOf([]), isSample: false, archived: false };
  // A class whose teacher listed what it has.
  const c2 = { id: newId(), schoolYearId: year.id, name: 'Grade 4 – Ilang-Ilang (synthetic test)', curriculum: 'deped', gradeGroups: [{ id: newId(), grade: '4', learnerCount: 28 }], languages: ['en'], profile: profileOf(['chalkboard', 'manila paper', 'crayons', 'seed packets', 'hand lens', 'plastic cups']), isSample: false, archived: false };
  const asg = (cls) => ({ id: newId(), classId: cls.id, learningAreaId: 'science', subjectName: 'Science', gradeGroupIds: [cls.gradeGroups[0].id], language: 'en', slots: [1, 2, 3, 4, 5].map((weekday) => ({ id: newId(), weekday, startTime: '08:00', minutes: 50, rotation: null })) });
  const a1 = asg(c1), a2 = asg(c2);
  for (const c of [c1, c2]) await engine.put('class', c);
  for (const a of [a1, a2]) await engine.put('assignment', a);
  const plans = {};
  for (const [key, cls, a, withMaterials] of [['fresh', c1, a1, false], ['existing', c2, a2, true]]) {
    const pick = comps.slice(key === 'fresh' ? 0 : 2, key === 'fresh' ? 2 : 4);
    const { plan, sections } = newPlan({ template: defaultTemplateFor(cls, a), cls, assignment: a, dates: [today], language: 'en', competencies: { [cls.gradeGroups[0].id]: pick.map((c) => c.id) }, curriculumVersion: meta.curriculumVersion, newId, title: `Grade 4 Science: ${pick[0]?.shortTitle ?? 'lesson'} (synthetic test)` });
    // The existing lesson already has the teacher's own materials and a written procedure the rewrite can read.
    const filled = sections.map((s) => {
      if (withMaterials && s.key === 'materials') return { ...s, content: { type: 'list', items: ['seed packets for each group', 'hand lens (2 per group)'] }, editedByTeacher: true };
      if (s.key === 'procedure' && s.content.type === 'procedure')
        return { ...s, content: { ...s.content, steps: s.content.steps.map((st, i) => ({ ...st, title: st.title || ['Review', 'Activity', 'Discussion', 'Closing'][i % 4], body: [{ t: 'p', spans: [{ text: i === 1 ? 'Groups observe seeds with a hand lens and draw what they see on manila paper.' : 'The class talks about what plants need to grow.' }] }] })) }, editedByTeacher: true };
      return s;
    });
    await engine.batch([{ op: 'put', entity: 'plan', data: plan }, ...filled.map((s) => ({ op: 'put', entity: 'plan_section', data: s }))]);
    plans[key] = { planId: plan.id, classId: cls.id, competencies: pick.map((c) => c.shortTitle) };
  }
  await syncAll(engine);
  check('seed: a local teacher, a class with no listed materials and one with listed materials, a fresh and an existing lesson', (await engine.status()).pending === 0, JSON.stringify(plans));
  writeFileSync(accountFile, JSON.stringify({ email, password, plans, c2Materials: c2.profile.materials }, null, 1));
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

/* ------------------------------------------------ browser phases */
const acct = JSON.parse(readFileSync(accountFile, 'utf8'));
await client.call('auth.login', { body: { email: acct.email, password: acct.password, deviceLabel: `lesson walk ${phase}` } });
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright-core');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
const VIEW = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  foldable: { viewport: { width: 673, height: 841 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 },
  // What a 1366-pixel screen shows at 200% browser zoom.
  zoom200: { viewport: { width: 683, height: 450 }, deviceScaleFactor: 2 },
};
async function open(view, lang) {
  const ctx = await browser.newContext({ ...VIEW[view], locale: 'en-PH', timezoneId: 'Asia/Manila', acceptDownloads: true });
  await ctx.addInitScript((l) => { try { localStorage.setItem('tala.lang', l); } catch {} }, lang);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${view}/${lang}: pageerror: ${String(e).slice(0, 240)}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${view}/${lang}: console: ${m.text().slice(0, 240)}`); });
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`${view}/${lang}: ${r.status()} ${new URL(r.url()).pathname}`); });
  await page.goto(base + '/sign-in', { waitUntil: 'networkidle', timeout: 120000 });
  await page.locator('input[type=email]').fill(acct.email);
  await page.locator('input[type=password]').fill(acct.password);
  await page.locator('button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 60000 });
  await page.waitForTimeout(2500);
  return { ctx, page, view, lang };
}
const shot = async (s, name, fullPage = false) => {
  await s.page.evaluate(() => document.fonts.ready).catch(() => {});
  await s.page.waitForTimeout(300);
  await s.page.screenshot({ path: join(out, 'shots', `${name}-${s.view}-${s.lang}.png`), fullPage });
};
const noSideways = (s) => s.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const L = (lang) => (lang === 'fil' ? fil : en);
const materialsLabel = (lang) => (lang === 'fil' ? 'Mga Kagamitan' : 'Learning Resources');
const aiButton = (s, label) => s.page.getByRole('button', { name: `${L(s.lang)['gen.regen']}: ${label}`, exact: true });
const materialItems = async (s) => s.page.locator(`input[aria-label^="${materialsLabel(s.lang)} "]`).evaluateAll((els) => els.map((e) => e.value));
const serverMaterials = async (planId) => {
  const e = engineFor(`check-${++n}`);
  await syncAll(e);
  const sec = (await e.list('plan_section')).find((x) => x.data.planId === planId && x.data.key === 'materials');
  return sec?.data.content.items ?? null;
};
const jobsFor = (planId) => {
  const d = db();
  const rows = d.prepare("select status, json_extract(job,'$.failure.reason') reason from generation_jobs where json_extract(input,'$.planId')=? and json_extract(input,'$.sectionKey')='materials'").all(planId);
  d.close();
  return rows;
};

/** Item 6, measured: Required beside the title, Rewrite with AI at the top right, no overlap, no sideways scroll. */
async function headerLayout(s) {
  return s.page.evaluate(({ required, regen }) => {
    const out = [];
    for (const sec of document.querySelectorAll('section[aria-labelledby^="s-"]')) {
      const h2 = sec.querySelector('h2');
      if (!h2) continue;
      const headerRow = h2.parentElement;
      const pill = [...headerRow.querySelectorAll('span')].find((x) => x.textContent.trim() === required);
      const btn = [...headerRow.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith(regen + ':'));
      const r = (el) => el?.getBoundingClientRect();
      const sr = r(sec), hr = r(h2), pr = r(pill), br = r(btn);
      const body = headerRow.nextElementSibling ? r(headerRow.nextElementSibling) : null;
      const overlap = (a, b) => a && b && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
      out.push({
        key: sec.getAttribute('aria-labelledby').slice(2),
        title: h2.textContent.trim(),
        pill: !!pill,
        // beside: on the title's last line, starting right after the title text
        pillBeside: !pill || (() => {
          const range = document.createRange();
          range.selectNodeContents(h2);
          // the title's text fragments (not the pill's own boxes); the last one is the lowest line above or on the pill's line
          const inPill = (x) => x.left >= pr.left - 1 && x.right <= pr.right + 1 && x.top >= pr.top - 3 && x.bottom <= pr.bottom + 3;
          const words = [...range.getClientRects()].filter((x) => x.width > 0 && !inPill(x));
          const last = words.filter((x) => x.top < pr.bottom).sort((a, b) => b.top - a.top || b.right - a.right)[0];
          if (!last) return false;
          // beside the last word on the same line, or — only when it cannot fit there — directly under the title
          const sameLine = pr.left - last.right < 24 && pr.top < last.bottom && pr.bottom > last.top;
          const wrappedBecauseNarrow = pr.top >= last.top + 2 && pr.top - last.bottom < 14 && Math.abs(pr.left - hr.left) < 4 && last.right + 8 + pr.width > hr.right;
          return sameLine || wrappedBecauseNarrow;
        })(),
        ai: !!btn,
        aiRight: !btn || sr.right - br.right < 24,
        // top right: the button's top is level with the title's first line, and it ends above the section's content
        aiTop: !btn || (Math.abs(br.top - hr.top) < 16 && (!body || br.bottom <= body.top + 1)),
        aiTouch: !btn || br.height >= 43,
        overlap: !!(overlap(br, hr) || overlap(br, pr)),
      });
    }
    return out;
  }, { required: L(s.lang)['editor.required'], regen: L(s.lang)['gen.regen'] });
}
/** Item 5, measured: the title field shows all its text, with no inner scrollbar and no sideways scroll. */
async function titleFits(s) {
  return s.page.evaluate(() => {
    const ta = document.querySelector('h1 textarea');
    if (!ta) return { ok: false, why: 'no title field' };
    const cs = getComputedStyle(ta);
    const lh = parseFloat(cs.lineHeight) || 30;
    return { ok: ta.scrollHeight <= ta.clientHeight + 1 && cs.overflowY !== 'auto' && cs.overflowY !== 'scroll', lines: Math.round(ta.clientHeight / lh), fontPx: parseFloat(cs.fontSize), scroll: ta.scrollHeight, client: ta.clientHeight, sideways: document.documentElement.scrollWidth > window.innerWidth + 1 };
  });
}

try {
  if (phase === 'success' && !argv.includes('--layout-only')) {
    // 1a. Fresh lesson, class with no listed materials: the hint, the prerequisite, then a real rewrite.
    const d = await open('desktop', 'en');
    await d.page.goto(`${base}/lessons/${acct.plans.fresh.planId}`, { waitUntil: 'networkidle', timeout: 120000 });
    await d.page.waitForTimeout(2000);
    const lay = await headerLayout(d);
    const pre = lay.filter((x) => !['results', 'reflection'].includes(x.key));
    check('item 6 (desktop): every pre-class section has Rewrite with AI at the top right, Required right beside its title, nothing overlapping', pre.length >= 5 && pre.every((x) => x.ai && x.aiRight && x.aiTop && x.aiTouch && !x.overlap && x.pillBeside) && lay.filter((x) => ['results', 'reflection'].includes(x.key)).every((x) => !x.ai), JSON.stringify(lay.map((x) => `${x.key}:${x.ai ? 'ai' : '-'}${x.pill ? '+req' : ''}${x.aiRight && x.aiTop ? '' : ' MISPLACED'}${x.pillBeside ? '' : ' PILL-APART'}${x.overlap ? ' OVERLAP' : ''}`)));
    check('item 6 (desktop): no sideways scrolling', await noSideways(d));
    const hint = await d.page.getByText(en['gen.materials.sectionHint']).count();
    check('item 1: an empty Materials section in a class with no listed materials says why Tala cannot fill it', hint === 1);
    await shot(d, 'i1-01-fresh-lesson', true);
    await aiButton(d, 'Learning Resources').click();
    const sheet = d.page.locator('dialog[open]');
    await sheet.waitFor({ timeout: 15000 });
    const primary = sheet.getByRole('button', { name: en['gen.materials.saveAndRewrite'], exact: true });
    check('item 1: the sheet says what is missing (the class materials) and offers a field for them; Save and rewrite waits for input', (await sheet.getByText(en['gen.materials.needResources']).count()) === 1 && (await primary.isDisabled()), 'prerequisite shown before anything is sent');
    await shot(d, 'i1-02-prerequisite');
    const typed = ['chalkboard', 'manila paper', 'crayons', 'seed packets', 'hand lens', 'plastic cups', 'soil'];
    await sheet.getByLabel(en['gen.materials.fieldLabel']).fill(typed.join(', '));
    const t0 = Date.now();
    // Two fast clicks: one request only.
    await primary.click();
    await primary.click({ timeout: 500 }).catch(() => {});
    await sheet.getByText(en['gen.working']).waitFor({ timeout: 10000 }).catch(() => {});
    const workingShown = (await sheet.getByText(en['gen.working']).count()) === 1;
    await shot(d, 'i1-03-working');
    await d.page.getByText(en['gen.regenDone']).waitFor({ timeout: 120000 });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    check('item 1: an accurate working state while the real model writes', workingShown, `${secs} s until done`);
    await d.page.waitForTimeout(2000);
    const items = await materialItems(d);
    check('item 1 (REAL generation): the Materials section now lists materials, each one from the class list', items.length > 0 && items.every((x) => typed.some((m) => m.toLowerCase() === x.trim().toLowerCase())), items.join(' | '));
    await shot(d, 'i1-04-rewritten', true);
    const jobs = jobsFor(acct.plans.fresh.planId);
    check('item 1: two fast clicks made exactly one request', jobs.length === 1 && jobs[0].status === 'done', JSON.stringify(jobs));
    await d.page.reload({ waitUntil: 'networkidle', timeout: 120000 });
    await d.page.waitForTimeout(2500);
    const after = await materialItems(d);
    const onServer = await serverMaterials(acct.plans.fresh.planId);
    check('item 1: after a reload the materials are still there, and the server has them (another device gets them)', JSON.stringify(after) === JSON.stringify(items) && JSON.stringify(onServer) === JSON.stringify(items), `${after.length} items`);
    const e = engineFor('cls');
    await syncAll(e);
    const cls = (await e.get('class', acct.plans.fresh.classId))?.data;
    check('item 1: the typed materials were saved to the class (the Class page shows them)', JSON.stringify(cls?.profile.materials) === JSON.stringify(typed), (cls?.profile.materials ?? []).join(', '));
    check('item 1: the empty-materials hint is gone once the class lists materials', (await d.page.getByText(en['gen.materials.sectionHint']).count()) === 0);

    // 1b. Existing lesson with the teacher's own materials; class lists materials: says what Tala chooses from.
    await d.page.goto(`${base}/lessons/${acct.plans.existing.planId}`, { waitUntil: 'networkidle', timeout: 120000 });
    await d.page.waitForTimeout(2000);
    const before = await materialItems(d);
    await aiButton(d, 'Learning Resources').click();
    const sheet2 = d.page.locator('dialog[open]');
    await sheet2.waitFor({ timeout: 15000 });
    const fromLine = await sheet2.getByText(en['gen.materials.from'].split('{list}')[0].trim(), { exact: false }).count();
    check('item 1: for a class with listed materials the sheet says Tala chooses only from them; the edited-part warning shows', fromLine === 1 && (await sheet2.getByText(en['gen.regenEdited']).count()) === 1);
    await shot(d, 'i1-05-existing-sheet');
    await sheet2.getByRole('button', { name: en['gen.regenConfirm'], exact: true }).click();
    await d.page.getByText(en['gen.regenDone']).waitFor({ timeout: 120000 });
    await d.page.waitForTimeout(2000);
    const items2 = await materialItems(d);
    check('item 1 (REAL generation, existing lesson): the rewrite replaced the teacher’s list with class materials; the previous version is kept', items2.length > 0 && items2.every((x) => acct.c2Materials.some((m) => m.toLowerCase() === x.trim().toLowerCase())) && JSON.stringify(items2) !== JSON.stringify(before), `${before.join(' | ')} → ${items2.join(' | ')}`);
    const dd = db();
    const revs = dd.prepare("select count(*) n from core_records where entity='section_revision' and json_extract(data,'$.planId')=?").get(acct.plans.existing.planId)?.n ?? null;
    dd.close();
    check('item 1: the previous Materials text is kept as a revision (History)', revs !== null && revs >= 1, `${revs} revision record(s)`);
    await d.ctx.close();
  }
  if (phase === 'success') {
    // Items 5 + 6 across widths and languages: long titles, unbroken words.
    const titles = {
      en: 'Grade 4 Science — How plants make their own food from sunlight, water and air, with a garden walk and seed observation in groups of five',
      fil: 'Agham 4 — Paano gumagawa ng sariling pagkain ang mga halaman mula sa sikat ng araw, tubig at hangin, kasama ang paglalakad sa hardin',
      token: 'Photosynthesis'.repeat(9),
    };
    for (const view of ['phone', 'foldable', 'desktop', 'zoom200']) {
      for (const lang of ['en', 'fil']) {
        if ((view === 'foldable' || view === 'zoom200') && lang === 'fil') continue;
        const s = await open(view, lang);
        await s.page.goto(`${base}/lessons/${acct.plans.existing.planId}`, { waitUntil: 'networkidle', timeout: 120000 });
        await s.page.waitForTimeout(1500);
        for (const [tk, text] of Object.entries(titles)) {
          if (lang === 'fil' && tk !== 'fil') continue;
          if (lang === 'en' && tk === 'fil') continue;
          const ta = s.page.locator('h1 textarea');
          await ta.fill(text);
          await s.page.waitForTimeout(400);
          const fit = await titleFits(s);
          check(`item 5 (${view}, ${lang}, ${tk === 'token' ? 'one unbroken word' : 'long title'}): the title wraps and grows — all text visible, no inner scrollbar, no sideways scroll, normal size`, fit.ok && !fit.sideways && fit.lines >= 2 && fit.fontPx >= 24, JSON.stringify(fit));
          if (tk !== 'token') await shot(s, `i5-title-${tk}`);
        }
        const lay = await headerLayout(s);
        const pre = lay.filter((x) => !['results', 'reflection'].includes(x.key));
        check(`item 6 (${view}, ${lang}): Rewrite with AI at the right of every pre-class section header and above its content, Required beside the title, no overlap, no sideways scroll, touch-sized`, pre.every((x) => x.ai && x.aiRight && x.aiTop && x.aiTouch && !x.overlap && x.pillBeside) && (await noSideways(s)), JSON.stringify(pre.filter((x) => !(x.ai && x.aiRight && x.aiTop && x.aiTouch && !x.overlap && x.pillBeside))));
        await s.page.locator('section[aria-labelledby="s-materials"]').scrollIntoViewIfNeeded();
        await shot(s, 'i6-sections');
        if (view === 'desktop' && lang === 'en') {
          // Keyboard: the section's AI button is reachable and announces its section.
          const target = aiButton(s, 'Learning Resources');
          await target.focus();
          const focused = await s.page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
          check('item 6: keyboard focus reaches a section’s Rewrite with AI and it names its section', focused === `${en['gen.regen']}: Learning Resources`, focused);
          await s.page.keyboard.press('Enter');
          await s.page.locator('dialog[open]').waitFor({ timeout: 10000 });
          check('item 6: Enter opens that section’s own rewrite sheet', (await s.page.locator('dialog[open]').getByText('Learning Resources').count()) >= 1);
          await s.page.keyboard.press('Escape');
        }
        // Put the title back (the walk must not leave a test title).
        await s.page.locator('h1 textarea').fill('Grade 4 Science lesson (synthetic test)');
        await s.page.waitForTimeout(1500);
        await s.ctx.close();
      }
    }
    // The Filipino sheet, phone.
    const f = await open('phone', 'fil');
    await f.page.goto(`${base}/lessons/${acct.plans.existing.planId}`, { waitUntil: 'networkidle', timeout: 120000 });
    await f.page.waitForTimeout(1500);
    await aiButton(f, 'Mga Kagamitan').click();
    await f.page.locator('dialog[open]').waitFor({ timeout: 15000 });
    check('item 1 (Filipino, phone): the sheet opens with the Filipino wording', (await f.page.locator('dialog[open]').getByText(fil['gen.materials.from'].split('{list}')[0].trim(), { exact: false }).count()) === 1);
    await shot(f, 'i1-06-sheet');
    await f.ctx.close();
  }

  if (phase === 'failure') {
    // The server for this phase runs with broken provider keys: the provider refuses every call.
    const p = await open('phone', 'en');
    await p.page.goto(`${base}/lessons/${acct.plans.existing.planId}`, { waitUntil: 'networkidle', timeout: 120000 });
    await p.page.waitForTimeout(2000);
    const before = await materialItems(p);
    await aiButton(p, 'Learning Resources').click();
    const sheet = p.page.locator('dialog[open]');
    await sheet.waitFor({ timeout: 15000 });
    // The teacher-edited warning decides the label ("Yes, rewrite it" or "Rewrite with AI"); either starts it.
    await sheet.getByRole('button', { name: new RegExp(`^(${en['gen.regenConfirm']}|${en['gen.regen']})$`) }).click();
    const msg = sheet.getByRole('alert');
    await msg.getByText(en['gen.failed.providers_unavailable']).waitFor({ timeout: 180000 });
    const inView = await msg.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; });
    check('item 1 (provider down): the failure is shown at the top of the sheet, in view on a phone, and announced', inView, await msg.innerText());
    await shot(p, 'i1-07-provider-down');
    const retry = sheet.getByRole('button', { name: en['gen.tryAgain'], exact: true });
    check('item 1: the sheet offers Try again', (await retry.count()) === 1);
    await retry.click();
    await p.page.waitForTimeout(1000);
    await msg.getByText(en['gen.failed.providers_unavailable']).waitFor({ timeout: 180000 });
    check('item 1: trying again is safe (the same clear message, one more request)', (await sheet.getByRole('button', { name: en['gen.tryAgain'], exact: true }).count()) === 1);
    await p.page.keyboard.press('Escape');
    await p.page.reload({ waitUntil: 'networkidle', timeout: 120000 });
    await p.page.waitForTimeout(2000);
    const afterItems = await materialItems(p);
    check('item 1: the teacher’s materials are unchanged after the failures', JSON.stringify(afterItems) === JSON.stringify(before), afterItems.join(' | '));
    const jobs = jobsFor(acct.plans.existing.planId).slice(-2);
    check('item 1: both failed requests are recorded as failed (providers_unavailable), none as done', jobs.length === 2 && jobs.every((j) => j.status === 'failed' && j.reason === 'providers_unavailable'), JSON.stringify(jobs));
    await p.ctx.close();
  }
  if (phase === 'queued') {
    // Asked while offline, run in the background when back online, failed (broken keys): shown in the lesson.
    const q = await open('desktop', 'en');
    await q.page.goto(`${base}/lessons/${acct.plans.existing.planId}`, { waitUntil: 'networkidle', timeout: 120000 });
    await q.page.waitForTimeout(2000);
    const before = await materialItems(q);
    await q.ctx.setOffline(true);
    await q.page.waitForTimeout(1500);
    await aiButton(q, 'Learning Resources').click();
    const sheet = q.page.locator('dialog[open]');
    await sheet.waitFor({ timeout: 15000 });
    await sheet.getByRole('button', { name: en['gen.keepWaiting'], exact: true }).click();
    await q.page.getByText(en['gen.queued']).waitFor({ timeout: 15000 });
    check('item 1 (offline): the rewrite is queued and the teacher is told so', true, en['gen.queued'].slice(0, 60));
    await q.ctx.setOffline(false);
    const banner = q.page.getByText(en['gen.queuedFailed'].split('“')[0].trim(), { exact: false });
    await banner.first().waitFor({ timeout: 120000 });
    const text = await banner.first().innerText();
    check('item 1 (queued, provider down): back online, the failed rewrite is shown in the lesson with its part and reason', text.includes('Learning Resources') && text.includes(en['gen.failed.providers_unavailable'].split('.')[0]), text);
    await shot(q, 'i1-08-queued-failed');
    check('item 1 (queued): the teacher’s materials are unchanged', JSON.stringify(await materialItems(q)) === JSON.stringify(before));
    await q.page.getByRole('button', { name: en['common.close'], exact: true }).first().click();
    await q.page.waitForTimeout(800);
    await q.page.reload({ waitUntil: 'networkidle', timeout: 120000 });
    await q.page.waitForTimeout(2000);
    check('item 1 (queued): once closed, the notice stays closed after a reload', (await q.page.getByText(en['gen.queuedFailed'].split('“')[0].trim(), { exact: false }).count()) === 0);
    await q.ctx.close();
  }
  if (phase === 'savefail') {
    // A full device (simulated: every IndexedDB write throws the browser's own QuotaExceededError).
    const v = await open('phone', 'en');
    await v.page.goto(`${base}/lessons/${acct.plans.existing.planId}`, { waitUntil: 'networkidle', timeout: 120000 });
    await v.page.waitForTimeout(2500);
    const first = v.page.locator(`input[aria-label="${materialsLabel('en')} 1"]`);
    const before = await first.inputValue();
    await v.page.evaluate(() => {
      const w = window;
      w.__put = IDBObjectStore.prototype.put;
      w.__add = IDBObjectStore.prototype.add;
      const full = () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); };
      IDBObjectStore.prototype.put = full;
      IDBObjectStore.prototype.add = full;
    });
    const changed = `${before} (checked ${Date.now() % 10000})`;
    await first.fill(changed);
    const alert = v.page.getByRole('alert').filter({ hasText: en['editor.saveFailedStorage'].slice(0, 30) });
    await alert.first().waitFor({ timeout: 15000 });
    const saidSaved = await v.page.getByText(en['editor.saved'], { exact: true }).count();
    check('save fix: with the device full, the status says the change was NOT saved (storage full), never "Saved"', saidSaved === 0, await alert.first().innerText());
    check('save fix: the change stays on screen', (await first.inputValue()) === changed);
    await alert.first().scrollIntoViewIfNeeded();
    await v.page.evaluate(() => window.scrollBy(0, -120));
    await shot(v, 'save-01-not-saved');
    await v.page.evaluate(() => { const w = window; IDBObjectStore.prototype.put = w.__put; IDBObjectStore.prototype.add = w.__add; });
    await v.page.getByRole('button', { name: en['gen.tryAgain'], exact: true }).click();
    await v.page.getByText(en['editor.saved'], { exact: false }).first().waitFor({ timeout: 15000 });
    check('save fix: after space is free, Try again saves it and the status says Saved', (await v.page.getByRole('alert').filter({ hasText: en['editor.saveFailedStorage'].slice(0, 30) }).count()) === 0);
    await v.page.waitForTimeout(1500);
    await v.page.reload({ waitUntil: 'networkidle', timeout: 120000 });
    await v.page.waitForTimeout(2500);
    check('save fix: after a reload the change is there (it really was written)', (await v.page.locator(`input[aria-label="${materialsLabel('en')} 1"]`).inputValue()) === changed);
    await v.page.locator(`input[aria-label="${materialsLabel('en')} 1"]`).fill(before);
    await v.page.waitForTimeout(2000);
    await v.ctx.close();
  }
} catch (e) {
  check(`the ${phase} phase ran to the end`, false, String(e?.stack ?? e).slice(0, 380));
}
await browser.close();
check(`no browser errors and no server errors (${phase})`, errors.length === 0, errors.slice(0, 4).join(' | '));
const file = join(out, `lesson-walk-${phase}.json`);
const prior = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
writeFileSync(file, JSON.stringify({ phase, base, at: new Date().toISOString(), checks: results.length, failed: results.filter((r) => !r.ok).length, results, previousRun: prior ? { at: prior.at, failed: prior.failed } : null }, null, 1));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed (${phase})`);
process.exit(results.some((r) => !r.ok) ? 1 : 0);
