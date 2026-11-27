import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeckSlide, LessonPresentation, Plan, PlanSection, SlidesJob } from '@hiraia/tala-core';
import { buildCombinedPlan, gradeLessonFromPlan } from '@hiraia/tala-core/plan';
import { fixtureClass, fixtureIds, packLikePlan } from '../../../../tala-core/src/plan/combine-fixtures';
import { createFakeLlm, createTestServer, type FakeLlm, type TestServer, type TestUser } from '../../testing';
import type { LlmGateway, LlmRequest, ServerModule } from '../../kernel/types';
import { createLlmGateway, llmModule, type ProviderCall } from '../llm';
import { createPacksModule } from '../packs';
import { createDecksModule } from './index';
import { slideParts, xmlUnescape } from './pptx-read';
import { libraryFixture, SAMPLE_PACKS } from './testing';
import type { LibraryFixture } from './testing';
import { readZip } from './zip';

const PACK = SAMPLE_PACKS[0] ?? '';
const skip = SAMPLE_PACKS.length < 2;

interface World {
  fx: LibraryFixture;
  t: TestServer;
  close(): void;
}
function world(opts: { llm?: LlmGateway; modules?: ServerModule[]; config?: Parameters<typeof createTestServer>[0] extends infer O ? (O extends { config?: infer C } ? C : never) : never } = {}): World {
  const fx = libraryFixture([
    { packId: PACK, lang: 'en' },
    { packId: PACK, lang: 'fil' },
  ]);
  const t = createTestServer({
    modules: [...(opts.modules ?? []), createPacksModule(fx.options), createDecksModule(fx.options)],
    ...(opts.llm ? { services: { llm: opts.llm } } : {}),
    ...(opts.config ? { config: opts.config } : {}),
    quiet: true,
  });
  return {
    fx,
    t,
    close() {
      t.close();
      fx.cleanup();
    },
  };
}

/** A model answer for a lesson's slides (words only; ids and answer slides are the server's). */
const aiDeck = (picture: string | null = null, title = 'Roots hold the plant') => ({
  slides: [
    { kind: 'question', title: 'What do roots do?', lines: ['Think of a plant at home.'], choices: [], answer: null, explanation: '', notes: 'Ask two learners.', picture: null },
    { kind: 'concept', title, lines: ['Roots hold the plant in the soil.', 'Roots take in water.'], choices: [], answer: null, explanation: '', notes: 'Point to the drawing.', picture },
    { kind: 'activity', title: 'Look at a plant', lines: ['Pull out a weed gently.', 'Draw its roots.'], choices: [], answer: null, explanation: '', notes: 'Five minutes.', picture: 'not-a-real-drawing' },
    { kind: 'check', title: 'Quick check', lines: ['What do roots take in?'], choices: ['Water', 'Light'], answer: 0, explanation: 'Roots take in water from the soil.', notes: '', picture: null },
    { kind: 'summary', title: 'Remember', lines: ['Roots hold the plant and take in water.'], choices: [], answer: null, explanation: '', notes: '', picture: null },
  ],
});
const aiSlide = (kind = 'concept', title = 'Roots drink water') => ({
  slide: { kind, title, lines: ['Roots take in water from the soil.'], choices: [], answer: null, explanation: '', notes: 'Ask: where does the water go?', picture: null },
});

/** One teacher's lesson, saved through the records service like a sync from her device would save it. */
function seedLesson(t: TestServer, user: TestUser, over: Partial<Plan> = {}, grade: '4' | '5' = '4', groupId = 'group001') {
  const { plan, sections } = packLikePlan({ grade, groupId, topic: 'Plant roots', lang: 'en', newId: fixtureIds(`${user.id.slice(0, 6)}${groupId}${Math.random().toString(36).slice(2, 7)}`) });
  const p = { ...plan, ...over };
  t.services.records.put(user.id, 'plan', p);
  const own = sections.map((s) => ({ ...s, planId: p.id }));
  for (const s of own) t.services.records.put(user.id, 'plan_section', s);
  return { plan: p, sections: own };
}
const putSection = (t: TestServer, user: TestUser, s: PlanSection) => t.services.records.put(user.id, 'plan_section', s);

