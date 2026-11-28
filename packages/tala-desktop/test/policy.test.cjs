const { test } = require('node:test');
const assert = require('node:assert/strict');
const p = require('../src/policy.cjs');
test('hostile navigation never enters the renderer', () => {
  for (const url of ['http://tala.hiraia.org', 'https://tala.hiraia.org.evil.test', 'https://tala.hiraia.org@evil.test', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'https://user:password@tala.hiraia.org']) assert.equal(p.internal(url), false, url);
  assert.equal(p.internal('https://tala.hiraia.org/lessons/123'), true);
  assert.equal(p.external('https://www.deped.gov.ph/'), true);
  for (const url of ['mailto:x@example.com', 'ms-settings:', 'file:///x', 'javascript:alert(1)']) assert.equal(p.external(url), false);
});
test('downloads accept same-origin documents, not executables or foreign blobs', () => {
  assert.equal(p.download('blob:https://tala.hiraia.org/uuid'), true);
  assert.equal(p.download('blob:https://evil.test/uuid'), false);
  assert.equal(p.filename('CON.pdf'), null);
  assert.equal(p.filename('lesson.pdf.exe'), null);
  assert.equal(p.filename('lesson.pptx'), 'lesson.pptx');
  assert.equal(p.filename('../../test.docx'), '.._.._test.docx');
});
