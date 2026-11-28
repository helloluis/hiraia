// Synthetic classroom and a two-slide PowerPoint. Uses the unmodified Tala source
// and a verified local API. No teaching library, production database or AI calls.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTalaClient } from '../../tala-core/src/contracts/index.ts';
import { createSyncEngine, createMemoryStore } from '../../tala-core/src/sync/index.ts';
import { layoutDeck } from '../../tala-core/src/decks/index.ts';
import { newPlan, defaultTemplateFor } from '../../tala-web/src/data/plans.ts';
import { writeDeckPptx } from '../../tala-server/src/modules/decks/pptx-write.ts';

const [base, dir, nonce] = process.argv.slice(2);
assert.match(base!, /^http:\/\/127\.0\.0\.1:\d+$/);
const health = await (await fetch(base + '/api/v1/health')).json();
assert.equal(health.environment, 'local');
assert.ok(health.version.endsWith(nonce));
const account = JSON.parse(readFileSync(join(dir!, 'account.json'), 'utf8'));
assert.match(account.email, /^teacher\.lessonwalk\..+@example\.com$/);
let cookie = '';
const client = createTalaClient({ baseUrl: base!, validateResponses: false,
  fetch: async (input, init) => {
    const request = new Request(input, init);
    assert.equal(new URL(request.url).origin, base);
    if (cookie) request.headers.set('cookie', cookie);
    const response = await fetch(request);
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0]!;
    return response;
  },
});
await client.call('auth.login', { body: { email: account.email, password: account.password, deviceLabel: 'local desktop fixture' } });
const newId = () => randomUUID();
const engine = createSyncEngine({ store: createMemoryStore(), transport: client.syncTransport, deviceId: newId(), now: () => new Date(), newId });
for (let n = 0; n < 6; n++) await engine.sync();
const year = (await engine.list('school_year'))[0]!.data;
const date = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const cls = { id: newId(), schoolYearId: year.id, name: 'Grades 4 and 5 (synthetic desktop test)', curriculum: 'deped' as const,
  gradeGroups: ['4', '5'].map(grade => ({ id: newId(), grade, learnerCount: 10 })), languages: ['en' as const],
  profile: { materials: ['paper'], textbooks: [], electricity: true, projector: true, printing: true, outdoorSpace: true, notes: '' }, isSample: false, archived: false };
const assignment = { id: newId(), classId: cls.id, learningAreaId: 'science', subjectName: 'Science',
  gradeGroupIds: cls.gradeGroups.map(g => g.id), language: 'en' as const,
  slots: [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ id: newId(), weekday, startTime: '08:00', minutes: 50, rotation: null })) };
await engine.put('class', cls);
await engine.put('assignment', assignment);
const sourcePlans = [];
for (const group of cls.gradeGroups) {
  const one = { ...assignment, gradeGroupIds: [group.id] };
  const { plan, sections } = newPlan({ template: defaultTemplateFor(cls, one), cls, assignment: one, dates: [date], language: 'en', newId,
    title: `Grade ${group.grade}: observe a plant (synthetic)` });
  plan.customObjectives = ['Describe the visible parts of a plant.'];
  for (const section of sections) {
    if (section.content.type === 'list') section.content = { type: 'list', items: ['Paper and pencils'] };
  }
  await engine.batch([{ op: 'put', entity: 'plan', data: plan }, ...sections.map(data => ({ op: 'put' as const, entity: 'plan_section' as const, data }))]);
  sourcePlans.push(plan.id);
}
for (let n = 0; n < 20 && (await engine.status()).pending; n++) await engine.sync();
assert.equal((await engine.status()).pending, 0);

const slides = [
  { id: 'synthetic-title', day: 1, kind: 'cover' as const, title: 'Synthetic plant lesson', lines: ['Desktop upload fixture'] },
  { id: 'synthetic-content', day: 1, kind: 'concept' as const, title: 'Observe a plant', lines: ['Look at the leaves.', 'Draw what you see.'] },
].map(s => ({ ...s, choices: [], revealOf: null, correctChoice: null, image: null, notes: 'Synthetic classroom notes.' }));
const layout = layoutDeck({ language: 'en', grade: '4', term: 1, week: 1, approved: false, reviewer: null, sourcesLine: '', personalCopy: false, slides });
const pptx = writeDeckPptx({ title: 'Synthetic desktop upload', language: 'en', slides: layout, drawings: new Map(), createdAt: '2026-11-28T00:00:00Z', modifiedAt: '2026-11-28T00:00:00Z' });
writeFileSync(join(dir!, 'synthetic.pptx'), pptx);
writeFileSync(join(dir!, 'features.json'), JSON.stringify({ classId: cls.id, assignmentId: assignment.id, date, sourcePlans }));
console.log('Synthetic local multigrade lessons and PowerPoint fixture ready.');
