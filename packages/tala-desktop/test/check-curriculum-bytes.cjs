// The local server validates raw byte lengths. Never repair or normalize its data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
function checkBytes(name, raw, committed) {
  assert.ok(raw.equals(committed), `Curriculum checkout differs from Git: ${name}`);
  assert.equal(raw.byteLength, JSON.parse(raw.toString('utf8')).bytes, `Curriculum byte metadata mismatch: ${name}`);
}
if (require.main === module) {
  const root = path.resolve(__dirname, '../../..');
  const relative = 'packages/tala-server/data/packs';
  const files = fs.readdirSync(path.join(root, relative)).filter(n => n.endsWith('.json')).sort();
  assert.ok(files.length > 0, 'Curriculum packs missing');
  for (const name of files) {
    const raw = fs.readFileSync(path.join(root, relative, name));
    const committed = execFileSync('git', ['show', `HEAD:${relative}/${name}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
    checkBytes(name, raw, committed);
  }
  console.log(`Verified ${files.length} curriculum packs: exact Git bytes and declared sizes`);
}
module.exports = { checkBytes };