async function settled(t: TestServer, user: TestUser, planId: string, jobId: string): Promise<SlidesJob> {
  for (let i = 0; i < 400; i++) {
    const job = await t.ok('decks.ai.get', { params: { planId, jobId }, token: user.token });
    if (job.status !== 'queued' && job.status !== 'running') return job;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail('The AI request did not finish.');
}
const present = (t: TestServer, user: TestUser, planId: string) => t.ok('decks.lesson.get', { params: { planId }, token: user.token });
const link = (t: TestServer, user: TestUser, planId: string, day = 2) =>
  t.ok('decks.lesson.link', { params: { planId }, body: { packId: PACK, lang: 'en', day }, token: user.token });
const ask = (t: TestServer, user: TestUser, planId: string, body: { scope: 'new' | 'lesson' | 'slide'; slideId?: string; instruction?: string }) =>
  t.call('decks.ai.start', { params: { planId }, body, token: user.token });
const textOf = (pptx: ArrayBuffer) => {
  const zip = readZip(new Uint8Array(pptx));
  return slideParts(zip).map((part) =>
    (zip.text(part).match(/<a:t>([^<]*)<\/a:t>/g) ?? []).map((x) => xmlUnescape(x.slice(5, -6))).join(' ')
  );
};

test('every lesson presentation route needs a session', { skip }, async () => {
  const w = world();
  try {
    const paths: Array<[string, string, unknown?]> = [
      ['GET', '/plans/p1/presentation'],
      ['POST', '/plans/p1/presentation', { packId: PACK, lang: 'en', day: 1 }],
      ['DELETE', '/plans/p1/presentation'],
      ['POST', '/plans/p1/presentation/checked'],
      ['PUT', '/plans/p1/presentation/sources/g1', { planId: null }],
      ['GET', '/plans/p1/presentation/pptx'],
      ['POST', '/plans/p1/presentation/ai', { scope: 'new' }],
      ['GET', '/plans/p1/presentation/ai/j1'],
      ['POST', '/plans/p1/presentation/ai/j1/apply', {}],
      ['POST', '/plans/p1/presentation/ai/j1/discard'],
      ['GET', '/decks/d1/revisions'],
      ['POST', '/decks/d1/revisions/r1/restore'],
    ];
    for (const [method, path, body] of paths) {
      const res = await w.t.request(method, path, body ? { body } : {});
      assert.equal(res.status, 401, `${method} ${path}`);
    }
  } finally {
    w.close();
  }
});

test('a pack lesson: its day’s slides, a stale cue when the saved lesson changes, nothing overwritten', { skip }, async () => {
  const w = world();
  try {
    const a = await w.t.registerUser();
    const { plan, sections } = seedLesson(w.t, a);
    const none = await present(w.t, a, plan.id);
    assert.equal(none.kind, 'lesson');
    assert.equal(none.slides, null);
    const p = await link(w.t, a, plan.id, 2);
    assert.equal(p.link?.day, 2);
    assert.equal(p.slides?.origin, 'pack');
    assert.deepEqual(p.slides?.days, [1, 2, 3, 4, 5]);
    // Only Day 2 and the credits slide are this lesson's; the copy itself holds the whole week.
    assert.ok(p.slides!.slides.every((s) => s.day === 2 || s.kind === 'credits'));
    assert.ok(p.slides!.slides.some((s) => s.kind === 'credits'));
    assert.ok(p.slides!.deckSlideCount > p.slides!.slides.length);
    assert.equal(p.stale, false);
    // Her copy is the same one the pack page opens ("My copy").
    const list = await w.t.ok('decks.list', { token: a.token });
    assert.deepEqual(list.decks.map((d) => d.id), [p.slides!.deckId]);
    const rev = p.slides!.rev;

    // After-class writing is not a change of the lesson.
    const reflection = sections.find((s) => s.key === 'reflection')!;
    putSection(w.t, a, { ...reflection, content: { type: 'text', blocks: [{ t: 'p', spans: [{ text: 'They loved it.' }] }] } });
    assert.equal((await present(w.t, a, plan.id)).stale, false);
    // She changes the procedure: the slides say so and stay exactly as they were.
    const proc = sections.find((s) => s.key === 'procedure')!;
    putSection(w.t, a, { ...proc, content: proc.content.type === 'procedure' ? { ...proc.content, steps: proc.content.steps.slice(0, 3) } : proc.content });
    const changed = await present(w.t, a, plan.id);
    assert.equal(changed.stale, true);
    assert.equal(changed.slides?.rev, rev);
    // "They still fit": the cue goes.
    const checked = await w.t.ok('decks.lesson.checked', { params: { planId: plan.id }, token: a.token });
    assert.equal(checked.stale, false);
    // Another day of the same copy.
    const day3 = await link(w.t, a, plan.id, 3);
    assert.equal(day3.slides?.deckId, p.slides?.deckId);
    assert.ok(day3.slides!.slides.every((s) => s.day === 3 || s.kind === 'credits'));
    const noDay = await w.t.call('decks.lesson.link', { params: { planId: plan.id }, body: { packId: 'sci26-g9-t1-w01', lang: 'en', day: 1 }, token: a.token });
    assert.equal(noDay.status, 404);
    // The lesson's download holds only its day.
    const pptx = await w.t.ok('decks.lesson.pptx', { params: { planId: plan.id }, token: a.token });
    assert.equal(textOf(pptx).length, day3.slides!.slides.length);
  } finally {
    w.close();
  }
});

test('slides made with AI from a lesson without a pack: a proposal first, nothing written until she applies it', { skip }, async () => {
  const llm = createFakeLlm({ answers: { 'slides.generate': aiDeck() } });
  const w = world({ llm });
  try {
    const a = await w.t.registerUser();
    const { plan, sections } = seedLesson(w.t, a, { subjectName: 'English', learningAreaId: 'english', lineage: null, title: 'Naming words' });
    const reflection = sections.find((s) => s.key === 'reflection')!;
    putSection(w.t, a, { ...reflection, content: { type: 'text', blocks: [{ t: 'p', spans: [{ text: 'PRIVATE REFLECTION' }] }] } });
    const started = await ask(w.t, a, plan.id, { scope: 'new', instruction: 'Use simple words.' });
    assert.equal(started.ok, true);
    const job = await settled(w.t, a, plan.id, started.data!.id);
    assert.equal(job.status, 'ready');
    // What the model got: the saved lesson (its steps, objectives, language), the teacher's words, no reflection.
    assert.equal(llm.calls.length, 1);
    const call = llm.calls[0]!;
    assert.equal(call.feature, 'slides.generate');
    assert.equal(call.promptId, 'slides/deck');
    const sent = JSON.parse(call.vars.lesson!) as { language: string; lesson: { objectives: string[]; procedure: unknown[] } };
    assert.equal(sent.language, 'en');
    assert.equal(sent.lesson.procedure.length, 5);
    assert.ok(sent.lesson.objectives[0]!.includes('plant roots'));
    assert.ok(!JSON.stringify(call.vars).includes('PRIVATE REFLECTION'));
    assert.equal(call.vars.instruction, 'Use simple words.');
    // The proposal: a cover, the five slides, the check followed by its answer slide; no invented picture.
    const slides = job.proposal!.slides;
    assert.deepEqual(slides.map((s) => s.kind), ['cover', 'question', 'concept', 'activity', 'check', 'reveal', 'summary']);
    assert.equal(slides[0]!.title, 'Naming words');
    const reveal = slides.find((s) => s.kind === 'reveal')!;
    assert.equal(reveal.revealOf, slides.find((s) => s.kind === 'check')!.id);
    assert.equal(reveal.correctChoice, 0);
    assert.ok(slides.every((s) => s.image === null));
    assert.ok(slides.every((s) => /^n[a-z0-9]{8}$/.test(s.id)));
    // Nothing written yet.
    const before = await present(w.t, a, plan.id);
    assert.equal(before.slides, null);
    assert.equal(before.job?.status, 'ready');
    // Apply: her lesson's own deck, linked, not stale.
    const applied = await w.t.ok('decks.ai.apply', { params: { planId: plan.id, jobId: job.id }, body: {}, token: a.token });
    assert.equal(applied.slides?.origin, 'lesson');
    assert.equal(applied.slides?.subject, 'English');
    assert.equal(applied.slides?.slides.length, 7);
    assert.equal(applied.stale, false);
    assert.equal(applied.job, null);
    // Applying again changes nothing (a double tap).
    const again = await w.t.ok('decks.ai.apply', { params: { planId: plan.id, jobId: job.id }, body: {}, token: a.token });
    assert.equal(again.slides?.deckId, applied.slides?.deckId);
    // It is not one of her pack copies, and it opens, edits and downloads like one.
    assert.deepEqual((await w.t.ok('decks.list', { token: a.token })).decks, []);
    const detail = await w.t.ok('decks.get', { params: { deckId: applied.slides!.deckId }, token: a.token });
    assert.equal(detail.deck.origin, 'lesson');
    assert.equal(detail.original.available, false);
    const pptx = await w.t.ok('decks.pptx', { params: { deckId: applied.slides!.deckId }, token: a.token });
    assert.ok(textOf(pptx).join(' ').includes('Roots hold the plant'));
    assert.ok(textOf(pptx)[0]!.includes('DRAFT — made with AI from the lesson plan'));
    // There is no library original to start over from.
    const reset = await w.t.call('decks.reset', { params: { deckId: applied.slides!.deckId }, token: a.token });
    assert.equal(reset.status, 404);
    // New slides for a lesson that has some: refused, nothing asked.
    const twice = await ask(w.t, a, plan.id, { scope: 'new' });
    assert.equal(twice.status, 409);
    assert.equal(llm.calls.length, 1);
  } finally {
    w.close();
  }
});

test('one request at a time per lesson: asking again while one is being worked on answers that one', { skip }, async () => {
  const fake = createFakeLlm({ answers: { 'slides.generate': aiDeck() } });
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const llm: LlmGateway = { routeFor: fake.routeFor, complete: async (req) => (await gate, fake.complete(req)) };
  const w = world({ llm });
  try {
    const a = await w.t.registerUser();
    const { plan } = seedLesson(w.t, a, { lineage: null });
    const one = await ask(w.t, a, plan.id, { scope: 'new' });
    await new Promise((r) => setTimeout(r, 20));
    const two = await ask(w.t, a, plan.id, { scope: 'new' });
    assert.equal(two.data?.id, one.data?.id);
    assert.ok(two.data?.status === 'running' || two.data?.status === 'queued');
    release();
    const done = await settled(w.t, a, plan.id, one.data!.id);
    assert.equal(done.status, 'ready');
    assert.equal(fake.calls.length, 1);
  } finally {
    release();
    w.close();
  }
});

test('rewrite one slide: the proposal replaces only it, applying keeps an earlier version, restoring brings it back', { skip }, async () => {
  const llm = createFakeLlm({ answers: { 'slides.rewrite': aiSlide() } });
  const w = world({ llm });
  try {
    const a = await w.t.registerUser();
    const { plan } = seedLesson(w.t, a);
    const p = await link(w.t, a, plan.id, 2);
    const target = p.slides!.slides.find((s) => s.kind === 'concept')!;
    const started = await ask(w.t, a, plan.id, { scope: 'slide', slideId: target.id });
    const job = await settled(w.t, a, plan.id, started.data!.id);
    assert.equal(job.status, 'ready');
    assert.equal(llm.calls[0]!.feature, 'slides.rewrite');
    const sent = JSON.parse(llm.calls[0]!.vars.slide!) as { slide: { kind: string; title: string }; pictures: unknown[] };
    assert.equal(sent.slide.title, target.title);
    assert.ok(sent.pictures.length > 0, 'the deck’s own drawings are offered');
    assert.deepEqual(job.proposal!.replaces, [target.id]);
    assert.equal(job.proposal!.slides[0]!.id, target.id);
    assert.equal(job.proposal!.slides[0]!.title, 'Roots drink water');
    const deckId = p.slides!.deckId;
    const before = await w.t.ok('decks.get', { params: { deckId }, token: a.token });
    await w.t.ok('decks.ai.apply', { params: { planId: plan.id, jobId: job.id }, body: {}, token: a.token });
    const after = await w.t.ok('decks.get', { params: { deckId }, token: a.token });
    assert.equal(after.deck.rev, before.deck.rev + 1);
    assert.equal(after.deck.slides.find((s) => s.id === target.id)!.title, 'Roots drink water');
    // Every other slide is as it was.
    const others = (d: typeof before) => JSON.stringify(d.deck.slides.filter((s) => s.id !== target.id));
    assert.equal(others(after), others(before));
    const revs = await w.t.ok('decks.revisions', { params: { deckId }, token: a.token });
    assert.deepEqual(revs.revisions.map((r) => r.reason), ['ai']);
    const restored = await w.t.ok('decks.restore', { params: { deckId, revisionId: revs.revisions[0]!.id }, token: a.token });
    assert.equal(JSON.stringify(restored.deck.slides), JSON.stringify(before.deck.slides));
    // Putting a version back is undoable too.
    const revs2 = await w.t.ok('decks.revisions', { params: { deckId }, token: a.token });
    assert.deepEqual(revs2.revisions.map((r) => r.reason), ['restore', 'ai']);
    const redo = await w.t.ok('decks.restore', { params: { deckId, revisionId: revs2.revisions[0]!.id }, token: a.token });
    assert.equal(redo.deck.slides.find((s) => s.id === target.id)!.title, 'Roots drink water');
    // Cover, day openers and credits are not rewritten.
    const credits = p.slides!.slides.find((s) => s.kind === 'credits')!;
    assert.equal((await ask(w.t, a, plan.id, { scope: 'slide', slideId: credits.id })).status, 400);
    // From the slide editor of another deck (the lesson uses this one): refused, nothing asked.
    const calls = llm.calls.length;
    const other = await w.t.call('decks.ai.start', { params: { planId: plan.id }, body: { scope: 'slide', slideId: target.id, deckId: 'some-other-deck' }, token: a.token });
    assert.equal(other.status, 409);
    assert.equal((other.error?.details as { reason: string }).reason, 'deck_not_linked');
    assert.equal(llm.calls.length, calls);
  } finally {
    w.close();
  }
});

test('rewrite all of a lesson’s slides on a pack copy: only that day’s slides change; the lesson matches again', { skip }, async () => {
  // The model answers with one of the drawings it was offered, and one it was not.
  const fake = createFakeLlm({
    answers: {
      'slides.generate': (req: LlmRequest<unknown>) => aiDeck((JSON.parse(req.vars.lesson!) as { pictures: Array<{ slug: string }> }).pictures[0]?.slug ?? null),
    },
  });
  const w = world({ llm: fake });
  try {
    const a = await w.t.registerUser();
    const { plan, sections } = seedLesson(w.t, a);
    const p = await link(w.t, a, plan.id, 2);
    const id = p.slides!.deckId;
    const proc = sections.find((s) => s.key === 'procedure')!;
    putSection(w.t, a, { ...proc, content: proc.content.type === 'procedure' ? { ...proc.content, steps: proc.content.steps.slice(0, 4) } : proc.content });
    assert.equal((await present(w.t, a, plan.id)).stale, true);
    const old = await w.t.ok('decks.get', { params: { deckId: id }, token: a.token });
    const started = await ask(w.t, a, plan.id, { scope: 'lesson' });
    const job = await settled(w.t, a, plan.id, started.data!.id);
    assert.equal(job.status, 'ready', JSON.stringify(job.failure));
    const sent = JSON.parse(fake.calls[0]!.vars.lesson!) as { currentSlides: unknown[]; lesson: { procedure: unknown[] } };
    assert.ok(sent.currentSlides.length > 0, 'the slides being rewritten are given');
    assert.equal(sent.lesson.procedure.length, 4, 'the lesson as saved now');
    // A whole week copy and no day chosen: the teacher must say which day is the lesson's first.
    await w.t.ok('decks.ai.apply', { params: { planId: plan.id, jobId: job.id }, body: {}, token: a.token });
    const after = await w.t.ok('decks.get', { params: { deckId: id }, token: a.token });
    const notDay2 = (d: typeof old) => JSON.stringify(d.deck.slides.filter((s) => s.day !== 2 || s.kind === 'day'));
    assert.equal(notDay2(after), notDay2(old), 'other days, the day opener and the credits stay');
    const day2 = after.deck.slides.filter((s) => s.day === 2 && s.kind !== 'day');
    assert.deepEqual(day2.map((s) => s.kind), ['question', 'concept', 'activity', 'check', 'reveal', 'summary']);
    assert.equal(day2[1]!.image?.slug, p.slides!.media[0]!.slug);
    assert.equal(day2[2]!.image, null, 'a drawing the deck does not have is dropped');
    // The base stays the Hiraia original, so the credits say the copy was edited by its teacher.
    assert.equal(JSON.stringify(after.baseSlides), JSON.stringify(old.baseSlides));
    assert.equal((await present(w.t, a, plan.id)).stale, false);
    assert.equal((await w.t.ok('decks.revisions', { params: { deckId: id }, token: a.token })).revisions.length, 1);
    // A whole-week link (no day): rewriting "all" would replace five days, so she is asked to choose a day.
    await link(w.t, a, plan.id, 0);
    const noDay = await ask(w.t, a, plan.id, { scope: 'lesson' });
    assert.equal(noDay.status, 400);
    assert.equal((noDay.error?.details as { reason: string }).reason, 'choose_day');
  } finally {
    w.close();
  }
});

test('a proposal is not applied over slides changed after it was made, unless she says so', { skip }, async () => {
  const llm = createFakeLlm({ answers: { 'slides.rewrite': aiSlide() } });
  const w = world({ llm });
  try {
    const a = await w.t.registerUser();
    const { plan } = seedLesson(w.t, a);
    const p = await link(w.t, a, plan.id, 2);
    const target = p.slides!.slides.find((s) => s.kind === 'concept')!;
    const job = await settled(w.t, a, plan.id, (await ask(w.t, a, plan.id, { scope: 'slide', slideId: target.id })).data!.id);
    const d = await w.t.ok('decks.get', { params: { deckId: p.slides!.deckId }, token: a.token });
    const edited = d.deck.slides.map((s) => (s.id === target.id ? { ...s, title: 'My own words' } : s));
    await w.t.ok('decks.save', { params: { deckId: d.deck.id }, body: { baseRev: d.deck.rev, slides: edited }, token: a.token });
    const refused = await w.t.call('decks.ai.apply', { params: { planId: plan.id, jobId: job.id }, body: {}, token: a.token });
    assert.equal(refused.status, 409);
    assert.equal((refused.error?.details as { reason: string }).reason, 'slides_changed');
    const kept = await w.t.ok('decks.get', { params: { deckId: d.deck.id }, token: a.token });
    assert.equal(kept.deck.slides.find((s) => s.id === target.id)!.title, 'My own words');
    // Another slide changing does not matter; she can still choose the suggestion over her words.
    await w.t.ok('decks.ai.apply', { params: { planId: plan.id, jobId: job.id }, body: { force: true }, token: a.token });
    const forced = await w.t.ok('decks.get', { params: { deckId: d.deck.id }, token: a.token });
    assert.equal(forced.deck.slides.find((s) => s.id === target.id)!.title, 'Roots drink water');
    const revs = await w.t.ok('decks.revisions', { params: { deckId: d.deck.id }, token: a.token });
    assert.equal(revs.revisions.length, 1);
    const back = await w.t.ok('decks.restore', { params: { deckId: d.deck.id, revisionId: revs.revisions[0]!.id }, token: a.token });
    assert.equal(back.deck.slides.find((s) => s.id === target.id)!.title, 'My own words', 'her own words can be put back');
  } finally {
    w.close();
  }
});

test('failures say why and leave the slides as they were: empty or unusable answer, no provider, switched off, empty lesson', { skip }, async () => {
  const llm = createFakeLlm({ answers: { 'slides.generate': { slides: [] }, 'slides.rewrite': () => { throw new Error('down'); } } });
  const w = world({ llm });
  try {
    const a = await w.t.registerUser();
    const { plan } = seedLesson(w.t, a, { lineage: null });
    const empty = await settled(w.t, a, plan.id, (await ask(w.t, a, plan.id, { scope: 'new' })).data!.id);
    assert.equal(empty.status, 'failed');
    assert.equal(empty.failure?.reason, 'invalid_output');
    assert.equal(empty.proposal, null);
    const shown = await present(w.t, a, plan.id);
    assert.equal(shown.slides, null);
    assert.equal(shown.job?.failure?.reason, 'invalid_output', 'a reload still says what happened');
    // A broken answer (no check answer) is unusable too.
    llm.answer('slides.generate', { slides: aiDeck().slides.map((s) => (s.kind === 'check' ? { ...s, answer: 5 } : s)) });
    const broken = await settled(w.t, a, plan.id, (await ask(w.t, a, plan.id, { scope: 'new' })).data!.id);
    assert.equal(broken.failure?.reason, 'invalid_output');
    // Retry works once the model answers well.
    llm.answer('slides.generate', aiDeck());
    const ok = await settled(w.t, a, plan.id, (await ask(w.t, a, plan.id, { scope: 'new' })).data!.id);
    assert.equal(ok.status, 'ready');
    await w.t.ok('decks.ai.apply', { params: { planId: plan.id, jobId: ok.id }, body: {}, token: a.token });
    const deck = (await present(w.t, a, plan.id)).slides!;
    // No provider for one slide: failed, deck untouched.
    const down = await settled(w.t, a, plan.id, (await ask(w.t, a, plan.id, { scope: 'slide', slideId: deck.slides[2]!.id })).data!.id);
    assert.equal(down.failure?.reason, 'providers_unavailable');
    const after = (await present(w.t, a, plan.id)).slides!;
    assert.equal(after.rev, deck.rev);
    assert.equal(JSON.stringify(after.slides), JSON.stringify(deck.slides));
    // A dismissed failure is no longer shown.
    await w.t.ok('decks.ai.discard', { params: { planId: plan.id, jobId: down.id }, token: a.token });
    assert.equal((await present(w.t, a, plan.id)).job, null);
    // An empty lesson: refused before anything is asked.
    const calls = llm.calls.length;
    const blank = seedLesson(w.t, a, { lineage: null, customObjectives: [] });
    for (const s of blank.sections)
      putSection(w.t, a, { ...s, content: s.content.type === 'procedure' ? { type: 'procedure', steps: [] } : s.content.type === 'list' ? { type: 'list', items: [] } : { type: 'text', blocks: [] } });
    const refused = await ask(w.t, a, blank.plan.id, { scope: 'new' });
    assert.equal(refused.status, 400);
    assert.equal((refused.error?.details as { reason: string }).reason, 'empty_lesson');
    assert.equal(llm.calls.length, calls);
  } finally {
    w.close();
  }
  // Switched off for slides: the model is never called.
  const off = createFakeLlm({ routes: { 'slides.generate': 'off' }, answers: { 'slides.generate': aiDeck() } });
  const v = world({ llm: off });
  try {
    const b = await v.t.registerUser();
    const { plan } = seedLesson(v.t, b, { lineage: null });
    const job = await settled(v.t, b, plan.id, (await ask(v.t, b, plan.id, { scope: 'new' })).data!.id);
    assert.equal(job.failure?.reason, 'disabled');
    assert.equal(off.calls.length, 0);
  } finally {
    v.close();
  }
  // Generation switched off on the server: refused at once.
  const z = world({ llm: createFakeLlm({ answers: { 'slides.generate': aiDeck() } }), config: { features: { generation: false } } });
  try {
    const c = await z.t.registerUser();
    const { plan } = seedLesson(z.t, c, { lineage: null });
    const res = await ask(z.t, c, plan.id, { scope: 'new' });
    assert.equal(res.status, 503);
  } finally {
    z.close();
  }
});

test('AI slides count against the teacher’s daily allowance: a lesson’s slides as full, one slide as section', { skip }, async () => {
  let calls = 0;
  const provider: ProviderCall = async (_p, _c, prompt) => {
    calls++;
    const content = prompt.includes('You rewrite ONE classroom slide') ? JSON.stringify(aiSlide()) : JSON.stringify(aiDeck());
    return { content, inputTokens: 100, outputTokens: 200, costUsd: 0.0001 };
  };
  const gatewayModule: ServerModule = { ...llmModule, services: (deps) => ({ llm: createLlmGateway(deps, { call: provider }) }) };
  const w = world({ modules: [gatewayModule], config: { llm: { quotas: { fullPerDay: 1, sectionPerDay: 1 }, cacheSeconds: 0 } } });
  try {
    const a = await w.t.registerUser();
    const one = seedLesson(w.t, a, { lineage: null });
    const first = await settled(w.t, a, one.plan.id, (await ask(w.t, a, one.plan.id, { scope: 'new' })).data!.id);
    assert.equal(first.status, 'ready', JSON.stringify(first.failure));
    await w.t.ok('decks.ai.apply', { params: { planId: one.plan.id, jobId: first.id }, body: {}, token: a.token });
    const two = seedLesson(w.t, a, { lineage: null });
    const second = await settled(w.t, a, two.plan.id, (await ask(w.t, a, two.plan.id, { scope: 'new' })).data!.id);
    assert.equal(second.failure?.reason, 'quota_exceeded');
    assert.equal((await present(w.t, a, two.plan.id)).slides, null);
    // One slide is the other allowance.
    const deck = (await present(w.t, a, one.plan.id)).slides!;
    const slide = await settled(w.t, a, one.plan.id, (await ask(w.t, a, one.plan.id, { scope: 'slide', slideId: deck.slides[2]!.id })).data!.id);
    assert.equal(slide.status, 'ready', JSON.stringify(slide.failure));
    const third = await settled(w.t, a, one.plan.id, (await ask(w.t, a, one.plan.id, { scope: 'slide', slideId: deck.slides[2]!.id })).data!.id);
    assert.equal(third.failure?.reason, 'quota_exceeded');
    assert.equal(calls, 2);
    const used = w.t.db.prepare('SELECT bucket, used FROM llm_quota WHERE user_id = ? ORDER BY bucket').all(a.id) as Array<{ bucket: string; used: number }>;
    assert.deepEqual(used, [{ bucket: 'full', used: 1 }, { bucket: 'section', used: 1 }]);
  } finally {
    w.close();
  }
});

test('a multi-grade session: each grade’s own lesson and slides, her choice of lesson, the download in block order', { skip }, async () => {
  const w = world();
  try {
    const a = await w.t.registerUser();
    const ids = fixtureIds('mg');
    const cls = fixtureClass(['4', '5']);
    const g4 = seedLesson(w.t, a, { id: 'g4lesson' }, '4', 'group001');
    const g5 = seedLesson(w.t, a, { id: 'g5lesson', title: 'Day 2: Weather', lineage: null }, '5', 'group002');
    const session = buildCombinedPlan({
      cls,
      assignment: { id: 'assign01', subjectName: 'Science', learningAreaId: 'science' },
      lessons: [g4, g5].map((l, i) => gradeLessonFromPlan({ plan: l.plan, sections: l.sections, groupId: `group00${i + 1}`, grade: l.plan.grades[0]! })),
      date: '2026-11-24',
      minutes: 60,
      language: 'en',
      newId: ids,
    });
    w.t.services.records.put(a.id, 'plan', session.plan);
    for (const s of session.sections) w.t.services.records.put(a.id, 'plan_section', s);
    await link(w.t, a, g4.plan.id, 2);
    const p = await present(w.t, a, session.plan.id);
    assert.equal(p.kind, 'session');
    assert.deepEqual(p.parts.map((x) => [x.grade, x.source?.planId, x.source?.chosen, Boolean(x.slides)]), [
      ['4', 'g4lesson', 'auto', true],
      ['5', 'g5lesson', 'auto', false],
    ]);
    // A session has no deck of its own: no AI on it, no pack link.
    assert.equal((await ask(w.t, a, session.plan.id, { scope: 'new' })).status, 400);
    // The download: put together now, in the session's blocks, every slide labelled with its grade.
    const pages = textOf(await w.t.ok('decks.lesson.pptx', { params: { planId: session.plan.id }, token: a.token }));
    const find = (needle: string) => pages.findIndex((x) => x.includes(needle));
    const turn4 = find('Grade 4 with the teacher');
    const turn5 = find('Grade 5 with the teacher');
    assert.ok(find('Start together') > 0 && find('Start together') < turn4 && turn4 < turn5 && turn5 < find('Finish together'), pages.map((x) => x.slice(0, 40)).join(' | '));
    assert.ok(pages[turn4 + 1]!.includes('Meanwhile, Grade 5'));
    assert.ok(pages.some((x, i) => i > turn5 && x.includes("No slides yet for Grade 5's lesson")));
    assert.ok(pages.slice(turn4 + 2, turn5).every((x) => x.includes('GRADE 4')), 'Grade 4’s slides carry their grade');
    assert.ok(pages[pages.length - 1]!.includes("About Grade 4's slides"));
    // She chooses another Grade 5 lesson; the part follows.
    const other = seedLesson(w.t, a, { id: 'g5other', title: 'Clouds', lineage: null, placements: [] }, '5', 'group002');
    const chosen = await w.t.ok('decks.lesson.source', { params: { planId: session.plan.id, groupId: 'group002' }, body: { planId: other.plan.id }, token: a.token });
    assert.deepEqual(chosen.parts[1]!.source, { planId: 'g5other', title: 'Clouds', chosen: 'teacher' });
    const back = await w.t.ok('decks.lesson.source', { params: { planId: session.plan.id, groupId: 'group002' }, body: { planId: null }, token: a.token });
    assert.equal(back.parts[1]!.source?.planId, 'g5lesson');
    // A session cannot be a grade's lesson.
    assert.equal((await w.t.call('decks.lesson.source', { params: { planId: session.plan.id, groupId: 'group002' }, body: { planId: session.plan.id }, token: a.token })).status, 400);
    // The stale cue of a grade's lesson shows in its part.
    const proc = g4.sections.find((s) => s.key === 'procedure')!;
    putSection(w.t, a, { ...proc, content: proc.content.type === 'procedure' ? { ...proc.content, steps: proc.content.steps.slice(1) } : proc.content });
    assert.equal((await present(w.t, a, session.plan.id)).parts[0]!.stale, true);
  } finally {
    w.close();
  }
});

test('another teacher reaches none of it: plans, slides, requests, versions and sessions answer not found', { skip }, async () => {
  const llm = createFakeLlm({ answers: { 'slides.rewrite': aiSlide() } });
  const w = world({ llm });
  try {
    const a = await w.t.registerUser();
    const b = await w.t.registerUser();
    const { plan } = seedLesson(w.t, a);
    const p = await link(w.t, a, plan.id, 2);
    const slideId = p.slides!.slides.find((s) => s.kind === 'concept')!.id;
    const job = await settled(w.t, a, plan.id, (await ask(w.t, a, plan.id, { scope: 'slide', slideId })).data!.id);
    await w.t.ok('decks.ai.apply', { params: { planId: plan.id, jobId: job.id }, body: {}, token: a.token });
    const deckId = p.slides!.deckId;
    const revisionId = (await w.t.ok('decks.revisions', { params: { deckId }, token: a.token })).revisions[0]!.id;
    const calls = [
      await w.t.call('decks.lesson.get', { params: { planId: plan.id }, token: b.token }),
      await w.t.call('decks.lesson.link', { params: { planId: plan.id }, body: { packId: PACK, lang: 'en', day: 1 }, token: b.token }),
      await w.t.call('decks.lesson.unlink', { params: { planId: plan.id }, token: b.token }),
      await w.t.call('decks.lesson.checked', { params: { planId: plan.id }, token: b.token }),
      await w.t.call('decks.lesson.source', { params: { planId: plan.id, groupId: 'group001' }, body: { planId: null }, token: b.token }),
      await w.t.call('decks.lesson.pptx', { params: { planId: plan.id }, token: b.token }),
      await w.t.call('decks.ai.start', { params: { planId: plan.id }, body: { scope: 'lesson' }, token: b.token }),
      await w.t.call('decks.ai.get', { params: { planId: plan.id, jobId: job.id }, token: b.token }),
      await w.t.call('decks.ai.apply', { params: { planId: plan.id, jobId: job.id }, body: {}, token: b.token }),
      await w.t.call('decks.ai.discard', { params: { planId: plan.id, jobId: job.id }, token: b.token }),
      await w.t.call('decks.revisions', { params: { deckId }, token: b.token }),
      await w.t.call('decks.restore', { params: { deckId, revisionId }, token: b.token }),
    ];
    for (const [i, c] of calls.entries()) assert.equal(c.status, 404, `call ${i}`);
    // Her own plan with his job id: not found either.
    const mine = seedLesson(w.t, b);
    assert.equal((await w.t.call('decks.ai.get', { params: { planId: mine.plan.id, jobId: job.id }, token: b.token })).status, 404);
    // Nothing of hers changed.
    const still = await present(w.t, a, plan.id);
    assert.equal(still.slides?.deckId, deckId);
    assert.equal((await w.t.ok('decks.revisions', { params: { deckId }, token: a.token })).revisions.length, 1);
  } finally {
    w.close();
  }
});

test('stopping: a pack copy stays among her copies, slides made from a lesson go; a deleted deck or account takes it all', { skip }, async () => {
  const llm = createFakeLlm({ answers: { 'slides.generate': aiDeck() } });
  const w = world({ llm });
  try {
    const a = await w.t.registerUser();
    const packLesson = seedLesson(w.t, a);
    const p = await link(w.t, a, packLesson.plan.id, 2);
    await w.t.ok('decks.lesson.unlink', { params: { planId: packLesson.plan.id }, token: a.token });
    assert.equal((await present(w.t, a, packLesson.plan.id)).slides, null);
    assert.equal((await w.t.ok('decks.list', { token: a.token })).decks[0]?.id, p.slides!.deckId);
    // Start over on the copy keeps the copy as it was as an earlier version.
    await w.t.ok('decks.reset', { params: { deckId: p.slides!.deckId }, token: a.token });
    assert.deepEqual((await w.t.ok('decks.revisions', { params: { deckId: p.slides!.deckId }, token: a.token })).revisions.map((r) => r.reason), ['reset']);
    const own = seedLesson(w.t, a, { lineage: null });
    const job = await settled(w.t, a, own.plan.id, (await ask(w.t, a, own.plan.id, { scope: 'new' })).data!.id);
    const made = await w.t.ok('decks.ai.apply', { params: { planId: own.plan.id, jobId: job.id }, body: {}, token: a.token });
    await w.t.ok('decks.lesson.unlink', { params: { planId: own.plan.id }, token: a.token });
    assert.equal((await w.t.call('decks.get', { params: { deckId: made.slides!.deckId }, token: a.token })).status, 404);
    // Deleting a copy removes its link from the lesson.
    await link(w.t, a, packLesson.plan.id, 1);
    await w.t.ok('decks.delete', { params: { deckId: p.slides!.deckId }, token: a.token });
    assert.equal((await present(w.t, a, packLesson.plan.id)).link, null);
    assert.equal((w.t.db.prepare('SELECT COUNT(*) AS n FROM decks_revisions WHERE deck_id = ?').get(p.slides!.deckId) as { n: number }).n, 0);
    // The account goes: every table of hers is empty.
    await link(w.t, a, packLesson.plan.id, 1);
    await w.t.ok('account.delete', { body: { password: a.password, confirm: 'DELETE' }, token: a.token });
    for (const table of ['decks_plan_links', 'decks_revisions', 'decks_ai_jobs', 'decks_session_sources', 'decks_decks'])
      assert.equal((w.t.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE owner_id = ?`).get(a.id) as { n: number }).n, 0, table);
  } finally {
    w.close();
  }
});
