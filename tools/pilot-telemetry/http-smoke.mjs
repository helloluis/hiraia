import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
const temp = mkdtempSync(path.join(tmpdir(), 'hiraia-http-'));
const dbPath = path.join(temp, 'telemetry.db');
const port = '18136';
const child = spawn(process.execPath, ['packages/web/.telemetry/server.cjs'], {
  env: { ...process.env, HIRAIA_TELEMETRY_DB_PATH: dbPath, TELEMETRY_PORT: port },
  stdio: ['ignore', 'pipe', 'pipe'],
});
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('startup timeout')), 5000);
    child.stdout.once('data', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(Error(`early exit ${code}`));
    });
    child.stderr.on('data', (data) => process.stderr.write(data));
  });
  const url = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(url + '/health')).status, 200);
  assert.equal((await fetch(url + '/api/telemetry/batch')).status, 404);
  const event = {
    id: 'http_event_0123456789',
    name: 'card_viewed',
    occurred_at: Date.now() - 10 * 86400000,
    session_id: 'http_session_0123456789',
    props: { language: 'cebuano', source: 'curated' },
  };
  for (let i = 0; i < 2; i++) {
    const response = await fetch(url + '/api/telemetry/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schema: 1,
        installation_id: 'http_install_0123456789',
        events: [event],
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).acknowledged, [event.id]);
  }
  const db = new Database(dbPath, { readonly: true });
  assert.equal(db.prepare('SELECT count(*) n FROM telemetry_events').get().n, 1);
  assert.equal(
    db.prepare('SELECT occurred_at FROM telemetry_events').get().occurred_at,
    event.occurred_at
  );
  db.close();
  console.log(
    'PASS: standalone HTTP host, health, write-only route, ten-day-old event, retry deduplication'
  );
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
  rmSync(temp, { recursive: true, force: true });
}
