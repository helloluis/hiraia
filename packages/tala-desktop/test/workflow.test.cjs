const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
test('production checks require a dedicated manual tag and prior successful native local steps', () => {
  const yaml = fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/tala-desktop.yml'), 'utf8');
  const step = yaml.match(/- name: Intentional bounded production synthetic verification\n([\s\S]+?)\n      - name:/)?.[1];
  assert.ok(step);
  assert.match(step, /^        if: startsWith\(github\.ref_name, 'tala-desktop-preview-production-'\)$/m);
  assert.doesNotMatch(step, /always\(\)|continue-on-error/);
  assert.equal((yaml.match(/node test\/production-ai\.cjs/g) || []).length, 1);
  const index = yaml.indexOf('- name: Intentional bounded production synthetic verification');
  for (const local of ['node test/electron.cjs', 'node test/local-walk.cjs']) {
    assert.ok(yaml.indexOf(local) < index);
    assert.ok(yaml.lastIndexOf(local) < index);
  }
  const eligible = tag => tag.startsWith('tala-desktop-preview-production-');
  for (const tag of ['main', 'feature/desktop', 'tala-v1-demo.21', 'tala-desktop-preview-3', 'tala-desktop-preview-failure-3']) assert.equal(eligible(tag), false);
  assert.equal(eligible('tala-desktop-preview-production-1'), true);
  assert.match(yaml, /retention-days: 3/);
});
