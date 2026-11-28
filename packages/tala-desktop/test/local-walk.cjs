// Actual unmodified Tala web/server, temporary database, no production credentials.
// Source apps use a loopback HTTPS origin; packaged apps use the launch-time DNS
// boundary proven in electron.cjs. Both reach exactly one temporary local server.
const { _electron: electron } = require('playwright');
const { httpsFixture } = require('./https-fixture.cjs');
const { bounded, captureMacDesktop, closeElectron } = require('./harness.cjs');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const web = path.resolve(root, '../tala-web');
const webRequire = createRequire(path.join(web, 'package.json'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tala-local-parity-'));
const output = path.join(root, 'test-output', `local-${process.platform}-${process.arch}`);
fs.mkdirSync(output, { recursive: true });
let origin;
const nonce = 'desktop-local-' + crypto.randomBytes(6).toString('hex');
const results = [];
const apiStatuses = [];
let server, app, base, page, fixture;
const netlogs = [];
let healthVerified = false;
let networkEvidence;
let currentCheck = 'local server startup';
async function check(name, fn) {
  currentCheck = name;
  fs.writeFileSync(path.join(output, 'progress.json'), JSON.stringify({ currentCheck, results }));
  await bounded(fn(), 90000, name);
  results.push({ name, status: 'passed' }); console.log('PASS', name);
}
async function launch() {
  const profile = path.join(temp, 'profile');
  const log = path.join(temp, `net-${netlogs.length}.json`); netlogs.push(log);
  const args = [...fixture.args, '--log-net-log=' + log, '--user-data-dir=' + profile];
  app = await electron.launch({ chromiumSandbox: true,
    ...(process.env.TALA_DESKTOP_EXECUTABLE ? { executablePath: process.env.TALA_DESKTOP_EXECUTABLE, args } : { args: [...args, root] }),
    env: { ...process.env, TALA_DESKTOP_TEST: '1', TALA_DESKTOP_TEST_ORIGIN: origin, TALA_DESKTOP_TEST_PROFILE: profile } });
  const ctx = app.context();
  await ctx.addInitScript(() => localStorage.setItem('tala.lang', 'en'));
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.goto(origin + '/sign-in');
  assert.equal(new URL(page.url()).origin, origin);
  const health = await page.evaluate(() => fetch('/api/v1/health').then(r => r.json()));
  assert.equal(health.environment, 'local');
  assert.ok(health.version.endsWith(nonce));
  assert.ok(fixture.requests.some(r => r.path === '/api/v1/health'));
  healthVerified = true;
}
async function startServer() {
  // Next automatically loads these files even if the child environment is clean.
  for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    assert.equal(fs.existsSync(path.join(web, name)), false, 'Local feature test requires a checkout without live Next environment files');
  }
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  base = `http://127.0.0.1:${port}`;
  fixture = await httpsFixture((req, res) => {
    // This proxy has exactly one fixed loopback destination; it cannot proxy an
    // absolute URL or CONNECT request to an external host.
    if (!req.url.startsWith('/') || req.url.startsWith('//')) { res.writeHead(400); return res.end(); }
    const upstream = http.request(base + req.url, { method: req.method, headers: { ...req.headers, host: new URL(base).host } }, remote => {
      if (req.url.startsWith('/api/')) apiStatuses.push({ path: req.url.split('?')[0], status: remote.statusCode });
      res.writeHead(remote.statusCode, remote.headers); remote.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
  });
  origin = process.env.TALA_DESKTOP_EXECUTABLE ? 'https://tala.hiraia.org' : fixture.origin;
  const env = { ...process.env };
  // Use deterministic missing-provider errors, never spend inherited model credits.
  for (const key of Object.keys(env)) if (/API_KEY|TOKEN|SECRET|^TALA_|^AWS_|^CLOUDFLARE_/.test(key)) delete env[key];
  Object.assign(env, { TALA_ENV: 'local', TALA_DB_PATH: path.join(temp, 'tala.sqlite'),
    TALA_PUBLIC_ORIGIN: origin, TALA_BUILD_ID: nonce, TALA_AUTH_AUTO_VERIFY: '1', TALA_LOG_LEVEL: 'error', NEXT_TELEMETRY_DISABLED: '1',
    TALA_PACKS_LIBRARY_DIR: path.join(temp, 'no-library'), TALA_PACKS_ARTIFACTS_DIR: path.join(temp, 'no-artifacts') });
  const log = fs.openSync(path.join(temp, 'server.log'), 'w', 0o600);
  server = spawn(process.execPath, [webRequire.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: web, env, stdio: ['ignore', log, log] });
  fs.closeSync(log);
  for (let n = 0; n < 60; n++) {
    if (server.exitCode !== null) throw new Error('Local Tala server exited; inspect private server log');
    try { if ((await fetch(base + '/api/v1/health')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Local Tala server failed health check');
}
(async () => {
  await startServer(); await launch();
  const Database = webRequire('better-sqlite3');
  const db = new Database(path.join(temp, 'tala.sqlite'), { readonly: true });
  assert.equal(db.prepare('select count(*) as n from core_users').get().n, 0);
  db.close();
  const email = `desktop.${crypto.randomUUID()}@example.com`;
  const password = crypto.randomBytes(18).toString('base64url') + 'Aa1!';
  await check('actual registration and authenticated account (temporary local DB)', async () => {
    await page.goto(origin + '/register');
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await page.locator('input[autocomplete=name]').fill('Synthetic Desktop Teacher');
    await page.locator('input[type=email]').fill(email);
    await page.locator('input[type=password]').fill(password);
    await page.locator('button[type=submit]').click();
    await page.waitForURL(url => !['/register','/sign-in'].includes(url.pathname));
    assert.equal(await page.evaluate(async () => (await fetch('/api/v1/auth/me')).status), 200);
    const checkDb = new Database(path.join(temp, 'tala.sqlite'), { readonly: true });
    assert.equal(checkDb.prepare('select count(*) as n from core_users where email_norm=?').get(email).n, 1);
    checkDb.close();
  });
  await check('actual English and Filipino screens', async () => {
    await page.goto(origin + '/settings');
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Filipino', exact: true }).click();
    await page.getByRole('heading', { name: 'Mga Setting', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'settings-fil.png') });
    await page.getByRole('button', { name: 'English', exact: true }).click();
  });
  await check('actual authenticated session survives relaunch', async () => {
    await app.evaluate(async ({ session }) => session.fromPartition('persist:tala').cookies.flushStore());
    await closeElectron(app); app = null; await launch();
    await page.goto(origin + '/settings');
    await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
    assert.equal(await page.evaluate(async () => (await fetch('/api/v1/auth/me')).status), 200);
  });
  await check('actual sign-out and sign-in', async () => {
    await page.getByRole('button', { name: 'Sign out', exact: true }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/sign-in');
    await page.locator('input[type=email]').fill(email);
    await page.locator('input[type=password]').fill(password);
    await page.locator('button[type=submit]').click();
    await page.waitForURL(url => url.pathname !== '/sign-in');
  });
  // Existing source-owned seed creates two fictional lessons through the actual
  // API/sync engine. Its credential file stays only in the private temp directory.
  const seeded = path.join(temp, 'seed');
  execFileSync(process.execPath, [webRequire.resolve('tsx/cli'), 'scripts/lesson-walk.mjs', 'seed', base, seeded, '--db', path.join(temp, 'tala.sqlite')], { cwd: web, stdio: 'pipe', timeout: 90000 });
  const account = JSON.parse(fs.readFileSync(path.join(seeded, 'account.json')));
  execFileSync(process.execPath, [webRequire.resolve('tsx/cli'), path.join(__dirname, 'seed-features.mts'), base, seeded, nonce], { cwd: web, stdio: 'pipe', timeout: 90000 });
  const features = JSON.parse(fs.readFileSync(path.join(seeded, 'features.json')));
  const probe = await fetch(base + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: account.email, password: account.password, deviceLabel: 'desktop local seed check' }) });
  assert.equal(probe.status, 200, 'seeded account must log in directly before browser test');
  await page.goto(origin + '/settings');
  await page.getByRole('button', { name: 'Sign out', exact: true }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.waitForURL(url => url.pathname === '/sign-in');
  await page.locator('input[type=email]').fill(account.email);
  await page.locator('input[type=password]').fill(account.password);
  const loginRequest = page.waitForRequest(req => req.url().endsWith('/auth/login') && req.method() === 'POST');
  await page.locator('button[type=submit]').click();
  const posted = (await loginRequest).postDataJSON();
  assert.equal(posted.email === account.email && posted.password === account.password, true, 'UI must submit exact seeded credentials');
  await page.waitForURL(url => url.pathname !== '/sign-in');
  await check('actual lesson editor and Materials rewrite controls', async () => {
    await page.goto(origin + '/lessons/' + account.plans.existing.planId);
    await page.getByRole('button', { name: 'Rewrite with AI: Learning Resources', exact: true }).waitFor();
    assert.ok((await page.locator('input[aria-label^="Learning Resources "]').evaluateAll(inputs => inputs.map(input => input.value))).includes('seed packets for each group'));
    await page.screenshot({ path: path.join(output, 'lesson-en.png') });
  });
  await check('actual Word export produces a readable ZIP document', async () => {
    await app.evaluate(({ session, dialog }, dir) => {
      dialog.showMessageBox = async () => ({ response: 0 });
      global.__talaDownloads = [];
      session.fromPartition('persist:tala').on('will-download', (_event, item) => {
        const result = { name: item.getFilename(), state: 'pending' };
        global.__talaDownloads.push(result);
        item.setSavePath(dir + '/' + result.name);
        item.once('done', (_event, state) => { result.state = state; result.path = item.getSavePath(); });
      });
    }, output);
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
    await page.locator('[data-download-word]').click();
    let downloads = [];
    for (let n = 0; n < 100; n++) {
      downloads = await app.evaluate(() => global.__talaDownloads);
      if (downloads.length && downloads[0].state !== 'pending') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(downloads.length, 1, 'one native download event required');
    assert.equal(downloads[0].state, 'completed');
    const bytes = fs.readFileSync(downloads[0].path);
    assert.equal(bytes.subarray(0, 2).toString(), 'PK');
    assert.ok(bytes.length > 1000);
    const { readZip } = require('../../tala-server/src/modules/decks/zip.ts');
    const docx = readZip(bytes);
    assert.ok(docx.text('word/document.xml').includes('seed packets for each group'));
    assert.ok(docx.has('[Content_Types].xml'));
  });
  await check('actual printable lesson renders PDF bytes', async () => {
    await page.goto(origin + '/lessons/' + account.plans.existing.planId + '/print');
    await page.frameLocator('iframe').locator('h1').first().waitFor();
    const bytes = await app.evaluate(async ({ BrowserWindow }) => {
      const buffer = await BrowserWindow.getAllWindows()[0].webContents.printToPDF({ printBackground: true });
      return buffer.toString('base64');
    });
    const pdf = Buffer.from(bytes, 'base64');
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    fs.writeFileSync(path.join(output, 'lesson.pdf'), pdf);
  });
  await check('actual Materials AI failure is visible and preserves lesson content', async () => {
    await page.goto(origin + '/lessons/' + account.plans.existing.planId);
    const values = () => page.locator('input[aria-label^="Learning Resources "]').evaluateAll(inputs => inputs.map(input => input.value));
    await page.getByRole('button', { name: 'Rewrite with AI: Learning Resources', exact: true }).click();
    const before = await values();
    const sheet = page.locator('dialog[open]');
    await sheet.getByRole('button', { name: 'Yes, rewrite it', exact: true }).click();
    await sheet.getByRole('alert').getByText('The writing service is not answering. Your inputs are kept.', { exact: true }).waitFor({ timeout: 60000 });
    await sheet.getByRole('button', { name: 'Try again', exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'materials-ai-error.png') });
    await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Rewrite with AI: Learning Resources', exact: true }).waitFor();
    assert.deepEqual(await values(), before);
  });
  await check('actual timetable saves Saturday and Sunday and survives reload', async () => {
    await page.goto(origin + '/class');
    await page.getByLabel('Switch class', { exact: true }).selectOption(account.plans.existing.classId);
    await page.getByRole('button', { name: /Science.*Edit/ }).click();
    const sheet = page.locator('dialog[open]');
    const days = sheet.locator('fieldset button[aria-pressed]');
    assert.equal(await days.count(), 7);
    await days.nth(5).click(); await days.nth(6).click();
    await sheet.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Class saved.', { exact: true }).waitFor();
    await page.reload();
    await page.getByLabel('Switch class', { exact: true }).selectOption(account.plans.existing.classId);
    await page.getByRole('button', { name: /Science.*Edit/ }).click();
    assert.equal(await days.nth(5).getAttribute('aria-pressed'), 'true');
    assert.equal(await days.nth(6).getAttribute('aria-pressed'), 'true');
    await page.screenshot({ path: path.join(output, 'weekend-timetable.png') });
    await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
  });
  await check('actual multigrade combination saves an editable session', async () => {
    await page.goto(origin + '/lessons/combine?classId=' + features.classId + '&date=' + features.date);
    await page.locator('[data-mg-screen]').waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-mg-pick]')].filter(el => el.value).length === 2);
    await page.locator('[data-mg-make]').click();
    await page.waitForURL(/\/lessons\/(?!combine|new)[^/]+$/);
    const note = page.getByLabel('Note for this session');
    const expectedNote = 'Synthetic desktop check: bring paper for both grades.';
    const combinedId = new URL(page.url()).pathname.split('/').pop();
    await note.fill(expectedNote);
    await note.blur();
    let persisted = false;
    for (let n = 0; n < 150; n++) {
      const state = new Database(path.join(temp, 'tala.sqlite'), { readonly: true });
      const rows = state.prepare("select data from core_records where entity='plan_section' and json_extract(data,'$.planId')=?").all(combinedId);
      state.close();
      persisted = rows.some(row => JSON.parse(row.data).content?.note === expectedNote);
      if (persisted) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(persisted, true, 'combined note reached the temporary server database');
    await page.reload();
    await page.waitForFunction(value => [...document.querySelectorAll('textarea')].some(el => el.value === value), expectedNote);
    assert.equal(await note.inputValue(), expectedNote);
    await page.screenshot({ path: path.join(output, 'multigrade.png') });
  });
  await check('actual assembled session presents and responds to keyboard navigation', async () => {
    await page.locator('[data-present]').click();
    const presenter = page.locator('dialog[open]');
    await presenter.waitFor();
    const before = await presenter.innerText();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    assert.notEqual(await presenter.innerText(), before);
    await page.screenshot({ path: path.join(output, 'session-presenter.png') });
    await page.keyboard.press('Escape');
    await presenter.waitFor({ state: 'hidden' });
  });
  let uploadId, titleField;
  await check('actual PowerPoint upload and saved text edit', async () => {
    await page.goto(origin + '/library/mine');
    await page.locator('[data-upload-input]').setInputFiles(path.join(seeded, 'synthetic.pptx'));
    await page.waitForURL(/\/slides\/mine\/[^/]+$/, { timeout: 60000 });
    uploadId = new URL(page.url()).pathname.split('/').pop();
    await page.locator('[data-slide-id]').first().waitFor();
    const deck = await page.evaluate(async id => (await fetch('/api/v1/deck-uploads/' + id)).json(), uploadId);
    assert.equal(deck.base.slides.length, 2);
    const first = deck.base.slides[0];
    const block = first.blocks.find(b => b.role === 'title' && b.editable);
    assert.ok(block, 'uploaded title is editable');
    titleField = '#uf-' + first.id + '-' + block.id + '-0';
    await page.locator(titleField).fill('Edited synthetic desktop plant lesson');
    await page.locator(titleField).blur();
    await page.waitForTimeout(1500);
    await page.locator('[data-save-state="saved"]').waitFor();
    await page.reload();
    assert.equal(await page.locator(titleField).inputValue(), 'Edited synthetic desktop plant lesson');
    await page.screenshot({ path: path.join(output, 'uploaded-pptx-editor.png') });
  });
  await check('actual edited PowerPoint downloads and contains the saved words', async () => {
    const before = await app.evaluate(() => global.__talaDownloads.length);
    await page.locator('[data-open-download]').click();
    await page.locator('[data-download-mine]').click();
    let downloads;
    for (let n = 0; n < 150; n++) {
      downloads = await app.evaluate(() => global.__talaDownloads);
      if (downloads.length > before && downloads[before].state !== 'pending') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(downloads.length, before + 1);
    assert.equal(downloads[before].state, 'completed');
    const { readZip } = require('../../tala-server/src/modules/decks/zip.ts');
    const pptx = readZip(fs.readFileSync(downloads[before].path));
    assert.ok(pptx.text('ppt/slides/slide1.xml').includes('Edited synthetic desktop plant lesson'));
  });
  await closeElectron(app); app = null;
  await check('actual feature walk made no non-loopback Chromium connection', async () => {
    const connections = [];
    for (const file of netlogs) {
      const log = JSON.parse(fs.readFileSync(file));
      for (const event of log.events) if (event.type === log.constants.logEventTypes.TCP_CONNECT_ATTEMPT && event.params?.address) connections.push(event.params.address);
    }
    assert.ok(connections.length > 0);
    const nonLoopbackConnections = connections.filter(address => !/^(127\.0\.0\.1:|\[::1\]:)/.test(address)).length;
    assert.equal(nonLoopbackConnections, 0);
    networkEvidence = { tcpAttempts: connections.length, nonLoopbackConnections };
  });
})().catch(async error => {
  // Playwright call logs can include fill() values. Never retain credentials.
  console.error(error.name + ': ' + error.message.split('\n')[0]);
  console.error('Check:', currentCheck);
  console.error('Recent local API statuses:', JSON.stringify(apiStatuses.slice(-16)));
  captureMacDesktop(output);
  if (page && !page.isClosed()) { await page.screenshot({ path: path.join(output, 'failure.png'), timeout: 5000 }).catch(() => {}); }
  results.push({ name: 'walk aborted', status: 'failed', error: error.name + ': ' + error.message.split('\n')[0] });
  process.exitCode = 1;
}).finally(async () => {
  const report = { platform: process.platform, arch: process.arch,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    packaged: !!process.env.TALA_DESKTOP_EXECUTABLE, source: 'unmodified local Tala web/server; isolated HTTPS to temporary SQLite database',
    isolation: { fixtureRequests: fixture?.requests.length, allPeersLoopback: fixture?.requests.every(r => r.peer === '127.0.0.1'), healthBuildNonceVerified: healthVerified, ...networkEvidence },
    limits: ['No real AI provider configured', 'No teaching-pack library copied; session presentation uses visible placeholders for missing grade slides', 'Save dialog bypassed to verify downloaded bytes; printToPDF is not native print-dialog evidence', 'DOCX/PPTX archive contents verified; not opened in Microsoft Office'], results };
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(root, 'test-output', `features-${process.platform}-${process.arch}.json`), JSON.stringify(report, null, 2));
  await closeElectron(app);
  if (server && server.exitCode === null) {
    await new Promise(resolve => {
      const timer = setTimeout(() => { server.kill('SIGKILL'); resolve(); }, 5000);
      server.once('exit', () => { clearTimeout(timer); resolve(); });
      server.kill();
    });
  }
  await fixture?.close();
  // Retain only screenshots/documents/report in ignored test-output, never credentials/DB.
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
