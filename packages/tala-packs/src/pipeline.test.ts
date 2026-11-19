import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { WeeklyPackContent } from '@hiraia/tala-core/contracts';
import { buildTargets, loadSciencePacks, targetId } from './targets';
import { CURRICULUM_PACKS, LIBRARY } from './paths';
import { DayOut, OutlineOut, dayChecks, normalizeDay, tidyCheckSlide, tidySlide } from './generate';
import { annotate, applyPatch, canonicalPath, expectMatches, parsePath, placeholderIn, preparePatch, retarget, splitSlideLine, stripIndex } from './review';
import { clampText, foldList, splitAtComma, splitOverContract } from './text';
import { checkPack, checkSameStructure } from './checks';
import { checkVerbiage } from './verbiage';
import { loadInputs } from './context';
import { BudgetExceeded, MODELS, Meter, isDeepSeekPeak, msUntilDeepSeekOffPeak, rateFactor } from './llm';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const targets = buildTargets(loadSciencePacks(CURRICULUM_PACKS));

test('every printed Science week from Grade 3 to 10 is a target, and nothing else', () => {
  assert.equal(targets.length, 262);
  assert.equal(new Set(targets.map((t) => t.targetId)).size, 262);
  for (const t of targets) assert.match(t.targetId, /^sci26-g(3|4|5|6|7|8|9|10)-t[1-3]-w\d{2}$/);
  // Grade 5 Term 1 and Grade 6 Term 2 end at week 10 as printed; no week 11 is invented.
  assert.equal(targets.filter((t) => t.grade === '5' && t.term === 1).length, 10);
  assert.equal(targets.filter((t) => t.grade === '6' && t.term === 2).length, 10);
  assert.equal(targets.filter((t) => t.grade === '4' && t.term === 1).length, 11);
  // Every one of the 322 competencies is taught in at least one week.
  const covered = new Set(targets.flatMap((t) => t.competencies.map((c) => c.id)));
  assert.equal(covered.size, 322);
});

test('overlapping DepEd week cells are kept as printed, with each competency positioned in its own range', () => {
  const t = targets.find((x) => x.targetId === targetId('7', 3, 3))!;
  assert.deepEqual(t.ranges, [
    { weekFrom: 1, weekTo: 4 },
    { weekFrom: 3, weekTo: 8 },
  ]);
  const heat = t.competencies.find((c) => c.weekFrom === 1)!;
  const quake = t.competencies.find((c) => c.weekFrom === 3)!;
  assert.equal(heat.position, 3);
  assert.equal(quake.position, 1);
});

test('competency text in a target is the stored record, verbatim', () => {
  const packs = loadSciencePacks(CURRICULUM_PACKS);
  const all = new Map(packs.flatMap((p) => p.competencies.map((c) => [c.id, c.text] as const)));
  for (const t of targets) for (const c of t.competencies) assert.equal(c.text, all.get(c.id));
});

test('day normaliser fixes mechanical slips and logs them, without touching content', () => {
  const art = new Map([['lungs-a', { titles: ['Lungs'] }]]);
  const raw = {
    day: 9,
    flow: [
      { phase: 'Activating Prior Knowledge', minutes: '5', teacher: 'T', learners: 'L', slideIds: ['x1'] },
      { phase: 'developing_understanding_1', minutes: 40, teacher: 'T', learners: 'L', slideIds: ['x3'] },
    ],
    slides: [
      { id: 'x1', kind: 'day', title: 'Day 2: Air', lines: ['Today: air'], notes: 'n' },
      { id: 'x2', kind: 'concept', title: 'Lungs', lines: ['a'], image: 'lungs-a', notes: 'n' },
      { id: 'x3', kind: 'concept', title: 'Gills', lines: ['b'], image: { slug: 'not-approved', alt: 'x' }, notes: 'n' },
    ],
  };
  const log: string[] = [];
  const out = normalizeDay(2, art)(raw, log) as any;
  assert.equal(out.day, 2);
  assert.deepEqual(out.slides.map((s: any) => s.id), ['d2s1', 'd2s2', 'd2s3']);
  assert.ok(out.slides.every((s: any) => s.day === 2));
  assert.equal(out.flow[0].phase, 'activating_prior_knowledge');
  assert.equal(out.flow[1].phase, 'developing_understanding');
  assert.equal(out.flow[0].minutes, 5);
  assert.deepEqual(out.slides[1].image, { slug: 'lungs-a', alt: 'Lungs' });
  assert.equal(out.slides[2].image, null, 'an image outside the approved candidates is removed');
  assert.deepEqual(out.flow.map((f: any) => f.slideIds), [['d2s1', 'd2s2'], ['d2s3']]);
  assert.equal(out.slides[1].title, 'Lungs', 'content is untouched');
  assert.ok(log.some((l) => l.includes('not an approved candidate')));
});

