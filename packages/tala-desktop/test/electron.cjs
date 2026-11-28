// No Playwright network interception. A real local HTTPS fixture owns responses;
// DNS is fail-closed from process launch, including the initial window load.
const { _electron: electron } = require('playwright');
const { httpsFixture } = require('./https-fixture.cjs');
const { bounded, captureMacDesktop, closeElectron, linuxHeadlessArgs } = require('./harness.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tala-shell-test-'));
const origin = 'https://tala.hiraia.org';
const nonce = crypto.randomUUID();
let app, fixture, offline = false;
let negativeStatus, dnsFailure, tcpAttempts = 0, nonLoopbackConnections;
const results = [], netlogs = [];
const output = path.join(root, 'test-output');
let currentCheck = 'starting local HTTPS fixture', currentStep;
const windowSteps = [];
function progress(error) {
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, `progress-shell-${process.platform}-${process.arch}.json`), JSON.stringify({
    currentCheck, currentStep, windowSteps, results, ...(error ? { error: error.name + ': ' + error.message.split('\n')[0] } : {}),
  }, null, 2));
}
function serve(req, res) {
  if (offline) return req.socket.destroy();
  if (req.url === '/fixture-health') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ environment: 'local', nonce })); }
  if (req.url === '/set-session') { res.setHeader('Set-Cookie', '__Host-tala_shell_test=synthetic; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600'); return res.end('set'); }
  if (req.url === '/check-session') return res.end((req.headers.cookie || '').includes('__Host-tala_shell_test=synthetic') ? 'present' : 'absent');
  if (req.url.startsWith('/api/')) { res.writeHead(403); return res.end('No production API in this fixture'); }
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><html lang="en"><title>LOCAL Tala shell fixture</title><body><h1>Local fixture</h1><input aria-label="Lesson"><a href="/lessons/fixture" target="_blank">Presentation window</a><button onclick="document.documentElement.requestFullscreen()">Present</button></body></html>');
}
async function launch() {
  const log = path.join(profile, `net-${netlogs.length}.json`); netlogs.push(log);
  const args = [...linuxHeadlessArgs(), ...fixture.args, '--log-net-log=' + log, '--user-data-dir=' + profile];
  app = await electron.launch({ chromiumSandbox: true,
    ...(process.env.TALA_DESKTOP_EXECUTABLE ? { executablePath: process.env.TALA_DESKTOP_EXECUTABLE, args } : { args: [...args, root] }),
    env: { ...process.env, TALA_DESKTOP_TEST: '1', TALA_DESKTOP_TEST_ORIGIN: origin, TALA_DESKTOP_TEST_PROFILE: profile } });
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.getByRole('heading', { name: 'Local fixture' }).waitFor();
  const health = await page.evaluate(() => fetch('/fixture-health').then(r => r.json()));
  assert.deepEqual(health, { environment: 'local', nonce });
  assert.ok(fixture.requests.some(r => r.path === '/fixture-health'));
  return page;
}
async function check(name, fn) {
  currentCheck = name; currentStep = undefined; progress();
  await bounded(fn(), 45000, name);
  results.push({ name, status: 'passed' }); progress(); console.log('PASS', name);
}
async function windowStep(name, fn) {
  currentStep = name; progress(); console.log('STEP', name);
  await bounded(fn(), 15000, name);
  const state = await bounded(app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return { events: global.__windowEvents || [], fullScreen: win.isFullScreen(), size: win.getSize() };
  }), 2000, name + ' diagnostics');
  windowSteps.push({ name, status: 'passed', ...state }); progress();
}
async function waitWindowEvent(name) {
  // Poll the recorded event, not a raw unbounded event Promise in app.evaluate.
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await bounded(app.evaluate((_electron, event) => global.__windowEvents.some(e => e.name === event), name), 2000, name + ' observation')) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out: ' + name);
}
(async () => {
  fixture = await httpsFixture(serve);
  let page = await launch();
  await check('local HTTPS isolation and production API negative control', async () => {
    negativeStatus = await page.evaluate(() => fetch('/api/v1/auth/register', { method: 'POST' }).then(r => r.status));
    assert.equal(negativeStatus, 403);
    assert.ok(fixture.requests.some(r => r.path === '/api/v1/auth/register' && r.method === 'POST'));
    dnsFailure = await app.evaluate(async ({ session }) => {
      try { await session.fromPartition('persist:tala').resolveHost('hiraia.org'); return null; }
      catch (error) { return { name: error.name, message: error.message }; }
    });
    assert.ok(dnsFailure);
    assert.match(dnsFailure.message, /ERR_NAME_NOT_RESOLVED/);
  });
  await check('sandbox and renderer isolation', async () => {
    const prefs = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
    for (const key of ['contextIsolation', 'sandbox', 'webSecurity']) assert.equal(prefs[key], true, key);
    for (const key of ['nodeIntegration', 'nodeIntegrationInWorker', 'nodeIntegrationInSubFrames', 'webviewTag']) assert.equal(prefs[key], false, key);
    assert.deepEqual(await page.evaluate(() => [typeof require, typeof process, typeof window.electron]), ['undefined', 'undefined', 'undefined']);
  });
  await check('hostile navigation and popup blocked', async () => {
    for (const url of ['file:///etc/passwd', 'data:text/html,evil']) {
      await page.evaluate(url => { location.href = url; }, url);
      await page.waitForTimeout(100); assert.equal(page.url(), origin + '/week');
      await page.evaluate(url => { window.open(url); }, url);
    }
    assert.equal(app.windows().length, 1);
  });
  await check('same-origin child inherits protections', async () => {
    const childPromise = app.waitForEvent('window');
    await page.getByRole('link', { name: 'Presentation window' }).click();
    const child = await childPromise; await child.waitForLoadState();
    assert.equal(child.url(), origin + '/lessons/fixture');
    assert.equal(await child.evaluate(() => typeof require), 'undefined');
    assert.ok(fixture.requests.some(r => r.path === '/lessons/fixture'));
    await child.close();
  });
  await check('external HTTPS confirmation and other schemes denied', async () => {
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
  await check('location and notifications denied', async () => {
    assert.equal(await page.evaluate(() => Notification.requestPermission()), 'denied');
    assert.equal(await page.evaluate(() => new Promise(resolve => navigator.geolocation.getCurrentPosition(() => resolve('allowed'), () => resolve('denied')))), 'denied');
  });
  await check('print iframe, keyboard, fullscreen and resize', async () => {
    await windowStep('keyboard input and print iframe content (no native print dialog)', async () => {
      await page.getByRole('textbox', { name: 'Lesson' }).fill('Synthetic lesson');
      assert.equal(await page.getByRole('textbox', { name: 'Lesson' }).inputValue(), 'Synthetic lesson');
      assert.equal(await page.evaluate(() => { const frame = document.createElement('iframe'); document.body.appendChild(frame); frame.contentDocument.write('<h1>Printable lesson</h1>'); return frame.contentDocument.body.textContent; }), 'Printable lesson');
    });
    await windowStep('observe native and HTML fullscreen events before entry', async () => {
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        global.__windowEvents = [];
        for (const name of ['enter-full-screen', 'leave-full-screen', 'enter-html-full-screen', 'leave-html-full-screen', 'resize']) {
          win.on(name, () => global.__windowEvents.push({ name, at: Date.now() }));
        }
      });
    });
    await windowStep('enter HTML fullscreen and finish the macOS native transition', async () => {
      await page.getByRole('button', { name: 'Present' }).click();
      await page.waitForFunction(() => !!document.fullscreenElement, null, { polling: 100 });
      // macOS uses a native Space animation. DOM fullscreen alone does not mean
      // that transition has finished; exiting during it can strand Chromium's Promise.
      if (process.platform === 'darwin') await waitWindowEvent('enter-full-screen');
    });
    await windowStep('exit HTML fullscreen and finish the macOS native transition', async () => {
      await page.evaluate(() => document.exitFullscreen());
      await page.waitForFunction(() => !document.fullscreenElement, null, { polling: 100 });
      if (process.platform === 'darwin') await waitWindowEvent('leave-full-screen');
    });
    await windowStep('resize after fullscreen exit and verify resulting bounds', async () => {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 600));
      assert.deepEqual(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize()), [800, 600]);
      assert.equal(await page.evaluate(() => !!document.fullscreenElement), false);
    });
  });
  await check('persistent secure cookie reaches fixture after relaunch', async () => {
    await page.evaluate(() => fetch('/set-session'));
    await app.evaluate(async ({ session }) => session.fromPartition('persist:tala').cookies.flushStore());
    await closeElectron(app); app = null; page = await launch();
    assert.equal(await page.evaluate(() => fetch('/check-session').then(r => r.text())), 'present');
  });
  await check('network loss recovery and retry stays local', async () => {
    offline = true;
    await page.goto(origin + '/week').catch(() => {});
    await page.getByRole('heading', { name: 'Tala needs an internet connection' }).waitFor();
    offline = false;
    await page.getByRole('link', { name: 'Try again' }).click();
    await page.getByRole('heading', { name: 'Local fixture' }).waitFor();
  });
  await closeElectron(app); app = null;
  await check('network log contains no non-loopback TCP connection', async () => {
    const connections = [];
    for (const file of netlogs) {
      const log = JSON.parse(fs.readFileSync(file));
      for (const event of log.events) if (event.type === log.constants.logEventTypes.TCP_CONNECT_ATTEMPT && event.params?.address) connections.push(event.params.address);
    }
    assert.ok(connections.length > 0, 'no TCP evidence');
    tcpAttempts = connections.length;
    nonLoopbackConnections = connections.filter(address => !/^(127\.0\.0\.1:|\[::1\]:)/.test(address)).length;
    assert.equal(nonLoopbackConnections, 0, 'non-loopback connection found');
  });
  fs.mkdirSync(path.join(root, 'test-output'), { recursive: true });
  fs.writeFileSync(path.join(root, 'test-output', `shell-${process.platform}-${process.arch}.json`), JSON.stringify({
    scope: 'local HTTPS synthetic shell integration, not live feature parity', packaged: !!process.env.TALA_DESKTOP_EXECUTABLE,
    displayBackend: linuxHeadlessArgs().length ? 'ozone-headless' : 'system display',
    platform: process.platform, arch: process.arch,
    isolation: { fixtureRequests: fixture.requests.length, allPeersLoopback: fixture.requests.every(r => r.peer === '127.0.0.1'),
      productionApiNegativeControl: '403 from local fixture', otherDns: 'NOTFOUND', negativeStatus, dnsFailure, tcpAttempts, nonLoopbackConnections }, windowSteps, results,
  }, null, 2));
})().catch(error => {
  progress(error); captureMacDesktop(output);
  console.error(error.name + ': ' + error.message.split('\n')[0]); process.exitCode = 1;
}).finally(async () => {
  await closeElectron(app); await fixture?.close(); fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
