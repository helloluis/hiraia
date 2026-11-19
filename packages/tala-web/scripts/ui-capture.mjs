// Scripted screenshots of the running Tala web app, at phone and desktop sizes, for visual review.
//   node scripts/ui-capture.mjs <baseUrl> <outDir> <spec.json>
// spec.json: { "groups": [ { "viewport": "phone"|"desktop"|"tablet", "lang": "en"|"fil",
//                            "account": { "email": "...", "password": "..." } | null,
//                            "shots": [ { "name", "path", "fullPage"?, "settle"?, "actions"?: [...] } ] } ] }
// actions (in order): { "click": "visible text" } | { "click": { "role", "name" } } | { "click": { "selector" } }
//   | { "fill": { "selector", "value" } } | { "press": "ArrowRight" } | { "wait": ms } | { "waitFor": "text" }
//   | { "scrollTo": "text or selector" } | { "eval": "js" } | { "shot": "suffix", "fullPage"? }
// One browser context per group: signs in once through the real form, then walks the shots.
// Playwright and Chromium come from the dev box (not dependencies of this package):
//   PLAYWRIGHT_PATH=/…/node_modules/playwright-core/index.mjs  CHROMIUM_PATH=/…/chrome-headless-shell
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [base, out, specFile] = process.argv.slice(2);
if (!base || !out || !specFile) throw new Error('usage: ui-capture.mjs <baseUrl> <outDir> <spec.json>');
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright-core');
const spec = JSON.parse(readFileSync(specFile, 'utf8'));
const VIEW = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  small: { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1366, height: 860 }, deviceScaleFactor: 1 },
  wide: { viewport: { width: 1600, height: 960 }, deviceScaleFactor: 1 },
};
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const results = [];

const locate = (page, target) => {
  if (typeof target === 'string') return page.getByText(target, { exact: false }).first();
  if (target.role) return page.getByRole(target.role, { name: target.name, exact: target.exact ?? false }).first();
  if (target.testId) return page.getByTestId(target.testId).first();
  return page.locator(target.selector).first();
};

for (const group of spec.groups) {
  const ctx = await browser.newContext({ ...VIEW[group.viewport ?? 'desktop'], locale: 'en-PH', timezoneId: 'Asia/Manila' });
  if (group.lang) await ctx.addInitScript((l) => { try { localStorage.setItem('tala.lang', l); } catch {} }, group.lang);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 240)}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 240)}`); });
  if (group.account) {
    await page.goto(base + '/sign-in', { waitUntil: 'networkidle', timeout: 120000 });
    await page.locator('input[type=email]').fill(group.account.email);
    await page.locator('input[type=password]').fill(group.account.password);
    await page.locator('button[type=submit]').click();
    await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 60000 }).catch(() => errors.push('sign-in did not navigate'));
    await page.waitForTimeout(group.afterSignIn ?? 2500);
  }
  for (const s of group.shots) {
    const before = errors.length;
    const name = `${s.name}-${group.viewport ?? 'desktop'}-${group.lang ?? 'fil'}`;
    try {
      if (s.path) await page.goto(base + s.path, { waitUntil: 'networkidle', timeout: 120000 });
      await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }).catch(() => {});
      for (const a of s.actions ?? []) {
        if (a.click) await locate(page, a.click).click({ timeout: 20000 });
        if (a.fill) await page.locator(a.fill.selector).first().fill(a.fill.value);
        if (a.type) await page.keyboard.type(a.type, { delay: 15 });
        if (a.press) await page.keyboard.press(a.press);
        if (a.waitFor) await page.getByText(a.waitFor).first().waitFor({ timeout: 60000 });
        if (a.scrollTo) await locate(page, a.scrollTo.startsWith?.('css=') ? { selector: a.scrollTo.slice(4) } : a.scrollTo).scrollIntoViewIfNeeded();
        if (a.eval) await page.evaluate(a.eval);
        if (a.wait) await page.waitForTimeout(a.wait);
        if (a.shot) {
          await page.evaluate(() => document.fonts.ready).catch(() => {});
          await page.screenshot({ path: join(out, `${name}-${a.shot}.png`), fullPage: Boolean(a.fullPage) });
        }
      }
      await page.waitForTimeout(s.settle ?? 900);
      // Never shoot with a fallback face: wait for the self-hosted display font.
      await page.evaluate(() => document.fonts.ready.then(() => document.fonts.load("600 20px 'Fraunces'"))).catch(() => {});
      const file = join(out, `${name}.png`);
      await page.screenshot({ path: file, fullPage: Boolean(s.fullPage) });
      const metrics = await page.evaluate(() => ({
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
        height: document.documentElement.scrollHeight,
        width: window.innerWidth,
      }));
      results.push({ name, url: page.url(), ...metrics, errors: errors.slice(before) });
    } catch (e) {
      results.push({ name, url: page.url(), failed: String(e).slice(0, 300), errors: errors.slice(before) });
    }
  }
  await ctx.close();
}
await browser.close();
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 1));
console.log(JSON.stringify(results.map((r) => ({ name: r.name, h: r.height, overflowX: r.overflowX, failed: r.failed, errors: r.errors?.length ? r.errors : undefined })), null, 1));
