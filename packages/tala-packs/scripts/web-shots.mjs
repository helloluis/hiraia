// Screenshots of the running Tala web app (evidence for the library flow). Usage:
//   node scripts/web-shots.mjs <baseUrl> <outDir> <spec.json>
// spec: [{ "name": "...", "path": "/library?grade=4&term=1", "viewport": "phone"|"desktop", "signIn": true, "actions": [...] }]
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const [base, out, specFile] = process.argv.slice(2);
const spec = JSON.parse(readFileSync(specFile, 'utf8'));
const CHROMIUM = '/home/b11/code/hiraia/build/browser-runtime-145/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell';
const VIEW = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 },
};
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROMIUM });
const results = [];
for (const s of spec) {
  const ctx = await browser.newContext({ ...VIEW[s.viewport ?? 'desktop'] });
  if (s.lang) await ctx.addInitScript((l) => { try { localStorage.setItem('tala.lang', l); } catch {} }, s.lang);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  if (s.signIn) {
    // Register through the API, then sign in through the real form so the app's own session store is set.
    const email = s.email ?? `teacher+${Date.now()}${Math.floor(Math.random() * 1e4)}@example.org`;
    const password = 'correct horse battery staple 42';
    const reg = await page.request.post(`${base}/api/v1/auth/register`, { data: { email, password, displayName: 'Ma’am Test', language: 'en' } });
    if (!reg.ok()) errors.push(`register ${reg.status()} ${(await reg.text()).slice(0, 200)}`);
    await ctx.clearCookies();
    await page.goto(base + '/sign-in', { waitUntil: 'networkidle', timeout: 120000 });
    await page.locator('input[type=email]').fill(email);
    await page.locator('input[type=password]').fill(password);
    await page.locator('button[type=submit]').click();
    await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 60000 }).catch(() => errors.push('sign-in did not navigate'));
    for (const step of s.setup ?? []) {
      await page.goto(base + step.path, { waitUntil: 'networkidle', timeout: 120000 });
      if (step.click) await page.getByRole('button', { name: step.click }).first().click();
      if (step.wait) await page.waitForTimeout(step.wait);
    }
  }
  await page.goto(base + s.path, { waitUntil: 'networkidle', timeout: 120000 });
  for (const a of s.actions ?? []) {
    try {
      if (a.click) await page.getByRole(a.role ?? 'button', { name: a.click }).first().click();
      if (a.wait) await page.waitForTimeout(a.wait);
      if (a.waitFor) await page.getByText(a.waitFor).first().waitFor({ timeout: 60000 });
      if (a.shot) await page.screenshot({ path: join(out, `${s.name}-${a.shot}.png`), fullPage: Boolean(a.fullPage) });
    } catch (e) {
      errors.push(`action ${JSON.stringify(a)} failed: ${String(e).slice(0, 160)}`);
    }
  }
  await page.waitForTimeout(s.settle ?? 1200);
  const file = join(out, `${s.name}.png`);
  await page.screenshot({ path: file, fullPage: Boolean(s.fullPage) });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  const width = await page.evaluate(() => window.innerWidth);
  results.push({ name: s.name, file, url: page.url(), cssWidth: width, horizontalOverflow: overflow, errors });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
