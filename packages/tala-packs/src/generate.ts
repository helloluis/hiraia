/**
 * Draft one weekly pack: an outline call (week plan + teacher guide + assessment), then one call per day (lesson
 * plan + slides + speaker notes). Model output is validated against the shared contract; one repair round is allowed
 * with the exact validation errors, otherwise the stage fails and the error is recorded.
 *
 * Curriculum text is never taken from the model: competencies are copied from the stored record.
 * Stage outputs are cached under build/work/<packId>/ keyed by an input hash, so a rerun resumes.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  AssessmentItem,
  DayPlan,
  PACK_SCHEMA_VERSION,
  Slide,
  TeacherGuide,
  type WeeklyPackContent,
} from '@hiraia/tala-core/contracts';
import { MODELS, chat, parseJsonObject, type ChatMessage, type Meter, type ModelSpec } from './llm';
import {
  artCandidatesFor,
  artText,
  bowActivitiesFor,
  describeTarget,
  fill,
  groundingFor,
  loadInputs,
  loadPrompt,
  referencesText,
} from './context';
import { LIBRARY, PIPELINE_VERSION, WORK } from './paths';
import type { WeekTarget } from './targets';
import { clampText, foldList, lineMax, splitAtComma, splitSlideLine, stripEnumerator } from './text';

export const SENSITIVITY = z.enum(['human_reproduction', 'health', 'disaster', 'safety_critical']);

export const OutlineOut = z.object({
  title: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(600),
  sensitivity: z.array(SENSITIVITY).default([]),
  guide: TeacherGuide,
  days: z
    .array(
      z.object({
        day: z.number().int().min(1).max(5),
        title: z.string().trim().min(1).max(80),
        competencyIds: z.array(z.string()).min(1).max(6),
        objective: z.string().trim().min(1).max(300),
        keyIdeas: z.array(z.string().trim().min(1).max(240)).min(1).max(5),
        mainActivity: z.string().trim().min(1).max(700),
        check: z.object({ question: z.string().min(1).max(300), answer: z.string().min(1).max(400), why: z.string().min(1).max(500) }),
      })
    )
    .length(5),
  assessment: z.array(z.preprocess(normalizeItem, AssessmentItem)).min(4).max(12),
});
export type OutlineOut = z.infer<typeof OutlineOut>;

/** Deterministic fixes for harmless spelling variants, so a repair round is not spent on them. */
function normalizeItem(v: unknown): unknown {
  if (!v || typeof v !== 'object') return v;
  const o = { ...(v as Record<string, unknown>) };
  const k = String(o.kind ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  const map: Record<string, string> = {
    performance_task: 'performance', performance_assessment: 'performance', mcq: 'multiple_choice', multiple_choices: 'multiple_choice',
    short: 'short_answer', open_ended: 'short_answer', constructed_response: 'short_answer',
  };
  if (map[k]) o.kind = map[k];
  else if (k) o.kind = k;
  if (o.correctChoice === undefined) o.correctChoice = null;
  return o;
}

// 12 slides fit a 45-minute lesson; 13-14 are accepted after one request to trim (a `[length]` check), never fatal.
export const DayOut = DayPlan.extend({ slides: z.array(Slide).min(5).max(14) });
export type DayOut = z.infer<typeof DayOut>;

export const TIMING_BASIS =
  'Science is taught five times a week, 45 minutes a session, in Grades 3–10: DepEd Order No. 010, s. 2024 (Tables 3, 5 and 6) and DepEd Order No. 012, s. 2024 (§2.a, which also allows uniform 50, 55 or 60-minute periods). Applied to the SY 2026–2027 three-term calendar.';

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

function workDir(packId: string) {
  const d = resolve(WORK, packId);
  mkdirSync(d, { recursive: true });
  return d;
}

/** Run one model stage with JSON validation and a single repair round; cache the validated result. */
/** Check messages with this prefix are text-length problems: asked to be fixed, but never fatal for a week. */
export const LENGTH_ONLY = '[length] ';

export async function stage<T>(args: {
  meter: Meter;
  packId: string;
  name: string;
  spec: ModelSpec;
  thinking: boolean;
  prompt: string;
  schema: z.ZodType<T, z.ZodTypeDef, any>;
  maxTokens: number;
  check?: (value: T) => string[];
  /** Deterministic fixes for mechanical slips (ids, numbering, enum spellings); logged, never content. */
  normalize?: (raw: unknown, log: string[]) => unknown;
  force?: boolean;
  /**
   * When only `check` still fails after the repair attempts, keep the last contract-valid reply instead of failing
   * the week (its remaining problems are returned as `warnings` and stored with the cache entry).
   */
  softCheck?: boolean;
}): Promise<{ value: T; cached: boolean; attempts: number; warnings: string[] }> {
  const dir = workDir(args.packId);
  const key = hash({ p: args.prompt, m: args.spec.model, t: args.thinking });
  const cacheFile = resolve(dir, `${args.name}.json`);
  if (!args.force && existsSync(cacheFile)) {
    const c = JSON.parse(readFileSync(cacheFile, 'utf8'));
    if (c.key === key) return { value: args.schema.parse(c.value), cached: true, attempts: 0, warnings: c.warnings ?? [] };
  }
  const messages: ChatMessage[] = [
    { role: 'system', content: 'You write structured JSON for a teacher-facing education product. Output one JSON object only.' },
    { role: 'user', content: args.prompt },
  ];
  let lastErrors: string[] = [];
  const failures: string[] = [];
  let lastValid: { value: T; attempt: number } | null = null;
  // Two attempts; a third only when the second failed for a DIFFERENT reason (B11 rule: the same failure twice stops).
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt === 3 && failures[0] === failures[1]) break;
    const res = await chat(args.meter, {
      spec: args.spec,
      messages,
      maxTokens: args.maxTokens,
      thinking: args.thinking,
      label: `${args.packId}:${args.name}:${attempt}`,
    });
    writeFileSync(resolve(dir, `${args.name}.raw${attempt}.txt`), res.content);
    let parsed: unknown;
    try {
      parsed = parseJsonObject(res.content);
    } catch {
      lastErrors = [
        res.finishReason === 'length'
          ? 'The reply was cut off before the JSON ended (too long). Shorten the text fields.'
          : 'The reply was not valid JSON.',
      ];
      parsed = undefined;
    }
    if (parsed !== undefined) {
      const log: string[] = [];
      if (args.normalize) parsed = args.normalize(parsed, log);
      if (log.length) writeFileSync(resolve(dir, `${args.name}.normalized${attempt}.json`), JSON.stringify(log, null, 1));
      const r = args.schema.safeParse(parsed);
      if (r.success) {
        const extra = args.check?.(r.data) ?? [];
        if (!extra.length) {
          writeFileSync(cacheFile, JSON.stringify({ key, model: args.spec.model, at: new Date().toISOString(), value: r.data }, null, 1));
          return { value: r.data, cached: false, attempts: attempt, warnings: [] };
        }
        lastErrors = extra;
        lastValid = { value: r.data, attempt };
      } else {
        lastErrors = r.error.issues
          .slice(0, 25)
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
      }
    }
    failures.push(JSON.stringify(lastErrors));
    // Every failed attempt's reasons are kept, so a week that passed on its repair still shows what went wrong.
    writeFileSync(resolve(dir, `${args.name}.attempt${attempt}.errors.json`), JSON.stringify(lastErrors, null, 1));
    messages.push({ role: 'assistant', content: res.content.slice(0, 60_000) });
    messages.push({
      role: 'user',
      content:
        'Your JSON did not pass validation. Fix exactly these problems and return the complete corrected JSON object:\n- ' +
        lastErrors.join('\n- '),
    });
  }
  writeFileSync(resolve(dir, `${args.name}.errors.json`), JSON.stringify(lastErrors, null, 1));
  if ((args.softCheck || (lastValid && lastErrors.every((e) => e.startsWith(LENGTH_ONLY)))) && lastValid) {
    const warnings = JSON.parse(failures.at(-1) ?? '[]') as string[];
    writeFileSync(cacheFile, JSON.stringify({ key, model: args.spec.model, at: new Date().toISOString(), value: lastValid.value, warnings }, null, 1));
    return { value: lastValid.value, cached: false, attempts: lastValid.attempt, warnings };
  }
  throw new Error(`${args.name} failed validation ${failures.length} times: ${lastErrors.slice(0, 5).join('; ')}`);
}

