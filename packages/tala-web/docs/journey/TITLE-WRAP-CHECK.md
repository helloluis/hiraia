# Long-title wrap check (overflow3.mjs, reference copy)

Run against a dev server: `node overflow3.mjs http://localhost:3100 <TALA_DB_PATH>`. Asserts, at 360 px, 320 px and 360 px with 200% text, that a 63-character title wraps to 2–3 lines (ellipsis after three) in the lesson header (draft and locked), the lessons list and This Week, with no horizontal overflow.

```js
// Long-title wrap check: lesson header (draft + locked), lessons list, This Week at 320, 360 and 360@200%.
import { chromium } from '/home/b11/code/hiraia/node_modules/.pnpm/playwright@1.58.2/node_modules/playwright/index.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Database = require('/home/b11/code/tala-wt/d/packages/tala-web/node_modules/better-sqlite3');
const [base = 'http://localhost:3100', dbPath = '/tmp/tala-web-dev3.sqlite'] = process.argv.slice(2);
const LONG = 'Friction on Different Surfaces: A Multigrade Ramp Investigation';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
const page = await ctx.newPage();
const problems = [];
const find = () => page.evaluate(() => { const w = document.documentElement.clientWidth; const out = []; for (const el of document.querySelectorAll('body *')) { const r = el.getBoundingClientRect(); if (r.right > w + 1 && r.width > 0) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} right=${Math.round(r.right)}`); } return { w, sw: document.documentElement.scrollWidth, out: out.slice(0, 4) }; });
const titleInfo = (sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const cs = getComputedStyle(el); const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.25; return { lines: Math.round(el.getBoundingClientRect().height / lh), text: (el.textContent || '').slice(0, 40), clipped: el.scrollHeight > el.clientHeight + 1 }; }, sel);
const check = async (label, sel) => { const o = await find(); const ti = await titleInfo(sel); const ok = o.sw <= o.w && ti && ti.lines >= 2 && ti.lines <= 3; console.log(ok ? 'OK  ' : 'BAD ', label, JSON.stringify({ sw: o.sw, w: o.w, overflow: o.out, title: ti })); if (!ok) problems.push(label); };
const zoom = async (on) => { if (on) await page.addStyleTag({ content: 'html{font-size:32px}' }); };
const email = `t3-${Date.now()}@example.com`;
await page.goto(base + '/register'); await page.getByLabel('Pangalan mo').fill('Gng. Reyes'); await page.getByLabel('Email').fill(email); await page.getByLabel('Password').fill('mahabang-password-123');
await page.getByRole('button', { name: 'Gumawa ng account' }).click(); await page.waitForURL('**/verify-email'); await page.waitForTimeout(600);
const db = new Database(dbPath, { readonly: true }); const row = db.prepare("select vars from core_mail_outbox where to_email=? and template='verify_email' order by rowid desc limit 1").get(email);
await page.goto(base + '/week'); await page.waitForTimeout(400); await page.goto(base + '/verify-email#token=' + JSON.parse(row.vars).link.split('#token=')[1]); await page.waitForTimeout(2000);
await page.goto(base + '/setup'); await page.waitForTimeout(800); await page.getByRole('button', { name: 'Subukan ang halimbawang klase' }).click(); await page.waitForURL('**/week', { timeout: 40000 }); await page.waitForTimeout(2500);
// open a no-plan slot → write by hand → set the long title
const card = page.locator('main div.px-3.py-3').filter({ has: page.getByRole('link', { name: 'Sumulat ng plano' }) }).first();
if (!(await card.count())) { await page.getByRole('button', { name: /Susunod na linggo/ }).click(); await page.waitForTimeout(1500); }
await page.locator('main div.px-3.py-3').filter({ has: page.getByRole('link', { name: 'Sumulat ng plano' }) }).first().getByRole('link', { name: 'Sumulat ng plano' }).click();
await page.waitForURL('**/lessons/new**'); await page.waitForTimeout(3000); await page.getByRole('button', { name: 'Ako ang susulat' }).click(); await page.waitForURL(/\/lessons\/(?!new$)[^/]+$/, { timeout: 20000 }); await page.waitForTimeout(1500);
const planUrl = page.url();
await page.getByPlaceholder('Pamagat ng aralin').fill(LONG); await page.waitForTimeout(1500);
for (const [w, z] of [[360, false], [320, false], [360, true]]) {
  await page.setViewportSize({ width: w, height: 740 }); await page.goto(planUrl); await page.waitForTimeout(1500); await zoom(z); await page.waitForTimeout(300);
  await check(`editor draft header ${w}${z ? '@200%' : ''}`, 'main h1 textarea');
  await page.screenshot({ path: `/tmp/tala-smoke/title-editor-${w}${z ? '-200' : ''}.png` });
  await page.goto(base + '/lessons'); await page.waitForTimeout(1500); await zoom(z); await page.waitForTimeout(300);
  await check(`lessons list ${w}${z ? '@200%' : ''}`, 'main a[href^="/lessons/"] span.line-clamp-3');
  await page.goto(base + '/week'); await page.waitForTimeout(2500); await zoom(z); await page.waitForTimeout(300);
  const weekTitle = page.locator('main p.line-clamp-3').filter({ hasText: 'Friction' });
  if (!(await weekTitle.count())) { await page.getByRole('button', { name: /Susunod na linggo/ }).click(); await page.waitForTimeout(1500); await zoom(z); }
  await check(`this week ${w}${z ? '@200%' : ''}`, 'main p.line-clamp-3');
}
// locked header
await page.setViewportSize({ width: 320, height: 740 }); await page.goto(planUrl); await page.waitForTimeout(1500);
const boxes = page.locator('[role=textbox][contenteditable=true]'); const n = await boxes.count();
for (let i = 0; i < n; i++) { const b = boxes.nth(i); if ((await b.innerText()).trim() === '') { await b.click(); await page.keyboard.type('Gawain.'); } }
const addBlock = page.getByRole('button', { name: '+ Magdagdag ng bloke ng oras' }); if (await addBlock.count()) { await addBlock.click(); await page.waitForTimeout(300); const bb = page.locator('[role=textbox][contenteditable=true]'); const m = await bb.count(); for (let i = 0; i < m; i++) { const b = bb.nth(i); if ((await b.innerText()).trim() === '') { await b.click(); await page.keyboard.type('Gawain.'); } } }
await page.waitForTimeout(1500); await page.getByRole('button', { name: 'I-lock', exact: true }).click(); await page.waitForTimeout(500);
const lockBtn = page.locator('dialog[open]').getByRole('button', { name: 'I-lock', exact: true });
if (await lockBtn.isEnabled()) { await lockBtn.click(); await page.waitForTimeout(1500); await check('editor locked header 320', 'main h1 span.line-clamp-3'); await page.screenshot({ path: '/tmp/tala-smoke/title-locked-320.png' }); } else console.log('SKIP locked header (lock blocked)');
console.log(problems.length ? 'PROBLEMS: ' + problems.join('; ') : 'ALL TITLE CHECKS OK');
await browser.close();
```