test('check slides keep their options in choices only, without letters', () => {
  const s = tidyCheckSlide({
    kind: 'check',
    title: 'Quick Check',
    lines: ['What do red blood cells carry?', 'A. Germs', 'B. Oxygen', 'C. Bones', 'D. Food'],
    choices: ['A', 'B', 'C', 'D'],
  });
  assert.equal(s.title, 'What do red blood cells carry?');
  assert.deepEqual(s.lines, []);
  assert.deepEqual(s.choices, ['Germs', 'Oxygen', 'Bones', 'Food']);
});

test('a day may end on an exit check without a reveal, but no other check may', () => {
  const base = (slides: any[]) =>
    DayOut.parse({
      day: 1,
      title: 'T',
      competencyIds: ['c1'],
      objective: 'o',
      minutes: 45,
      materials: [],
      flow: [
        { phase: 'activating_prior_knowledge', minutes: 5, teacher: 't', learners: 'l', slideIds: [slides[0].id] },
        { phase: 'lesson_purpose', minutes: 5, teacher: 't', learners: 'l', slideIds: [] },
        { phase: 'developing_understanding', minutes: 25, teacher: 't', learners: 'l', slideIds: slides.slice(1, -1).map((s) => s.id) },
        { phase: 'generalization', minutes: 5, teacher: 't', learners: 'l', slideIds: [] },
        { phase: 'evaluating_learning', minutes: 5, teacher: 't', learners: 'l', slideIds: [slides.at(-1).id] },
      ],
      check: { question: 'q', answer: 'a', why: 'w' },
      support: 's',
      extension: 'e',
      longerPeriod: 'l',
      slides,
    });
  const sl = (id: string, kind: string, extra: object = {}) => ({ id, day: 1, kind, title: 'x', lines: [], notes: 'n', ...extra });
  const ok = base([sl('d1s1', 'day'), sl('d1s2', 'check', { choices: ['a', 'b'] }), sl('d1s3', 'reveal', { revealOf: 'd1s2', correctChoice: 0 }), sl('d1s4', 'concept'), sl('d1s5', 'check')]);
  assert.deepEqual(dayChecks(1, new Set(), new Set(['c1']))(ok), []);
  const bad = base([sl('d1s1', 'day'), sl('d1s2', 'check'), sl('d1s3', 'concept'), sl('d1s4', 'check', { choices: ['a'] }), sl('d1s5', 'reveal', { revealOf: 'd1s4', correctChoice: 0 })]);
  assert.ok(dayChecks(1, new Set(), new Set(['c1']))(bad).some((e) => e.includes('must be followed by its reveal')));
});

test('assessment kind spellings are normalised before validation', () => {
  const parsed = OutlineOut.shape.assessment.element.parse({
    id: 'q1',
    kind: 'performance_task',
    prompt: 'p',
    answer: 'a',
    explanation: 'e',
    competencyId: 'c',
  });
  assert.equal(parsed.kind, 'performance');
});