export function outlineChecks(t: WeekTarget) {
  return (o: OutlineOut): string[] => {
    const ids = new Set(t.competencies.map((c) => c.id));
    const errs: string[] = [];
    o.days.forEach((d, i) => {
      if (d.day !== i + 1) errs.push(`days[${i}].day must be ${i + 1}`);
      for (const id of d.competencyIds) if (!ids.has(id)) errs.push(`days[${i}].competencyIds: ${id} is not one of this week's competencies`);
    });
    for (const id of ids) if (!o.days.some((d) => d.competencyIds.includes(id))) errs.push(`competency ${id} is not taught on any day`);
    o.assessment.forEach((q, i) => {
      if (!ids.has(q.competencyId)) errs.push(`assessment[${i}].competencyId ${q.competencyId} is not this week's`);
      if (q.kind === 'multiple_choice') {
        if (q.choices.length !== 4) errs.push(`assessment[${i}] needs exactly 4 choices`);
        if (q.correctChoice === null || q.correctChoice >= q.choices.length) errs.push(`assessment[${i}].correctChoice must index a choice`);
      }
      if (q.id !== `q${i + 1}`) errs.push(`assessment[${i}].id must be q${i + 1}`);
    });
    const refIds = new Set(loadInputs().references.map((r) => r.id));
    o.guide.sources.forEach((s, i) => {
      if (!refIds.has(s.refId)) errs.push(`guide.sources[${i}].refId ${s.refId} is not in the allowed list`);
    });
    o.guide.background.forEach((b, i) =>
      b.refIds.forEach((r) => {
        if (!refIds.has(r)) errs.push(`guide.background[${i}].refIds: ${r} is not in the allowed list`);
      })
    );
    return errs;
  };
}

