import { DEFAULT_LESSON_PROMPT_VERSION, lessonRequest } from './compact';
import {
  BUILTIN_TEMPLATES,
  type GenerationInput,
  type GenerationJob,
  type Template,
} from '@hiraia/tala-core';
import {
  classResources,
  formatCompetencyObjective,
  sectionHasContent,
  validateGeneratedSections,
} from '@hiraia/tala-core/generation';
import {
  HttpError,
  requireUser,
  type BaseDeps,
  type Ctx,
  type ServerModule,
} from '../../kernel/types';
export const migrations = [
  {
    id: 'generation:001_jobs',
    sql: `CREATE TABLE generation_jobs (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, input TEXT NOT NULL, job TEXT NOT NULL, status TEXT NOT NULL); CREATE INDEX generation_pending ON generation_jobs(status);`,
  },
  {
    id: 'generation:002_idempotency',
    sql: 'ALTER TABLE generation_jobs ADD COLUMN idempotency_key TEXT; CREATE UNIQUE INDEX generation_idempotency ON generation_jobs(owner_id,idempotency_key) WHERE idempotency_key IS NOT NULL;',
  },
];
const controllers = new WeakMap<object, Map<string, AbortController>>();
function controls(db: object) {
  let value = controllers.get(db);
  if (!value) {
    value = new Map();
    controllers.set(db, value);
  }
  return value;
}
function read(ctx: Ctx, id: string) {
  const row = ctx.db
    .prepare('SELECT * FROM generation_jobs WHERE id=? AND owner_id=?')
    .get(id, requireUser(ctx).id) as { job: string; input: string } | undefined;
  if (!row) throw new HttpError('not_found', 'Generation request not found.');
  return {
    job: JSON.parse(row.job) as GenerationJob,
    input: JSON.parse(row.input) as GenerationInput,
  };
}
function save(deps: BaseDeps, job: GenerationJob) {
  deps.db
    .prepare('UPDATE generation_jobs SET job=?,status=? WHERE id=?')
    .run(JSON.stringify(job), job.status, job.id);
}
function resolveInput(ctx: Ctx, input: GenerationInput) {
  const template: Template | undefined =
    BUILTIN_TEMPLATES.find((t) => t.id === input.templateId) ??
    ctx.services.records.get(requireUser(ctx).id, 'template', input.templateId)?.data;
  if (!template) throw new HttpError('invalid_input', 'Choose a supported template.');
  if (input.gradeGroups.length > 1 && template.kind !== 'multigrade')
    throw new HttpError('invalid_input', 'Choose the multi-grade template.');
  if (
    input.kind === 'section' &&
    (!input.sectionKey ||
      !template.sections.some((s) => s.key === input.sectionKey && !s.outsideLock))
  )
    throw new HttpError('invalid_input', 'Choose a section.');
  // Materials are written only from what the class has listed (prompt rule and check): with nothing listed the
  // only possible answer is an empty list, which looked like a silent success (27 Nov 2026). Say so instead.
  if (
    input.kind === 'section' &&
    input.sectionKey === 'materials' &&
    classResources(input.classProfile).length === 0
  )
    throw new HttpError(
      'invalid_input',
      'List the materials your class has first. Tala writes materials only from them.',
      { reason: 'no_class_resources' }
    );
  if (input.kind === 'translate' && !input.targetLanguage)
    throw new HttpError('invalid_input', 'Choose Filipino or English for the translation.');
  if (input.kind !== 'full' && !input.planId)
    throw new HttpError('invalid_input', 'Choose a source plan.');
  const resolvedObjectives: Record<string, string[]> = {};
  for (const g of input.gradeGroups) {
    const ids = input.competencies[g.id] ?? [];
    const records = input.curriculumVersion
      ? ctx.services.curriculum.getCompetencies(input.curriculumVersion, ids)
      : [];
    if (records.length !== new Set(ids).size)
      throw new HttpError('invalid_input', 'Download the curriculum or enter your own objectives.');
    resolvedObjectives[g.id] = ids.map((id) => {
      const record = records.find((c) => c.id === id);
      if (!record)
        throw new HttpError(
          'invalid_input',
          'Download the curriculum or enter your own objectives.'
        );
      return formatCompetencyObjective(record);
    });
  }
  if (!Object.values(resolvedObjectives).flat().length && !input.customObjectives.length)
    throw new HttpError('invalid_input', 'Select competencies or enter your own objectives.');
  const snapshot = input.planId
    ? ctx.services.records.planSnapshot(requireUser(ctx).id, input.planId)
    : null;
  if (input.planId && !snapshot) throw new HttpError('not_found', 'Source plan not found.');
  const source =
    snapshot?.sections.map((s) => ({ key: s.data.key, content: s.data.content })) ?? [];
  const prior = input.priorPlanId
    ? ctx.services.records.planSnapshot(requireUser(ctx).id, input.priorPlanId)
    : null;
  if (input.priorPlanId && !prior) throw new HttpError('not_found', 'Previous plan not found.');
  return {
    template,
    resolvedObjectives,
    source,
    prior: prior?.sections.map((s) => ({ key: s.data.key, content: s.data.content })) ?? [],
  };
}
/**
 * A week plan has as many sessions as days in its own week grid (27 Nov 2026: a Saturday-only class's week plan is
 * one Saturday; a Mon/Wed/Sat class's is three days). The browser only sees the plan's dates; the server reads the
 * plan itself. Classic five-day grids are unchanged.
 */
