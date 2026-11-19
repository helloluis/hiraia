// Captures the landing carousel screens from a running tala-web with the seeded demo account.
// Usage: node scripts/demo-capture.mjs <baseUrl> <email> <password> <draftPlanId> <lockedPlanId> [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_PATH || 'sharp');
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const [base, email, password, draftPlanId, lockedPlanId, outDir = 'public/screens'] =
  process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
// Optional: only capture the named screens (comma-separated), e.g. ONLY=week-phone,library-phone
const only = (process.env.ONLY || '').split(',').filter(Boolean);
// A pack to show on the Library screens (must be built in the running server's library).
const packId = process.env.PACK_ID || 'sci26-g4-t2-w10';
const shots = [];
async function capture(name, viewport, scale, go) {
  if (only.length && !only.includes(name)) return;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, timezoneId: 'Asia/Manila', locale: 'en-PH' });
  // The carousel shows the everyday screens, not the first-visit guide.
  await ctx.addInitScript(() => { try { localStorage.setItem('tala.firstSteps.done', '1'); } catch {} });
  const page = await ctx.newPage();
  await page.goto(base + '/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /Mag-log in|Log in/ }).click();
  await page.waitForURL('**/week', { timeout: 20000 });
  await page.waitForTimeout(2500);
  await go(page);
  // Hide the Next dev badge if present and take a viewport shot
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  await page.evaluate(() => document.fonts.ready.then(() => document.fonts.load("600 20px 'Fraunces'"))).catch(() => {});
  const png = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: png, fullPage: false });
  // Phone frames show at ≤ 300 CSS px, desktop ones at ≤ 640: 786 / 1200 px wide is plenty on a weak connection.
  const width = viewport.width <= 500 ? 786 : 1200;
  await sharp(png)
    .resize({ width })
    .webp({ quality: 70 })
    .toFile(path.join(outDir, `${name}.webp`));
  await sharp(png)
    .resize({ width })
    .jpeg({ quality: 72, mozjpeg: true })
    .toFile(path.join(outDir, `${name}.jpg`));
  fs.unlinkSync(png);
  const m = await sharp(path.join(outDir, `${name}.webp`)).metadata();
  shots.push({
    name,
    w: m.width,
    h: m.height,
    webp: fs.statSync(path.join(outDir, `${name}.webp`)).size,
    jpg: fs.statSync(path.join(outDir, `${name}.jpg`)).size,
  });
  await ctx.close();
}
const phone = { width: 393, height: 852 }; // 393 px phone proportions, captured at 2×
await capture('week-phone', phone, 2, async (page) => {
  await page.goto(base + '/week');
  await page.waitForTimeout(4000);
});
// The Library: the front page, a pack's lesson plan, and a teacher's own copy of the slides.
await capture('library-phone', phone, 2, async (page) => {
  await page.goto(base + '/library');
  await page.waitForTimeout(4000);
  await page.evaluate(() => {
    document.querySelector('#for-you')?.scrollIntoView();
    window.scrollBy(0, -76);
  });
  await page.waitForTimeout(600);
});
await capture('pack-phone', phone, 2, async (page) => {
  await page.goto(base + `/library/${packId}?tab=lessons&day=1`);
  await page.waitForTimeout(4500);
  await page.evaluate(() => {
    const h = [...document.querySelectorAll('h3')].find((x) => /Daloy ng lesson|How the lesson goes/.test(x.textContent || ''));
    h?.scrollIntoView();
    window.scrollBy(0, -150);
  });
  await page.waitForTimeout(600);
});
await capture('slides-phone', phone, 2, async (page) => {
  await page.goto(base + `/library/${packId}?tab=slides`);
  await page.locator('[data-slide-thumb="d2s6"]').first().waitFor({ timeout: 30000 });
  await page.locator('[data-slide-thumb="d2s6"]').first().click();
  await page.locator('dialog[open]').first().waitFor();
  await page.waitForTimeout(1800);
});
await capture('editor-phone', phone, 2, async (page) => {
  await page.goto(base + `/lessons/${lockedPlanId}`);
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const h = [...document.querySelectorAll('h2')].find((x) =>
      /Daloy|Session Flow/.test(x.textContent || '')
    );
    h?.scrollIntoView();
    window.scrollBy(0, -70);
  });
  await page.waitForTimeout(500);
});
await capture('draft-phone', phone, 2, async (page) => {
  await page.goto(base + `/lessons/${draftPlanId}`);
  await page.waitForTimeout(3000);
});
await capture('roster-phone', phone, 2, async (page) => {
  await page.goto(base + '/class/roster/import');
  await page.waitForTimeout(1500);
  await page
    .getByLabel(/I-paste|Paste/)
    .fill(
      [
        'Pangalan',
        'DELA CRUZ, Juan Miguel S.',
        'Reyes, Maria Clara',
        'SANTOS, Jose Jr.',
        'Mr. Bautista, Pedro (transferee)',
        'Villanueva, Grace',
        'TOTAL: 5',
      ].join('\n')
    );
  const noAi = page.getByRole('button', { name: /walang AI|without AI/ });
  const next = page.getByRole('button', { name: /Susunod|Next/ });
  await ((await noAi.count()) ? noAi : next).click();
  await page.waitForTimeout(3500);
  await page.evaluate(() => {
    const h = [...document.querySelectorAll('h2')].find((x) =>
      /Kailangan ng desisyon|Needs your decision/.test(x.textContent || '')
    );
    h?.scrollIntoView();
    window.scrollBy(0, -70);
  });
  await page.waitForTimeout(300);
});
await capture('print-phone', phone, 2, async (page) => {
  await page.goto(base + `/lessons/${lockedPlanId}/print?paper=a4`);
  await page.waitForTimeout(3000);
});
await capture('community-phone', phone, 2, async (page) => {
  await page.goto(base + '/community');
  await page.waitForTimeout(3000);
});
// A teacher's own copy of the slides, open in the editor (makes the copy on first run; it is private to the account).
await capture('slides-desktop', { width: 1280, height: 800 }, 1, async (page) => {
  await page.goto(base + `/library/${packId}?tab=slides`);
  await page.locator('[data-slide-thumb="d2s6"]').first().waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: /Edit my copy|Continue editing|I-edit ang kopya ko|Ituloy ang pag-edit/ }).first().click();
  await page.waitForURL(/\/slides\/[^/]+/, { timeout: 30000 });
  await page.locator('nav [data-slide-thumb="d2s6"]').waitFor({ timeout: 30000 });
  await page.locator('nav [data-slide-thumb="d2s6"]').click();
  await page.waitForTimeout(1800);
});
await capture('week-desktop', { width: 1280, height: 800 }, 1, async (page) => {
  await page.goto(base + '/week');
  await page.waitForTimeout(3000);
});
await capture('editor-desktop', { width: 1280, height: 800 }, 1, async (page) => {
  await page.goto(base + `/lessons/${lockedPlanId}`);
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const h = [...document.querySelectorAll('h2')].find((x) =>
      /Daloy|Session Flow/.test(x.textContent || '')
    );
    h?.scrollIntoView();
    window.scrollBy(0, -80);
  });
  await page.waitForTimeout(500);
});
await browser.close();
console.log(JSON.stringify(shots, null, 2));
