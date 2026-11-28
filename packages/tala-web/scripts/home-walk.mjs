// Walk of the public homepage in a real browser, signed out. It only reads: no account, no form, no write. It can be
// pointed at a local build or at the live site.
//
// For English and Filipino, at desktop, two phone widths, a foldable width and a 200 % zoom, it checks what the page
// says (the three showcases, the promise section, the disclaimer), that nothing scrolls sideways, that each picture is
// the right file for the language and the layout and keeps its box, that the curriculum map is the shipped map and
// its pack marks are what the library's public index says right now, keyboard focus, touch sizes, contrast, the
// language switch, reduced motion, the page without script, a slow library answer, a failed one, and every link.
// With --reference it also photographs the hero on another deployment and compares the two pixel by pixel.
// Every step is a named check in home-walk.json; screenshots go beside it.
//
//   PLAYWRIGHT_PATH=… CHROMIUM_PATH=… SHARP_PATH=… pnpm exec tsx scripts/home-walk.mjs <baseUrl> <outDir>
//        [--reference https://tala.hiraia.org]   compare the hero with this deployment
//        [--skip-external]                        do not request the two outside links (qvac.tether.io, hiraia.org)
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const [baseArg, out] = argv;
const option = (name, fallback = '') => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
if (!baseArg || !out) throw new Error('usage: home-walk.mjs <baseUrl> <outDir> [--reference <url>] [--skip-external]');
const base = baseArg.replace(/\/$/, '');
const reference = option('reference').replace(/\/$/, '');
const skipExternal = argv.includes('--skip-external');
const { en } = await import('../src/i18n/en.ts');
const { fil } = await import('../src/i18n/fil.ts');
const { SCIENCE_COVERAGE } = await import('../src/features/landing/science-coverage.generated.ts');
const { packWeeks } = await import('../src/features/landing/coverage.ts');
const { SHOTS, WIDE_SHOT_FROM } = await import('../src/features/landing/shots.ts');
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright-core');
const sharp = require(process.env.SHARP_PATH || 'sharp');
mkdirSync(out, { recursive: true });

const STRINGS = { en, fil };
const LANGS = ['en', 'fil'];
const format = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
const manifest = JSON.parse(readFileSync(join(here, '../public/screens/home/manifest.json'), 'utf8'));
const results = [];
const notes = new Set();
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 400) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${String(detail).slice(0, 220)}` : ''}`);
};
const VIEWS = {
  desktop: { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 },
  phone390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  phone360: { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  fold: { viewport: { width: 768, height: 900 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true },
  // A 1366 × 900 window zoomed to 200 %: half the CSS pixels, twice the density.
  zoom200: { viewport: { width: 683, height: 450 }, deviceScaleFactor: 2 },
};

/* ------------------------------------------------ what the library says right now (the yardstick for pack numbers) */
const indexResponse = await fetch(`${base}/api/v1/packs/index`);
const liveIndex = indexResponse.ok ? await indexResponse.json() : null;
check('the library’s public index answers, signed out, without a cookie', indexResponse.ok && !indexResponse.headers.get('set-cookie'), `status ${indexResponse.status}`);
const expectedPacks = Object.fromEntries(LANGS.map((l) => [l, packWeeks(liveIndex, SCIENCE_COVERAGE, l)]));
const first = SCIENCE_COVERAGE.grades[0].grade;
const last = SCIENCE_COVERAGE.grades[SCIENCE_COVERAGE.grades.length - 1].grade;
const packsSentence = (lang) => {
  const p = expectedPacks[lang];
  if (!p) return STRINGS[lang]['landing.s.cur.packsAsk'];
  return format(STRINGS[lang][p.approved > 0 ? 'landing.s.cur.packsMixed' : 'landing.s.cur.packs'], { built: p.built.size, weeks: SCIENCE_COVERAGE.weeks });
};

/* ------------------------------------------------ the page's own answer: status, cookie, cache */
{
  const res = await fetch(`${base}/`, { redirect: 'manual' });
  const html = await res.text();
  check('GET / answers 200 as a page', res.status === 200 && /text\/html/.test(res.headers.get('content-type') ?? ''), `status ${res.status}`);
  check('GET / sets no cookie', !res.headers.get('set-cookie'), res.headers.get('set-cookie') ?? '');
  check('the served HTML names no model provider', !/deepseek|qwen|openrouter/i.test(html));
  // What a text reader gets without running any script: the curriculum sentence with its number, and no pack number.
  const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  check('the served HTML carries the curriculum number and the always-true pack line, and no pack count', text.includes(String(SCIENCE_COVERAGE.competencies)) && text.includes(fil['landing.s.cur.packsAsk']) && !new RegExp(`\\b\\d+ (of|sa kabuuang) ${SCIENCE_COVERAGE.weeks}\\b`).test(text));
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
async function open(view, lang, extra = {}) {
  const ctx = await browser.newContext({ ...VIEWS[view], locale: 'en-PH', timezoneId: 'Asia/Manila', ...extra });
  await ctx.addInitScript((l) => {
    try {
      localStorage.setItem('tala.lang', l);
    } catch {}
  }, lang);
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().startsWith(base)) problems.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  return { ctx, page, view, lang, problems, width: VIEWS[view].viewport.width };
}
const ready = async (page) => {
  await page.evaluate(() => document.fonts.ready.then(() => document.fonts.load("600 20px 'Fraunces'"))).catch(() => {});
  await page.locator('[data-packs]').first().waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
};
/** Scroll down the page in steps (as a reader does), so lazy pictures load and waiting pictures come in. */
const readThrough = (page) =>
  page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.6);
    for (let y = 0; y <= document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 180));
    }
    await Promise.race([
      Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))),
      new Promise((r) => setTimeout(r, 8000)),
    ]);
    await new Promise((r) => setTimeout(r, 700));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 200));
  });