export function withPlanWeekDays(
  input: GenerationInput,
  template: Template,
  source: Array<{ key: string; content: { type: string; days?: Array<{ weekday: number }> } }>
): GenerationInput {
  if (template.span !== 'week') return input;
  const grid = source.find((s) => s.content.type === 'weekgrid')?.content;
  const days = new Set((grid?.days ?? []).map((d) => d.weekday).filter((d) => d >= 1 && d <= 7)).size;
  return days >= 1 && days !== input.sessions ? { ...input, sessions: days } : input;
}
export async function runJob(ctx: Ctx, id: string): Promise<void> {
  const ownerId = requireUser(ctx).id;
  const { job, input } = read(ctx, id);
  if (job.status !== 'queued') return;
  const controller = new AbortController();
  controls(ctx.db).set(id, controller);
  job.status = 'running';
  save(ctx, job);
  try {
    if (!ctx.config.features.generation) {
      job.status = 'failed';
      job.failure = {
        reason: 'disabled',
        message: 'Generation is disabled. Use the pre-filled draft.',
      };
      return;
    }
    const resolved = resolveInput(ctx, input);
    const planned = withPlanWeekDays(input, resolved.template, resolved.source);
    const promptId = `lesson/${input.kind === 'full' ? (input.gradeGroups.length > 1 ? 'multigrade' : resolved.template.span === 'week' ? 'week' : 'single') : input.kind}`;
    const result = await ctx.services.llm.complete(
      lessonRequest(
        { ...planned, template: resolved.template, resolvedObjectives: resolved.resolvedObjectives },
        {
          userId: requireUser(ctx).id,
          newId: ctx.newId,
          source: resolved.source,
          prior: resolved.prior,
          signal: controller.signal,
          version: ctx.config.llm.promptVersions[promptId] ?? DEFAULT_LESSON_PROMPT_VERSION,
        }
      )
    );
    const live = ctx.db
      .prepare('SELECT status,owner_id FROM generation_jobs WHERE id=?')
      .get(id) as { status: string; owner_id: string } | undefined;
    if (!live || live.owner_id !== ownerId || live.status === 'cancelled') return;
    // A rewrite of one part that comes back empty is not a result: nothing is written, and the teacher is told.
    const target =
      result.ok && input.kind === 'section'
        ? result.data.sections.find((s) => s.key === input.sectionKey)?.content
        : undefined;
    if (result.ok && input.kind === 'section' && !sectionHasContent(target)) {
      job.status = 'failed';
      job.failure = {
        reason: 'empty_output',
        message: 'Nothing usable came back for this part. Nothing was changed.',
      };
      ctx.log.warn('generation.empty_output', { kind: input.kind, sectionKey: input.sectionKey ?? null });
    } else if (result.ok) {
      job.status = 'done';
      job.result = {
        title: result.data.title,
        sections: result.data.sections.map((s) => ({
          ...s,
          gen: {
            provider: result.provider,
            model: result.model,
            promptId: result.promptId,
            promptVersion: result.promptVersion,
            curriculumVersion: input.curriculumVersion,
            at: ctx.now().toISOString(),
          },
        })),
        provider: result.provider,
        model: result.model,
        warnings: result.data.warnings ?? [],
      };
    } else if (result.reason === 'cancelled') job.status = 'cancelled';
    else {
      job.status = 'failed';
      job.failure = {
        reason: result.reason === 'rules_only' ? 'disabled' : result.reason,
        message: result.message,
      };
    }
  } catch {
    job.status = 'failed';
    job.failure = {
      reason: 'invalid_input',
      message: 'Check your inputs. You can continue with the pre-filled draft.',
    };
  } finally {
    controls(ctx.db).delete(id);
    const live = ctx.db
      .prepare('SELECT status,owner_id FROM generation_jobs WHERE id=?')
      .get(id) as { status: string; owner_id: string } | undefined;
    if (live && live.owner_id === ownerId && live.status !== 'cancelled') {
      job.finishedAt = ctx.now().toISOString();
      save(ctx, job);
    }
  }
}
export const generationModule: ServerModule = {
  name: 'generation',
  migrations,
  onAccountMerged: (deps, from, to) => {
    if (from === to) return;
    // Preserve every job; a colliding destination key retains its original replay anchor.
    deps.db
      .prepare(
        'UPDATE generation_jobs SET idempotency_key=NULL WHERE owner_id=? AND idempotency_key IN (SELECT idempotency_key FROM generation_jobs WHERE owner_id=?)'
      )
      .run(from, to);
    const running = deps.db
      .prepare("SELECT id FROM generation_jobs WHERE owner_id=? AND status='running'")
      .all(from) as { id: string }[];
    for (const job of running) controls(deps.db).get(job.id)?.abort();
    deps.db
      .prepare(
        "UPDATE generation_jobs SET owner_id=?,status=CASE WHEN status='running' THEN 'queued' ELSE status END,job=CASE WHEN status='running' THEN json_set(job,'$.status','queued') ELSE job END WHERE owner_id=?"
      )
      .run(to, from);
  },
  onAccountDeleted: (deps, userId) => {
    const jobs = deps.db.prepare('SELECT id FROM generation_jobs WHERE owner_id=?').all(userId) as {
      id: string;
    }[];
    for (const job of jobs) controls(deps.db).get(job.id)?.abort();
    deps.db.prepare('DELETE FROM generation_jobs WHERE owner_id=?').run(userId);
  },
  handlers: {
    'generation.create': (ctx, { body }) =>
      ctx.db
        .transaction(() => {
          const user = requireUser(ctx);
          if (body.idempotencyKey) {
            const existing = ctx.db
              .prepare('SELECT job FROM generation_jobs WHERE owner_id=? AND idempotency_key=?')
              .get(user.id, body.idempotencyKey) as { job: string } | undefined;
            if (existing) return JSON.parse(existing.job) as GenerationJob;
          }
          resolveInput(ctx, body);
          const job: GenerationJob = {
            id: ctx.newId(),
            status: 'queued',
            kind: body.kind,
            planId: body.planId ?? null,
            createdAt: ctx.now().toISOString(),
            finishedAt: null,
            result: null,
            failure: null,
          };
          ctx.db
            .prepare(
              'INSERT INTO generation_jobs(id,owner_id,input,job,status,idempotency_key) VALUES(?,?,?,?,?,?)'
            )
            .run(
              job.id,
              user.id,
              JSON.stringify(body),
              JSON.stringify(job),
              job.status,
              body.idempotencyKey ?? null
            );
          return job;
        })
        .immediate(),
    'generation.get': (ctx, { params }) => read(ctx, params.jobId).job,
    'generation.cancel': (ctx, { params }) => {
      const { job } = read(ctx, params.jobId);
      if (job.status === 'queued' || job.status === 'running') {
        job.status = 'cancelled';
        job.finishedAt = ctx.now().toISOString();
        save(ctx, job);
        controls(ctx.db).get(job.id)?.abort();
      }
      return job;
    },
    'generation.allowance': (ctx) => {
      const user = requireUser(ctx),
        day = ctx.now().toISOString().slice(0, 10);
      const used = (bucket: string) =>
        (
          ctx.db
            .prepare('SELECT used FROM llm_quota WHERE day=? AND user_id=? AND bucket=?')
            .get(day, user.id, bucket) as { used: number } | undefined
        )?.used ?? 0;
      const spent = (
        ctx.db
          .prepare(
            'SELECT COALESCE((SELECT SUM(cost) FROM llm_usage WHERE month=?),0)+COALESCE((SELECT cost FROM llm_deleted_spend WHERE month=?),0) AS cost'
          )
          .get(day.slice(0, 7), day.slice(0, 7)) as { cost: number }
      ).cost;
      return {
        fullRemainingToday: Math.max(0, ctx.config.llm.quotas.fullPerDay - used('full')),
        sectionRemainingToday: Math.max(0, ctx.config.llm.quotas.sectionPerDay - used('section')),
        degraded: spent >= ctx.config.llm.budget.monthlyUsd,
      };
    },
  },
  start: (deps) => {
    deps.db
      .prepare(
        "UPDATE generation_jobs SET status='queued',job=json_set(job,'$.status','queued') WHERE status='running'"
      )
      .run();
    let stopped = false,
      busy = false;
    const tick = async () => {
      if (stopped || busy) return;
      busy = true;
      try {
        const row = deps.db
          .prepare("SELECT id,owner_id FROM generation_jobs WHERE status='queued' LIMIT 1")
          .get() as { id: string; owner_id: string } | undefined;
        if (row)
          await runJob(
            {
              ...deps,
              user: {
                id: row.owner_id,
                email: '',
                emailVerified: true,
                displayName: '',
                sessionId: 'job',
              },
              requestId: row.id,
              ip: null,
            },
            row.id
          );
      } catch {
        deps.log.error('generation.runner_failed');
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => {
      void tick();
    }, 100);
    timer.unref();
    return () => {
      stopped = true;
      clearInterval(timer);
      for (const c of controls(deps.db).values()) c.abort();
    };
  },
};
// Compatibility with kernels that still read the pre-contract extension location.
Object.assign(generationModule, {
  kernel: { onAccountDeleted: generationModule.onAccountDeleted },
});
export default generationModule;
