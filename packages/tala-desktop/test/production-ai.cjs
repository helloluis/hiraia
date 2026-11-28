// Intentional production checks, separately authorized by rq_czqd79ie.
// NEVER imported by the isolated fixture walks. No uploads, credentials in
// evidence, unrelated lesson edits, account reuse across owners, or AI retries.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { _electron: electron } = require('playwright');
const { bounded, closeElectron, linuxHeadlessArgs } = require('./harness.cjs');
const { installProductionGuard } = require('./production-guard.cjs');
const { preflight } = require('./linux-preflight.cjs');
const { readOwnerResume } = require('./owner-resume.cjs');
const root = path.resolve(__dirname, '..');
const web = path.resolve(root, '../tala-web');
const webRequire = createRequire(path.join(web, 'package.json'));
const [mode, base] = process.argv.slice(2);
assert.equal(process.env.TALA_DESKTOP_PRODUCTION_TEST_APPROVAL, 'rq_czqd79ie');
assert.equal(base, 'https://tala.hiraia.org');
assert.ok(mode === 'owner' || mode === 'ephemeral');
const native = mode === 'ephemeral';
let resume;
if (native) {
  assert.match(process.env.TALA_RELEASE_TAG || '', /^tala-desktop-preview-production-[a-zA-Z0-9.-]+$/);
  assert.equal(process.env.GITHUB_RUN_ATTEMPT, '1', 'Never replay production writes by rerunning a job');
  assert.ok(process.env.TALA_DESKTOP_EXECUTABLE);
  assert.equal(process.env.CI, 'true');
  assert.ok(['win32', 'darwin'].includes(process.platform), 'Native mode requires a Windows or macOS runner');
} else {
  assert.equal(process.env.TALA_DESKTOP_OWNER_AI_CHECK, '1');
  assert.notEqual(process.env.CI, 'true', 'Owner credentials must stay on the owner host');
  if (process.platform === 'linux' && !preflight(process.env.TALA_DESKTOP_EXECUTABLE || require('electron'))) process.exit(2);
  assert.ok(process.env.TALA_TEST_EMAIL && process.env.TALA_TEST_PASSWORD);
  assert.equal(process.env.TALA_TEST_EMAIL, 'fable-release-test-20261125@example.com', 'Owner mode is for the retained release account only');
  resume = readOwnerResume(process.env.TALA_DESKTOP_OWNER_RESUME_REPORT);
}
const run = process.env.GITHUB_RUN_ID || process.env.TALA_DESKTOP_PRODUCTION_RUN_ID;
assert.match(run || '', /^[a-zA-Z0-9-]{1,60}$/, 'Explicit unique production run id required');
const scope = `${run}-${process.platform}-${process.arch}`;
const output = path.join(root, 'test-output', 'production-' + scope);
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const reportPath = path.join(output, 'production.json');
const email = native ? `desktop-native-${scope}-${crypto.randomBytes(6).toString('hex')}@example.com` : process.env.TALA_TEST_EMAIL;
assert.match(email, /@example\.com$/);
const password = native ? crypto.randomBytes(24).toString('base64url') + 'Aa1!' : process.env.TALA_TEST_PASSWORD;
const displayName = `Synthetic Desktop Native Check (${run}/${process.platform}-${process.arch})`;
const report = { scope: 'INTENTIONAL PRODUCTION SYNTHETIC CHECK', mode, run,
  release: native ? process.env.TALA_RELEASE_TAG : null,
  displayBackend: !native && linuxHeadlessArgs().length ? 'ozone-headless' : 'system display',
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  platform: process.platform, arch: process.arch, account: { email, id: resume?.accountId ?? null, ...(native ? { displayName } : {}) },
  resume: resume ? { priorRun: resume.priorRun, planId: resume.planId } : null,
  phase: 'planned', checks: [], seed: null, jobs: [], cleanup: native ? 'not registered' : 'owner account retained; existing labelled lesson and new labelled year/class retained' };