const sideways = (page, width) => page.evaluate((w) => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, ok: document.documentElement.scrollWidth <= w + 1 && window.innerWidth <= w + 1 }), width);

/* ------------------------------------------------ every language at every width */
const shifts = {};
for (const lang of LANGS) {
  const T = STRINGS[lang];
  for (const view of Object.keys(VIEWS)) {
    const s = await open(view, lang);
    const { page } = s;
    const tag = `${lang} ${view}`;
    // Layout shifts are recorded from the first paint on.
    await s.ctx.addInitScript(() => {
      window.__shift = 0;
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (!e.hadRecentInput) window.__shift += e.value;
        }).observe({ type: 'layout-shift', buffered: true });
      } catch {}
    });
    const res = await page.goto(`${base}/`, { waitUntil: 'networkidle', timeout: 120000 });
    await ready(page);
    await page.waitForFunction(() => document.querySelector('[data-packs]')?.getAttribute('data-packs') !== 'loading', null, { timeout: 30000 }).catch(() => {});
    await readThrough(page);

    const seen = await page.evaluate(() => {
      const text = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.replace(/\s+/g, ' ').trim());
      return {
        htmlLang: document.documentElement.lang,
        h1: text('main h1'),
        h2: text('main h2'),
        h3: text('#screens h3'),
        articles: document.querySelectorAll('#screens article').length,
        packs: document.querySelector('[data-packs]')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
        packsState: document.querySelector('[data-packs]')?.getAttribute('data-packs') ?? null,
        marks: document.querySelectorAll('#screens table tbody td span[aria-hidden] > span').length,
        caps: [...document.querySelectorAll('#screens table .tala-landing-cap')].filter((e) => getComputedStyle(e).display !== 'none').length,
        rows: document.querySelectorAll('#screens table tbody tr').length,
        cols: document.querySelectorAll('#screens table thead th').length - 1,
        body: document.body.innerText,
        promise: text('main section.bg-forest h3'),
        footer: document.querySelector('footer p')?.textContent.trim() ?? '',
        heroTarget: Boolean(document.querySelector(document.querySelector('main section a[href^="#"]')?.getAttribute('href') ?? '#none')),
      };
    });
    check(`${tag}: the page loads with no error and no failed request`, res?.status() === 200 && s.problems.length === 0, s.problems.join(' | '));
    check(`${tag}: the page is in ${lang === 'fil' ? 'Filipino' : 'English'}`, seen.htmlLang === lang && seen.h1[0] === T['landing.h1'], `${seen.htmlLang}: ${seen.h1[0]}`);
    const wantH3 = [T['landing.s.mg.h'], T['landing.s.sl.h'], format(T['landing.s.cur.h'], { from: first, to: last })];
    check(`${tag}: exactly three showcases, in order: multi-grade plan, slides, Science curriculum`, seen.articles === 3 && JSON.stringify(seen.h3) === JSON.stringify(wantH3), seen.h3.join(' | '));
    check(`${tag}: the curriculum sentence carries the shipped number of competencies`, seen.body.includes(format(T['landing.s.cur.b'], { competencies: SCIENCE_COVERAGE.competencies })));
    check(`${tag}: the map is ${SCIENCE_COVERAGE.grades.length} grades by 3 terms with one mark per mapped week (${SCIENCE_COVERAGE.weeks})`, seen.rows === SCIENCE_COVERAGE.grades.length && seen.cols === 3 && seen.marks === SCIENCE_COVERAGE.weeks, `${seen.rows} rows, ${seen.cols} terms, ${seen.marks} marks`);
    check(`${tag}: the pack sentence and the pack marks are what the library says now`, seen.packs === packsSentence(lang) && seen.caps === (expectedPacks[lang]?.built.size ?? 0), `${seen.packsState}: "${seen.packs}" · ${seen.caps} marks`);
    check(`${tag}: the promise section has its four promises and the disclaimer is word for word`, JSON.stringify(seen.promise) === JSON.stringify(['free', 'offline', 'simple', 'check'].map((k) => T[`landing.p.${k}.k`])) && seen.footer === T['landing.footerDeped'] && seen.body.includes(T['landing.promiseTitle']));
    check(`${tag}: no model provider is named on the page`, !/deepseek|qwen|openrouter/i.test(seen.body));
    check(`${tag}: the hero’s arrow has somewhere to land`, seen.heroTarget);
    const wide = await sideways(page, s.width);
    check(`${tag}: nothing scrolls sideways`, wide.ok, `page ${wide.scrollWidth}px, window ${wide.innerWidth}px, device ${s.width}px`);

    // Pictures: the right file for this language and layout, loaded, described, and in a box of its own proportions.
    const layout = s.width >= WIDE_SHOT_FROM ? 'wide' : 'phone';
    const pictures = await page.evaluate(() =>
      [...document.querySelectorAll('#screens figure picture img')].map((img) => {
        const box = img.closest('picture').getBoundingClientRect();
        return { src: img.currentSrc.replace(location.origin, ''), alt: img.alt, natural: [img.naturalWidth, img.naturalHeight], box: [box.width, box.height], shown: getComputedStyle(img.closest('figure')).opacity };
      })
    );
    const wantPictures = [
      ['planner', T['landing.s.mg.alt']],
      ['slides', T['landing.s.sl.alt']],
    ];
    const pictureProblems = [];
    wantPictures.forEach(([name, alt], i) => {
      const p = pictures[i];
      const file = manifest.files.find((f) => f.name === `${name}-${layout}-${lang}`);
      if (!p) return pictureProblems.push(`${name}: missing`);
      if (p.src !== `/screens/home/${name}-${layout}-${lang}.webp`) pictureProblems.push(`${name}: shows ${p.src}`);
      if (p.natural[0] !== file.w || p.natural[1] !== file.h) pictureProblems.push(`${name}: ${p.natural.join('×')} loaded, manifest ${file.w}×${file.h}`);
      if (p.alt !== alt) pictureProblems.push(`${name}: description differs`);
      if (p.shown !== '1') pictureProblems.push(`${name}: opacity ${p.shown}`);
      // The box is never taller than the picture's own proportions (a taller box would stretch or letterbox it), and
      // the full width is used. In the one-column layout a tall capture may be shown cut at the bottom.
      const own = SHOTS[name][layout][1] / SHOTS[name][layout][0];
      const ratio = p.box[1] / p.box[0];
      if (ratio > own + 0.01 || ratio < own * 0.75) pictureProblems.push(`${name}: box ${ratio.toFixed(3)}, picture ${own.toFixed(3)}`);
    });
    check(`${tag}: both pictures are this language’s ${layout} captures, loaded, described and unstretched`, pictures.length === 2 && pictureProblems.length === 0, pictureProblems.join(' | '));

    // "Good" by the usual yardstick is under 0.1. What there is comes from the hero: a reader who chose English gets
    // the server's Filipino first and the hero card changes height when the words change (so it is the same on any
    // deployment; the reference comparison below shows this page adds nothing to it).
    const shift = await page.evaluate(() => window.__shift);
    shifts[`${lang} ${view}`] = Number(shift);
    check(`${tag}: the page holds still while it loads and is read through (layout shift under 0.1)`, typeof shift === 'number' && shift < 0.1, `cumulative layout shift ${Number(shift).toFixed(4)}`);

    if (VIEWS[view].hasTouch) {
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('header a, header button, main a, main button, footer a')]
          .filter((e) => e.getClientRects().length)
          .map((e) => ({ name: (e.getAttribute('aria-label') || e.textContent.trim() || e.querySelector('img')?.alt || '').trim().slice(0, 40), w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height), footer: Boolean(e.closest('footer')) }))
          .filter((e) => e.h < 44 || e.w < 44)
      );
      const body = small.filter((e) => !e.footer);
      check(`${tag}: every link and button in the header and the page is at least 44 px tall and wide`, body.length === 0, body.map((e) => `${e.name} ${e.w}×${e.h}`).join(' | '));
      // The footer belongs to the shell shared with /download, /forms and the Library; what is small there is noted.
      for (const e of small.filter((x) => x.footer)) notes.add(`footer (shared shell, not part of this change): "${e.name}" is ${e.w}×${e.h} px on ${view}`);
    }
    await page.screenshot({ path: join(out, `home-${view}-${lang}-full.png`), fullPage: true });
    await page.screenshot({ path: join(out, `home-${view}-${lang}-top.png`) });
    await s.ctx.close();
  }
}

