const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

async function bounded(operation, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Timed out: ' + label)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

function captureMacDesktop(output) {
  // GitHub-hosted, temporary synthetic test desktop only. No interactive/user Mac.
  if (process.platform !== 'darwin' || process.env.CI !== 'true') return;
  fs.mkdirSync(output, { recursive: true });
  try { execFileSync('screencapture', ['-x', path.join(output, 'mac-test-failure.png')], { stdio: 'ignore', timeout: 5000 }); } catch {}
}

async function closeElectron(app) {
  if (!app) return;
  try { await bounded(app.close(), 5000, 'Electron shutdown'); }
  catch {
    // Only the subprocess owned by this Playwright launch, never other runner apps.
    const child = app.process();
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

module.exports = { bounded, captureMacDesktop, closeElectron };