// A reused run id fails before network access. Inspect the prior receipt first.
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tala-production-check-'));
const seedPath = path.join(output, 'seed-identities.json');
let app, page, registered = false, stopping = false;
function active() { assert.equal(stopping, false, 'Production work has ended'); }
const persist = () => {
  const text = JSON.stringify(report, null, 2);
  fs.writeFileSync(reportPath, text, { mode: 0o600 });
  if (native) fs.writeFileSync(path.join(root, 'test-output', `production-${process.platform}-${process.arch}.json`), text, { mode: 0o600 });
};
persist();
async function identity() {
  const me = await page.evaluate(async () => {
    const r = await fetch('/api/v1/auth/me');
    if (!r.ok) return { status: r.status };
    const { user } = await r.json(); return { status: r.status, id: user.id, email: user.email };
  });
  assert.equal(me.status, 200); assert.equal(me.email, email);
  if (report.account.id) assert.equal(me.id, report.account.id);
  report.account.id = me.id; persist(); return me;
}
async function check(name, operation) {
  active();
  report.phase = name; persist();
  await bounded(operation(), 120000, name);
  active();
  report.checks.push({ name, status: 'passed' }); persist(); console.log('PASS production:', name);
}
async function uiStep(name, locator, operation) {
  active(); report.phase = name; persist();
  try {
    await bounded(operation(), 60000, name);
  } catch (error) {
    // Counts only: never capture production text, credentials or a screenshot.
    report.ui = { step: name, matches: await bounded(locator.count(), 2000, 'selector diagnostic').catch(() => null),
      visible: await bounded(locator.first().isVisible(), 2000, 'visibility diagnostic').catch(() => null) };
    persist(); throw error;
  }
  active();
}
async function pollJob(url, done) {
  for (let n = 0; n < 75; n++) {
    active();
    const result = await page.evaluate(async u => { const r = await fetch(u); return { status: r.status, body: await r.json() }; }, url);
    active();
    assert.equal(result.status, 200);
    const job = result.body;
    if (job.status === done) return job;
    if (['failed', 'cancelled', 'discarded'].includes(job.status)) throw new Error('AI job did not succeed');
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw new Error('AI job deadline');
}
async function waitMacPresentation(event) {
  if (process.platform !== 'darwin') return;
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    active();
    if (await bounded(app.evaluate((_e, name) => global.__presentationEvents.includes(name), event), 2000, 'native presentation event')) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Native presentation transition deadline');
}
async function runChecks() {
  execFileSync(process.execPath, [webRequire.resolve('tsx/cli'), path.join(__dirname, 'production-seed.mts'), '--validate-only'], { cwd: web, stdio: 'pipe', timeout: 15000 });
  execFileSync(process.execPath, [webRequire.resolve('tsx/cli'), path.join(__dirname, 'production-fixture-check.mts')], { cwd: web, stdio: 'pipe', timeout: 15000 });
  active();
  const args = [...(native ? [] : linuxHeadlessArgs()), '--user-data-dir=' + profile];
  app = await electron.launch({ chromiumSandbox: true,
    ...(process.env.TALA_DESKTOP_EXECUTABLE ? { executablePath: process.env.TALA_DESKTOP_EXECUTABLE, args } : { args: [...args, root] }),
    env: { ...process.env, TALA_DESKTOP_TEST: '0' } });
  page = await app.firstWindow(); page.setDefaultTimeout(20000);
  page.on('response', async response => {
    if (new URL(response.url()).pathname !== '/api/v1/sync/push' || response.request().method() !== 'POST') return;
    try {
      const body = await response.json();
      report.syncAcknowledgement = { status: response.status(), results: body.results.map(r => r.status) };
    } catch { report.syncAcknowledgement = { status: response.status(), invalid: true }; }
    persist();
  });
  // Allow only known operations, with a separate reserved cleanup request. This
  // runs in the test's main-process debugger, never in the shipped app/preload.
  await app.evaluate(installProductionGuard, { base, native, email, displayName });
  if (native) {
    report.phase = 'registering exactly one synthetic account'; report.cleanup = 'registration may be in flight'; persist();
    await page.goto(base + '/register');
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await page.locator('input[autocomplete=name]').fill(displayName);
    await page.locator('input[type=email]').fill(email);
    await page.locator('input[type=password]').fill(password);
    const [response] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/auth/register' && r.request().method() === 'POST'),
      page.locator('button[type=submit]').click(),
    ]);
    assert.ok(response.ok());
    const auth = await response.json();
    assert.equal(auth.user.email, email);
    report.account.id = auth.user.id; registered = true; report.cleanup = 'required'; persist();
  } else {
    await page.goto(base + '/sign-in');
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await page.locator('input[type=email]').fill(email);
    await page.locator('input[type=password]').fill(password);
    await page.locator('button[type=submit]').click();
  }
  await page.waitForURL(u => !['/register', '/sign-in'].includes(u.pathname));
  const me = await identity();
  active();
  execFileSync(process.execPath, [webRequire.resolve('tsx/cli'), path.join(__dirname, 'production-seed.mts'), base, seedPath, me.id, mode], {
    cwd: web, stdio: 'pipe', timeout: 60000,
    env: { ...process.env, TALA_TEST_EMAIL: email, TALA_TEST_PASSWORD: password },
  });
  active();
  const seed = JSON.parse(fs.readFileSync(seedPath)); report.seed = seed; persist();
  assert.equal(seed.phase, 'seeded');
  await app.evaluate((_e, seed) => {
    for (const key of ['planId', 'sectionIds', 'contentSectionId', 'sectionDigests', 'revisionContentDigest', 'appliedPlanDigest']) global.__productionCheck[key] = seed[key];
  }, seed);
  await page.goto(base + '/lessons/' + seed.planId);
  await check('one real content-section rewrite', async () => {
    const content = page.getByRole('textbox', { name: 'Content', exact: true });
    const rewrite = page.getByRole('button', { name: 'Rewrite with AI: Content', exact: true });
    await uiStep('wait for the labelled lesson Content editor', content, () => content.waitFor({ state: 'visible', timeout: 55000 }));
    await uiStep('wait for class-linked Content Rewrite control', rewrite, () => rewrite.waitFor({ state: 'visible', timeout: 55000 }));
    const before = await content.innerText();
    await uiStep('open the Content Rewrite confirmation', rewrite, () => rewrite.click());
    const sheet = page.locator('dialog[open]');
    report.phase = 'submit exactly one Content rewrite'; persist();
    const [response] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/generation/jobs' && r.request().method() === 'POST'),
      sheet.getByRole('button', { name: /^(Rewrite with AI|Yes, rewrite it)$/ }).click(),
    ]);
    assert.ok(response.ok());
    const job = await response.json(); report.jobs.push({ id: job.id, kind: 'section', status: job.status }); persist();
    report.phase = 'wait for the real Content rewrite job'; persist();
    const finished = await pollJob('/api/v1/generation/jobs/' + job.id, 'done');
    report.jobs[0].status = finished.status;
    await sheet.waitFor({ state: 'hidden' });
    assert.ok((await content.innerText()).trim().length > 20);
    assert.notEqual(await content.innerText(), before);
    // Wait for the real sync acknowledgement, not just optimistic UI text.
    report.phase = 'wait for the Content revision and lesson sync'; persist();
    for (let n = 0; n < 300 && !report.syncAcknowledgement; n++) {
      active(); await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(report.syncAcknowledgement?.status, 200, 'Rewrite must be durably synced');
    assert.deepEqual(report.syncAcknowledgement.results, Array(11).fill('applied'));
  });
  if (native) await check('one real slide-generation proposal and application', async () => {
    const [response] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === `/api/v1/plans/${seed.planId}/presentation/ai` && r.request().method() === 'POST'),
      page.locator('[data-make-slides]').click(),
    ]);
    assert.ok(response.ok());
    const job = await response.json(); report.jobs.push({ id: job.id, kind: 'slides', status: job.status }); persist();
    await app.evaluate((_e, id) => { global.__productionCheck.slideJobId = id; }, job.id);
    const finished = await pollJob(`/api/v1/plans/${seed.planId}/presentation/ai/${job.id}`, 'ready');
    report.jobs[1].status = finished.status;
    await page.locator('[data-ai-proposal]').first().waitFor();
    await page.locator('[data-ai-use]').click();
    await page.locator('[data-present]').waitFor();
    const presentation = await page.evaluate(async id => (await fetch(`/api/v1/plans/${id}/presentation`)).json(), seed.planId);
    assert.ok(presentation.slides?.deckId);
    report.deckId = presentation.slides.deckId;
    await app.evaluate((_e, id) => { global.__productionCheck.deckId = id; }, report.deckId);
    persist();
    if (process.platform === 'darwin') await app.evaluate(({ BrowserWindow }) => {
      global.__presentationEvents = [];
      const win = BrowserWindow.getAllWindows()[0];
      for (const name of ['enter-full-screen', 'leave-full-screen']) win.once(name, () => global.__presentationEvents.push(name));
    });
    await page.locator('[data-present]').click();
    const presenter = page.locator('dialog[open]');
    await presenter.waitFor();
    await waitMacPresentation('enter-full-screen');
    const before = await presenter.innerText();
    await page.keyboard.press('ArrowRight');
    assert.notEqual(await presenter.innerText(), before);
    await page.keyboard.press('Escape');
    await presenter.waitFor({ state: 'hidden' });
    await waitMacPresentation('leave-full-screen');
    await page.locator('[data-edit-slides] a').click();
    const title = page.locator('textarea[id$="-title"]').first();
    await title.fill('Synthetic native desktop slide edit');
    await title.blur();
    await page.waitForTimeout(1500);
    await page.locator('[data-save-state="saved"]').waitFor();
    await page.reload();
    assert.equal(await title.inputValue(), 'Synthetic native desktop slide edit');
  });
}
(async () => {
  try { await bounded(runChecks(), 270000, 'production verification wall-time'); }
  catch (error) { report.failure = { type: error.name, phase: report.phase }; process.exitCode = 1; }
  finally {
    stopping = true;
    // Inventory survives an abrupt process death; no account password is ever persisted.
    if (fs.existsSync(seedPath)) report.seed = JSON.parse(fs.readFileSync(seedPath));
    if (app) {
      await bounded(app.evaluate(() => { global.__productionCheck.finishing = true; }), 5000, 'end production writes').catch(() => {});
      if (native) {
        try {
          await bounded((async () => {
            await identity(); // exact cohort identity again before deletion
            const status = await page.evaluate(async secret => (await fetch('/api/v1/account/delete', {
              method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: 'DELETE', password: secret }),
            })).status, password);
            assert.equal(status, 200);
            const signedOut = await page.evaluate(async () => (await fetch('/api/v1/auth/me')).status);
            assert.equal(signedOut, 401);
            report.cleanup = 'self-delete 200; auth/me 401';
          })(), 30000, 'synthetic account self-delete');
        } catch {
          report.cleanup = registered ? 'UNVERIFIED: owner must inspect exact cohort account' : 'registration outcome uncertain; owner must inspect the planned email';
          process.exitCode = 1;
        }
      } else if (page) await bounded(page.evaluate(() => fetch('/api/v1/auth/logout', { method: 'POST' })), 10000, 'owner sign out').catch(() => {});
      report.network = await bounded(app.evaluate(() => {
        const s = global.__productionCheck;
        return { writes: s.writes, recordWrites: s.recordWrites, syncApplications: s.syncApplications, registrations: s.registrations, deletions: s.deletions, sectionRequests: s.sections, slideRequests: s.slides, blocked: s.blocked, statuses: s.statuses };
      }), 5000, 'read request counts').catch(() => ({ unavailable: true }));
      const writes = (report.seed?.writes || 0) + (report.network.writes || 0);
      report.totalWriteRequests = writes;
      if (writes > 40 || report.network.blocked || report.network.unavailable || (native && report.network.deletions !== 1)) process.exitCode = 1;
    }
    report.phase = process.exitCode ? 'failed or cleanup unverified' : 'completed'; persist();
    await closeElectron(app);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    console.log('Production receipt:', path.basename(output), report.phase);
  }
})();
