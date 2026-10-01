import { sha256 } from './hash';
import type {
  AdmissionMode,
  AssessmentContext,
  AssessmentData,
  AssessmentExposure,
  AssessmentLanguage,
  AssessmentQuestion,
  AssessmentRegistry,
  AssessmentResult,
  AssessmentRole,
  AssessmentSession,
  BankItem,
  Blueprint,
  LanguageInput,
} from './types';

export const FORTNIGHT_MS = 14 * 24 * 60 * 60 * 1000;
export function languageKey(language: LanguageInput): AssessmentLanguage {
  if (language === 'en' || language === 'english') return 'en';
  if (language === 'tl' || language === 'tagalog') return 'tl';
  if (language === 'bis' || language === 'bisaya' || language === 'cebuano') return 'bis';
  throw new Error('Unsupported assessment language.');
}
/** Require an explicit timezone and a real calendar date; Date.parse alone normalizes Feb 30. */
export function validTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
      value
    );
  if (!match) return null;
  const [, y, m, d, h, n, s, z] = match;
  const year = Number(y),
    month = Number(m),
    day = Number(d);
  if (
    year < 1000 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    Number(h) > 23 ||
    Number(n) > 59 ||
    Number(s) > 59
  )
    return null;
  if (z !== 'Z' && (Number(z!.slice(1, 3)) > 23 || Number(z!.slice(4, 6)) > 59)) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}
export function isRecentExposure(
  item: BankItem,
  exposures: AssessmentExposure[],
  now: string
): boolean {
  const end = validTime(now);
  if (end === null) return false;
  return exposures.some((event) => {
    const at = validTime(event.at);
    return (
      at !== null &&
      at <= end &&
      at >= end - FORTNIGHT_MS &&
      event.knowledgePresented === true &&
      event.familyId === item.familyId &&
      item.teachingLinks.some(
        (link) =>
          link.cardId === event.cardId &&
          link.familyId === event.familyId &&
          !!link.hashes[event.language] &&
          link.hashes[event.language] === event.presentedTextSha256
      )
    );
  });
}
function inFoundationScope(item: BankItem, context: AssessmentContext, blueprint?: Blueprint): boolean {
  return context.grade === 3 && blueprint?.student_grade === 3 && item.grade === 0 &&
    typeof blueprint.foundation_scope_id === 'string' &&
    item.scope.foundation_scope_id === blueprint.foundation_scope_id &&
    blueprint.foundation_item_ids?.includes(item.id) === true;
}

export function itemEligible(
  item: BankItem,
  context: AssessmentContext,
  exposures: AssessmentExposure[],
  now: string,
  mode: AdmissionMode,
  blueprint?: Blueprint
): boolean {
  if (
    item.status === 'hold' ||
    item.status === 'retired' ||
    (Array.isArray(item.review.holds) && item.review.holds.length) ||
    item.grade > context.grade
  )
    return false;
  if (mode === 'production' && (!item.productionReady || item.status !== 'ready_for_pilot'))
    return false;
  // Kindergarten foundations have their own reviewed scope. A low numeric grade or
  // a reused topic label must never grant blanket admission to a different pathway.
  const foundation = inFoundationScope(item, context, blueprint);
  if (item.scope.foundation_scope_id !== undefined && !foundation) return false;
  if (
    isRecentExposure(item, exposures, now) ||
    context.teacherCoveredTargets?.includes(item.targetId)
  )
    return true;
  if (!foundation && item.grade !== context.grade - 1) return false;
  // This explicit evaluation route measures Hiraia prior-level recall, never verified grade readiness.
  return (
    mode === 'local_evaluation' ||
    !!context.confirmedPriorCurricula?.some(
      (c) => c.grade === item.grade && c.curriculumVersion === item.curriculumVersion
    )
  );
}
function rank(seed: string, id: string): string {
  return sha256(`${seed}|${id}`);
}
function shuffled<T>(values: T[], seed: string, key: (value: T) => string): T[] {
  return values
    .map((value) => ({ value, rank: rank(seed, key(value)) }))
    .sort((a, b) => a.rank.localeCompare(b.rank))
    .map((x) => x.value);
}
interface Slot {
  id: string;
  role: AssessmentRole;
  candidates: BankItem[];
}
interface FormPick {
  slot: Slot;
  item: BankItem;
}
export type Selection = { ok: true; session: AssessmentSession } | { ok: false; reason: string };

