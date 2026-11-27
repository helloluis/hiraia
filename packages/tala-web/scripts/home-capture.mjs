// The product pictures on the public homepage (features/landing/Showcase.tsx), taken from a running LOCAL tala-web.
//
// For English and for Filipino it seeds a fictional teacher through the real API and sync engine (no direct database
// writes), then photographs the real screens in Chromium:
//   planner-*   the lesson editor of ONE combined plan for a Grades 4, 5 and 6 room: the session timeline and a
//               rotation block. Each grade's lesson is a short invented one (below), combined by the same function the
//               "One plan for a multi-grade class" screen calls.
//   slides-*    the teacher's own copy of a Hiraia pack's slides in the slide editor. The pack is an AI draft and the
//               screen says so; the slide shown has been reworded by "the teacher" (the words below), as the editor
//               invites her to.
// Each picture is taken at the size it is shown at (wide layout and phone layout), at twice the pixel density, and
// written as WebP with a JPEG fallback. Nothing here calls a model.
//
//   PLAYWRIGHT_PATH=… CHROMIUM_PATH=… SHARP_PATH=… pnpm exec tsx scripts/home-capture.mjs <baseUrl> <outDir> --db <TALA_DB_PATH>
//        <outDir>            where the WebP/JPEG files and manifest.json go (the page reads public/screens/home)
//        [--raw <dir>]       also keep the untouched PNG screenshots there
//        [--only en|fil]     one language (the page needs both)
//        [--date YYYY-MM-DD] the lesson date shown (default: today, or this week's Monday on a weekend)
//
// Local servers only: it creates accounts. The server needs the Science pack library (TALA_PACKS_LIBRARY_DIR and
// TALA_PACKS_ARTIFACTS_DIR) with the pack named in DECK below. Everything typed or seeded is invented (@example.com).
import { createRequire } from 'node:module';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const [base, out] = argv;
const option = (name, fallback = '') => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
const dbPath = option('db');
if (!base || !out || !dbPath) throw new Error('usage: home-capture.mjs <baseUrl> <outDir> --db <TALA_DB_PATH> [--raw <dir>] [--only en|fil]');
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error('local servers only (this script creates accounts)');
const rawDir = option('raw');
const only = option('only');
const { createTalaClient } = await import('@hiraia/tala-core/contracts');
const { createSyncEngine, createMemoryStore } = await import('@hiraia/tala-core/sync');
const { BUILTIN_TEMPLATES } = await import('../../tala-core/src/contracts/content.ts');
const { combineSavedLessons } = await import('../src/features/lessons/combine-model.ts');
const { planFromPackDay } = await import('../src/data/pack-plans.ts');
const { en } = await import('../src/i18n/en.ts');
const { fil } = await import('../src/i18n/fil.ts');
const STRINGS = { en, fil };
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright-core');
const sharp = require(process.env.SHARP_PATH || 'sharp');
mkdirSync(out, { recursive: true });
if (rawDir) mkdirSync(rawDir, { recursive: true });

