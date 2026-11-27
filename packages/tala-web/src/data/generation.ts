/**
 * Lesson generation (PRD §9) on the client: build the request from records (counts only, never names),
 * poll the server job, and write the result through the sync engine as one operation — previous text kept as
 * `section_revision` (LLM-4), plan marked AI draft. Failures land on the pre-filled template; offline → queued.
 */
import { applyGeneratedSections, blankSections } from '@hiraia/tala-core/plan';
import { buildPrefilledDraft } from '@hiraia/tala-core/generation';
import {
  BUILTIN_TEMPLATES,
  TalaApiError,
  type ClassRecord,
  type Competency,
  type EntityName,
  type GenerationInput,
  type GenerationJob,
  type Lang,
  type Plan,
  type PlanSection,
  type SectionContent,
  type SyncEngine,
  type TalaClient,
  type Template,
} from '@hiraia/tala-core/contracts';
import type { KvCache } from './cache';
import { newId as defaultNewId, nowIso } from './ids';

export interface BuildArgs {
  plan: Plan;
  cls: ClassRecord | null;
  template: Template;
  language: Lang;
  guidance?: string;
  kind?: GenerationInput['kind'];
  sectionKey?: string;
  instruction?: string;
  priorPlanId?: string;
  /** Client-generated; the same key from the same account returns the same job, charged once (RES-5). */
  idempotencyKey?: string;
}

/** Inputs per §9.2. Grade groups carry counts only; roster names are never part of the request. */
export function buildGenerationInput(a: BuildArgs): GenerationInput {
  const groupIds = a.plan.gradeGroupIds.length
    ? a.plan.gradeGroupIds
    : (a.cls?.gradeGroups.map((g) => g.id) ?? []);
  const gradeGroups = groupIds.map((id, i) => {
    const g = a.cls?.gradeGroups.find((x) => x.id === id);
    return {
      id,
      grade: g?.grade ?? a.plan.grades[i] ?? a.plan.grades[0]!,
      learnerCount: g?.learnerCount ?? null,
    };
  });
  const competencies: Record<string, string[]> = {};
  for (const id of groupIds) competencies[id] = (a.plan.competencies[id] ?? []).slice(0, 12);
  return {
    idempotencyKey: a.idempotencyKey ?? defaultNewId(),
    kind: a.kind ?? 'full',
    planId: a.plan.id,
    templateId: a.template.id,
    language: a.language,
    subjectName: a.plan.subjectName,
    learningAreaId: a.plan.learningAreaId,
    timeBudgetMinutes: Math.max(10, Math.min(480, a.plan.durationMinutes)),
    sessions: a.template.span === 'week' ? 5 : 1,
    gradeGroups: gradeGroups.length
      ? gradeGroups
      : [{ id: 'g1', grade: a.plan.grades[0]!, learnerCount: null }],
    competencies,
    curriculumVersion: a.plan.curriculumVersion,
    customObjectives: a.plan.customObjectives,
    classProfile: a.cls?.profile ?? {
      materials: [],
      textbooks: [],
      electricity: null,
      projector: null,
      printing: null,
      outdoorSpace: null,
      notes: '',
    },
    guidance: (a.guidance ?? '').slice(0, 1000),
    priorPlanId: a.priorPlanId,
    sectionKey: a.sectionKey,
    instruction: a.instruction?.slice(0, 500),
  };
}

export function hasObjectives(input: GenerationInput): boolean {
  return (
    Object.values(input.competencies).some((ids) => ids.length) || input.customObjectives.length > 0
  );
}

export type BatchOp =
  | { op: 'put'; entity: EntityName; data: unknown }
  | { op: 'remove'; entity: EntityName; id: string };

/** One durable local operation (contract `SyncEngine.batch`): every change lands or none does. */
export function writeBatch(engine: SyncEngine, ops: BatchOp[]): Promise<void> {
  return ops.length ? engine.batch(ops) : Promise.resolve();
}

