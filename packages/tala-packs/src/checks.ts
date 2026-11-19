/**
 * Deterministic checks on a complete pack. Failures block the `auto_checks` stage; warnings are listed for the
 * human reviewer. No model is involved here.
 */
import { WeeklyPackContent, LESSON_PHASES, type Slide } from '@hiraia/tala-core/contracts';
import { loadInputs } from './context';
import type { WeekTarget } from './targets';
import { lineMax, slideCharsMax, stripEnumerator } from './text';
export { lineMax, slideCharsMax, stripEnumerator } from './text';

export const CHECKER_VERSION = 'checks/1';

export interface CheckResult {
  failures: string[];
  warnings: string[];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Words that signal a hazard somewhere in an activity. */
const RISK = /\b(fire|flame|candle|match(es)?|burn(ing|t)?|heat(ed|ing)?|hot water|boil(ing)?|stove|alcohol lamp|vinegar|bleach|acid|base|chemical|lye|muriatic|electric(ity|al)?|battery|batteries|wire|socket|outlet|knife|cutter|blade|scissors|glass|thermometer|mirror|sunlight|look at the sun|outdoor|outside|field trip|taste|tasting|lab|soil sample|animal|insect)\b/i;
const SAFETY_WORDS = /\b(safe(ty|ly)?|careful(ly)?|caution|do not|don't|never|supervis\w*|adult|goggles|gloves|wash (your )?hands|keep away|away from)\b/i;
/** Acronyms a Filipino teacher reads without expansion. */
const KNOWN_ACRONYMS = new Set([
  'DEPED', 'PAGASA', 'PHIVOLCS', 'DOST', 'DENR', 'DOH', 'DNA', 'TV', 'OK', 'PH', 'UV', 'CO2', 'H2O', 'O2', 'MATATAG', 'NASA', 'WHO', 'USB',
  'AM', 'PM', 'LED', 'ID', 'A', 'B', 'C', 'D', 'I', 'II', 'III', 'IV', 'V', 'BOW', 'PE', 'MAPEH', 'SI', 'CM', 'MM', 'KG', 'ML', 'L', 'N', 'S', 'E', 'W',
]);

export function checkPack(raw: unknown, t: WeekTarget, opts: { requireIllustrationChecks?: boolean } = {}): CheckResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  const parsed = WeeklyPackContent.safeParse(raw);
  if (!parsed.success) {
    return {
      failures: parsed.error.issues.slice(0, 30).map((i) => `schema: ${i.path.join('.')}: ${i.message}`),
      warnings,
    };
  }
  const p = parsed.data;

  // 1. Curriculum fidelity: competencies are the stored records, verbatim and complete.
  const want = t.competencies.map((c) => `${c.id}|${c.text}`).join('\n');
  const got = p.competencies.map((c) => `${c.id}|${c.text}`).join('\n');
  if (want !== got) failures.push('competencies differ from the stored curriculum record for this week');
  if (p.packId !== t.targetId || p.grade !== t.grade || p.term !== t.term || p.week !== t.week)
    failures.push('pack identity does not match its target');
  if (p.provenance.targetInputHash !== t.inputHash) failures.push('pack was drafted from different curriculum inputs');
  const compIds = new Set(t.competencies.map((c) => c.id));

  // 2. Days and the MATATAG procedure.
  p.days.forEach((d, i) => {
    if (d.day !== i + 1) failures.push(`days[${i}] is day ${d.day}, expected ${i + 1}`);
    const total = d.flow.reduce((n, s) => n + s.minutes, 0);
    if (total !== d.minutes || d.minutes !== 45) failures.push(`day ${d.day}: flow minutes ${total}, lesson minutes ${d.minutes}; both must be 45`);
    let pos = 0;
    d.flow.forEach((s, j) => {
      const k = LESSON_PHASES.indexOf(s.phase);
      if (k < pos) failures.push(`day ${d.day}: flow[${j}] ${s.phase} is out of MATATAG order`);
      pos = Math.max(pos, k);
    });
    for (const ph of LESSON_PHASES) if (!d.flow.some((s) => s.phase === ph)) failures.push(`day ${d.day}: no ${ph} step`);
    for (const id of d.competencyIds) if (!compIds.has(id)) failures.push(`day ${d.day}: competency ${id} is not this week's`);
  });
  for (const id of compIds) {
    if (!p.days.some((d) => d.competencyIds.includes(id))) failures.push(`competency ${id} is not taught on any day`);
    if (!p.assessment.some((q) => q.competencyId === id)) failures.push(`competency ${id} is not assessed`);
  }

  // 3. Slides: order, ids, plan ↔ slide consistency.
  const ids = p.slides.map((s) => s.id);
  if (new Set(ids).size !== ids.length) failures.push('slide ids are not unique');
  if (p.slides[0]?.kind !== 'cover') failures.push('first slide must be the cover');
  if (p.slides.at(-1)?.kind !== 'credits') failures.push('last slide must be the credits slide');
  let lastDay = 0;
  for (const s of p.slides.slice(1, -1)) {
    if (s.day < lastDay) failures.push(`slide ${s.id} is out of day order`);
    lastDay = s.day;
  }
  for (const d of p.days) {
    const daySlides = p.slides.filter((s) => s.day === d.day).map((s) => s.id);
    const referenced = d.flow.flatMap((s) => s.slideIds);
    if (JSON.stringify(daySlides) !== JSON.stringify(referenced))
      failures.push(`day ${d.day}: lesson flow references [${referenced.join(', ')}] but the deck has [${daySlides.join(', ')}]`);
    if (!daySlides.length) failures.push(`day ${d.day} has no slides`);
    const first = p.slides.find((s) => s.day === d.day);
    if (first && first.kind !== 'day') failures.push(`day ${d.day}: first slide must be its Day slide`);
  }

  // 3b. An exit ticket that repeats a question already answered that day only tests memory of the reveal.
  for (const d of p.days) {
    const sq = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const day = p.slides.filter((s) => s.day === d.day);
    const answered = day.filter((s, i) => s.kind === 'check' && day[i + 1]?.kind === 'reveal');
    const lastAnswered = answered.length ? day.indexOf(answered.at(-1)!) : -1;
    // the question text of each answered check: its title and each line, as written
    const asked = answered.flatMap((s) => [s.title, ...s.lines].map(sq)).filter((q) => q.length >= 20);
    const exitTexts = [sq(d.check.question), ...day.filter((s, i) => i > lastAnswered && (s.kind === 'question' || (s.kind === 'check' && day[i + 1]?.kind !== 'reveal'))).map((s) => sq([s.title, ...s.lines].join(' ')))];
    if (asked.some((q) => exitTexts.some((x) => x.includes(q))))
      warnings.push(`day ${d.day}: the exit ticket repeats a question already answered on a slide that day`);
  }

  // 3c. English stays within the design lengths, so its Filipino edition (20–40% longer) fits the same fields.
  if (p.language === 'en') failures.push(...designLengthFailures(p));

  // 4. TV legibility limits and no answers before their reveal.
  p.slides.forEach((s, i) => {
    if (s.title.length > 60) failures.push(`${s.id}: title is ${s.title.length} characters (max 60)`);
    if (s.lines.length > 5 || (s.lines.length === 5 && s.lines.join('').length > slideCharsMax(p.language) - 20)) failures.push(`${s.id}: too much text (${s.lines.length} lines)`);
    s.lines.forEach((raw, j) => {
      const l = stripEnumerator(raw);
      const max = lineMax(p.language);
      if (l.length > max) failures.push(`${s.id}: line ${j + 1} is ${l.length} characters (max ${max})`);
      else if (l.length > 90) warnings.push(`${s.id}: line ${j + 1} is long for a TV slide (${l.length} characters)`);
    });
    if (s.lines.join('').length > slideCharsMax(p.language)) failures.push(`${s.id}: too much text for a TV slide (${s.lines.join('').length} characters, max ${slideCharsMax(p.language)})`);
    if (s.kind !== 'cover' && s.kind !== 'credits' && s.notes.length < 120) warnings.push(`${s.id}: speaker notes are short (${s.notes.length} characters)`);
    const learnerText = [s.title, ...s.lines, ...s.choices].join(' ');
    if (s.kind !== 'reveal' && /\b(answer|sagot)\s*[:=]/i.test(learnerText)) failures.push(`${s.id}: shows an answer on a learner-facing slide`);
    if (s.kind === 'check') {
      if (s.choices.some((c) => /[✓✔*]|\(correct\)|\bcorrect\b/i.test(c))) failures.push(`${s.id}: a choice is marked as correct`);
      const next = p.slides[i + 1];
      const lastOfDay = !next || next.day !== s.day;
      if (!next || next.kind !== 'reveal' || next.revealOf !== s.id) {
        if (!lastOfDay) failures.push(`${s.id}: check is not followed by its reveal`);
      } else if (s.choices.length) {
        if (next.correctChoice === null || next.correctChoice >= s.choices.length) failures.push(`${next.id}: correctChoice does not index the check's choices`);
        else {
          const right = norm(s.choices[next.correctChoice]!);
          const revealText = norm(next.lines.join(' '));
          const overlap = right.split(' ').filter((w) => w.length > 3 && revealText.includes(w)).length;
          if (right && overlap === 0) warnings.push(`${next.id}: reveal text does not echo the correct choice "${s.choices[next.correctChoice]}"`);
        }
      }
    }
    if (s.kind === 'reveal' && (!s.revealOf || !ids.includes(s.revealOf))) failures.push(`${s.id}: reveal points to no check slide`);
  });
  for (const d of p.days) {
    const exit = norm(d.check.answer);
    if (exit.split(' ').length >= 4)
      for (const s of p.slides.filter((x) => x.day === d.day && x.kind !== 'reveal'))
        if (norm([s.title, ...s.lines].join(' ')).includes(exit)) failures.push(`day ${d.day}: exit-ticket answer appears on learner slide ${s.id}`);
  }

  // 5. Illustrations: only approved candidates for this week, each recorded with its bytes and check.
  const art = new Map<string, true>();
  for (const c of t.competencies) for (const cand of loadInputs().art.competencies[c.id]?.candidates ?? []) art.set(cand.slug, true);
  const used = p.slides.filter((s) => s.image).map((s) => s.image!.slug);
  for (const slug of used) if (!art.has(slug)) failures.push(`illustration ${slug} is not an approved candidate for this week`);
  if (opts.requireIllustrationChecks) {
    for (const slug of new Set(used)) {
      const rec = p.illustrations.find((x) => x.slug === slug);
      if (!rec) failures.push(`illustration ${slug} has no provenance record`);
      else if (rec.check.verdict !== 'pass') failures.push(`illustration ${slug} did not pass its image check`);
    }
  }
  for (const d of p.days) {
    const day = p.slides.filter((s) => s.day === d.day);
    if (!day.some((s, i) => s.kind === 'check' && day[i + 1]?.kind === 'reveal')) warnings.push(`day ${d.day}: no check-and-answer pair on the slides (the written exit ticket remains)`);
  }
  const contentSlides = p.slides.filter((s) => !['cover', 'credits', 'day', 'reveal'].includes(s.kind));
  const illustrated = contentSlides.filter((s) => s.image).length;
  if (illustrated === 0) warnings.push('no slide has an illustration');

  // 6. Assessment and answer keys.
  p.assessment.forEach((q, i) => {
    if (q.id !== `q${i + 1}`) failures.push(`assessment[${i}] id ${q.id}, expected q${i + 1}`);
    if (q.kind === 'multiple_choice') {
      if (q.choices.length !== 4) failures.push(`${q.id}: multiple choice needs 4 choices`);
      if (q.correctChoice === null || q.correctChoice >= q.choices.length) failures.push(`${q.id}: correctChoice is missing or out of range`);
      if (new Set(q.choices.map(norm)).size !== q.choices.length) failures.push(`${q.id}: duplicate choices`);
    }
  });
  if (!p.assessment.some((q) => q.kind === 'short_answer')) warnings.push('assessment has no short-answer item');

  // 7. Sources: only the allowlist; every background section cites one.
  const refIds = new Set(loadInputs().references.map((r) => r.id));
  for (const s of p.guide.sources) if (!refIds.has(s.refId)) failures.push(`source ${s.refId} is not in the reference allowlist`);
  p.guide.background.forEach((b, i) => {
    for (const r of b.refIds) if (!refIds.has(r)) failures.push(`background[${i}] cites unknown source ${r}`);
    if (!b.refIds.length) warnings.push(`background "${b.heading}" cites no source`);
  });

  // 8. Safety: any hazard word in an activity needs a precaution.
  for (const d of p.days) {
    const activity = [...d.materials, ...d.flow.map((s) => `${s.teacher} ${s.learners}`)].join(' ');
    const m = activity.match(RISK);
    if (m && !SAFETY_WORDS.test(activity)) warnings.push(`day ${d.day}: mentions "${m[0]}" but the lesson steps carry no safety instruction`);
  }
  const allActivity = p.days.flatMap((d) => [...d.materials, ...d.flow.map((s) => s.teacher)]).join(' ');
  const hazard = allActivity.match(/\b(fire|flame|candle|matches|burn(ing)?|boil(ing)?|stove|bleach|acid|electric(ity)?|battery|knife|cutter|blade|glass)\b/i);
  if (hazard && !p.guide.safety.length) failures.push(`activities use "${hazard[0]}" but the guide has no safety section`);

  // 9. Plain language: acronyms must be expanded somewhere.
  const teacherText = [
    ...p.guide.background.flatMap((b) => b.paragraphs),
    ...p.days.flatMap((d) => d.flow.map((s) => s.teacher)),
    ...p.slides.map((s) => s.notes),
  ].join('\n');
  const acronyms = new Set((teacherText.match(/\b[A-Z][A-Z0-9]{1,6}\b/g) ?? []).filter((a) => !KNOWN_ACRONYMS.has(a.toUpperCase())));
  for (const a of acronyms) {
    const expanded = new RegExp(`\\(${a}\\)|${a} \\(|${a}\\s*[—–-]\\s*[a-z]`, 'i').test(teacherText);
    if (!expanded) warnings.push(`acronym ${a} is never expanded`);
  }

  // 10. Vocabulary is used; sensitive topics are flagged.
  const everything = norm([JSON.stringify(p.days), JSON.stringify(p.slides)].join(' '));
  for (const v of p.guide.vocabulary)
    if (!everything.includes(norm(v.term)) && !(v.filipino && everything.includes(norm(v.filipino))))
      warnings.push(`vocabulary "${v.term}" is not used in any lesson or slide`);
  if (t.competencies.some((c) => /reproductive|puberty|menstruat/i.test(c.text)) && !p.sensitivity.includes('human_reproduction'))
    failures.push('competency covers human reproduction but the pack is not flagged for sensitive review');

  return { failures, warnings };
}

export function slideStats(slides: Slide[]) {
  const content = slides.filter((s) => !['cover', 'credits', 'day', 'reveal'].includes(s.kind));
  return { total: slides.length, content: content.length, illustrated: content.filter((s) => s.image).length };
}

/** The Filipino edition must have exactly the English edition's structure: same lessons, timing, slides and answers. */
/**
 * Design lengths of teacher-facing fields (the contract allows × 1.4 for the Filipino edition). Model revisions of
 * the English grew fields into that room, and the Filipino edition of the same text then could not fit (G4, G7).
 */
const DESIGN: Array<[RegExp, number]> = [
  [/^summary$/, 600],
  [/^assessment\[\d+\]\.prompt$/, 500], [/^assessment\[\d+\]\.choices\[\d+\]$/, 160], [/^assessment\[\d+\]\.answer$/, 600], [/^assessment\[\d+\]\.explanation$/, 900],
  [/^guide\.bigIdea$/, 400], [/^guide\.whyItMatters$/, 700], [/^guide\.background\[\d+\]\.heading$/, 90], [/^guide\.background\[\d+\]\.paragraphs\[\d+\]$/, 1400],
  [/^guide\.prerequisites\[\d+\]\.idea$/, 240], [/^guide\.prerequisites\[\d+\]\.quickCheck$/, 300], [/^guide\.prerequisites\[\d+\]\.ifMissing$/, 400],
  [/^guide\.vocabulary\[\d+\]\.term$/, 60], [/^guide\.vocabulary\[\d+\]\.(meaning|example)$/, 300],
  [/^guide\.misconceptions\[\d+\]\.belief$/, 240], [/^guide\.misconceptions\[\d+\]\.whyLearnersThinkIt$/, 400], [/^guide\.misconceptions\[\d+\]\.(correctIdea|howToAddress)$/, 500],
  [/^guide\.studentQuestions\[\d+\]\.question$/, 240], [/^guide\.studentQuestions\[\d+\]\.answer$/, 800],
  [/^guide\.localExamples\[\d+\]\.example$/, 200], [/^guide\.localExamples\[\d+\]\.connection$/, 500],
  [/^guide\.materials\[\d+\]\.(item|amount)$/, 120], [/^guide\.materials\[\d+\]\.notes$/, 300], [/^guide\.materials\[\d+\]\.substitute$/, 200],
  [/^guide\.(preparation|safety)\[\d+\]$/, 400],
  [/^days\[\d+\]\.objective$/, 300], [/^days\[\d+\]\.materials\[\d+\]$/, 300], [/^days\[\d+\]\.expectedObservations\[\d+\]$/, 300],
  [/^days\[\d+\]\.flow\[\d+\]\.teacher$/, 2400], [/^days\[\d+\]\.flow\[\d+\]\.learners$/, 1000],
  [/^days\[\d+\]\.check\.question$/, 400], [/^days\[\d+\]\.check\.answer$/, 600], [/^days\[\d+\]\.check\.why$/, 800],
  [/^days\[\d+\]\.(support|extension)$/, 900], [/^days\[\d+\]\.longerPeriod$/, 800], [/^slides\[\d+\]\.notes$/, 2400],
];

export function designLengthFailures(p: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === 'string') {
      const rule = DESIGN.find(([re]) => re.test(path));
      if (rule && v.length > rule[1]) out.push(`${path} is ${v.length} characters; keep the English within ${rule[1]} so the Filipino edition fits`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  walk(p, '');
  return out;
}

export function checkSameStructure(en: WeeklyPackContent, fil: WeeklyPackContent): string[] {
  const errs: string[] = [];
  const sig = (p: WeeklyPackContent) => ({
    competencies: p.competencies.map((c) => `${c.id}|${c.text}`),
    days: p.days.map((d) => ({ day: d.day, minutes: d.minutes, competencyIds: d.competencyIds, flow: d.flow.map((f) => [f.phase, f.minutes, f.slideIds.join(',')]) })),
    slides: p.slides.map((s) => [s.id, s.day, s.kind, s.image?.slug ?? '', s.revealOf ?? '', s.correctChoice ?? '', s.choices.length]),
    assessment: p.assessment.map((q) => [q.id, q.kind, q.correctChoice ?? '', q.choices.length, q.competencyId]),
    illustrations: p.illustrations.map((i) => [i.slug, i.sha256, i.slides.join(',')]),
  });
  const a = sig(en);
  const b = sig(fil);
  for (const key of Object.keys(a) as Array<keyof typeof a>)
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) errs.push(`Filipino edition differs from English in ${key}`);
  if (fil.language !== 'fil' || en.language !== 'en') errs.push('editions are labelled with the wrong language');
  return errs;
}