/* ------------------------------------------------ keyboard: every stop shows where it is */
for (const lang of LANGS) {
  const s = await open('desktop', lang);
  const { page } = s;
  await page.goto(`${base}/`, { waitUntil: 'networkidle', timeout: 120000 });
  await ready(page);
  const stops = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body) return null;
      const cs = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      return {
        name: (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50),
        tag: e.tagName,
        ring: e.matches(':focus-visible') && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2,
        inView: r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth,
        inShowcase: Boolean(e.closest('#screens')),
      };
    });
    if (!stop) break;
    if (stops.length && stop.name === stops[0].name && stop.tag === stops[0].tag && stops.length > 3) break;
    stops.push(stop);
  }
  const T = STRINGS[lang];
  const names = stops.map((x) => x.name);
  check(`${lang}: the keyboard reaches every action on the page, each with a visible focus ring and in view`, stops.length >= 10 && stops.every((x) => x.ring && x.inView), `${stops.length} stops: ${names.join(' › ')}`.slice(0, 380) + (stops.some((x) => !x.ring || !x.inView) ? ` · WITHOUT RING OR OUT OF VIEW: ${stops.filter((x) => !x.ring || !x.inView).map((x) => x.name).join(', ')}` : ''));
  check(`${lang}: the showcases add one keyboard stop, the Library link, after the hero’s actions`, stops.filter((x) => x.inShowcase).length === 1 && names.includes(T['landing.s.cur.link']) && names.indexOf(T['landing.s.cur.link']) > names.indexOf(T['landing.register']), names.filter((n, i) => stops[i].inShowcase).join(', '));
  await page.screenshot({ path: join(out, `home-focus-${lang}.png`) });
  await s.ctx.close();
}