/** Write a finished job into the plan: section_revisions first, then sections, then the plan (AI draft). */
export async function applyGenerationJob(
  engine: SyncEngine,
  plan: Plan,
  sections: PlanSection[],
  job: GenerationJob,
  newId: () => string,
  confirmedSectionIds: string[] = []
): Promise<Plan> {
  if (job.status !== 'done' || !job.result) throw new Error('Job is not done.');
  const gen = job.result.sections[0]?.gen ?? {
    provider: job.result.provider,
    model: job.result.model,
    promptId: 'lesson',
    promptVersion: 0,
    curriculumVersion: plan.curriculumVersion,
    at: nowIso(),
  };
  const applied = applyGeneratedSections({
    plan: { ...plan, title: plan.title || job.result.title },
    sections,
    generated: job.result.sections.map((s) => ({ key: s.key, content: s.content })),
    gen,
    newId,
    confirmedSectionIds,
  });
  const ops: BatchOp[] = [
    ...applied.revisions.map((r) => ({
      op: 'put' as const,
      entity: 'section_revision' as const,
      data: r,
    })),
    ...applied.sections.map((s) => ({
      op: 'put' as const,
      entity: 'plan_section' as const,
      data: s,
    })),
    { op: 'put', entity: 'plan', data: applied.plan },
  ];
  await writeBatch(engine, ops);
  return applied.plan;
}

/** Fallback (§9.4): the template pre-filled with competencies, class details and time blocks. Never overwrites teacher text. */
export async function prefillPlan(
  engine: SyncEngine,
  plan: Plan,
  sections: PlanSection[],
  input: GenerationInput,
  template: Template,
  competencies: Competency[]
): Promise<void> {
  const resolvedObjectives: Record<string, string[]> = {};
  for (const [gid, ids] of Object.entries(input.competencies))
    resolvedObjectives[gid] = ids.map((id) => competencies.find((c) => c.id === id)?.text ?? id);
  const draft = buildPrefilledDraft({ ...input, template, resolvedObjectives });
  const ops: BatchOp[] = [];
  for (const d of draft.sections) {
    const existing = sections.find((s) => s.key === d.key);
    if (!existing || existing.editedByTeacher) continue;
    const content = normaliseIds(d.content);
    ops.push({
      op: 'put',
      entity: 'plan_section',
      data: { ...existing, content, origin: 'manual' as const },
    });
  }
  if (!plan.title) ops.push({ op: 'put', entity: 'plan', data: { ...plan, title: draft.title } });
  if (ops.length) await writeBatch(engine, ops);
}

/** The shared helper uses fixed ids for its placeholder step/block; give them unique ids. */
function normaliseIds(content: SectionContent): SectionContent {
  const id = () => `pf-${Math.random().toString(36).slice(2, 10)}`;
  if (content.type === 'procedure')
    return { ...content, steps: content.steps.map((s) => ({ ...s, id: id() })) };
  if (content.type === 'multigrade')
    return { ...content, blocks: content.blocks.map((b) => ({ ...b, id: id() })) };
  return content;
}

/** Switch a plan whose class has several groups to the multi-grade template (server requires it). */
export async function switchTemplate(
  engine: SyncEngine,
  plan: Plan,
  sections: PlanSection[],
  template: Template,
  newId: () => string
): Promise<void> {
  const ops: BatchOp[] = sections.map((s) => ({
    op: 'remove' as const,
    entity: 'plan_section' as const,
    id: s.id,
  }));
  for (const s of blankSections(
    template,
    plan.id,
    plan.gradeGroupIds.map((id) => ({ id })),
    newId
  ))
    ops.push({ op: 'put', entity: 'plan_section', data: s });
  ops.push({ op: 'put', entity: 'plan', data: { ...plan, templateId: template.id } });
  await writeBatch(engine, ops);
}