test('patches are applied only where the reviser quoted the current value', () => {
  assert.deepEqual(parsePath('guide.vocabulary[9].meaning'), ['guide', 'vocabulary', 9, 'meaning']);
  const pack = { guide: { vocabulary: [{ term: 'Root system', meaning: 'All the roots of a plant' }, { term: 'Shoot system', meaning: 'Stems, leaves, flowers' }] } } as unknown as WeeklyPackContent;
  assert.equal(expectMatches(pack, 'guide.vocabulary[1].meaning', 'Stems, leaves'), true);
  assert.equal(expectMatches(pack, 'guide.vocabulary[1].meaning', 'All the roots'), false, 'wrong index is caught');
  assert.equal(expectMatches(pack, 'guide.vocabulary[1].meaning', undefined), false, 'a patch without a quote is refused');
  const next = applyPatch(pack, 'guide.vocabulary[1].meaning', 'Stems, leaves, flowers and fruits');
  assert.equal((next as any).guide.vocabulary[1].meaning, 'Stems, leaves, flowers and fruits');
  assert.equal((pack as any).guide.vocabulary[1].meaning, 'Stems, leaves, flowers', 'the original is not mutated');
  assert.throws(() => applyPatch(pack, 'competencies[0].text', 'x'), /not editable/);
  assert.throws(() => applyPatch(pack, 'guide.vocabulary[1].meaning', ['x']), /type/);
  // A picture is an object: quoting its slug (or its JSON) identifies it; a missing picture is quoted as null.
  const withImage = { slides: [{ image: { slug: 'breathing-in-out-diaphragm', alt: 'Ribs lift' } }, { image: null }] } as unknown as WeeklyPackContent;
  assert.equal(expectMatches(withImage, 'slides[0].image', 'breathing-in-out-diaphragm'), true);
  assert.equal(expectMatches(withImage, 'slides[0].image', '{"slug": "breathing-in-out-diaphragm", "alt": "Ribs lift"}'), true);
  assert.equal(expectMatches(withImage, 'slides[0].image', 'heart-pump'), false);
  assert.equal(expectMatches(withImage, 'slides[1].image', null), true);
  assert.equal(expectMatches(withImage, 'slides[1].image', 'heart-pump'), false);
});

test('list items are labelled with their index for the models, and a mis-indexed patch is moved only on a unique quote', () => {
  const pack = {
    slides: [
      { id: 'd1s1', title: 'Day 1', lines: [] },
      { id: 'd1s2', title: 'Typhoon signals', lines: ['Signal No. 1 means strong winds within 36 hours.'] },
      { id: 'd1s3', title: 'The eye of a typhoon', lines: ['The calm in the middle is the eye of the typhoon.'] },
    ],
  } as unknown as WeeklyPackContent;
  const shown = annotate(pack) as any;
  assert.equal(shown.slides[2]._i, 2);
  assert.deepEqual(stripIndex(shown), pack);
  assert.equal(canonicalPath(pack, 'slides[d1s3].lines[0]'), 'slides[2].lines[0]');
  assert.throws(() => canonicalPath(pack, 'slides[d9s9].lines'), /no item with id/);
  // quoted the eye line but pointed at slide 1: moved to slide 2
  assert.equal(retarget(pack, 'slides[1].lines[0]', 'The calm in the middle is the eye'), 'slides[2].lines[0]');
  // a short quote never moves a patch
  assert.equal(retarget(pack, 'slides[1].lines[0]', 'The calm'), null);
  // a quote found nowhere else is not moved
  assert.equal(retarget(pack, 'slides[1].lines[0]', 'Signal No. 3 means very strong winds'), null);
  // a list quoted whole, or by its first item, matches
  const plan = { days: [{ flow: [{ slideIds: ['d5s5', 'd5s6', 'd5s7'] }] }] } as unknown as WeeklyPackContent;
  assert.equal(expectMatches(plan, 'days[0].flow[0].slideIds', '["d5s5","d5s6","d5s7"]'), true);
  assert.equal(expectMatches(plan, 'days[0].flow[0].slideIds', 'd5s5'), true);
  assert.equal(expectMatches(plan, 'days[0].flow[0].slideIds', '["d5s6"]'), false);
  // a numbered slide line quoted without its number matches
  const steps = { slides: [{ lines: ['1. Look at the pictures.', '2. Put them in order: before, during, the calm eye.'] }] } as unknown as WeeklyPackContent;
  assert.equal(expectMatches(steps, 'slides[0].lines[1]', 'Put them in order: before, during'), true);
  // an object quoted with its "_i" label still matches
  assert.equal(expectMatches(pack, 'slides[2]', '{"_i": 2, "id": "d1s3", "title": "The eye of a typhoon"}'), true);
});