/* ------------------------------------------------ contrast of the new text */
for (const lang of LANGS)
  for (const view of ['desktop', 'phone360']) {
    const s = await open(view, lang);
    await s.page.goto(`${base}/`, { waitUntil: 'networkidle', timeout: 120000 });
    await ready(s.page);
    await s.page.waitForFunction(() => document.querySelector('[data-packs]')?.getAttribute('data-packs') !== 'loading', null, { timeout: 30000 }).catch(() => {});
    const low = await s.page.evaluate(() => {
      const parse = (c) => {
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (!m) return [0, 0, 0, 0];
        const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
      };
      const over = (top, under) => {
        const a = top[3];
        return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
      };
      const backdrop = (el) => {
        const layers = [];
        for (let e = el; e; e = e.parentElement) {
          const c = parse(getComputedStyle(e).backgroundColor);
          if (c[3] > 0) layers.push(c);
          if (c[3] >= 1) break;
        }
        let colour = [255, 255, 255, 1];
        for (const layer of layers.reverse()) colour = over(layer, colour);
        return colour;
      };
      const lum = (c) => {
        const f = (v) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
      };
      const out = [];
      const walker = document.createTreeWalker(document.querySelector('#screens'), NodeFilter.SHOW_TEXT);
      const done = new Set();
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!n.textContent.trim() || done.has(el)) continue;
        done.add(el);
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || el.closest('.sr-only') || el.closest('[aria-hidden="true"]')) continue;
        const bg = backdrop(el);
        const fg = over(parse(cs.color), bg);
        const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
        const ratio = (hi + 0.05) / (lo + 0.05);
        const size = parseFloat(cs.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
        if (ratio < (large ? 3 : 4.5)) out.push(`${n.textContent.trim().slice(0, 30)} ${ratio.toFixed(2)}:1 at ${size}px`);
        else out.push(null);
      }
      return { failures: out.filter(Boolean), checked: out.length };
    });
    check(`${lang} ${view}: every piece of text in the showcases meets WCAG AA contrast`, low.checked > 15 && low.failures.length === 0, `${low.checked} pieces checked${low.failures.length ? ` · ${low.failures.join(' | ')}` : ''}`);
    await s.ctx.close();
  }

