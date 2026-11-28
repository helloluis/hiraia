// Shell/security integration checks. These are deliberately reported separately
// from live Tala feature parity: the page below is a local synthetic fixture.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tala-shell-test-'));
const origin = 'https://tala.hiraia.org';
let app;
const results = [];
async function launch() {
  app = await electron.launch({ chromiumSandbox: true,
    ...(process.env.TALA_DESKTOP_EXECUTABLE ? { executablePath: process.env.TALA_DESKTOP_EXECUTABLE, args: ['--user-data-dir=' + profile] } : { args: [root] }), env: { ...process.env,
    TALA_DESKTOP_TEST: '1', TALA_DESKTOP_TEST_ORIGIN: origin, TALA_DESKTOP_TEST_PROFILE: profile } });
  const page = await app.firstWindow();
  await app.context().route(origin + '/**', route => route.fulfill({ contentType: 'text/html', body:
    '<!doctype html><html lang="en"><title>Synthetic Tala shell fixture</title><body><h1>Tala fixture</h1><input aria-label="Lesson"><a href="/lessons/fixture" target="_blank">Presentation window</a></body></html>' }));
  await page.goto(origin + '/week');
  return page;
}
async function check(name, fn) { await fn(); results.push({ name, status: 'passed' }); console.log('PASS', name); }
(async () => {
  let page = await launch();
  await check('sandbox and renderer isolation', async () => {
    const prefs = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
    for (const key of ['contextIsolation', 'sandbox', 'webSecurity']) assert.equal(prefs[key], true, key);
    for (const key of ['nodeIntegration', 'nodeIntegrationInWorker', 'nodeIntegrationInSubFrames', 'webviewTag']) assert.equal(prefs[key], false, key);
    assert.deepEqual(await page.evaluate(() => [typeof require, typeof process, typeof window.electron]), ['undefined', 'undefined', 'undefined']);
  });
  await check('hostile navigation and popup blocked', async () => {
    for (const url of ['file:///etc/passwd', 'data:text/html,evil']) {
      await page.evaluate(url => { location.href = url; }, url);
      await page.waitForTimeout(100);
      assert.equal(page.url(), origin + '/week');
      await page.evaluate(url => { window.open(url); }, url);
    }
    assert.equal(app.windows().length, 1);
  });
  await check('same-origin child inherits protections', async () => {
    const childPromise = app.waitForEvent('window');
    await page.getByRole('link', { name: 'Presentation window' }).click();
    const child = await childPromise;
    await child.waitForLoadState();
    assert.equal(child.url(), origin + '/lessons/fixture');
    assert.equal(await child.evaluate(() => typeof require), 'undefined');
    await child.close();
  });
  await check('external HTTPS requires confirmation; non-web schemes denied', async () => {
    await app.evaluate(({ dialog, shell }) => {
      global.__external = []; global.__prompts = [];
      dialog.showMessageBox = async (_owner, options) => { global.__prompts.push(options); return { response: 0 }; };
      shell.openExternal = async url => { global.__external.push(url); };
    });
    await page.evaluate(() => { window.open('https://www.deped.gov.ph/'); window.open('ms-settings:'); });
    await page.waitForTimeout(100);
    assert.equal(await app.evaluate(() => global.__prompts.length), 1);
    assert.equal(await app.evaluate(() => global.__external.length), 0);
  });
  await check('camera, location and notifications denied', async () => {
    assert.equal(await page.evaluate(() => Notification.requestPermission()), 'denied');
    assert.equal(await page.evaluate(() => new Promise(resolve => navigator.geolocation.getCurrentPosition(() => resolve('allowed'), () => resolve('denied')))), 'denied');
  });
  await check('print iframe and keyboard input', async () => {
    await page.getByRole('textbox', { name: 'Lesson' }).fill('Synthetic lesson');
    assert.equal(await page.getByRole('textbox', { name: 'Lesson' }).inputValue(), 'Synthetic lesson');
    assert.equal(await page.evaluate(() => { const frame = document.createElement('iframe'); document.body.appendChild(frame); frame.contentDocument.write('<h1>Printable lesson</h1>'); return frame.contentDocument.body.textContent; }), 'Printable lesson');
  });
  await check('persistent secure session across relaunch', async () => {
    await app.context().addCookies([{ name: '__Host-tala_shell_test', value: 'synthetic', url: origin, secure: true, httpOnly: true, sameSite: 'Lax', expires: Math.floor(Date.now()/1000) + 600 }]);
    await app.evaluate(async ({ session }) => { await session.fromPartition('persist:tala').cookies.flushStore(); });
    await app.close(); page = await launch();
    assert.ok((await app.context().cookies(origin)).some(c => c.name === '__Host-tala_shell_test' && c.value === 'synthetic'));
  });
  await check('network loss displays recovery and retry restores page', async () => {
    await app.context().unroute(origin + '/**');
    await app.context().route(origin + '/**', route => route.abort('internetdisconnected'));
    await page.goto(origin + '/week').catch(() => {});
    await page.getByRole('heading', { name: 'Tala needs an internet connection' }).waitFor();
    await app.context().unroute(origin + '/**');
    await app.context().route(origin + '/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Recovered</h1>' }));
    await page.getByRole('link', { name: 'Try again' }).click();
    await page.getByRole('heading', { name: 'Recovered' }).waitFor();
  });
  fs.mkdirSync(path.join(root, 'test-output'), { recursive: true });
  fs.writeFileSync(path.join(root, 'test-output', `shell-${process.platform}-${process.arch}.json`), JSON.stringify({ scope: 'synthetic shell integration, not live feature parity', packaged: !!process.env.TALA_DESKTOP_EXECUTABLE, platform: process.platform, arch: process.arch, results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await app?.close();
  fs.rmSync(profile, { recursive: true, force: true });
});