test('mechanical patch fixes: long slide lines split at sentences, numbers sent as text', () => {
  const long = 'Table salt solution is neutral in water. Not all salts are neutral — baking soda is a salt, but its solution is basic.';
  assert.ok(long.length > 110);
  assert.deepEqual(splitSlideLine(long), ['Table salt solution is neutral in water.', 'Not all salts are neutral — baking soda is a salt, but its solution is basic.']);
  assert.equal(splitSlideLine('x'.repeat(130)), null, 'no boundary: not split');
  const pack = { slides: [{ lines: ['Litmus turns red in acid.', 'Salt water is neutral.'] }], days: [{ flow: [{ minutes: 10 }] }] } as unknown as WeeklyPackContent;
  const p = preparePatch(pack, 'slides[0].lines[1]', long);
  assert.equal(p.path, 'slides[0].lines');
  assert.deepEqual(p.value, ['Litmus turns red in acid.', 'Table salt solution is neutral in water.', 'Not all salts are neutral — baking soda is a salt, but its solution is basic.']);
  assert.deepEqual(preparePatch(pack, 'days[0].flow[0].minutes', '12').value, 12);
  // lists and objects sent as text
  assert.deepEqual(preparePatch(pack, 'slides[0].lines', '1. One.\n2. Two.').value, ['1. One.', '2. Two.']);
  assert.deepEqual(preparePatch(pack, 'slides[0].lines', '["A","B"]').value, ['A', 'B']);
  const withObj = { days: [{ check: { question: 'q', answer: 'a', why: 'w' } }], slides: [{ image: { slug: 's', alt: 'a' } }] } as unknown as WeeklyPackContent;
  assert.deepEqual(preparePatch(withObj, 'days[0].check', '{"_i":0,"question":"Q2","answer":"A2","why":"W2"}').value, { question: 'Q2', answer: 'A2', why: 'W2' });
  assert.equal(preparePatch(withObj, 'slides[0].image', 'null').value, null);
  assert.equal(preparePatch(withObj, 'days[0].check', 'not json').value, 'not json', 'unparseable text is left for the type check to refuse');
  assert.deepEqual(preparePatch(pack, 'slides[0].lines[0]', 'Short.').value, 'Short.');
});

test('a placeholder written instead of the revised text is detected', () => {
  assert.ok(placeholderIn('[paragraph updated by issue c1]'));
  assert.ok(placeholderIn(['ok', '[text unchanged]']));
  assert.equal(placeholderIn('What gas do we breathe out? [Carbon dioxide, water vapour and warm air.]'), null);
  assert.equal(placeholderIn({ slug: 'a', alt: 'A heart [cut away] pumping' }), null);
});

test('a slide line that only repeats the title is dropped', () => {
  const s = tidySlide({ kind: 'question', title: 'Which part grows out of the seed first?', lines: ['Which part grows out of the seed first?', 'Look at your cup.'], choices: [] });
  assert.deepEqual(s.lines, ['Look at your cup.']);
  const kept = tidySlide({ kind: 'concept', title: 'Roots', lines: ['Roots hold the plant in the soil.'], choices: [] });
  assert.deepEqual(kept.lines, ['Roots hold the plant in the soil.']);
});

const committed = existsSync(LIBRARY)
  ? readdirSync(LIBRARY).flatMap((d) => (['en', 'fil'] as const).filter((l) => existsSync(resolve(LIBRARY, d, l, 'pack.json'))).map((l) => ({ id: d, lang: l })))
  : [];

test('every committed pack satisfies the contract and records its review honestly', () => {
  for (const { id, lang } of committed) {
    const pack = WeeklyPackContent.parse(JSON.parse(readFileSync(resolve(LIBRARY, id, lang, 'pack.json'), 'utf8')));
    const review = JSON.parse(readFileSync(resolve(LIBRARY, id, lang, 'review.json'), 'utf8'));
    assert.equal(pack.language, lang);
    assert.equal(review.language, lang);
    const t = targets.find((x) => x.targetId === id)!;
    const r = checkPack(pack, t, { requireIllustrationChecks: true });
    if (review.autoChecks.state === 'pass') assert.deepEqual(r.failures, [], `${id}/${lang} claims passing checks`);
    // Verbiage results are recorded and reproducible.
    assert.ok(review.verbiage, `${id}/${lang}: verbiage recorded`);
    assert.equal(review.verbiage.state, checkVerbiage(pack).state, `${id}/${lang}: verbiage reproducible`);
    // A model can never fill a human review stage.
    for (const k of ['teacherReview', 'expertReview'] as const)
      if (review[k]) assert.ok(!/qwen|deepseek|gpt|claude|model/i.test(review[k].reviewer), `${id}/${lang}: ${k} names a model`);
    if (review.publication === 'approved') assert.ok(review.teacherReview, `${id}/${lang} is approved without a teacher review`);
    const art = loadInputs().art.competencies;
    const allowed = new Map(t.competencies.flatMap((c) => (art[c.id]?.candidates ?? []).map((a) => [a.slug, a] as const)));
    for (const ill of pack.illustrations) {
      assert.equal(allowed.get(ill.slug)?.sha256, ill.sha256, `${id}/${lang}: ${ill.slug}`);
      assert.equal(ill.check.verdict, 'pass');
    }
  }
});