/* ------------------------------------------------ the language switch */
for (const [from, to] of [['en', 'fil'], ['fil', 'en']]) {
  const s = await open('desktop', from);
  const { page } = s;
  await page.goto(`${base}/`, { waitUntil: 'networkidle', timeout: 120000 });
  await ready(page);
  await page.locator(`header button[lang="${to}"]`).click();
  await page.waitForFunction((l) => document.documentElement.lang === l, to, { timeout: 15000 }).catch(() => {});
  await readThrough(page);
  const after = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    h3: [...document.querySelectorAll('#screens h3')].map((e) => e.textContent.trim()),
    promise: document.querySelector('main section.bg-forest h2')?.textContent.trim(),
    srcs: [...document.querySelectorAll('#screens figure picture img')].map((i) => i.currentSrc.replace(location.origin, '')),
    stored: localStorage.getItem('tala.lang'),
    pressed: document.querySelector('header button[aria-pressed="true"]')?.getAttribute('lang'),
  }));
  const T = STRINGS[to];
  check(`switching from ${from} to ${to} changes the words, the pictures and the page language at once`, after.lang === to && after.h3[0] === T['landing.s.mg.h'] && after.promise === T['landing.promiseTitle'] && after.srcs.every((x) => x.endsWith(`-${to}.webp`)) && after.pressed === to, `${after.lang} · ${after.h3[0]} · ${after.srcs.join(', ')}`);
  // The choice is the reader's: it is kept on this device for the next visit.
  await s.ctx.addInitScript(() => {});
  check(`the choice of ${to} is remembered on this device`, after.stored === to, `stored: ${after.stored}`);
  await s.ctx.close();
}

/* ------------------------------------------------ motion: a waiting picture comes in once; reduced motion: nothing moves */
for (const view of ['desktop', 'phone390']) {
  const s = await open(view, 'en');
  const { page } = s;
  await page.goto(`${base}/`, { waitUntil: 'networkidle', timeout: 120000 });
  await ready(page);
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => [...document.querySelectorAll('.tala-landing-reveal')].map((e) => ({ state: e.dataset.reveal ?? '', top: Math.round(e.getBoundingClientRect().top), opacity: getComputedStyle(e).opacity })));
  await readThrough(page);
  const after = await page.evaluate(() => [...document.querySelectorAll('.tala-landing-reveal')].map((e) => ({ state: e.dataset.reveal ?? '', opacity: getComputedStyle(e).opacity, translate: getComputedStyle(e).translate })));
  check(`${view}: pictures below the screen wait, and each has come in fully once the page is read through`, before.length === 2 && before.every((b) => b.state === 'wait' && b.opacity === '0') && after.every((a) => a.state === 'in' && a.opacity === '1' && (a.translate === 'none' || a.translate === '0px')), `before ${JSON.stringify(before)} · after ${JSON.stringify(after)}`);
  await s.ctx.close();

  const r = await open(view, 'en', { reducedMotion: 'reduce' });
  await r.page.goto(`${base}/`, { waitUntil: 'networkidle', timeout: 120000 });
  await ready(r.page);
  await r.page.waitForFunction(() => document.querySelector('[data-packs]')?.getAttribute('data-packs') !== 'loading', null, { timeout: 30000 }).catch(() => {});
  await r.page.waitForTimeout(300);
  const still = await r.page.evaluate(() => ({
    figures: [...document.querySelectorAll('.tala-landing-reveal')].map((e) => ({ state: e.dataset.reveal ?? '', opacity: getComputedStyle(e).opacity })),
    caps: [...document.querySelectorAll('.tala-landing-cap')].slice(0, 400).map((e) => getComputedStyle(e).animationName),
    hidden: [...document.querySelectorAll('#screens *')].filter((e) => getComputedStyle(e).opacity === '0').length,
  }));
  check(`${view}, reduced motion: every picture is simply there, and nothing in the showcases animates`, still.figures.length === 2 && still.figures.every((f) => f.state === '' && f.opacity === '1') && still.caps.every((n) => n === 'none') && still.hidden === 0, JSON.stringify({ figures: still.figures, animated: still.caps.filter((n) => n !== 'none').length }));
  await r.page.screenshot({ path: join(out, `home-${view}-en-reduced-motion.png`), fullPage: true });
  await r.ctx.close();
}

