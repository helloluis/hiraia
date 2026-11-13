# journey.mjs (reference copy)

```js
// Full-stack journey against the production build (next start). Usage: node journey.mjs <baseUrl> <dbPath> <outDir> <mode: fallback|live>
import { chromium } from '/home/b11/code/hiraia/node_modules/.pnpm/playwright@1.58.2/node_modules/playwright/index.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const Database = require('/home/b11/code/tala-wt/d/packages/tala-web/node_modules/better-sqlite3');
const [base, dbPath, outDir, mode = 'fallback'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const results = [];
const step = async (name, fn) => { try { const info = await fn(); results.push({ name, ok: true, info }); console.log('PASS', name, info ?? ''); } catch (e) { results.push({ name, ok: false, info: String(e.message || e).slice(0, 300) }); console.log('FAIL', name, String(e.message || e).slice(0, 300)); } };
const browser = await chromium.launch();
const errors = [];
const newPage = async () => { const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } }); const page = await ctx.newPage(); page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); }); page.on('pageerror', e => errors.push('PAGEERROR ' + e.message)); return page; };
const shot = (page, n) => page.screenshot({ path: `${outDir}/${n}.png`, fullPage: true });
const dialog = page => page.locator('dialog[open]');
const text = async page => (await page.locator('main').innerText()).replace(/\n+/g, ' | ');
const db = () => new Database(dbPath, { readonly: true });
const verifyToken = email => JSON.parse(db().prepare("select vars from core_mail_outbox where to_email=? and template='verify_email' order by rowid desc limit 1").get(email).vars).link.split('#token=')[1];
const register = async (page, email, name) => {
  await page.goto(base + '/register'); await page.getByLabel('Pangalan mo').fill(name); await page.getByLabel('Email').fill(email); await page.getByLabel('Password').fill('mahabang-password-123');
  await page.getByRole('button', { name: 'Gumawa ng account' }).click(); await page.waitForURL('**/verify-email', { timeout: 20000 }); await page.waitForTimeout(600);
  await page.goto(base + '/week'); await page.waitForTimeout(500); await page.goto(base + '/verify-email#token=' + verifyToken(email)); await page.waitForTimeout(2500);
  const t = await text(page); if (!t.includes('Na-verify na')) throw new Error('not verified: ' + t.slice(0, 120));
};

const page = await newPage();
const email1 = `journey1-${Date.now()}@example.com`;
await step('01 register + verify email via local outbox', async () => { await register(page, email1, 'Gng. Reyes'); await shot(page, '01-verified'); });
await step('02 one-tap sample class', async () => {
  await page.goto(base + '/setup'); await page.waitForTimeout(800); await shot(page, '02-setup');
  await page.getByRole('button', { name: 'Subukan ang halimbawang klase' }).click(); await page.waitForURL('**/week', { timeout: 40000 }); await page.waitForTimeout(3000);
});
await step('03 This Week shows paced Grade 2 + Grade 4 multigrade timeline', async () => {
  const t = await text(page); await shot(page, '03-this-week');
  if (!t.includes('Multigrade na sesyon')) throw new Error('no multigrade session: ' + t.slice(0, 300));
  if (!/Grade 2/.test(t) || !/Grade 4/.test(t)) throw new Error('grades missing: ' + t.slice(0, 300));
  if (!/Nasa tamang bilis|nahuhuli|nauuna/.test(t)) throw new Error('no pacing badge');
  return t.match(/Grade 2: [^|]{0,60}/)?.[0];
});
let planUrl = null;
await step('04 open a "no plan yet" slot → generate (' + mode + ')', async () => {
  const card = page.locator('main div.px-3.py-3').filter({ has: page.getByRole('link', { name: 'Sumulat ng plano' }) }).first();
  if (!(await card.count())) { await page.getByRole('button', { name: /Susunod na linggo/ }).click(); await page.waitForTimeout(1500); }
  const link = page.locator('main div.px-3.py-3').filter({ has: page.getByRole('link', { name: 'Sumulat ng plano' }) }).first().getByRole('link', { name: 'Sumulat ng plano' });
  await link.click(); await page.waitForURL('**/lessons/new**'); await page.waitForTimeout(3500); await shot(page, '04a-new-lesson');
  await page.getByRole('button', { name: 'Ipaburador sa AI' }).click(); await page.waitForURL('**/generate?planId=**', { timeout: 20000 }); await page.waitForTimeout(2500); await shot(page, '04b-generate-form');
  const start = page.getByRole('button', { name: 'Gawin ang burador' });
  if (!(await start.isEnabled())) throw new Error('start disabled: ' + (await text(page)).slice(-300));
  await start.click(); await page.waitForTimeout(1500); await shot(page, '04c-generate-working');
  const deadline = Date.now() + (mode === 'live' ? 150000 : 20000);
  while (Date.now() < deadline) { if (/\/lessons\/[^/]+\?drafted=1/.test(page.url()) || (await page.getByRole('button', { name: 'Buksan ang template na may paunang laman' }).count())) break; await page.waitForTimeout(1000); }
  await shot(page, '04d-generate-result');
  const t = await text(page);
  if (mode === 'fallback') {
    const pre = page.getByRole('button', { name: 'Buksan ang template na may paunang laman' });
    if (!(await pre.count())) throw new Error('fallback not offered: ' + t.slice(-300));
    const failureLine = t.match(/⚠ \| ([^|]+)/)?.[1]?.trim();
    await pre.first().click(); await page.waitForURL(/\/lessons\/[^/]+(\?.*)?$/, { timeout: 20000 }); await page.waitForTimeout(2000);
    planUrl = page.url().split('?')[0]; await shot(page, '04e-prefilled-editor');
    return 'fallback shown: ' + failureLine;
  }
  if (!/drafted=1/.test(page.url())) throw new Error('live draft did not arrive: ' + t.slice(-400));
  planUrl = page.url().split('?')[0]; await page.waitForTimeout(2000); await shot(page, '04e-ai-draft-editor');
  const et = await text(page); if (!et.includes('Burador ng AI')) throw new Error('AI draft mark missing');
  return 'AI draft applied';
});
await step('05 edit a section (rewrite objectives per group)', async () => {
  const boxes = page.locator('[role=textbox][contenteditable=true]'); const n = await boxes.count(); if (!n) throw new Error('no editable boxes');
  // Edit the first box (the teacher's change) and give every still-empty box one line so DOC-1 can pass later.
  await boxes.first().click(); await page.keyboard.press('End'); await page.keyboard.type(' Idinagdag ng guro.');
  for (let i = 1; i < n; i++) { const b = boxes.nth(i); if ((await b.innerText()).trim() === '') { await b.click(); await page.keyboard.type('Gawain ng pangkat.'); } }
  for (const label of [/^Mga Kagamitan 1$/]) { const inp = page.getByLabel(label); if (await inp.count() && !(await inp.inputValue())) await inp.fill('chalkboard'); }
  await page.waitForTimeout(1500); await shot(page, '05-edited');
  return `${n} editable boxes`;
});
await step('06 lock (DOC-1)', async () => {
  // fill anything still required: multigrade needs a block with activity for every group
  const addBlock = page.getByRole('button', { name: '+ Magdagdag ng bloke ng oras' });
  if (await addBlock.count()) {
    const flow = page.locator('section', { has: addBlock });
    if (!(await flow.locator('[role=textbox][contenteditable=true]').count())) { await addBlock.click(); await page.waitForTimeout(300); }
    const blockBoxes = flow.locator('[role=textbox][contenteditable=true]'); const m = await blockBoxes.count();
    for (let i = 0; i < m; i++) { const b = blockBoxes.nth(i); if ((await b.innerText()).trim() === '') { await b.click(); await page.keyboard.type('Gawain ng pangkat.'); } }
    await page.waitForTimeout(1200);
  }
  await page.getByRole('button', { name: 'I-lock', exact: true }).click(); await page.waitForTimeout(600);
  const sheet = (await dialog(page).innerText()).replace(/\n+/g, ' | '); await shot(page, '06a-lock-sheet');
  const lockBtn = dialog(page).getByRole('button', { name: 'I-lock', exact: true });
  if (!(await lockBtn.isEnabled())) throw new Error('lock blocked: ' + sheet.slice(0, 300));
  await lockBtn.click(); await page.waitForTimeout(2000); await shot(page, '06b-locked');
  const t = await text(page); if (!t.includes('Na-lock noong')) throw new Error('not locked: ' + t.slice(0, 200));
});
await step('07 PDF sheet (browser print, plain page, copy text, server PDF)', async () => {
  await page.getByRole('button', { name: 'Iba pang aksyon' }).click(); await page.waitForTimeout(300);
  await dialog(page).getByRole('button', { name: 'I-download ang PDF' }).click(); await page.waitForTimeout(500); await shot(page, '07a-pdf-sheet');
  await dialog(page).getByRole('button', { name: 'Kopyahin bilang teksto' }).click(); await page.waitForTimeout(500);
  const s = (await dialog(page).innerText()).replace(/\n+/g, ' | '); if (!s.includes('Nakopya')) throw new Error('copy failed: ' + s.slice(0, 200));
  const serverBtn = dialog(page).getByRole('button', { name: /Kumuha ng PDF mula sa server/ });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), serverBtn.click()]);
  await page.waitForTimeout(1500); await shot(page, '07b-pdf-after-server');
  await page.keyboard.press('Escape');
  return dl ? 'server PDF downloaded: ' + (await dl.suggestedFilename()) : 'server PDF: ' + (await dialog(page).innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 200);
});
await step('08 post to Community (sample class must refuse; real class posts)', async () => {
  await page.getByRole('button', { name: 'Iba pang aksyon' }).click(); await page.waitForTimeout(300);
  const post = dialog(page).getByRole('button', { name: 'I-post sa komunidad' });
  const count = await post.count(); await page.keyboard.press('Escape');
  if (count) throw new Error('sample class offered Post (should not)');
  return 'sample class correctly cannot post; posting is exercised in step 09 with a real class';
});
let postedTitle = null;
await step('09 real class: setup wizard → lesson → lock → post', async () => {
  await page.goto(base + '/setup'); await page.waitForTimeout(800); await page.getByRole('button', { name: 'Susunod' }).click(); await page.waitForTimeout(400);
  await page.getByLabel('Pangalan ng klase').fill('Grade 4 Mabini'); await page.getByLabel('Baitang').first().selectOption('4');
  await page.getByRole('button', { name: 'Susunod' }).click(); await page.waitForTimeout(400);
  await page.getByLabel('Magdagdag ng asignatura').selectOption({ label: 'Agham' }); await page.getByRole('button', { name: '+ Idagdag' }).click(); await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Susunod' }).click(); await page.waitForTimeout(3500); await shot(page, '09a-setup-start-positions');
  await page.getByRole('button', { name: 'Ipakita ang linggo ko' }).click(); await page.waitForURL('**/week', { timeout: 20000 }); await page.waitForTimeout(2500);
  await page.goto(base + '/lessons/new'); await page.waitForTimeout(3000);
  await page.getByLabel('Klase').selectOption({ label: 'Grade 4 Mabini' }); await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Ako ang susulat' }).click(); await page.waitForURL(/\/lessons\/[^/]+$/, { timeout: 20000 }); await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'Pumili ng kompetensi' }).click(); await page.waitForTimeout(800);
  const cb = dialog(page).getByRole('checkbox'); await cb.nth(1).check(); await dialog(page).getByRole('button', { name: 'I-save' }).click(); await page.waitForTimeout(800);
  const title = `Journey ${Date.now()}`; await page.getByPlaceholder('Pamagat ng aralin').fill(title); postedTitle = title;
  const add = page.getByRole('button', { name: '+ Magdagdag ng aytem' }); await add.nth(0).click(); await page.getByLabel(/^Mga Layunin 1$/).fill('Nailalarawan ang bilis ng galaw.'); await add.nth(1).click(); await page.getByLabel(/^Mga Kagamitan 1$/).fill('chalkboard');
  await page.getByRole('button', { name: '+ Magdagdag ng hakbang' }).click(); await page.getByLabel('Ano ang gagawin').first().fill('Panimula'); const pb = page.getByRole('textbox', { name: /^Pamamaraan 1$/ }).first(); await pb.click(); await page.keyboard.type('Balik-aral.');
  const as = page.getByRole('textbox', { name: 'Pagtataya' }).first(); await as.click(); await page.keyboard.type('Maikling pagsusulit.');
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'I-lock', exact: true }).click(); await page.waitForTimeout(500); await dialog(page).getByRole('button', { name: 'I-lock', exact: true }).click(); await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Iba pang aksyon' }).click(); await page.waitForTimeout(300); await dialog(page).getByRole('button', { name: 'I-post sa komunidad' }).click(); await page.waitForTimeout(1200); await shot(page, '09b-post-sheet');
  await dialog(page).getByLabel(/Gawa ko ito/).check(); await dialog(page).getByLabel(/CC BY-NC/).check(); await dialog(page).getByRole('button', { name: 'I-post sa komunidad' }).click(); await page.waitForTimeout(5000); await shot(page, '09c-posted');
  const body = (await page.locator('body').innerText()).replace(/\n+/g, ' | '); const m = body.match(/Nai-post[^|]*/)?.[0];
  if (!m) throw new Error('no posted toast: ' + body.slice(0, 300));
  return m;
});
await step('10 second account finds, copies and modifies it', async () => {
  const page2 = await newPage(); const email2 = `journey2-${Date.now()}@example.com`;
  await register(page2, email2, 'G. Santos');
  await page2.goto(base + '/setup'); await page2.waitForTimeout(800); await page2.getByRole('button', { name: 'Subukan ang halimbawang klase' }).click(); await page2.waitForURL('**/week', { timeout: 40000 }); await page2.waitForTimeout(2000);
  await page2.goto(base + '/community'); await page2.waitForTimeout(2500); await shot(page2, '10a-community-browse');
  const t = await text(page2);
  let found = t.includes(postedTitle ?? '∅');
  if (!found) { await page2.getByLabel('Maghanap ng aralin').fill('Journey'); await page2.waitForTimeout(2500); found = (await text(page2)).includes(postedTitle ?? '∅'); }
  if (!found) throw new Error('post not visible to second account (status may be pending check): ' + (await text(page2)).slice(0, 300));
  await page2.locator('main a[href^="/community/"]').filter({ hasText: postedTitle }).first().click(); await page2.waitForTimeout(2500); await shot(page2, '10b-artifact');
  await page2.getByRole('button', { name: 'Kopyahin sa mga aralin ko' }).first().click(); await page2.waitForTimeout(500); await dialog(page2).getByRole('button', { name: 'Kopyahin sa mga aralin ko' }).click();
  await page2.waitForURL(/\/lessons\/[^/]+$/, { timeout: 20000 }); await page2.waitForTimeout(2000);
  const box = page2.locator('[role=textbox][contenteditable=true]').first(); await box.click(); await page2.keyboard.type(' Binago ni G. Santos.'); await page2.waitForTimeout(1500); await shot(page2, '10c-copied-modified');
  const et = await text(page2); if (!/Naka-save/.test(et)) throw new Error('copy not saved');
  await page2.context().close();
});
await step('11 roster import of a pasted list with review', async () => {
  await page.goto(base + '/class/roster/import'); await page.waitForTimeout(1500);
  const sel = page.getByLabel('Klase'); if (await sel.count()) await sel.selectOption({ label: 'Grade 4 Mabini' });
  await page.getByLabel('I-paste ang mga pangalan dito').fill(['Pangalan', 'DELA CRUZ, Juan Miguel S.', 'Reyes, Maria Clara', 'SANTOS, Jose Jr.', 'Mr. Bautista, Pedro (transferee)', 'TOTAL: 4'].join('\n'));
  await shot(page, '11a-import-flag');
  const noAi = page.getByRole('button', { name: 'Linisin nang walang AI' }); const next = page.getByRole('button', { name: 'Susunod' });
  await ((await noAi.count()) ? noAi : next).click(); await page.waitForTimeout(3500); await shot(page, '11b-review');
  const review = await text(page); const counts = review.match(/\d+ linya ang nabasa[^|]*/)?.[0];
  for (let i = 0; i < 10; i++) { const b = page.getByRole('button', { name: 'Tanggapin', exact: true }); if (!(await b.count())) break; await b.first().click(); await page.waitForTimeout(150); }
  const viewed = page.getByLabel('Natingnan ko na ang mga binagong hanay'); if (await viewed.count()) { await viewed.check(); await page.getByLabel('Tanggapin lahat ng binagong hanay').check(); }
  await page.getByRole('button', { name: /^I-save ang \d+ mag-aaral/ }).click(); await page.waitForTimeout(3000); await shot(page, '11c-saved');
  const t = await text(page); if (!/mag-aaral ang na-save/.test(t)) throw new Error('not saved: ' + t.slice(0, 200));
  return counts + ' → ' + t.match(/\d+ mag-aaral ang na-save/)?.[0];
});
await step('12 mark a no-class day and apply the realignment', async () => {
  await page.goto(base + '/week'); await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Markahan ang araw na walang klase' }).click(); await page.waitForTimeout(400);
  const dates = page.locator('main').locator('h2').allInnerTexts();
  await dialog(page).getByRole('button', { name: 'I-save' }).click(); await page.waitForTimeout(2500); await shot(page, '12a-realign-sheet');
  const sheet = (await dialog(page).innerText()).replace(/\n+/g, ' | ');
  const apply = dialog(page).getByRole('button', { name: 'Ilapat' });
  if (!(await apply.isEnabled())) throw new Error('apply disabled: ' + sheet.slice(0, 300));
  await apply.click(); await page.waitForTimeout(2500); await shot(page, '12b-realigned');
  const body = (await page.locator('body').innerText()).replace(/\n+/g, ' | ');
  if (!/Nailipat|Tapos/.test(body)) throw new Error('no applied toast: ' + body.slice(0, 200));
  void dates; return sheet.match(/\d+ paksa[^|]*/g)?.join('; ');
});
await step('13 sign out', async () => {
  await page.goto(base + '/settings'); await page.waitForTimeout(1500); await shot(page, '13a-settings');
  await page.getByRole('button', { name: 'Mag-sign out' }).click(); await page.waitForTimeout(400); await dialog(page).getByRole('button', { name: 'Mag-sign out' }).click();
  await page.waitForURL('**/sign-in', { timeout: 20000 }); await page.waitForTimeout(1000); await shot(page, '13b-signed-out');
});
console.log('CONSOLE ERRORS:', errors.length ? errors.join('\n') : 'none');
fs.writeFileSync(`${outDir}/results-${mode}.json`, JSON.stringify({ mode, at: new Date().toISOString(), results, consoleErrors: errors }, null, 2));
await browser.close();
process.exit(results.every(r => r.ok) ? 0 : 1);
```