test('the Filipino edition has exactly the English structure: competencies, timing, slides, drawings and answers', () => {
  for (const { id, lang } of committed) {
    if (lang !== 'fil' || !existsSync(resolve(LIBRARY, id, 'en', 'pack.json'))) continue;
    const en = WeeklyPackContent.parse(JSON.parse(readFileSync(resolve(LIBRARY, id, 'en', 'pack.json'), 'utf8')));
    const fil = WeeklyPackContent.parse(JSON.parse(readFileSync(resolve(LIBRARY, id, 'fil', 'pack.json'), 'utf8')));
    assert.deepEqual(checkSameStructure(en, fil), [], id);
    // Official competency wording stays verbatim (English) in both editions.
    assert.deepEqual(fil.competencies, en.competencies);
  }
});

test('the checker warns when an exit ticket repeats a question answered that day', { skip: !committed.some((c) => c.lang === 'en') }, () => {
  const c = committed.find((x) => x.lang === 'en')!;
  const pack = WeeklyPackContent.parse(JSON.parse(readFileSync(resolve(LIBRARY, c.id, 'en', 'pack.json'), 'utf8')));
  const t = targets.find((x) => x.targetId === c.id)!;
  // a day with a check answered on a slide
  const i = pack.slides.findIndex((s, k) => s.kind === 'check' && s.day > 0 && pack.slides[k + 1]?.kind === 'reveal' && (s.lines[0] ?? s.title).length >= 20);
  assert.ok(i > 0, 'fixture has an answered check');
  const check = pack.slides[i]!;
  const dayIdx = pack.days.findIndex((d) => d.day === check.day);
  const repeats = (p: WeeklyPackContent) => checkPack(p, t).warnings.filter((w) => w.startsWith(`day ${check.day}: the exit ticket repeats`)).length;
  const fresh = structuredClone(pack);
  fresh.days[dayIdx]!.check.question = 'Name one thing at home that would show the same idea, and say why.';
  const repeated = structuredClone(pack);
  repeated.days[dayIdx]!.check.question = `On paper: ${check.lines[0] ?? check.title}`;
  assert.ok(repeats(repeated) >= 1, 'a repeated question is flagged');
  assert.ok(repeats(repeated) >= repeats(fresh));
});

test('the checker catches an answer shown before its reveal', () => {
  if (!committed.length) return;
  const { id, lang } = committed[0]!;
  const pack = JSON.parse(readFileSync(resolve(LIBRARY, id, lang, 'pack.json'), 'utf8'));
  const t = targets.find((x) => x.targetId === id)!;
  const q = pack.slides.findIndex((s: any) => s.kind === 'question' || s.kind === 'concept');
  pack.slides[q].lines = ['Answer: oxygen'];
  assert.ok(checkPack(pack, t).failures.some((f) => f.includes('shows an answer')));
});

test('DeepSeek peak windows and prices follow the published schedule', () => {
  const at = (iso: string) => new Date(iso);
  // 2026-11-19 is a Thursday; 2026-11-21 a Saturday.
  assert.equal(isDeepSeekPeak(at('2026-11-19T05:59:00Z')), false);
  assert.equal(isDeepSeekPeak(at('2026-11-19T06:00:00Z')), true);
  assert.equal(isDeepSeekPeak(at('2026-11-19T09:59:00Z')), true);
  assert.equal(isDeepSeekPeak(at('2026-11-19T10:00:00Z')), false);
  assert.equal(isDeepSeekPeak(at('2026-11-19T01:30:00Z')), true);
  assert.equal(isDeepSeekPeak(at('2026-11-21T07:00:00Z')), false, 'weekends are off-peak');
  assert.equal(rateFactor(MODELS.writer, at('2026-11-19T12:00:00Z')), 0.5);
  assert.equal(rateFactor(MODELS.writer, at('2026-11-19T07:00:00Z')), 1);
  assert.equal(rateFactor(MODELS.critic, at('2026-11-19T12:00:00Z')), 1, 'Qwen has one price');
  const wait = msUntilDeepSeekOffPeak(at('2026-11-19T09:30:00Z'));
  assert.ok(wait >= 30 * 60_000 && wait <= 31 * 60_000, `waits until 10:00 (got ${wait} ms)`);
  assert.equal(msUntilDeepSeekOffPeak(at('2026-11-19T12:00:00Z')), 0);
});