/* ------------------------------------------------ the library answers late, or not at all */
for (const lang of LANGS)
  for (const view of ['desktop', 'phone360']) {
    const T = STRINGS[lang];
    // Late: three seconds. Until then the always-true line stands, no mark is drawn and no number is shown.
    const s = await open(view, lang);
    await s.page.route('**/api/v1/packs/index*', async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.continue();
    });
    await s.page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await ready(s.page);
    await s.page.locator('#home-cur').scrollIntoViewIfNeeded();
    await s.page.waitForTimeout(500);
    const waiting = await s.page.evaluate(() => {
      const p = document.querySelector('[data-packs]');
      const link = document.querySelector('#screens a[href="/library"]').getBoundingClientRect();
      const map = document.querySelector('#screens table').getBoundingClientRect();
      return { state: p.getAttribute('data-packs'), text: p.textContent.trim(), caps: [...document.querySelectorAll('.tala-landing-cap')].filter((e) => getComputedStyle(e).display !== 'none').length, link: Math.round(link.top + window.scrollY), map: Math.round(map.top + window.scrollY), mapHeight: Math.round(map.height) };
    });
    await s.page.waitForFunction(() => document.querySelector('[data-packs]')?.getAttribute('data-packs') === 'ready', null, { timeout: 20000 }).catch(() => {});
    await s.page.waitForTimeout(600);
    const arrived = await s.page.evaluate(() => {
      const p = document.querySelector('[data-packs]');
      const link = document.querySelector('#screens a[href="/library"]').getBoundingClientRect();
      const map = document.querySelector('#screens table').getBoundingClientRect();
      return { state: p.getAttribute('data-packs'), text: p.textContent.trim(), link: Math.round(link.top + window.scrollY), map: Math.round(map.top + window.scrollY), mapHeight: Math.round(map.height) };
    });
    check(`${lang} ${view}, slow library: until it answers the line gives no number and no pack mark is drawn`, waiting.state === 'loading' && waiting.text === T['landing.s.cur.packsAsk'] && waiting.caps === 0 && !/\d/.test(waiting.text), `"${waiting.text}" · ${waiting.caps} marks`);
    check(`${lang} ${view}, slow library: when it answers, the numbered line takes its place and nothing below moves`, arrived.state === (expectedPacks[lang] ? 'ready' : 'failed') && arrived.text === packsSentence(lang) && arrived.link === waiting.link && arrived.map === waiting.map && arrived.mapHeight === waiting.mapHeight, `link ${waiting.link} → ${arrived.link}, map ${waiting.map} → ${arrived.map}, map height ${waiting.mapHeight} → ${arrived.mapHeight}`);
    await s.ctx.close();

    // Not at all: the request fails. The page keeps the always-true line, draws no mark, drops the pack legend.
    const f = await open(view, lang);
    await f.page.route('**/api/v1/packs/index*', (route) => route.abort('failed'));
    await f.page.goto(`${base}/`, { waitUntil: 'networkidle', timeout: 120000 });
    await ready(f.page);
    await f.page.waitForFunction(() => document.querySelector('[data-packs]')?.getAttribute('data-packs') === 'failed', null, { timeout: 20000 }).catch(() => {});
    const failed = await f.page.evaluate(() => ({
      state: document.querySelector('[data-packs]').getAttribute('data-packs'),
      text: document.querySelector('[data-packs]').textContent.trim(),
      caps: [...document.querySelectorAll('.tala-landing-cap')].filter((e) => getComputedStyle(e).display !== 'none').length,
      legend: document.querySelectorAll('#screens figcaption > span').length,
      marks: document.querySelectorAll('#screens table tbody td span[aria-hidden] > span').length,
      section: document.querySelector('#home-cur').closest('article').innerText,
    }));
    check(`${lang} ${view}, no answer from the library: the map stays, no mark and no legend for packs, and no pack number anywhere`, failed.state === 'failed' && failed.text === T['landing.s.cur.packsAsk'] && failed.caps === 0 && failed.legend === 1 && failed.marks === SCIENCE_COVERAGE.weeks && !failed.section.includes(String(SCIENCE_COVERAGE.weeks)), `"${failed.text}" · ${failed.caps} marks · ${failed.legend} legend item(s)`);
    await f.page.locator('#home-cur').scrollIntoViewIfNeeded();
    await f.page.waitForTimeout(900); // the picture above has just come into view: let it finish coming in
    await f.page.screenshot({ path: join(out, `home-${view}-${lang}-library-unreachable.png`) });
    await f.ctx.close();
  }