export const MULTIGRADE_TEMPLATE = BUILTIN_TEMPLATES.find((t) => t.kind === 'multigrade')!;

/* ---------- polling ---------- */

export const TERMINAL: ReadonlyArray<GenerationJob['status']> = ['done', 'failed', 'cancelled'];

export async function pollJob(
  client: TalaClient,
  jobId: string,
  signal: AbortSignal,
  onTick?: (job: GenerationJob) => void,
  sleep = defaultSleep
): Promise<GenerationJob> {
  let delay = 1000;
  for (;;) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    let job: GenerationJob | null = null;
    try {
      job = await client.call('generation.get', { params: { jobId }, signal });
    } catch (err) {
      if (!(err instanceof TalaApiError && err.retryable)) throw err;
    }
    if (job) {
      onTick?.(job);
      if (TERMINAL.includes(job.status)) return job;
    }
    await sleep(delay, signal);
    delay = Math.min(5000, Math.round(delay * 1.5));
  }
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/* ---------- queue (LLM-7, RES-8): requests kept on the device until they can run ---------- */

export interface QueuedGeneration {
  id: string;
  planId: string;
  input: GenerationInput;
  /** Set once the server accepted the request; the runner then only polls. */
  jobId: string | null;
  confirmedSectionIds: string[];
  createdAt: string;
}

const QUEUE_KEY = 'generation.queue';

export async function listQueue(cache: KvCache): Promise<QueuedGeneration[]> {
  return (await cache.get<QueuedGeneration[]>(QUEUE_KEY)) ?? [];
}
export async function enqueue(cache: KvCache, item: QueuedGeneration): Promise<void> {
  const q = (await listQueue(cache)).filter((x) => x.id !== item.id);
  await cache.set(QUEUE_KEY, [...q, item]);
}
export async function dequeue(cache: KvCache, id: string): Promise<void> {
  await cache.set(
    QUEUE_KEY,
    (await listQueue(cache)).filter((x) => x.id !== id)
  );
}
export async function updateQueued(
  cache: KvCache,
  id: string,
  patch: Partial<QueuedGeneration>
): Promise<void> {
  await cache.set(
    QUEUE_KEY,
    (await listQueue(cache)).map((x) => (x.id === id ? { ...x, ...patch } : x))
  );
}

/* ---------- failures of queued requests: kept on the device until the teacher has seen them (27 Nov 2026) ---------- */

/** A queued or background request that ended without a usable result. Shown in its lesson; never dropped silently. */
export interface QueuedFailure {
  id: string;
  planId: string;
  sectionKey: string | null;
  reason: string;
  at: string;
}

const FAILED_KEY = 'generation.failed';
/** Fired on window when a failure is recorded, so an open lesson shows it at once. */
export const FAILURE_EVENT = 'tala:generation-failed';

export async function listFailures(cache: KvCache): Promise<QueuedFailure[]> {
  return (await cache.get<QueuedFailure[]>(FAILED_KEY)) ?? [];
}
export async function recordFailure(cache: KvCache, failure: QueuedFailure): Promise<void> {
  const list = (await listFailures(cache)).filter((f) => f.id !== failure.id);
  await cache.set(FAILED_KEY, [...list, failure].slice(-20));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(FAILURE_EVENT));
}
export async function clearFailure(cache: KvCache, id: string): Promise<void> {
  await cache.set(
    FAILED_KEY,
    (await listFailures(cache)).filter((f) => f.id !== id)
  );
}
/** The reason to show for an error that ended a queued request (the same words as the sheet uses). */
export function failureReason(err: unknown): string {
  if (err instanceof TalaApiError) {
    const detail = (err.details as { reason?: string } | undefined)?.reason;
    if (detail === 'no_class_resources') return 'no_class_resources';
    if (err.code === 'quota_exceeded' || err.code === 'rate_limited') return 'quota_exceeded';
    return 'invalid_input';
  }
  return 'providers_unavailable';
}