export function dayChecks(day: number, allowedSlugs: Set<string>, competencyIds: Set<string>) {
  return (d: DayOut): string[] => {
    const errs: string[] = [];
    if (d.day !== day) errs.push(`day must be ${day}`);
    const total = d.flow.reduce((n, s) => n + s.minutes, 0);
    if (total !== 45) errs.push(`flow minutes add up to ${total}; they must add up to exactly 45`);
    const order = ['activating_prior_knowledge', 'lesson_purpose', 'developing_understanding', 'generalization', 'evaluating_learning'];
    let pos = 0;
    for (const [i, s] of d.flow.entries()) {
      const p = order.indexOf(s.phase);
      if (p < pos) errs.push(`flow[${i}].phase ${s.phase} is out of MATATAG order`);
      pos = Math.max(pos, p);
    }
    for (const ph of order) if (!d.flow.some((s) => s.phase === ph)) errs.push(`flow has no ${ph} step`);
    d.slides.forEach((s, i) => {
      if (s.id !== `d${day}s${i + 1}`) errs.push(`slides[${i}].id must be d${day}s${i + 1}`);
      if (s.day !== day) errs.push(`slides[${i}].day must be ${day}`);
      if (s.image && !allowedSlugs.has(s.image.slug)) errs.push(`slides[${i}].image.slug ${s.image.slug} is not in the illustration list (use null)`);
      if (s.kind === 'reveal') {
        const prev = d.slides[i - 1];
        if (!prev || prev.kind !== 'check' || s.revealOf !== prev.id) errs.push(`slides[${i}] (reveal) must come right after its check slide and set revealOf to it`);
        if (prev?.choices.length && (s.correctChoice === null || s.correctChoice >= prev.choices.length)) errs.push(`slides[${i}].correctChoice must index the check's choices`);
      }
      if (s.kind === 'check' && i < d.slides.length - 1 && d.slides[i + 1]?.kind !== 'reveal') errs.push(`slides[${i}] (check) must be followed by its reveal slide (only the day's last slide may be an exit check without one)`);
      // Length problems are asked to be fixed once, then accepted (`[length]`, see LENGTH_ONLY): the review loop gets
      // them as automatic issues, and a pack that still has one is built and marked "needs fixes" instead of failing.
      if (s.title.length > 60) errs.push(`[length] slides[${i}].title is longer than 60 characters`);
      if (s.lines.length > 5 || (s.lines.length === 5 && s.lines.join('').length > 320)) errs.push(`[length] slides[${i}] has too much text (max 4 lines, or 5 short ones)`);
      s.lines.forEach((l, j) => {
        if (l.length > 110) errs.push(`[length] slides[${i}].lines[${j}] is longer than 110 characters; shorten it`);
      });
      if (s.lines.join('').length > 340) errs.push(`[length] slides[${i}] has too much text for a TV slide; cut it to the essentials`);
    });
    if (d.slides.length > 12) errs.push(`${LENGTH_ONLY}the day has ${d.slides.length} slides; a 45-minute lesson fits at most 12 — merge or drop the least essential ones (and update the flow's slideIds)`);
    if (d.slides[0]?.kind !== 'day') errs.push('the first slide must be kind "day"');
    // A check + reveal pair on slides is asked for in the prompt; its absence is a recorded warning (checks.ts), not a
    // failed week: every day still has its written exit ticket.
    const referenced = d.flow.flatMap((s) => s.slideIds);
    const ids = d.slides.map((s) => s.id);
    if (JSON.stringify(referenced) !== JSON.stringify(ids)) errs.push(`flow slideIds must list every slide exactly once in order (${ids.join(', ')})`);
    for (const id of d.competencyIds) if (!competencyIds.has(id)) errs.push(`competencyIds: ${id} is not this week's`);
    return errs;
  };
}