/* ------------------------------------------------ without script */
for (const lang of ['fil']) {
  // Without script the page cannot read the reader's saved language: it is served in Filipino, the default.
  const s = await open('desktop', lang, { javaScriptEnabled: false });
  const res = await s.page.goto(`${base}/`, { waitUntil: 'load', timeout: 120000 });
  const T = STRINGS[lang];
  const plain = await s.page.evaluate(() => ({
    h3: [...document.querySelectorAll('#screens h3')].map((e) => e.textContent.trim()),
    figures: [...document.querySelectorAll('.tala-landing-reveal')].map((e) => getComputedStyle(e).opacity),
    marks: document.querySelectorAll('#screens table tbody td span[aria-hidden] > span').length,
    packs: document.querySelector('[data-packs]')?.textContent.trim(),
    images: [...document.querySelectorAll('#screens img')].map((i) => i.getAttribute('src')),
    register: Boolean(document.querySelector('a[href="/register"]')),
  }));
  check('without script: the three showcases, their pictures, the whole map and the links are all there, with no pack number', res?.status() === 200 && plain.h3.length === 3 && plain.h3[0] === T['landing.s.mg.h'] && plain.figures.every((o) => o === '1') && plain.marks === SCIENCE_COVERAGE.weeks && plain.packs === T['landing.s.cur.packsAsk'] && plain.images.length === 2 && plain.register, JSON.stringify({ h3: plain.h3.length, figures: plain.figures, marks: plain.marks, packs: plain.packs }));
  await s.page.screenshot({ path: join(out, `home-desktop-${lang}-no-script.png`), fullPage: true });
  await s.ctx.close();
}

