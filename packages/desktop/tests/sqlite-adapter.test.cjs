const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const { createStorage } = require('../src/storage.cjs');

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hiraia-exam-sqlite-')));
  const rendererRoot = path.join(root, 'renderer');
  fs.mkdirSync(rendererRoot);
  const storage = createStorage({rendererRoot, dataRoot: path.join(root, 'Learner José data')});
  t.after(() => { storage.close(); fs.rmSync(root, {recursive:true, force:true}); });
  const bridge = {info: {paths: storage.paths},
    sync: (operation, ...args) => storage.sync[operation](...args),
    invoke: async (operation, ...args) => storage.sync[operation](...args)};
  const source = fs.readFileSync(path.join(__dirname, '../../mobile/src/desktop/sqlite.ts'), 'utf8');
  const code = ts.transpileModule(source, {compilerOptions: {module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022}}).outputText;
  const adapter = {};
  new Function('require', 'exports', code)(id => {
    assert.equal(id, './bridge');
    return {desktop: () => bridge};
  }, adapter);
  return adapter;
}

test('exam history uses a separate read-only connection without disabling progress writes', async t => {
  const sqlite = fixture(t);
  const writer = await sqlite.openDatabaseAsync('hiraia.db');
  await writer.execAsync('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
  await writer.runAsync('INSERT INTO settings VALUES (?, ?)', 'exam', 'first');
  const reader = await sqlite.openDatabaseAsync('hiraia.db', {useNewConnection:true}, sqlite.defaultDatabaseDirectory);
  await reader.execAsync('PRAGMA query_only = ON');
  assert.equal((await reader.getFirstAsync('SELECT value FROM settings WHERE key=?', 'exam')).value, 'first');
  await assert.rejects(reader.runAsync('UPDATE settings SET value=?', 'wrong'), /readonly/);
  await writer.runAsync('UPDATE settings SET value=?', 'second');
  await reader.closeAsync();
  await assert.rejects(reader.getAllAsync('SELECT * FROM settings'), /closed/);
  await writer.runAsync('UPDATE settings SET value=?', 'third');
  assert.equal((await writer.getFirstAsync('SELECT value FROM settings')).value, 'third');
  assert.equal(await sqlite.openDatabaseAsync('hiraia.db'), writer);
});

test('dedicated report connections remain isolated across child profiles and app-owned paths', async t => {
  const sqlite = fixture(t);
  for (const child of ['first', 'second']) {
    const writer = await sqlite.openDatabaseAsync(`hiraia-profile-${child}.db`);
    await writer.execAsync('CREATE TABLE results (owner TEXT)');
    await writer.runAsync('INSERT INTO results VALUES (?)', child);
  }
  for (const child of ['first', 'second']) {
    const reader = await sqlite.openDatabaseAsync(`hiraia-profile-${child}.db`, {useNewConnection:true});
    await reader.execAsync('PRAGMA query_only = ON');
    assert.equal((await reader.getFirstAsync('SELECT owner FROM results')).owner, child);
    await reader.closeAsync();
  }
  await assert.rejects(sqlite.openDatabaseAsync('hiraia.db', {useNewConnection:true}, 'file:///outside/'), /application database directory/);
});