const PHASES = ['activating_prior_knowledge', 'lesson_purpose', 'developing_understanding', 'generalization', 'evaluating_learning'] as const;
const PHASE_ALIASES: Record<string, (typeof PHASES)[number]> = {
  activating: 'activating_prior_knowledge', prior_knowledge: 'activating_prior_knowledge', review: 'activating_prior_knowledge',
  establishing_lesson_purpose: 'lesson_purpose', purpose: 'lesson_purpose',
  developing_and_deepening_understanding: 'developing_understanding', deepening_understanding: 'developing_understanding', developing: 'developing_understanding',
  making_generalizations: 'generalization', generalizations: 'generalization', generalisation: 'generalization',
  evaluation: 'evaluating_learning', evaluating: 'evaluating_learning', assessment: 'evaluating_learning',
};

/** Mechanical fixes to a day reply: ids, day numbers, phase spellings, image shape, flow bookkeeping. */
export function normalizeDay(day: number, art: Map<string, { titles: string[] }>) {
  return (raw: unknown, log: string[]): unknown => {
    if (!raw || typeof raw !== 'object') return raw;
    const o = structuredClone(raw) as any;
    o.day = day;
    if (typeof o.minutes !== 'number') o.minutes = 45;
    if (Array.isArray(o.materials) && o.materials.length > 12 && o.materials.every((m: unknown) => typeof m === 'string')) {
      o.materials = foldList(o.materials, 12);
      log.push('materials: more than 12 items; the rest joined into the 12th');
    }
    for (const [i, f] of (Array.isArray(o.flow) ? o.flow : []).entries()) {
      if (typeof f.minutes === 'string') f.minutes = parseInt(f.minutes, 10);
      if (typeof f.phase === 'string' && !(PHASES as readonly string[]).includes(f.phase)) {
        const k = f.phase.toLowerCase().replace(/[\s-]+/g, '_');
        const fixed = PHASES.find((ph) => k.startsWith(ph)) ?? PHASE_ALIASES[k.replace(/_\d+$/, '')];
        if (fixed) {
          log.push(`flow[${i}].phase ${f.phase} → ${fixed}`);
          f.phase = fixed;
        }
      }
    }
    // Timing: the lesson is 45 minutes. A small miscount is fixed on the longest teaching step, and logged.
    if (Array.isArray(o.flow) && o.flow.length) {
      const total = o.flow.reduce((n: number, f: any) => n + (Number(f.minutes) || 0), 0);
      const diff = 45 - total;
      if (diff !== 0 && Math.abs(diff) <= 15) {
        const steps = o.flow.map((f: any, i: number) => ({ i, m: Number(f.minutes) || 0, dev: f.phase === 'developing_understanding' }));
        const pick = steps.filter((x: any) => x.dev).sort((a: any, b: any) => b.m - a.m)[0] ?? steps.sort((a: any, b: any) => b.m - a.m)[0];
        if (pick && pick.m + diff >= 1) {
          o.flow[pick.i].minutes = pick.m + diff;
          log.push(`flow minutes added up to ${total}; step ${pick.i} changed by ${diff} to make 45`);
        }
      }
    }
    const slides: any[] = Array.isArray(o.slides) ? o.slides : [];
    const idMap = new Map<string, string>();
    slides.forEach((s, i) => {
      const id = `d${day}s${i + 1}`;
      if (s.id !== id) {
        if (typeof s.id === 'string') idMap.set(s.id, id);
        log.push(`slide ${String(s.id)} renumbered ${id}`);
      }
      s.id = id;
      s.day = day;
      s.lines ??= [];
      s.choices ??= [];
      if (Array.isArray(s.lines) && s.lines.some((l: unknown) => typeof l === 'string' && stripEnumerator(l).length > lineMax('en'))) {
        const fixed = s.lines.flatMap((l: unknown) =>
          typeof l === 'string' && stripEnumerator(l).length > lineMax('en')
            ? (splitSlideLine(stripEnumerator(l), lineMax('en')) ?? (stripEnumerator(l).length > 130 ? (splitAtComma(stripEnumerator(l), 130) ?? [l]) : [l]))
            : [l]
        );
        if (fixed.length <= 5 && fixed.length !== s.lines.length) {
          s.lines = fixed;
          log.push(`slide ${id}: long line split at a sentence boundary`);
        }
      }
      s.revealOf ??= null;
      s.correctChoice ??= null;
      if (typeof s.image === 'string') s.image = { slug: s.image, alt: '' };
      if (s.image && typeof s.image === 'object' && typeof s.image.alt === 'string' && s.image.alt.length > 200) {
        s.image.alt = clampText(s.image.alt, 200);
        log.push(`slide ${id}: image alt text shortened to 200 characters`);
      }
      if (s.image && typeof s.image === 'object') {
        const cand = art.get(s.image.slug);
        if (!cand) {
          log.push(`slide ${id}: image ${String(s.image.slug)} is not an approved candidate; removed`);
          s.image = null;
        } else if (!s.image.alt) s.image.alt = cand.titles[0] ?? s.image.slug;
      } else s.image = null;
    });
    slides.forEach((s, i) => {
      if (s.revealOf && idMap.has(s.revealOf)) s.revealOf = idMap.get(s.revealOf);
      if (s.kind === 'reveal' && slides[i - 1]?.kind === 'check' && s.revealOf !== slides[i - 1].id) {
        log.push(`slide ${s.id}: revealOf set to ${slides[i - 1].id}`);
        s.revealOf = slides[i - 1].id;
      }
      // A "reveal" that does not follow a check is an explanation (e.g. of an activity's result): show it as one.
      if (s.kind === 'reveal' && slides[i - 1]?.kind !== 'check') {
        log.push(`slide ${s.id}: reveal without a check before it shown as a concept slide`);
        s.kind = 'concept';
        s.revealOf = null;
        s.correctChoice = null;
      }
    });
    // Flow ↔ slides: every slide in exactly one step, in deck order, steps never going backwards.
    const flow: any[] = Array.isArray(o.flow) ? o.flow : [];
    if (flow.length && slides.length) {
      const stepOf = new Map<string, number>();
      flow.forEach((f, k) =>
        (Array.isArray(f.slideIds) ? f.slideIds : []).forEach((id: string) => {
          const nid = idMap.get(id) ?? id;
          if (!stepOf.has(nid)) stepOf.set(nid, k);
        })
      );
      let current = 0;
      const assigned = slides.map((s) => {
        const k = stepOf.has(s.id) ? Math.max(current, stepOf.get(s.id)!) : current;
        current = k;
        return k;
      });
      const before = JSON.stringify(flow.map((f) => f.slideIds));
      flow.forEach((f, k) => {
        f.slideIds = slides.filter((_, i) => assigned[i] === k).map((s) => s.id);
      });
      if (JSON.stringify(flow.map((f) => f.slideIds)) !== before) log.push('flow slideIds rebuilt to cover every slide once, in deck order');
    }
    return o;
  };
}


