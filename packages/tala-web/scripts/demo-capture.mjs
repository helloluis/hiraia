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
const browser = await chromium.launch();
const shots = [];
async function capture(name, viewport, scale, go) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale });
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
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('main div.px-3.py-3')].find(
      (x) => /Science/.test(x.textContent || '') && /Grade 3/.test(x.textContent || '')
    );
    el?.scrollIntoView();
    window.scrollBy(0, -120);
  });
  await page.waitForTimeout(400);
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
