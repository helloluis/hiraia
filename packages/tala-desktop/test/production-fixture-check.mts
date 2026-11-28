// Offline contract check, using the REAL web apply helper and sync engine.
// The model result and transport below are synthetic; this is not real-AI evidence.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Plan } from '../../tala-core/src/contracts/index.ts';
import { createSyncEngine, createMemoryStore } from '../../tala-core/src/sync/index.ts';
import { applyGenerationJob } from '../../tala-web/src/data/generation.ts';
import { syntheticAiFixture } from './synthetic-ai-fixture.mts';
import guardHelper from './production-guard.cjs';
import digestHelper from './record-digest.cjs';
const { recordDigest } = digestHelper;
const at = '2026-11-28T00:00:00.000Z';
const fixture = syntheticAiFixture('ephemeral');
let pushed: any[] = [];
const transport = {
  push: async (body: any) => {
    pushed.push(...structuredClone(body.mutations));
    return { results: body.mutations.map((m: any) => ({ mutationId: m.mutationId, status: 'applied',
      record: { entity: m.entity, id: m.id, ownerId: 'offline-synthetic-owner', rev: m.baseRev + 1, updatedAt: at, deletedAt: null, data: m.data } })) };
  },
  pull: async () => ({ records: [], cursor: 'offline-control', hasMore: false, serverTime: at }),
};
const engine = createSyncEngine({ store: createMemoryStore(), transport, deviceId: randomUUID(), now: () => new Date(at), newId: randomUUID });
await engine.batch(fixture.changes);
assert.equal((await engine.sync()).ok, true);
assert.equal(pushed.length, 12);
pushed = [];
const content = fixture.sections.find(s => s.key === 'content')!;
const gen = { provider: 'offline-synthetic', model: 'fixture-only', promptId: 'lesson/dlp', promptVersion: 1, curriculumVersion: null, at };
await applyGenerationJob(engine, fixture.plan, fixture.sections, {
  id: randomUUID(), kind: 'section', planId: fixture.plan.id, status: 'done', createdAt: at, finishedAt: at, failure: null,
  result: { title: fixture.plan.title, provider: gen.provider, model: gen.model, warnings: [],
    sections: [{ key: 'content', content: { type: 'text', blocks: [{ t: 'p', spans: [{ text: 'Offline control: roots absorb water; leaves make food using sunlight.' }] }] }, gen }] },
}, randomUUID, [content.id]);
assert.equal((await engine.sync()).ok, true);
assert.equal(pushed.length, 11, 'The real engine must send the unchanged section puts too');
assert.equal(pushed.filter(m => m.entity === 'plan_section').length, 9);
assert.equal(pushed.filter(m => m.entity === 'section_revision').length, 1);
assert.equal(pushed.filter(m => m.entity === 'plan').length, 1);
let before: any;
guardHelper.installProductionGuard({ session: { fromPartition: () => ({ webRequest: {
  onBeforeRequest: (_filter: unknown, fn: any) => { before = fn; }, onCompleted: () => {},
} }) } }, { base: 'https://fixture.invalid', native: false, email: 'offline@example.com' });
Object.assign((globalThis as any).__productionCheck, { planId: fixture.plan.id, sections: 1,
  sectionIds: fixture.sections.map(s => s.id), contentSectionId: content.id,
  sectionDigests: Object.fromEntries(fixture.sections.map(s => [s.id, recordDigest(s)])),
  revisionContentDigest: recordDigest({ content: content.content, origin: content.origin, gen: content.gen }),
  appliedPlanDigest: recordDigest(Plan.parse({ ...fixture.plan, aiDraft: true, aiAssisted: true })) });
let accepted = false;
before({ url: 'https://fixture.invalid/api/v1/sync/push', method: 'POST',
  uploadData: [{ bytes: Buffer.from(JSON.stringify({ mutations: pushed })) }] }, (r: any) => { accepted = !r.cancel; });
assert.equal(accepted, true, 'The strict guard must accept the actual sync payload');
for (const section of fixture.sections.filter(s => s.id !== content.id)) {
  assert.equal(recordDigest(pushed.find(m => m.id === section.id).data), recordDigest(section));
}
// Resume links the existing standalone id; no replacement plan or section is seeded.
const owner = syntheticAiFixture('owner');
const standalone = Plan.parse({ ...owner.plan, placements: [], gradeGroupIds: [] });
const resumed = Plan.parse({ ...standalone, placements: [{ classId: owner.cls.id, assignmentId: null, dates: [] }],
  gradeGroupIds: owner.cls.gradeGroups.map(g => g.id) });
assert.equal(resumed.id, standalone.id);
assert.equal(recordDigest({ ...resumed, placements: [], gradeGroupIds: [] }), recordDigest(standalone));
console.log(JSON.stringify({ scope: 'OFFLINE; synthetic model result and transport', freshSeedRecords: 12,
  rewriteMutationCounts: { plan: 1, plan_section: 9, section_revision: 1 }, unchangedSectionDigests: 8,
  strictGuardAccepted: accepted, ownerResumePreservesPlanId: true }));