const same = (a: string, b: string) => a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') === b.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Every slide: a line that only repeats the title is dropped (the question was shown twice on the TV). */
export function tidySlide<T extends { kind: string; title: string; lines: string[]; choices: string[] }>(s: T): T {
  const lines = s.lines.filter((l) => !same(l, s.title));
  return tidyCheckSlide(lines.length === s.lines.length ? s : { ...s, lines });
}

/** Check slides: options belong in `choices` only (no letters); the question is the title when it fits. */
export function tidyCheckSlide<T extends { kind: string; title: string; lines: string[]; choices: string[] }>(s: T): T {
  if (s.kind !== 'check') return s;
  const lettered = s.lines.filter((l) => /^[A-D][.)]\s+\S/.test(l));
  const rest = s.lines.filter((l) => !/^[A-D][.)]\s+\S/.test(l));
  const strip = (c: string) => c.replace(/^[A-D][.)]\s+/, '').trim();
  let choices = s.choices.map(strip).filter(Boolean);
  if (lettered.length >= 2 && (choices.every((c) => c.length <= 2) || choices.length !== lettered.length)) choices = lettered.map(strip);
  let title = s.title;
  let lines = rest;
  if (/^(quick\s+)?(check|review|question)\b/i.test(title) && lines.length === 1 && lines[0]!.length <= 60) {
    title = lines[0]!;
    lines = [];
  }
  return { ...s, title, lines, choices };
}