test('the spend cap counts calls in flight, so several workers cannot pass it together', () => {
  const ledger = join(mkdtempSync(join(tmpdir(), 'tala-meter-')), 'calls.jsonl');
  const meter = new Meter(1.0, ledger, 0.2, { batch: 'test' });
  const qwen = MODELS.critic; // $1.5 in / $4.5 out per million
  // worst case of one call: (10k in * 1.5 + 50k out * 4.5) / 1e6 = 0.24
  const a = meter.reserve(qwen, 10_000, 50_000);
  const b = meter.reserve(qwen, 10_000, 50_000);
  const c = meter.reserve(qwen, 10_000, 50_000); // 0.2 spent + 0.72 reserved = 0.92
  assert.throws(() => meter.reserve(qwen, 10_000, 50_000), BudgetExceeded, 'a fourth would pass the cap');
  meter.release(a);
  meter.record({ label: 'sci26-g3-t3-w01:outline:1', model: 'x', costUsd: 0.1 });
  assert.equal(meter.byPack.get('sci26-g3-t3-w01'), 0.1);
  // 0.3 spent + 0.48 still reserved + 0.24 > 1.0: still refused until another call ends
  assert.throws(() => meter.reserve(qwen, 10_000, 50_000), BudgetExceeded);
  meter.release(b);
  assert.doesNotThrow(() => meter.release(meter.reserve(qwen, 10_000, 50_000)));
  meter.release(c);
  const row = JSON.parse(readFileSync(ledger, 'utf8').trim());
  assert.equal(row.batch, 'test', 'ledger rows carry the batch tag');
});

test('a slide line over the contract with no sentence break is split at a comma; length problems never fail a week', async () => {
  const long = 'When you stir salt into warm water in a clear cup at the front of the room, the grains seem to vanish completely from sight';
  assert.ok(long.length > 120);
  const parts = splitAtComma(long, 130)!;
  assert.equal(parts.length, 2);
  assert.ok(parts.every((x) => x.length <= 130) && parts.join(' ').replace(/,/g, '') === long.replace(/,/g, ''));
  assert.equal(splitAtComma('no commas here at all', 10), null);
  const { LENGTH_ONLY } = await import('./generate');
  assert.equal(LENGTH_ONLY, '[length] ');
});

test('over-long alt text and material lists are trimmed deterministically, without touching lesson text', () => {
  const alt = 'A cutaway drawing of a seed. ' + 'The root grows down into the soil while the shoot grows up toward the light, '.repeat(4);
  const short = clampText(alt, 200);
  assert.ok(short.length <= 200 && alt.startsWith(short.replace(/…$/, '')));
  assert.equal(clampText('Short alt.', 200), 'Short alt.');
  const mats = Array.from({ length: 14 }, (_, i) => `item ${i + 1}`);
  const folded = foldList(mats, 12);
  assert.equal(folded.length, 12);
  assert.equal(folded[11], 'item 12; item 13; item 14');
  assert.deepEqual(foldList(['a', 'b'], 12), ['a', 'b']);
});

test('a line over the contract with no sentence break, dash, semicolon or comma is split at a space', () => {
  const line = '— nagsasama ang maliliit na sentro ng hydrogen atoms para maging helium at lumabas ang enerhiya (tinatawag nating nuclei ang mga sentro).';
  assert.ok(line.length > 130);
  const parts = splitOverContract(line, 130)!;
  assert.equal(parts.length, 2);
  assert.ok(parts.every((x) => x.length <= 130));
  assert.equal(parts.join(' '), line);
});