const stamp = Date.now().toString(36);
const today = new Date().toISOString().slice(0, 10);
const addDays = (iso, k) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
};
const weekdayOf = (iso) => ((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
const lessonDate = option('date', weekdayOf(today) <= 5 ? today : addDays(today, 1 - weekdayOf(today)));

/* ------------------------------------------------ the invented lessons */
// Science, Term 2, Week 10 of the DepEd 2026 Budget of Work: the competencies named are the real ones for that week.
// The lesson words are written for these pictures, short on purpose, and are not taken from any teaching pack.
const PHASES = {
  en: { open: 'Activating prior knowledge', develop: 'Developing and deepening understanding', close: 'Making generalizations', assess: 'Evaluating learning' },
  fil: { open: 'Pagkuha ng Dating Kaalaman', develop: 'Paglinang at Pagpapalalim', close: 'Paglalahat', assess: 'Pagtataya' },
};
const WHO = { en: { teacher: 'Teacher', learners: 'Learners' }, fil: { teacher: 'Guro', learners: 'Mga mag-aaral' } };
const SCENE = {
  en: {
    teacher: 'Gng. Liza Ramos',
    school: 'Malaya Elementary School (demo)',
    room: 'Grades 4, 5 and 6 – Sampaguita',
    lessons: {
      4: {
        title: 'Which objects does a magnet attract?',
        competencies: ['science-bow-2026.science.g4.t2.10'],
        objective: 'Test which objects a magnet attracts.',
        materials: ['bar magnet', 'tray of small objects (paper clip, coin, nail, eraser, bottle cap)'],
        open: ['Hold up a magnet. Ask where learners have seen one at home.', 'Name places where they have seen a magnet.'],
        develop: ['Give each pair a magnet and a tray of objects. Have them predict first, then test.', 'Test each object and sort it: attracted or not attracted.'],
        close: ['Ask what the attracted objects are made of.', 'Say that the magnet attracted the objects made of iron or steel.'],
        assess: 'Name one object a magnet attracts and one it does not.',
      },
      5: {
        title: 'Do heavier objects fall faster?',
        competencies: ['science-bow-2026.science.g5.t2.11'],
        objective: 'Predict and test whether heavier objects fall faster.',
        materials: ['two balls of different weight', 'notebook'],
        open: ['Drop a pencil. Ask what made it fall.', 'Say what they think pulls objects down.'],
        develop: ['Ask for predictions, then drop a heavy ball and a light ball from the same height.', 'Predict, watch three drops, and record which ball lands first or whether they land together.'],
        close: ['Ask what the three drops showed.', 'Say that both balls landed at almost the same time.'],
        assess: 'Did the heavier ball land first? Write what you saw.',
      },
      6: {
        title: 'Crests and troughs in water waves',
        competencies: ['science-bow-2026.science.g6.t2.9'],
        objective: 'Describe water waves using the words crest and trough.',
        materials: ['basin of water', 'paper and pencil'],
        open: ['Tap the water in a basin once. Ask what moved.', 'Describe what they saw on the water.'],
        develop: ['Have each group make gentle waves in a basin and look at them from the side.', 'Draw the wave from the side and label a crest and a trough.'],
        close: ['Ask what the wave carried across the basin.', 'Say that the wave carried energy while the water stayed in place.'],
        assess: 'Label the crest and the trough on a wave drawing.',
      },
    },
  },
  fil: {
    teacher: 'Gng. Liza Ramos',
    school: 'Malaya Elementary School (demo)',
    room: 'Baitang 4, 5 at 6 – Sampaguita',
    lessons: {
      4: {
        title: 'Aling mga bagay ang nahihila ng magnet?',
        competencies: ['science-bow-2026.science.g4.t2.10'],
        objective: 'Subukan kung aling mga bagay ang nahihila ng magnet.',
        materials: ['bar magnet', 'tray ng maliliit na bagay (paper clip, barya, pako, pambura, tansan)'],
        open: ['Ipakita ang magnet. Itanong kung saan sila nakakita nito sa bahay.', 'Sabihin kung saan sila nakakita ng magnet.'],
        develop: ['Bigyan ang bawat pares ng magnet at tray ng mga bagay. Pahulaan muna bago ipasubok.', 'Subukan ang bawat bagay gamit ang magnet. Pagsama-samahin ang mga nahihila ng magnet at ihiwalay ang mga hindi.'],
        close: ['Itanong kung saan gawa ang mga bagay na nahila.', 'Sabihing nahila ng magnet ang mga bagay na gawa sa iron o steel.'],
        assess: 'Magbigay ng isang bagay na nahihila ng magnet at isang hindi.',
      },
      5: {
        title: 'Mas mabilis bang bumagsak ang mas mabigat na bola?',
        competencies: ['science-bow-2026.science.g5.t2.11'],
        objective: 'Hulaan at subukan kung mas mabilis bumagsak ang mas mabigat na bagay.',
        materials: ['dalawang bolang magkaiba ang bigat', 'notebook'],
        open: ['Ihulog ang lapis. Itanong kung bakit ito bumagsak.', 'Sabihin kung ano sa tingin nila ang humihila pababa sa mga bagay.'],
        develop: ['Pahulaan muna sa klase ang mangyayari. Pagkatapos, bitawan nang sabay ang mabigat at magaang bola mula sa parehong taas.', 'Humula muna. Panoorin ang tatlong pagsubok at itala kung aling bola ang unang lumapag o kung sabay silang lumapag.'],
        close: ['Itanong kung ano ang ipinakita ng tatlong hulog.', 'Sabihing halos sabay bumagsak ang dalawang bola.'],
        assess: 'Nauna bang bumagsak ang mas mabigat na bola? Isulat ang nakita mo.',
      },
      6: {
        title: 'Crest at trough ng alon sa tubig',
        competencies: ['science-bow-2026.science.g6.t2.9'],
        objective: 'Ilarawan ang alon sa tubig gamit ang mga salitang crest at trough.',
        materials: ['palanggana ng tubig', 'papel at lapis'],
        open: ['Tapikin nang isang beses ang tubig sa palanggana. Itanong kung ano ang gumalaw.', 'Ilarawan ang nakita nila sa tubig.'],
        develop: ['Pagawain ang bawat grupo ng mahihinang alon sa palanggana at patingnan ito mula sa gilid.', 'Iguhit ang alon mula sa gilid at lagyan ng label ang crest at trough.'],
        close: ['Itanong kung ano ang dinala ng alon sa kabilang dulo ng palanggana.', 'Sabihing enerhiya ang dinala ng alon habang nanatili sa puwesto ang tubig.'],
        assess: 'Lagyan ng label ang crest at trough sa drawing ng alon.',
      },
    },
  },
};
// The slide deck in the second picture: a Grade 5 lesson made from day 1 of this pack (a draft in both languages),
// with the pack's slides as the teacher's own copy. The slide shown is one whose drafted words say "stone" beside a
// drawing of a mango; she has corrected the title, the first line and her notes, which is what the editor is for.
const DECK = {
  packId: 'sci26-g5-t2-w10',
  day: 1,
  slideId: 'd1s7',
  room: { en: 'Grade 5 – Narra', fil: 'Baitang 5 – Narra' },
  edit: {
    en: {
      title: 'The mango falls without a push',
      line0: 'The mango fell down. No hand touched it while it was falling.',
      notes:
        'Hold a mango at waist height and let it go. Ask: ‘What happened? Did anything touch it while it was falling?’ Expected: it fell down and nothing touched it. Say: ‘The pull that made it fall is gravity.’',
    },
    fil: {
      title: 'Bumabagsak ang mangga kahit walang tumutulak',
      line0: 'Bumagsak ang mangga nang bitawan ito. Walang humawak dito habang bumabagsak.',
      notes:
        'Hawakan ang mangga nang kapantay ng baywang, saka bitawan. Itanong sa klase, ‘Ano ang nangyari? May humawak ba sa mangga habang bumabagsak ito?’ Asahang sasabihin nilang bumagsak ito at walang humawak dito. Sabihin, ‘Hinila ng gravity ang mangga pababa.’',
    },
  },
};

/* ------------------------------------------------ seed, through the real API */
const p = (text) => ({ t: 'p', spans: [{ text }] });
const labelled = (label, text) => ({ t: 'p', spans: [{ text: `${label}: `, b: true }, { text }] });
async function seed(lang) {
  const S = SCENE[lang];
  let n = 0;
  const newId = () => `home-${lang}-${stamp}-${(++n).toString(36).padStart(4, '0')}`;
  const email = `teacher.home.${lang}.${stamp}@example.com`;
  const password = `Tala-home-${stamp}-Aa1!`;
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
  await client.call('auth.register', { body: { email, password, displayName: S.teacher, uiLanguage: lang, deviceLabel: 'homepage capture seed' } });
  {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare("select vars from core_mail_outbox where to_email=? and template='verify_email' order by rowid desc limit 1").get(email);
    db.close();
    if (row) await client.call('auth.verifyEmail', { body: { token: JSON.parse(row.vars).link.split('#token=')[1] } });
  }
  const engine = createSyncEngine({ store: createMemoryStore(), transport: client.syncTransport, deviceId: `home-seed-${lang}-${stamp}`, now: () => new Date(), newId });
  const presets = (await client.call('calendar.presets')).presets;
  const preset = await client.call('calendar.preset', { params: { presetId: presets[0].id } });
  const year = {
    id: newId(), label: `${preset.startDate.slice(0, 4)}-${preset.endDate.slice(0, 4)}`, schoolName: S.school, startDate: preset.startDate, endDate: preset.endDate,
    terms: preset.terms.map((t) => ({ id: newId(), index: t.index, name: t.name, startDate: t.startDate, endDate: t.endDate })),
    teachingWeekdays: [1, 2, 3, 4, 5], presetId: preset.id, presetVersion: preset.version, provisional: preset.provisional,
  };
  await engine.put('school_year', year);
  await engine.put('profile', { id: 'profile', displayName: S.teacher, uiLanguage: lang, schoolName: S.school, region: 'Region IV-A', dataSaver: false, activeSchoolYearId: year.id, pacingParams: {} });
  const cls = {
    id: newId(), schoolYearId: year.id, name: S.room, curriculum: 'deped', gradeGroups: ['4', '5', '6'].map((grade) => ({ id: newId(), grade, learnerCount: 8 })), languages: [lang],
    profile: { materials: [], textbooks: [], electricity: true, projector: false, printing: true, outdoorSpace: true, notes: '' }, isSample: false, archived: false,
  };
  const science = {
    id: newId(), classId: cls.id, learningAreaId: 'science', subjectName: 'Science', gradeGroupIds: cls.gradeGroups.map((g) => g.id), language: lang,
    slots: [1, 2, 3, 4, 5].map((weekday) => ({ id: newId(), weekday, startTime: '08:00', minutes: 60, rotation: null })),
  };
  await engine.put('class', cls);
  await engine.put('assignment', science);
  const template = BUILTIN_TEMPLATES.find((t) => t.id === 'tpl.dlp.v1');
  const plans = [];
  const sections = [];
  for (const g of cls.gradeGroups) {
    const L = S.lessons[g.grade];
    const id = newId();
    const plan = {
      id, title: L.title, templateId: 'tpl.dlp.v1', language: lang, subjectName: 'Science', learningAreaId: 'science', grades: [g.grade], gradeGroupIds: [g.id],
      competencies: { [g.id]: L.competencies }, curriculumVersion: 'science-bow-2026', durationMinutes: 60,
      placements: [{ classId: cls.id, assignmentId: science.id, dates: [lessonDate] }],
    };
    const step = (role, minutes, [teacher, learners]) => ({ id: newId(), title: PHASES[lang][role], minutes, body: [labelled(WHO[lang].teacher, teacher), labelled(WHO[lang].learners, learners)] });
    const content = {
      objectives: { type: 'list', items: [L.objective] },
      materials: { type: 'list', items: L.materials },
      procedure: { type: 'procedure', steps: [step('open', 5, L.open), step('develop', 40, L.develop), step('close', 10, L.close), { id: newId(), title: PHASES[lang].assess, minutes: 5, body: [labelled(WHO[lang].learners, L.assess)] }] },
      assessment: { type: 'text', blocks: [p(L.assess)] },
    };
    const own = template.sections.map((s) => ({ id: newId(), planId: id, key: s.key, content: content[s.key] ?? { type: 'text', blocks: [] }, origin: 'manual' }));
    await engine.batch([{ op: 'put', entity: 'plan', data: plan }, ...own.map((s) => ({ op: 'put', entity: 'plan_section', data: s }))]);
    plans.push(plan);
    sections.push(...own);
  }
  for (let i = 0; i < 20 && (await engine.status()).pending; i++) await engine.sync();
  // The records as the server stores them (defaults filled in), then the same call the Combine screen makes.
  const storedPlans = (await engine.list('plan')).map((r) => r.data);
  const storedSections = (await engine.list('plan_section')).map((r) => r.data);
  const combined = combineSavedLessons({
    cls, assignment: science, date: lessonDate, minutes: 60, language: lang,
    picks: Object.fromEntries(cls.gradeGroups.map((g, i) => [g.id, plans[i].id])), plans: storedPlans, sections: storedSections, newId,
  });
  await engine.batch([{ op: 'put', entity: 'plan', data: combined.plan }, ...combined.sections.map((s) => ({ op: 'put', entity: 'plan_section', data: s }))]);
  for (let i = 0; i < 20 && (await engine.status()).pending; i++) await engine.sync();
  if ((await engine.status()).pending) throw new Error(`${lang}: the seed did not reach the server`);
  // A single-grade class with one lesson made from the pack's day, exactly as "Add to my class" writes it, and the
  // pack's slides linked to that lesson (her own copy is made by the link).
  const g5 = {
    id: newId(), schoolYearId: year.id, name: DECK.room[lang], curriculum: 'deped', gradeGroups: [{ id: newId(), grade: '5', learnerCount: 31 }], languages: [lang],
    profile: { materials: [], textbooks: [], electricity: true, projector: false, printing: true, outdoorSpace: true, notes: '' }, isSample: false, archived: false,
  };
  const g5Science = {
    id: newId(), classId: g5.id, learningAreaId: 'science', subjectName: 'Science', gradeGroupIds: [g5.gradeGroups[0].id], language: lang,
    slots: [1, 2, 3, 4, 5].map((weekday) => ({ id: newId(), weekday, startTime: '10:00', minutes: 45, rotation: null })),
  };
  await engine.put('class', g5);
  await engine.put('assignment', g5Science);
  const detail = await client.call('packs.detail', { params: { packId: DECK.packId }, query: { lang } });
  const fromPack = planFromPackDay({ pack: detail.content, review: detail.review, day: detail.content.days[DECK.day - 1], cls: g5, gradeGroupId: g5.gradeGroups[0].id, assignmentId: g5Science.id, date: lessonDate, newId });
  await engine.batch([{ op: 'put', entity: 'plan', data: fromPack.plan }, ...fromPack.sections.map((x) => ({ op: 'put', entity: 'plan_section', data: x }))]);
  for (let i = 0; i < 20 && (await engine.status()).pending; i++) await engine.sync();
  if ((await engine.status()).pending) throw new Error(`${lang}: the pack lesson did not reach the server`);
  const linked = await client.call('decks.lesson.link', { params: { planId: fromPack.plan.id }, body: { packId: DECK.packId, lang, day: DECK.day } });
  const deckId = linked.link?.deckId ?? linked.slides?.deckId;
  if (!deckId) throw new Error(`${lang}: the pack's slides were not linked to the lesson`);
  return {
    lang, email, password, planId: combined.plan.id, deckId, deckPlanId: fromPack.plan.id,
    blocks: combined.sections.find((x) => x.content.type === 'multigrade').content.blocks.map((b) => `${b.label} ${b.minutes}`),
  };
}

/* ------------------------------------------------ the browser */
const VIEW = {
  wide: { viewport: { width: 1366, height: 960 }, deviceScaleFactor: 2 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
async function open(view, who) {
  const ctx = await browser.newContext({ ...VIEW[view], locale: 'en-PH', timezoneId: 'Asia/Manila' });
  await ctx.addInitScript((l) => {
    try {
      localStorage.setItem('tala.lang', l);
      localStorage.setItem('tala.firstSteps.done', '1');
    } catch {}
  }, who.lang);
  const page = await ctx.newPage();
  await page.goto(base + '/sign-in', { waitUntil: 'networkidle', timeout: 120000 });
  await page.locator('input[type=email]').fill(who.email);
  await page.locator('input[type=password]').fill(who.password);
  await page.locator('button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 60000 });
  await page.waitForTimeout(2500); // first sync pulls her records onto this device
  return { ctx, page, view, lang: who.lang };
}
const settle = async (page) => {
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important} .tala-cue{display:none!important}' }).catch(() => {});
  await page.evaluate(() => document.fonts.ready.then(() => document.fonts.load("600 20px 'Fraunces'"))).catch(() => {});
  await page.waitForTimeout(500);
};
const written = [];
/** Save a screenshot region as WebP + JPEG at `width` pixels (and keep the PNG when --raw is given). */
async function save(page, name, clip, width) {
  const png = await page.screenshot({ clip, type: 'png' });
  if (rawDir) writeFileSync(join(rawDir, `${name}.png`), png);
  const img = sharp(png).resize({ width, withoutEnlargement: true });
  await img.clone().webp({ quality: 78, effort: 6 }).toFile(join(out, `${name}.webp`));
  await img.clone().jpeg({ quality: 76, mozjpeg: true }).toFile(join(out, `${name}.jpg`));
  const meta = await sharp(join(out, `${name}.webp`)).metadata();
  written.push({ name, w: meta.width, h: meta.height, webp: statSync(join(out, `${name}.webp`)).size, jpg: statSync(join(out, `${name}.jpg`)).size });
}

const people = [];
for (const lang of ['en', 'fil']) if (!only || only === lang) people.push(await seed(lang));
for (const who of people) console.log(`${who.lang}: seeded ${who.email} · plan ${who.planId} · deck ${who.deckId} · ${who.blocks.join(' | ')}`);

const format = (text, vars) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
const SHOT = {
  // name: [view, CSS height of the picture, pixel width of the saved file]
  planner: { wide: [900, 1320], phone: [640, 780] },
  slides: { wide: [880, 1860], phone: [700, 780] },
};

for (const who of people) {
  const words = STRINGS[who.lang];
  for (const view of ['wide', 'phone']) {
    const s = await open(view, who);
    const { page } = s;

    /* --- the multi-grade plan: the pinned session timeline and the second rotation ("Grade 5 with the teacher") --- */
    await page.goto(`${base}/lessons/${who.planId}`, { waitUntil: 'networkidle', timeout: 120000 });
    await page.getByLabel(words['editor.sessionNote']).waitFor({ timeout: 60000 });
    await settle(page);
    const box = await page.evaluate(async ([heading, startAt]) => {
      const title = [...document.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent.trim() === heading);
      if (!title) return null;
      // The block's card is the child of the list of blocks that holds the heading.
      let card = title;
      while (card.parentElement && !String(card.parentElement.className).includes('overflow-anchor')) card = card.parentElement;
      const strip = [...document.querySelectorAll('.sticky')].find((e) => e.querySelector('.tala-flow-seg'));
      if (!card.parentElement || !strip) return null;
      const section = strip.closest('section, [data-section], .bg-white') ?? strip.parentElement;
      const stripHeight = strip.getBoundingClientRect().height;
      const top = parseFloat(getComputedStyle(strip).top) || 0;
      // Wide: the whole block from its heading. Phone: from "Teacher is with", so the grades' boxes are in the picture.
      const from = startAt ? ([...card.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent.trim() === startAt) ?? card) : card;
      window.scrollTo(0, window.scrollY + from.getBoundingClientRect().top - top - stripHeight - 12);
      await new Promise((r) => setTimeout(r, 400));
      const a = strip.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const w = section.getBoundingClientRect();
      return { stripTop: a.top, stripBottom: a.bottom, cardTop: c.top, cardBottom: c.bottom, left: w.left, right: w.right, viewport: window.innerHeight };
    }, [format(words['editor.block'], { n: 3 }), view === 'phone' ? words['editor.teacherWith'] : '']);
    if (!box) throw new Error(`${who.lang} ${view}: the session flow was not found on the plan page`);
    const [plannerHeight, plannerWidth] = SHOT.planner[view];
    await save(page, `planner-${view}-${who.lang}`, { x: Math.max(0, box.left), y: Math.max(0, box.stripTop), width: Math.min(VIEW[view].viewport.width, box.right) - Math.max(0, box.left), height: Math.min(plannerHeight, box.viewport - Math.max(0, box.stripTop)) }, plannerWidth);

    /* --- her copy of the lesson's slides, with one slide corrected --- */
    await page.goto(`${base}/slides/${who.deckId}?plan=${who.deckPlanId}&slide=${DECK.slideId}`, { waitUntil: 'networkidle', timeout: 120000 });
    await page.locator(`#f-${DECK.slideId}-title`).first().waitFor({ timeout: 60000 });
    if (view === 'wide') {
      const edit = DECK.edit[who.lang];
      // On the phone the same deck is already corrected (the wide pass runs first and saves).
      await page.locator(`#f-${DECK.slideId}-title`).first().fill(edit.title);
      await page.locator(`#f-${DECK.slideId}-line-0`).first().fill(edit.line0);
      await page.locator(`#f-${DECK.slideId}-notes`).first().fill(edit.notes);
      await page.locator(`#f-${DECK.slideId}-notes`).first().blur();
    }
    await page.locator('[data-save-state="saved"]').first().waitFor({ timeout: 60000 });
    await page.mouse.move(5, 5);
    await settle(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    const [slidesHeight, slidesWidth] = SHOT.slides[view];
    await save(page, `slides-${view}-${who.lang}`, { x: 0, y: 0, width: VIEW[view].viewport.width, height: Math.min(slidesHeight, VIEW[view].viewport.height) }, slidesWidth);
    await s.ctx.close();
  }
}

await browser.close();
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ lessonDate, pack: DECK.packId, slide: DECK.slideId, files: written }, null, 1) + '\n');
for (const f of written) console.log(`${f.name}: ${f.w}×${f.h} · webp ${f.webp} B · jpg ${f.jpg} B`);