function choose(slots: Slot[], history: AssessmentResult[], seed: string): FormPick[] | null {
  const priorForms = history.map((r) => new Set(r.session.items.map((i) => i.id)));
  const recentIds = new Set(history.slice(-3).flatMap((r) => r.session.items.map((i) => i.id)));
  const counts = new Map<string, number>();
  for (const row of history)
    for (const item of row.session.items) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
  const priority = new Map<string, string>();
  for (const slot of slots)
    for (const item of slot.candidates)
      if (!priority.has(item.id)) priority.set(item.id, rank(seed, item.id));
  const ordered = slots
    .map((slot) => ({
      ...slot,
      candidates: [...slot.candidates].sort(
        (a, b) =>
          Number(recentIds.has(a.id)) - Number(recentIds.has(b.id)) ||
          (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0) ||
          priority.get(a.id)!.localeCompare(priority.get(b.id)!)
      ),
    }))
    .sort(
      (a, b) =>
        a.candidates.length - b.candidates.length ||
        Number(b.role === 'benchmark') - Number(a.role === 'benchmark') ||
        a.id.localeCompare(b.id)
    );
  const selected: FormPick[] = [],
    families = new Set<string>(),
    facts = new Set<string>(),
    ids = new Set<string>();
  let visits = 0;
  function visit(index: number, repeated: number): boolean {
    if (++visits > 100000) return false; // Fail closed rather than blocking the UI indefinitely.
    if (index === ordered.length)
      return !priorForms.some(
        (form) => form.size === ids.size && [...ids].every((id) => form.has(id))
      );
    const slot = ordered[index]!;
    const previousSame =
      slot.role === 'benchmark'
        ? undefined
        : [...selected].reverse().find((p) => p.slot.role === slot.role &&
            p.slot.candidates.length === slot.candidates.length &&
            p.slot.candidates.every((candidate, n) => candidate.id === slot.candidates[n]?.id));
    for (const item of slot.candidates) {
      if (
        ids.has(item.id) ||
        families.has(item.familyId) ||
        item.sourceFactIds.some((id) => facts.has(id))
      )
        continue;
      // Only interchangeable slots share ordering constraints. Balanced baselines
      // also contain same-role slots with different domain pools.
      if (
        previousSame &&
        slot.candidates.indexOf(item) <=
          slot.candidates.findIndex((c) => c.id === previousSame.item.id)
      )
        continue;
      const nextRepeated = repeated + Number(recentIds.has(item.id));
      if (nextRepeated > 2) continue;
      ids.add(item.id);
      families.add(item.familyId);
      item.sourceFactIds.forEach((id) => facts.add(id));
      selected.push({ slot, item });
      if (visit(index + 1, nextRepeated)) return true;
      selected.pop();
      ids.delete(item.id);
      families.delete(item.familyId);
      item.sourceFactIds.forEach((id) => facts.delete(id));
    }
    return false;
  }
  return visit(0, 0) ? selected : null;
}

