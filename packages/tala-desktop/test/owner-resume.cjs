const assert = require('node:assert/strict');
const fs = require('node:fs');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function readOwnerResume(file) {
  assert.ok(file, 'Owner mode requires the reviewed previous production receipt');
  assert.ok(fs.statSync(file).size < 65536, 'Receipt too large');
  const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(previous.mode, 'owner');
  assert.equal(previous.account?.email, 'fable-release-test-20261125@example.com');
  assert.match(previous.account.id, uuid);
  assert.equal(previous.seed?.phase, 'seeded');
  assert.equal(previous.network?.sectionRequests, 0, 'Do not repeat an AI submission');
  assert.equal(previous.network?.slideRequests, 0);
  assert.equal(previous.network?.blocked, 0);
  assert.ok(!previous.seed.classId && !previous.seed.schoolYearId, 'An already-linked attempt needs a fresh owner review');
  assert.match(previous.seed.planId, uuid);
  assert.equal(previous.seed.sectionIds?.length, 9);
  assert.equal(new Set(previous.seed.sectionIds).size, 9);
  for (const id of previous.seed.sectionIds) assert.match(id, uuid);
  return { accountId: previous.account.id, planId: previous.seed.planId,
    sectionIds: previous.seed.sectionIds, priorRun: previous.run };
}
module.exports = { readOwnerResume };
