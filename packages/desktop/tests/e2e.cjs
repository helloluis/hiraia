'use strict';
// Exercise the real renderer, sandbox bridge, packaged native engines and voices.
// CI extracts the actual ZIP into a path with spaces and Unicode before this runs.
const { _electron, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { verifyExam } = require('./exam-flow.cjs');
const root = path.resolve(__dirname, '../../..');
const output = path.join(root, 'build/windows-e2e');
const user = path.join(output, 'Learner José data');
fs.mkdirSync(output, { recursive: true });
const executablePath = process.env.HIRAIA_E2E_EXECUTABLE;
const report = { passed: false, platform: process.platform, arch: process.arch, packaged: !!executablePath,
  gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), checks: [] };
const logs = [];
const errors = [];
const pushCheck = report.checks.push.bind(report.checks);
report.checks.push = (...checks) => { console.log('PASS:', ...checks); return pushCheck(...checks); };
async function launch() {
  const app = await _electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: [path.join(root, 'packages/desktop')] }),
    env: { ...process.env, HIRAIA_TEST_DATA_DIR: user }, timeout: 90000 });
  const log = chunk => { logs.push(String(chunk)); fs.appendFileSync(path.join(output, 'application-live.log'), chunk); };
  app.process().stdout.on('data', log);
  app.process().stderr.on('data', log);
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  // No connection is available during first-run onboarding, reading or quizzes.
  await app.evaluate(({ session }) => {
    session.defaultSession.enableNetworkEmulation({ offline: true });
    globalThis.fetch = async () => { throw new Error('Offline validation'); };
  });
  return { app, page };
}
async function main() {
  fs.rmSync(user, { recursive: true, force: true });
  let app, page;
  try {
    ({ app, page } = await launch());
    await page.getByLabel('First name (optional)').fill('Windows Learner');
    await page.getByRole('button', { name: 'Create my profile', exact: true }).click();
    await page.getByText('English', { exact: true }).click();
    await page.getByText('FIVE', { exact: true }).click();
    await page.getByText("Let's start!", { exact: true }).click();
    await page.getByRole('button', { name: 'Next card', exact: true }).waitFor({ timeout: 90000 });
    await expect(page.getByText('Windows Learner', { exact: true })).toBeVisible();
    report.checks.push('offline first-run profile and curriculum');
    ({ app, page } = await verifyExam({ app, page, launch, output, report }));
    const next = page.getByRole('button', { name: 'Next card', exact: true });
    await next.focus();
    const before = await page.locator('body').innerText();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => page.locator('body').innerText()).not.toBe(before);
    assert.ok(await page.locator('[inert]').count(), 'Future cards must be removed from Tab navigation');
    report.checks.push('keyboard navigation and inactive-card focus isolation');
    const rail = page.getByTestId('horizontal-card-carousel');
    const previousPosition = await page.getByText(/^\d+ \/ \d+$/).innerText();
    await rail.hover();
    await page.mouse.wheel(500, 0);
    await expect.poll(() => page.getByText(/^\d+ \/ \d+$/).innerText()).not.toBe(previousPosition);
    report.checks.push('horizontal trackpad scroll advances the active card');
    const choices = page.getByRole('button', { name: /^[A-D]\. / }).and(page.locator(':not([disabled])'));
    for (let turn = 0; turn < 14 && !await choices.count(); turn++) {
      await next.click();
      await page.waitForTimeout(800);
    }
    assert.ok(await choices.count() >= 2, 'The curriculum must reach a real quiz');
    await page.screenshot({ path: path.join(output, 'wide-quiz.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2));
    await page.waitForTimeout(500);
    for (const choice of await choices.all()) {
      await choice.scrollIntoViewIfNeeded();
      await expect(choice).toBeInViewport();
      await choice.click({ trial: true });
    }
    await page.screenshot({ path: path.join(output, 'zoomed-quiz.png') });
    report.checks.push('all quiz answers reachable at 200% zoom');
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.webContents.setZoomFactor(1); w.setSize(900, 600); });
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeGreaterThanOrEqual(840);
    for (const choice of await choices.all()) { await choice.scrollIntoViewIfNeeded(); await choice.click({ trial: true }); }
    await page.screenshot({ path: path.join(output, 'small-window-quiz.png') });
    report.checks.push('all quiz answers reachable in a 900×600 window');
    const labels = await choices.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label').slice(3)));
    const { DatabaseSync } = require('node:sqlite');
    const data = path.join(root, 'packages/desktop/renderer/assets/assets/data');
    const database = new DatabaseSync(path.join(data, fs.readdirSync(data).find(name => /^cards\..*\.db$/.test(name))), { readOnly: true });
    let correct;
    for (const row of database.prepare('SELECT json FROM card_question').iterate()) {
      const question = JSON.parse(row.json);
      if (question.o?.length === labels.length && question.o.every(option => labels.includes(option.en))) {
        correct = question.o[question.a]?.en;
        break;
      }
    }
    database.close();
    assert.ok(correct, 'Quiz answers must match the bundled source bank');
    await choices.filter({ hasText: correct }).click();
    await expect(page.getByText(/Quiz ✓ 1/, { exact: false })).toBeVisible();
    await app.evaluate(({ app: electron, BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1366, 850); electron.setAccessibilitySupportEnabled(true); });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(output, 'screen-reader-layout.png') });
    report.checks.push('system accessibility mode renders');
    await app.close(); app = null;
    ({ app, page } = await launch());
    await expect(page.getByText('Windows Learner', { exact: true })).toBeVisible({ timeout: 90000 });
    // The active local profile and answered review resume automatically.
    await expect(page.getByText(/Quiz ✓ 1/, { exact: false })).toBeVisible({ timeout: 90000 });
    report.checks.push('profile and quiz result persist after restart');
    if (process.env.HIRAIA_E2E_NATIVE === '1') {
      await page.evaluate(() => {
        window.hiraiaPlaybackProbe = [];
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () {
          const entry = { source: this.src, playing: false, duration: 0 };
          window.hiraiaPlaybackProbe.push(entry);
          this.addEventListener('playing', () => { entry.playing = true; entry.duration = this.duration; }, { once: true });
          return play.call(this);
        };
      });
      await page.getByRole('button', { name: 'Listen', exact: true }).last().click();
      await expect.poll(() => page.evaluate(() => window.hiraiaPlaybackProbe.some(entry => entry.source.includes('speech') && entry.playing && entry.duration > 0)), { timeout: 45000 }).toBe(true);
      report.playback = await page.evaluate(() => window.hiraiaPlaybackProbe);
      report.checks.push('Listen button plays synthesized offline narration');
      const info = await page.evaluate(() => window.hiraiaDesktop.info);
      assert.equal(info.platform, process.platform);
      const modelDirectory = path.join(user, 'documents/validation-models');
      fs.mkdirSync(modelDirectory, { recursive: true });
      for (const name of ['labse.Q4_K_M.gguf', 'hiraia-sft-2b-v2.Q4_K_M.gguf']) {
        fs.copyFileSync(path.join(root, 'build/windows-native/models', name), path.join(modelDirectory, name));
      }
      report.native = await page.evaluate(async directory => {
        const api = window.hiraiaDesktop;
        const embed = await api.invoke('qvac.load', 'test-embed', { modelSrc: directory + '/labse.Q4_K_M.gguf', modelType: 'llamacpp-embedding', modelConfig: { pooling: 'cls', embdNormalize: 2, device: 'cpu' } });
        const vector = await api.invoke('qvac.embed', { modelId: embed, text: 'The Sun gives plants energy.' });
        await api.invoke('qvac.unload', { modelId: embed });
        if (vector.embedding.length !== 768 || !vector.embedding.every(Number.isFinite)) throw new Error('Invalid packaged embedding');
        const llm = await api.invoke('qvac.load', 'test-llm', { modelSrc: directory + '/hiraia-sft-2b-v2.Q4_K_M.gguf', modelType: 'llm', modelConfig: { ctx_size: 4096, gpu_layers: 0, device: 'cpu' } });
        let answer = '', stats, finish, fail;
        const finished = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
        const timer = setTimeout(() => fail(new Error('Packaged generation timed out')), 60000);
        const off = api.subscribe('qvac-stream', value => {
          if (value.id !== 'test-complete') return;
          if (value.event?.type === 'contentDelta') answer += value.event.text;
          if (value.error) fail(new Error(value.error));
          if (value.done) { stats = value.stats; finish(); }
        });
        // invoke replies and streamed notifications use separate IPC channels.
        // Wait for both so the final notification cannot race unsubscription.
        try { await Promise.all([finished, api.invoke('qvac.complete', 'test-complete', { modelId: llm, history: [{ role: 'user', content: 'Name the star at the center of our solar system.' }], generationParams: { temp: 0, predict: 24, reasoning_budget: 0 } })]); }
        finally { clearTimeout(timer); off(); await api.invoke('qvac.unload', { modelId: llm }); }
        if (!/sun/i.test(answer) || stats?.backendDevice !== 'cpu') throw new Error('Packaged CPU generation failed: ' + JSON.stringify({ answer, stats }));
        return { embeddingDimensions: vector.embedding.length, answer, stats };
      }, modelDirectory);
      report.checks.push('packaged QVAC CPU embedding and generation after relocation');
      report.voices = {};
      for (const [language, text] of [['en', 'The Sun gives plants energy.'], ['tl', 'Ang araw ay nagbibigay ng liwanag.']]) {
        const metadata = JSON.parse(fs.readFileSync(path.join(root, `packages/mobile/assets/voices/${language}/voice.json`)));
        const tokens = [0];
        for (const character of text.toLowerCase()) if (metadata.vocab[character] !== undefined) tokens.push(metadata.vocab[character], 0);
        report.voices[language] = await page.evaluate(async ({ language, tokens }) => {
          const api = window.hiraiaDesktop;
          const files = api.sync('fs.list', 'hiraia://app/assets/assets/voices/' + language);
          const model = files.find(file => file.name.endsWith('.onnx'))?.name;
          if (!model) throw new Error('Bundled voice is missing');
          // The native voice gate accepts only the two language filenames.
          const dir = api.info.paths.document + 'validation-voices/';
          api.sync('fs.mkdir', dir, { intermediates: true, idempotent: true });
          const uri = dir + language + '.onnx';
          api.sync('fs.copy', 'hiraia://app/assets/assets/voices/' + language + '/' + model, uri);
          const voice = await api.invoke('voice.open', uri);
          try {
            const values = { input_ids: { type: 'int64', data: tokens.map(String) }, attention_mask: { type: 'int64', data: tokens.map(() => '1') } };
            const outputs = await api.invoke('voice.run', voice.id, values);
            const waveform = outputs[voice.outputNames[0]].data;
            if (waveform.length < 1600 || !Array.from(waveform).every(Number.isFinite) || !Array.from(waveform).some(n => Math.abs(n) > 0.001)) throw new Error('Voice returned silent or invalid audio');
            return { samples: waveform.length };
          } finally { await api.invoke('voice.release', voice.id); }
        }, { language, tokens });
      }
      report.checks.push('bundled English and Tagalog voices synthesize offline');
    }
    assert.deepEqual(errors, [], 'Renderer JavaScript exceptions');
    report.passed = true;
  } finally {
    if (app) { try { await page.screenshot({ path: path.join(output, 'last-screen.png') }); } catch {} await app.close(); }
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ ...report, errors }, null, 2) + '\n');
    fs.writeFileSync(path.join(output, 'application.log'), logs.join(''));
  }
}
main().then(() => console.log(JSON.stringify(report, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