export function selectAssessment(
  registry: AssessmentRegistry,
  context: AssessmentContext,
  data: Pick<AssessmentData, 'history' | 'exposures'>,
  now: string,
  seed: string,
  mode: AdmissionMode
): Selection {
  if (validTime(now) === null)
    return { ok: false, reason: 'The device date is invalid. Set a valid date before starting.' };
  const blueprint = registry.blueprints.find((b) => b.student_grade === context.grade);
  if (!blueprint) return { ok: false, reason: 'There is no assessment blueprint for this grade.' };
  if (
    mode === 'production' &&
    (!registry.productionEnabled ||
      !blueprint.curriculum_cohort_verified ||
      blueprint.status !== 'ready_for_pilot')
  )
    return { ok: false, reason: 'Assessment content and curriculum reviews are still pending.' };
  const language = languageKey(context.language);
  const history = data.history.filter((r) => r.session.profileId === context.profileId);
  const benchmarkIds = new Set(
    blueprint.benchmark_slots.flatMap((slot) => slot.candidate_item_ids)
  );
  const benchmarkItems = registry.items.filter((i) => benchmarkIds.has(i.id));
  const benchmarkRevision = sha256(
    JSON.stringify(
      benchmarkItems.map((i) => ({
        id: i.id,
        revision: i.revision,
        content: i.content,
        demand: i.demand,
      }))
    )
  );
  const comparisonKey = sha256(
    JSON.stringify({
      grade: context.grade,
      language,
      blueprint: blueprint.revision,
      benchmarkRevision,
      mode,
      curricula: [...new Set(benchmarkItems.map((i) => i.curriculumVersion))].sort(),
      demand: 'recall',
    })
  );
  const baseline = !history.some((r) => r.session.comparisonKey === comparisonKey);
  const firstGradeBaseline = !history.some((r) => r.session.grade === context.grade);
  const eligible = registry.items.filter((i) =>
    itemEligible(i, context, data.exposures, now, mode, blueprint)
  );
  const byId = new Map(eligible.map((i) => [i.id, i]));
  let picks: FormPick[] | null = null;
  if (baseline && firstGradeBaseline) {
    const benchmarkMap = new Map(
      Object.entries(blueprint.baseline_benchmark_item_ids).map(([slot, id]) => [id, slot])
    );
    const slots: Slot[] = blueprint.baseline_example_item_ids.map((id) => ({
      id: benchmarkMap.get(id) ?? `readiness-${id}`,
      role: benchmarkMap.has(id) ? 'benchmark' : 'readiness',
      candidates: byId.has(id) ? [byId.get(id)!] : [],
    }));
    if (slots.length === 12 && slots.every((s) => s.candidates.length === 1))
      picks = choose(slots, history, seed);
    if (
      picks &&
      !Object.entries(blueprint.baseline_domain_counts).every(
        ([domain, count]) => picks!.filter((p) => p.item.domain === domain).length === count
      )
    )
      picks = null;
  } else {
    const benchmarks: Slot[] = blueprint.benchmark_slots.map((slot) => ({
      id: slot.id,
      role: 'benchmark',
      candidates: slot.candidate_item_ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
    }));
    const recent = eligible.filter((i) => isRecentExposure(i, data.exposures, now));
    const supplement = eligible.filter(
      (i) =>
        (i.grade === context.grade - 1 || inFoundationScope(i, context, blueprint)) &&
        (baseline || !isRecentExposure(i, data.exposures, now))
    );
    if (benchmarks.length === 6 && benchmarks.every((s) => s.candidates.length)) {
      if (baseline) {
        // A changed comparison segment needs a fresh balanced prior-level baseline.
        // All candidates within a benchmark slot must retain its domain.
        const counts: Record<string, number> = {};
        for (const slot of benchmarks) {
          const domains = new Set(slot.candidates.map((i) => i.domain));
          if (domains.size !== 1)
            return { ok: false, reason: 'The revised baseline needs a curriculum review.' };
          const domain = slot.candidates[0]!.domain;
          counts[domain] = (counts[domain] ?? 0) + 1;
        }
        const readiness: Slot[] = [];
        for (const [domain, total] of Object.entries(blueprint.baseline_domain_counts)) {
          for (let n = counts[domain] ?? 0; n < total; n++)
            readiness.push({
              id: `readiness-${domain}-${n}`,
              role: 'readiness',
              candidates: supplement.filter((i) => i.domain === domain),
            });
        }
        if (readiness.length === 6) picks = choose([...benchmarks, ...readiness], history, seed);
      }
      for (
        let count = Math.min(6, new Set(recent.map((i) => i.familyId)).size);
        !baseline && count >= 0 && !picks;
        count--
      ) {
        const slots = [
          ...benchmarks,
          ...Array.from({ length: count }, (_, n) => ({
            id: `recent-${n}`,
            role: 'recent' as const,
            candidates: recent,
          })),
          ...Array.from({ length: 6 - count }, (_, n) => ({
            id: `readiness-${n}`,
            role: 'readiness' as const,
            candidates: supplement,
          })),
        ];
        picks = choose(slots, history, seed);
      }
    }
  }
  if (!picks || picks.length !== 12)
    return {
      ok: false,
      reason:
        'We need more eligible questions to make a fresh 12-item assessment. Keep learning and try again later.',
    };
  const questions: AssessmentQuestion[] = picks.map(({ item, slot }) => ({
    id: item.id,
    itemId: item.id,
    revision: item.revision,
    stem: item.content.stem[language],
    options: shuffled(item.content.options, `${seed}|options|${item.id}`, (o) => o.id).map((o) => ({
      id: o.id,
      text: o.text[language],
    })),
    correctOptionId: item.content.correct_option_id,
    explanation: item.content.explanation[language],
    ...(item.content.diagram ? { diagram: { ...item.content.diagram }, diagramRequired: true as const } : {}),
    role: slot.role,
    benchmarkSlotId: slot.role === 'benchmark' ? slot.id : null,
    domain: item.domain,
    targetId: item.targetId,
    claim: item.claim,
    claimLimit: item.claimLimit,
    familyId: item.familyId,
    sourceFactIds: [...item.sourceFactIds],
    productionReady: item.productionReady,
    review: JSON.parse(JSON.stringify(item.review)) as Record<string, unknown>,
  }));
  const repeated = new Set(history.slice(-3).flatMap((r) => r.session.items.map((i) => i.id)));
  return {
    ok: true,
    session: {
      id: `ha-${sha256(`${context.profileId}|${seed}|${now}`).slice(0, 24)}`,
      profileId: context.profileId,
      grade: context.grade,
      language,
      startedAt: now,
      seed,
      admissionMode: mode,
      curriculumMatch: mode === 'local_evaluation' ? 'unverified' : 'confirmed',
      comparisonLabel: 'Hiraia-only',
      clockTrust: 'device_time_unverified',
      blueprintId: blueprint.id,
      blueprintRevision: blueprint.revision,
      registryInputHash: registry.inputHash,
      comparisonKey,
      kind: baseline ? 'baseline' : 'followup',
      exactRepeats: questions.filter((i) => repeated.has(i.id)).length,
      items: shuffled(questions, `${seed}|paper`, (q) => q.id),
      answers: [],
    },
  };
}

