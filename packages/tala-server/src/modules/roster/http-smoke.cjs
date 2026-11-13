// Run after `pnpm --filter @hiraia/tala-web build`. Uses only invented names and a disposable local DB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { randomUUID, randomBytes } = require('node:crypto');
const Database = require('better-sqlite3');
const XLSX = require('xlsx');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tala-roster-http-'));
  const dbPath = path.join(temporary, 'test.sqlite');
  const webDir = path.resolve(__dirname, '../../../../tala-web');
  const resolveWeb = createRequire(path.join(webDir, 'package.json'));
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [resolveWeb.resolve('next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: webDir, env: { ...process.env, TALA_ENV: 'local', TALA_DB_PATH: dbPath, TALA_PUBLIC_ORIGIN: origin, TALA_ROSTER_LLM_ROUTE: 'rules' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Never echo server output: a future regression must not print credentials or request contents.
  child.stdout.resume(); child.stderr.resume();
  let stopped = false;
  const closed = new Promise(resolve => child.once('close', () => { stopped = true; resolve(); }));
  let db;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (stopped) throw new Error('Next exited before readiness');
      try { ready = (await fetch(origin + '/sign-in')).ok; } catch {}
      if (ready) break;
      await delay(250);
    }
    assert.ok(ready, 'Next readiness timeout');
    let bearer;
    async function post(endpoint, body, expected = 200) {
      const response = await fetch(origin + '/api/v1' + endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) });
      const data = await response.json();
      if (response.status !== expected) throw new Error(`${endpoint}: HTTP ${response.status}, expected ${expected}; code ${data.error?.code ?? 'unknown'}`);
      return data;
    }
    const email = `roster-${randomUUID()}@example.test`, password = 'Test-only-' + randomBytes(24).toString('hex');
    const registration = await post('/auth/register', { email, password, displayName: 'Fictional Smoke Teacher', uiLanguage: 'en' });
    bearer = registration.token;
    const classId = 'smoke-class';
    const push = await post('/sync/push', { deviceId: 'smoke-device', mutations: [{ mutationId: randomUUID(), entity: 'class', id: classId, op: 'upsert', baseRev: 0, data: { id: classId, schoolYearId: 'smoke-year', name: 'Fictional Smoke Class', gradeGroups: [{ id: 'smoke-grade', grade: '3' }] } }] });
    assert.equal(push.results[0].status, 'applied');
    const text = 'Name\tGrade\nPeña, Miro A.\t3\nDe los Santos, Lira B.\t3';
    const pasted = { classId, filename: 'invented.txt', text, useAi: false };
    await post('/roster/imports', pasted, 403);
    db = new Database(dbPath, { readonly: true });
    const mail = db.prepare("SELECT vars FROM core_mail_outbox WHERE to_email = ? AND template = 'verify_email' ORDER BY rowid DESC LIMIT 1").get(email);
    assert.ok(mail, 'Verification email exists in disposable outbox');
    const token = new URLSearchParams(new URL(JSON.parse(mail.vars).link).hash.slice(1)).get('token');
    assert.ok(token, 'Verification token exists');
    await post('/auth/verify-email', { token });
    const textResult = await post('/roster/imports', pasted);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Name', 'Grade'], ['Peña, Miro A.', '3'], ['De los Santos, Lira B.', '3']]), 'Invented names');
    const contentBase64 = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }).toString('base64');
    const sheetResult = await post('/roster/imports', { classId, filename: 'invented.xlsx', contentBase64, useAi: false });
    for (const result of [textResult, sheetResult]) {
      assert.deepEqual(result.counts, { linesRead: 3, students: 2, needsReview: 0, notStudents: 1 });
      assert.deepEqual(result.rows.slice(1).map(r => r.proposed.displayName), ['Peña, Miro A.', 'De los Santos, Lira B.']);
      assert.equal(result.route, 'rules'); assert.equal(result.aiUsed, false);
    }
    await post('/account/delete', { confirm: 'DELETE', password });
    console.log(JSON.stringify({ runtime: 'next start (production build; TALA_ENV=local)', port, registration: 200, classSync: 'applied', unverifiedImport: 403, verification: 200, pastedImport: { status: 200, counts: textResult.counts, names: textResult.rows.slice(1).map(r => r.proposed.displayName) }, xlsxImport: { status: 200, counts: sheetResult.counts, sheets: sheetResult.sheets }, accountDeleted: true }));
  } finally {
    db?.close();
    if (!stopped) child.kill('SIGTERM');
    const killTimer = setTimeout(() => { if (!stopped) child.kill('SIGKILL'); }, 5000);
    await closed; clearTimeout(killTimer);
    fs.rmSync(temporary, { recursive: true, force: true });
    console.log(JSON.stringify({ serverStopped: stopped, temporaryDatabaseRemoved: !fs.existsSync(temporary) }));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
