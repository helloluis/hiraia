// Session Flow timeline evidence: (a) under budget, (b) over after adding a block, (c) pinned mid-scroll,
// (d) gone in the next section — at 393 px @2× and desktop, plus a short webm recording of the phone run.
// Usage: node scripts/flow-evidence.mjs <baseUrl> <email> <password> <flowPlanId> <outDir>
import fs from 'node:fs';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const [base, email, password, flowPlanId, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
async function run(label, viewport, scale, record) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: scale,
    recordVideo: record ? { dir: outDir, size: viewport } : undefined,
  });
  const page = await ctx.newPage();
  const shot = (n) =>
    page.screenshot({ path: path.join(outDir, `${n}-${label}.png`), fullPage: false });
  const info = async () =>
    (
      await page
        .locator('p.font-medium')
        .filter({ hasText: /minuto|minutes/ })
        .first()
        .innerText()
    ).trim();
  await page.goto(base + '/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /Mag-log in|Log in/ }).click();
  await page.waitForURL('**/week', { timeout: 20000 });
  await page.goto(base + `/lessons/${flowPlanId}`);
  await page.waitForTimeout(2500);
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  const toFlow = async (offset) => {
    await page.evaluate((o) => {
      const h = [...document.querySelectorAll('h2')].find((x) =>
        /Daloy ng Klase|Session Flow/.test(x.textContent || '')
      );
      h?.scrollIntoView();
      window.scrollBy(0, o);
    }, offset);
    await page.waitForTimeout(600);
  };
  await toFlow(-70);
  console.log(label, '(a)', await info());
  await shot('flow-1-under');
  // add a third block of 20 minutes with a name and one Grade activity → 55 of 50
  await page.getByRole('button', { name: /Magdagdag ng bloke|Add block/ }).click();
  await page.waitForTimeout(400);
  await page
    .getByLabel(/Pangalan ng bloke|Block name/)
    .last()
    .fill('Wrap-up');
  const minutes = page.getByLabel(/^Minuto$|^Minutes$/).last();
  await minutes.fill('20');
  const lastBlockFirstBox = page.getByRole('textbox', { name: /Wrap-up/ }).first();
  await lastBlockFirstBox.click();
  await page.keyboard.type('Ibahagi ang resulta ng bawat grupo.');
  await page.waitForTimeout(1200);
  await toFlow(-70);
  console.log(label, '(b)', await info());
  await shot('flow-2-over');
  // scroll part-way through the blocks: the bar should be pinned under the header
  await toFlow(viewport.width < 600 ? 700 : 500);
  const pinned = await page.evaluate(() => {
    const bar = document.querySelector('.sticky.z-10');
    if (!bar) return null;
    const r = bar.getBoundingClientRect();
    const header = getComputedStyle(document.documentElement).getPropertyValue('--header-h');
    return { top: Math.round(r.top), headerVar: header.trim() };
  });
  console.log(label, '(c) pinned at', JSON.stringify(pinned));
  await shot('flow-3-pinned');
  // scroll into the next section: the bar is gone
  await page.evaluate(() => {
    const h = [...document.querySelectorAll('h2')].find((x) =>
      /Pagtataya ng Bawat Baitang|Assessment per Grade/.test(x.textContent || '')
    );
    h?.scrollIntoView();
    window.scrollBy(0, 24);
  });
  await page.waitForTimeout(600);
  const gone = await page.evaluate(() => {
    const bar = document.querySelector('.sticky.z-10');
    if (!bar) return 'no bar';
    const r = bar.getBoundingClientRect();
    return r.bottom <= 0 ? 'scrolled away' : `still visible (bottom ${Math.round(r.bottom)})`;
  });
  console.log(label, '(d)', gone);
  await shot('flow-4-next-section');
  // Remove the block we added (through the confirmation dialog), so the next run starts from the seeded 35 minutes.
  await toFlow(-70);
  await page.getByRole('button', { name: /Alisin ang block 3|Remove block 3/ }).click();
  await page.waitForTimeout(500);
  await shot('flow-5-remove-confirm');
  const dlg = page.locator('dialog[open]');
  console.log(label, '(e) confirm:', (await dlg.innerText()).replace(/\n+/g, ' | ').slice(0, 160));
  await dlg.getByRole('button', { name: /Alisin|Remove/ }).click();
  // Give the debounced save and the sync push time to reach the server before this context closes.
  await page.waitForTimeout(4000);
  console.log(label, '(f) after remove', await info());
  await ctx.close();
  if (record) {
    const v = await page.video()?.path();
    if (v) fs.renameSync(v, path.join(outDir, `flow-sequence-${label}.webm`));
  }
}
await run('phone', { width: 393, height: 852 }, 2, true);
await run('desktop', { width: 1280, height: 800 }, 1, false);
await browser.close();