/** The previous week's day plan on the same competencies, from the library, as a short summary. */
export function previousWeekPlan(t: WeekTarget): string | null {
  if (t.week <= 1) return null;
  const prevId = t.targetId.replace(/w\d{2}$/, `w${String(t.week - 1).padStart(2, '0')}`);
  const file = resolve(LIBRARY, prevId, 'en', 'pack.json');
  if (!existsSync(file)) return null;
  const prev = JSON.parse(readFileSync(file, 'utf8')) as WeeklyPackContent;
  const shared = prev.competencies.some((c) => t.competencies.some((x) => x.id === c.id));
  if (!shared) return null;
  return prev.days.map((d) => `- Day ${d.day}: ${d.title} — ${d.objective}`).join('\n');
}

export interface DraftResult {
  content: WeeklyPackContent;
  outline: OutlineOut;
  costUsd: number;
}

export function outlineSummaryForDays(o: OutlineOut): string {
  return JSON.stringify({
    title: o.title,
    bigIdea: o.guide.bigIdea,
    vocabulary: o.guide.vocabulary.map((v) => `${v.term}: ${v.meaning}`),
    misconceptions: o.guide.misconceptions.map((m) => `${m.belief} → ${m.correctIdea}`),
    safety: o.guide.safety,
    days: o.days,
  });
}