export function resultFor(
  session: AssessmentSession,
  completedAt: string,
  history: AssessmentResult[]
): AssessmentResult {
  if (session.answers.length !== 12 || session.items.length !== 12)
    throw new Error('Only complete assessments can be scored.');
  const answers = new Map(session.answers.map((answer) => [answer.itemId, answer]));
  if (answers.size !== 12 || session.items.some((item) =>
    !item.options.some((option) => option.id === answers.get(item.id)?.optionId)))
    throw new Error('Every question needs exactly one valid answer before scoring.');
  const scored = session.items.map((item) => ({
    item,
    correct: Number(answers.get(item.id)!.optionId === item.correctOptionId),
  }));
  const score = (role?: AssessmentRole) => {
    const rows = role ? scored.filter((r) => r.item.role === role) : scored;
    return { correct: rows.reduce((n, r) => n + r.correct, 0), total: rows.length };
  };
  const prior = history.filter((r) => r.session.comparisonKey === session.comparisonKey).at(-1);
  const targets = [...new Set(scored.map((r) => r.item.targetId))];
  const targetInsights = targets.map((targetId) => {
    const rows = scored.filter((r) => r.item.targetId === targetId),
      correct = rows.reduce((n, r) => n + r.correct, 0);
    const earlierMiss = history
      .filter(
        (r) =>
          r.session.grade === session.grade &&
          r.session.language === session.language &&
          r.session.admissionMode === session.admissionMode
      )
      .slice(-3)
      .some((r) => r.targetInsights.some((t) => t.targetId === targetId && t.correct < t.total));
    return {
      targetId,
      correct,
      total: rows.length,
      recommendation:
        correct === rows.length
          ? ('remembered' as const)
          : earlierMiss
            ? ('reinforce' as const)
            : ('recheck' as const),
    };
  });
  // Support changes start a new practical comparison segment, even with the same language.
  const supported = session.answers.some((a) => a.supportUsed === 'read_aloud');
  const priorSupported = prior?.session.answers.some((a) => a.supportUsed === 'read_aloud');
  return {
    session,
    completedAt,
    score: score(),
    benchmark: score('benchmark'),
    recent: score('recent'),
    readiness: score('readiness'),
    targetInsights,
    comparison:
      prior && priorSupported === supported
        ? {
            previousCompletedAt: prior.completedAt,
            benchmarkDifference: score('benchmark').correct - prior.benchmark.correct,
          }
        : null,
  };
}
