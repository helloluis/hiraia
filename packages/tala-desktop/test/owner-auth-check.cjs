// Release-owner-only signed-in check, after a release. Never used by preview CI.
// No registration, lesson writes, AI calls, screenshots or credential output.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const base = process.argv[2];
assert.equal(process.env.TALA_DESKTOP_OWNER_READ_ONLY, '1', 'Release owner must opt in explicitly');
assert.equal(base, 'https://tala.hiraia.org', 'This shell is pinned to the approved Tala origin');
assert.ok(process.env.TALA_TEST_EMAIL && process.env.TALA_TEST_PASSWORD, 'Owner credentials must be supplied by environment');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tala-owner-auth-'));
let app, page;
(async () => {
  const args = ['--user-data-dir=' + profile];
  app = await electron.launch({ chromiumSandbox: true,
    ...(process.env.TALA_DESKTOP_EXECUTABLE ? { executablePath: process.env.TALA_DESKTOP_EXECUTABLE, args } : { args: [...args, path.resolve(__dirname, '..')] }) });
  page = await app.firstWindow();
  await page.goto(base + '/sign-in');
  await page.locator('input[type=email]').fill(process.env.TALA_TEST_EMAIL);
  await page.locator('input[type=password]').fill(process.env.TALA_TEST_PASSWORD);
  await page.locator('button[type=submit]').click();
  await page.waitForURL(url => url.origin === base && url.pathname !== '/sign-in');
  assert.equal(await page.evaluate(async () => (await fetch('/api/v1/auth/me')).status), 200);
  for (const route of ['/week', '/lessons', '/class', '/library', '/settings']) {
    await page.goto(base + route);
    assert.equal(new URL(page.url()).pathname, route);
    await page.locator('main').waitFor();
  }
  console.log('PASS owner auth and signed-in page navigation; no lesson mutations tested');
})().catch(error => {
  // Playwright fill call logs can contain credentials. Print only the error type.
  console.error('Owner auth check failed: ' + error.name); process.exitCode = 1;
}).finally(async () => {
  if (page && !page.isClosed()) await page.evaluate(() => fetch('/api/v1/auth/logout', { method: 'POST' })).catch(() => {});
  await app?.close();
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