export async function draftPack(meter: Meter, t: WeekTarget, opts: { writer?: ModelSpec; dayWriter?: ModelSpec; thinking?: boolean; dayThinking?: boolean; force?: boolean } = {}): Promise<DraftResult> {
  // Tiers (Luis, 2026-11-19): the week's design and teacher-guide science use the stronger model with reasoning;
  // the high-volume day plans, slides and notes use DeepSeek V4.1 Flash, Tala's default generator.
  const spec = opts.writer ?? MODELS.writer;
  const daySpec = opts.dayWriter ?? MODELS.writerFlash;
  const thinking = opts.thinking ?? true;
  const start = meter.spentUsd;
  const grounding = groundingFor(t);
  const art = artCandidatesFor(t);
  const outlinePrompt = loadPrompt('pack-outline.v1');
  const target = describeTarget(t);
  // Continuity across a multi-week DepEd topic: the previous week's actual lessons, when that week shares
  // competencies with this one and is already built. Appended only then, so other prompts are unchanged.
  const previous = previousWeekPlan(t);
  const outline = await stage({
    meter,
    packId: t.targetId,
    name: 'outline',
    spec,
    thinking,
    force: opts.force,
    maxTokens: 32_000,
    schema: OutlineOut,
    check: outlineChecks(t),
    prompt:
      fill(outlinePrompt.text, {
        TARGET: target,
        BOW_ACTIVITIES: bowActivitiesFor(t),
        GROUNDING: grounding.text,
        REFERENCES: referencesText(),
        GRADE: t.grade,
      }) +
      (previous
        ? `\n\nLAST WEEK'S LESSONS ON THIS TOPIC (already taught; build on them, do not repeat them):\n${previous}`
        : ''),
  });
  const dayPrompt = loadPrompt('pack-day.v1');
  const allowed = new Set(art.map((a) => a.slug));
  const compIds = new Set(t.competencies.map((c) => c.id));
  const outlineJson = outlineSummaryForDays(outline.value);
  // Day expansions run without model reasoning: the science is settled in the reasoned outline and the
  // independent critique reads every day. With reasoning on, one day call spent its whole token budget
  // reasoning and returned no content (2026-11-19).
  const days: DayOut[] = await Promise.all(
    outline.value.days.map(async (d) => {
      const res = await stage({
        meter,
        packId: t.targetId,
        name: `day${d.day}`,
        spec: daySpec,
        thinking: opts.dayThinking ?? false,
        force: opts.force,
        maxTokens: 16_000,
        schema: DayOut,
        check: dayChecks(d.day, allowed, compIds),
        normalize: normalizeDay(d.day, new Map(art.map((a) => [a.slug, a]))),
        prompt: fill(dayPrompt.text, {
          TARGET: target,
          OUTLINE: outlineJson,
          DAY: String(d.day),
          DAY_TITLE: d.title.replace(/"/g, "'"),
          DAY_OUTLINE: JSON.stringify(d),
          ART: artText(art),
          GRADE: t.grade,
        }),
      });
      return res.value;
    })
  );
  const content = assemble(t, outline.value, days, {
    promptIds: [outlinePrompt.id, dayPrompt.id],
    writer: spec,
    dayWriter: daySpec,
    groundingIds: grounding.ids,
  });
  return { content, outline: outline.value, costUsd: meter.spentUsd - start };
}

export function coverSlide(t: WeekTarget, title: string): z.infer<typeof Slide> {
  return {
    id: 'd0s1',
    day: 0,
    kind: 'cover',
    title,
    lines: [`Grade ${t.grade} Science · Term ${t.term} · Week ${t.week}`, 'Five 45-minute lessons'],
    choices: [],
    revealOf: null,
    correctChoice: null,
    image: null,
    notes:
      'How to use this deck: each lesson starts with a "Day" slide. Speaker notes under every slide tell you what to say, ' +
      'what to ask and the answers to expect; they show only in Presenter View, never on the TV. Question slides come ' +
      'before their answer slides, so learners can think before the answer appears. The teacher guide (separate PDF) ' +
      'explains the science behind the week, common wrong ideas, and the full answer key.',
  };
}

export function creditsSlide(t: WeekTarget): z.infer<typeof Slide> {
  return {
    id: 'd0s2',
    day: 0,
    kind: 'credits',
    title: 'About this deck',
    lines: [
      'Prepared by Hiraia for Tala, a free teacher tool',
      `Curriculum: DepEd Grade ${t.grade} Science, 2026 Three-Term Budget of Work`,
      'Drawings: Hiraia science illustration library',
    ],
    choices: [],
    revealOf: null,
    correctChoice: null,
    image: null,
    notes:
      'Sources for the science in this week are listed in the teacher guide. Hiraia is not affiliated with or endorsed by ' +
      'the Department of Education. Check the lesson against your own curriculum guide before teaching.',
  };
}

export function assemble(
  t: WeekTarget,
  o: OutlineOut,
  days: DayOut[],
  meta: { promptIds: string[]; writer: ModelSpec; dayWriter: ModelSpec; groundingIds: string[] }
): WeeklyPackContent {
  const catalog = loadInputs().art;
  const tidied = days.flatMap((d) => d.slides.map(tidySlide));
  // Multiple-choice checks and their reveals use the full width for the options: no picture there.
  const withChoices = new Set(tidied.filter((s) => s.kind === 'check' && s.choices.length).map((s) => s.id));
  const slides = [
    coverSlide(t, o.title),
    ...tidied.map((s) => ((s.kind === 'check' && withChoices.has(s.id)) || (s.kind === 'reveal' && s.revealOf && withChoices.has(s.revealOf)) ? { ...s, image: null } : s)),
    creditsSlide(t),
  ];
  return {
    schemaVersion: PACK_SCHEMA_VERSION,
    packId: t.targetId,
    curriculumVersion: t.curriculumVersion,
    curriculumDataRevision: t.curriculumDataRevision,
    learningAreaId: 'science',
    grade: t.grade,
    term: t.term,
    week: t.week,
    language: 'en',
    title: o.title,
    summary: o.summary,
    competencies: t.competencies.map((c) => ({
      id: c.id,
      text: c.text,
      shortTitle: c.shortTitle,
      weekFrom: c.weekFrom,
      weekTo: c.weekTo,
      position: c.position,
      sourcePage: c.sourcePage,
    })),
    timing: { sessions: 5, minutesPerSession: 45, basis: TIMING_BASIS },
    guide: o.guide,
    days: days.map(({ slides: _s, ...d }) => d),
    assessment: o.assessment,
    slides,
    illustrations: [],
    sensitivity: o.sensitivity,
    provenance: {
      pipelineVersion: PIPELINE_VERSION,
      promptIds: meta.promptIds,
      models: [
        { role: 'design-guide-assessment', provider: meta.writer.provider, model: meta.writer.model },
        { role: 'days-slides-notes', provider: meta.dayWriter.provider, model: meta.dayWriter.model },
      ],
      generatedAt: new Date().toISOString(),
      groundingFactIds: meta.groundingIds.slice(0, 200),
      targetInputHash: t.inputHash,
      artCatalogCommit: catalog.referenceCommit,
    },
  };
}
