const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
for (const eol of ['LF', 'CRLF']) test(`production tag and prior native-local success are required (${eol} checkout)`, () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/tala-desktop.yml'), 'utf8').replace(/\r\n/g, '\n');
  const checkout = eol === 'CRLF' ? source.replace(/\n/g, '\r\n') : source;
  const yaml = checkout.replace(/\r\n/g, '\n');
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
