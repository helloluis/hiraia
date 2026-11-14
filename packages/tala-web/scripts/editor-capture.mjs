// Captures editor review views (competency picker, Session Flow card, block controls, locked plan) at 393 px @2×
// and desktop. Usage: node scripts/editor-capture.mjs <baseUrl> <email> <password> <draftPlanId> <lockedPlanId> <outDir>
import fs from 'node:fs';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const [base, email, password, draftPlanId, lockedPlanId, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
async function shoot(name, viewport, scale, go) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  await page.goto(base + '/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /Mag-log in|Log in/ }).click();
  await page.waitForURL('**/week', { timeout: 20000 });
  await page.waitForTimeout(1500);
  await go(page);
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: false });
  await ctx.close();
  console.log('shot', name);
}
const scrollTo = (re) => async (page) => {
  await page.evaluate((src) => {
    const re = new RegExp(src);
    const h = [...document.querySelectorAll('h2, h3')].find((x) => re.test(x.textContent || ''));
    h?.scrollIntoView();
    window.scrollBy(0, -80);
  }, re.source);
  await page.waitForTimeout(400);
};
for (const [label, viewport, scale] of [
  ['phone', { width: 393, height: 852 }, 2],
  ['desktop', { width: 1280, height: 800 }, 1],
]) {
  await shoot(`picker-${label}`, viewport, scale, async (page) => {
    await page.goto(base + `/lessons/${draftPlanId}`);
    await page.waitForTimeout(2500);
    await page
      .getByRole('button', { name: /Pumili|Choose/ })
      .first()
      .click();
    await page.waitForTimeout(800);
  });
  await shoot(`flow-${label}`, viewport, scale, async (page) => {
    await page.goto(base + `/lessons/${draftPlanId}`);
    await page.waitForTimeout(2500);
    await scrollTo(/Daloy ng Klase|Session Flow/)(page);
  });
  await shoot(`block-controls-${label}`, viewport, scale, async (page) => {
    await page.goto(base + `/lessons/${draftPlanId}`);
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('strong')].find((x) =>
        /Bloke ng oras 2|Time block 2/.test(x.textContent || '')
      );
      el?.scrollIntoView();
      window.scrollBy(0, -90);
    });
    await page.waitForTimeout(400);
  });
  await shoot(`locked-${label}`, viewport, scale, async (page) => {
    await page.goto(base + `/lessons/${lockedPlanId}`);
    await page.waitForTimeout(2500);
  });
  await shoot(`locked-afterclass-${label}`, viewport, scale, async (page) => {
    await page.goto(base + `/lessons/${lockedPlanId}`);
    await page.waitForTimeout(2500);
    await scrollTo(/Pagninilay|Reflection|Pagkatapos ng klase|After class/)(page);
  });
}
await browser.close();
