const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { readOwnerResume } = require('./owner-resume.cjs');
test('owner resume requires the reviewed unused-AI standalone fixture; ambiguous/replayed records stop offline', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tala-resume-control-'));
  const file = path.join(dir, 'receipt.json');
  const prior = { mode: 'owner', run: 'offline-control', account: { id: randomUUID(), email: 'fable-release-test-20261125@example.com' },
    seed: { phase: 'seeded', planId: randomUUID(), sectionIds: Array.from({ length: 9 }, randomUUID) },
    network: { sectionRequests: 0, slideRequests: 0, blocked: 0 } };
  try {
    fs.writeFileSync(file, JSON.stringify(prior));
    const result = readOwnerResume(file);
    assert.equal(result.planId, prior.seed.planId);
    assert.equal(result.accountId, prior.account.id);
    for (const poison of [
      p => { p.mode = 'ephemeral'; }, p => { p.account.email = 'another@example.com'; },
      p => { p.network.sectionRequests = 1; }, p => { p.network.slideRequests = 1; },
      p => { p.network.blocked = 1; }, p => { p.seed.classId = randomUUID(); },
      p => { p.seed.schoolYearId = randomUUID(); }, p => { p.seed.phase = 'writing'; },
      p => { p.seed.sectionIds[1] = p.seed.sectionIds[0]; },
    ]) {
      const copy = structuredClone(prior); poison(copy); fs.writeFileSync(file, JSON.stringify(copy));
      assert.throws(() => readOwnerResume(file));
    }
    assert.throws(() => readOwnerResume(undefined));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