/* ------------------------------------------------ links */
{
  const s = await open('desktop', 'en');
  await s.page.goto(`${base}/`, { waitUntil: 'networkidle', timeout: 120000 });
  const hrefs = await s.page.evaluate(() => [...new Set([...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')))]);
  await s.ctx.close();
  const internal = hrefs.filter((h) => h.startsWith('/'));
  const outside = hrefs.filter((h) => /^https?:/.test(h));
  const anchors = hrefs.filter((h) => h.startsWith('#'));
  const bad = [];
  for (const h of internal) {
    const r = await fetch(base + h, { redirect: 'manual' });
    const type = r.headers.get('content-type') ?? '';
    if (r.status !== 200 || !/text\/html/.test(type)) bad.push(`${h} → ${r.status}`);
    if (r.headers.get('set-cookie')) bad.push(`${h} sets a cookie`);
  }
  check(`every link on the page that stays on the site opens a public page, signed out, without a cookie (${internal.join(', ')})`, internal.length >= 5 && bad.length === 0, bad.join(' | '));
  check('no link on the page points at a pack file or at the API', !hrefs.some((h) => /\/api\/|\/packs\/|\.pptx|\.pdf/.test(h)), hrefs.join(', '));
  check(`the in-page link has its target (${anchors.join(', ')})`, anchors.length === 1 && anchors[0] === '#screens');
  if (!skipExternal) {
    const down = [];
    for (const h of outside) {
      try {
        const r = await fetch(h, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
        if (r.status >= 400) down.push(`${h} → ${r.status}`);
      } catch (e) {
        down.push(`${h} → ${String(e).slice(0, 60)}`);
      }
    }
    check(`the outside links answer (${outside.join(', ')})`, outside.length === 2 && down.length === 0, down.join(' | '));
  }
}

/* ------------------------------------------------ the hero, against another deployment */
if (reference) {
  // The same measurement on the reference: this page must not move more than the one it replaces.
  for (const lang of LANGS)
    for (const view of Object.keys(VIEWS)) {
      const s = await open(view, lang);
      await s.ctx.addInitScript(() => {
        window.__shift = 0;
        try {
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) if (!e.hadRecentInput) window.__shift += e.value;
          }).observe({ type: 'layout-shift', buffered: true });
        } catch {}
      });
      await s.page.goto(`${reference}/`, { waitUntil: 'networkidle', timeout: 120000 });
      await s.page.waitForTimeout(1200);
      await readThrough(s.page);
      const theirs = Number(await s.page.evaluate(() => window.__shift));
      const ours = shifts[`${lang} ${view}`];
      check(`${lang} ${view}: no more layout shift than ${reference}`, ours <= theirs + 0.002, `this page ${ours.toFixed(4)}, reference ${theirs.toFixed(4)}`);
      await s.ctx.close();
    }

  for (const lang of LANGS)
    for (const view of ['desktop', 'phone390', 'phone360', 'fold']) {
      const shots = [];
      for (const site of [reference, base]) {
        const s = await open(view, lang);
        await s.page.goto(`${site}/`, { waitUntil: 'networkidle', timeout: 120000 });
        await s.page.evaluate(() => document.fonts.ready.then(() => document.fonts.load("600 20px 'Fraunces'"))).catch(() => {});
        await s.page.waitForFunction(() => [...document.querySelectorAll('main > section:first-of-type img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 30000 }).catch(() => {});
        await s.page.waitForTimeout(600);
        // The header bar overlays the hero, so it is in the picture too.
        const png = await s.page.locator('main > section').first().screenshot({ type: 'png' });
        const html = await s.page.evaluate(() => document.querySelector('main > section').outerHTML.replace(/\s+/g, ' '));
        shots.push({ site, png, html });
        await s.ctx.close();
      }
      const [a, b] = await Promise.all(shots.map((x) => sharp(x.png).raw().ensureAlpha().toBuffer({ resolveWithObject: true })));
      let different = -1;
      if (a.info.width === b.info.width && a.info.height === b.info.height) {
        different = 0;
        for (let i = 0; i < a.data.length; i += 4) if (Math.abs(a.data[i] - b.data[i]) > 2 || Math.abs(a.data[i + 1] - b.data[i + 1]) > 2 || Math.abs(a.data[i + 2] - b.data[i + 2]) > 2) different++;
      }
      writeFileSync(join(out, `hero-${view}-${lang}-reference.png`), shots[0].png);
      writeFileSync(join(out, `hero-${view}-${lang}-candidate.png`), shots[1].png);
      check(`hero, ${lang} ${view}: the same markup and the same picture as ${reference}, pixel for pixel`, shots[0].html === shots[1].html && different === 0, `${a.info.width}×${a.info.height} vs ${b.info.width}×${b.info.height}, ${different} pixels differ, markup ${shots[0].html === shots[1].html ? 'identical' : 'DIFFERS'}`);
    }
}

await browser.close();
const failed = results.filter((r) => !r.ok);
writeFileSync(join(out, 'home-walk.json'), JSON.stringify({ base, reference: reference || null, at: new Date().toISOString(), coverage: { competencies: SCIENCE_COVERAGE.competencies, weeks: SCIENCE_COVERAGE.weeks }, packs: Object.fromEntries(LANGS.map((l) => [l, expectedPacks[l] ? { built: expectedPacks[l].built.size, approved: expectedPacks[l].approved } : null])), passed: results.length - failed.length, failed: failed.length, notes: [...notes], results }, null, 1));
for (const n of notes) console.log(`NOTE  ${n}`);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
