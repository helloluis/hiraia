import { GenerationInput, Plan, PlanSection, BUILTIN_TEMPLATES } from '@hiraia/tala-core/contracts';
import type {
  SyncEngine,
  LocalStore,
  TalaClient,
  GenerationJob,
  GenerationInput as Input,
  ClassRecord,
} from '@hiraia/tala-core/contracts';
import { buildPrefilledDraft } from '@hiraia/tala-core/generation';
import { applyGeneratedSections, sectionRevision } from '@hiraia/tala-core/plan';
import { atomic, type Operation } from './atomic';
import { taskStore, type DurableTask } from './tasks';
import { retryDelay } from '../runtime/ladder';
export interface GenerationRequest {
  planId: string;
  input: Input;
  resolvedObjectives: Record<string, string[]>;
  fingerprint: string;
}
export const fingerprint = (value: unknown) => JSON.stringify(value);
export function createGeneration(deps: {
  engine: SyncEngine;
  store: LocalStore;
  client: TalaClient;
  newId(): string;
  now(): Date;
}) {
  const { engine, store, client, newId, now } = deps,
    tasks = taskStore(store);
  async function request(
    planId: string,
    patch: Partial<Input> = {},
    resolvedObjectives: Record<string, string[]> = {}
  ) {
    const row = await engine.get('plan', planId);
    if (!row || row.data.state !== 'draft') throw Error('Open a draft');
    const plan = row.data;
    const cls = (await engine.list('class')).find((c) =>
      plan.placements.some((p) => p.classId === c.id)
    )?.data;
    if (!cls) throw Error('Choose a class');
    const input = GenerationInput.parse({
      kind: 'full',
      planId,
      templateId: plan.templateId,
      language: plan.language,
      subjectName: plan.subjectName,
      learningAreaId: plan.learningAreaId,
      timeBudgetMinutes: plan.durationMinutes,
      sessions: BUILTIN_TEMPLATES.find((t) => t.id === plan.templateId)?.span === 'week' ? 5 : 1,
      gradeGroups: cls.gradeGroups,
      competencies: plan.competencies,
      curriculumVersion: plan.curriculumVersion,
      customObjectives: plan.customObjectives,
      classProfile: cls.profile,
      ...patch,
    });
    const sections = (await engine.list('plan_section'))
      .filter((s) => s.data.planId === planId)
      .map((s) => s.data);
    const task: DurableTask<GenerationRequest> = {
      id: newId(),
      kind: 'generation',
      state: 'queued',
      input: { planId, input, resolvedObjectives, fingerprint: fingerprint(sections) },
      attempts: 0,
      nextAt: 0,
      createdAt: now().toISOString(),
    };
    // The fallback exists before any network call; the full request survives process death.
    buildPrefilledDraft({ ...input, resolvedObjectives });
    await tasks.put(task);
    return task;
  }
  async function tick(online: boolean) {
    if (!online) return;
    for (const raw of await tasks.list()) {
      if (
        raw.kind !== 'generation' ||
        !['queued', 'polling'].includes(raw.state) ||
        raw.nextAt > now().getTime()
      )
        continue;
      const task = raw as DurableTask<GenerationRequest>;
      try {
        if (task.cancelRequested) {
          if (task.remoteId)
            await client.call('generation.cancel', { params: { jobId: task.remoteId } });
          await tasks.update(task.id, { state: 'cancelled' });
          continue;
        }
        let job: GenerationJob;
        if (task.remoteId)
          job = await client.call('generation.get', { params: { jobId: task.remoteId } });
        else {
          const sync = await engine.sync();
          if (!sync.ok) throw Error('offline');
          const plan = await engine.get('plan', task.input.planId);
          if (plan?.dirty) throw Error('not_synced');
          await tasks.update(task.id, { state: 'sending' });
          job = await client.call('generation.create', { body: task.input.input });
          await tasks.update(task.id, { remoteId: job.id, state: 'polling' });
        }
        const fresh = (await tasks.list()).find((t) => t.id === task.id);
        if (fresh?.cancelRequested) {
          await tasks.update(task.id, { remoteId: job.id, state: 'polling' });
          continue;
        }
        await tasks.update(task.id, {
          remoteId: job.id,
          result: job,
          state:
            job.status === 'done'
              ? 'ready'
              : job.status === 'failed'
                ? 'failed'
                : job.status === 'cancelled'
                  ? 'cancelled'
                  : 'polling',
          error: job.failure?.reason,
          nextAt: now().getTime() + 4000,
        });
      } catch (e) {
        const current = (await tasks.list()).find((t) => t.id === task.id)!;
        // A lost POST reply is not proof of failure: never create a second paid job automatically.
        await tasks.update(task.id, {
          state: current.state === 'sending' && !current.remoteId ? 'uncertain' : task.state,
          attempts: task.attempts + 1,
          nextAt: now().getTime() + retryDelay(task.attempts),
          error: 'generationUnavailable',
        });
      }
    }
  }
  async function apply(id: string, mode: 'result' | 'fallback', confirmed: boolean) {
    const task = (await tasks.list()).find((t) => t.id === id) as
      | DurableTask<GenerationRequest>
      | undefined;
    if (!task) throw Error('Missing request');
    const plan = (await engine.get('plan', task.input.planId))?.data;
    if (!plan || plan.state !== 'draft') throw Error('Unlock the lesson');
    const sections = (await engine.list('plan_section'))
      .filter((s) => s.data.planId === plan.id)
      .map((s) => s.data);
    if (!confirmed && fingerprint(sections) !== task.input.fingerprint)
      throw Error('Review changed lesson');
    const ops: Operation[] = [];
    if (mode === 'result') {
      const job = task.result as GenerationJob;
      if (job?.status !== 'done' || !job.result) throw Error('Not ready');
      const generated = job.result.sections;
      const gen = generated[0]?.gen;
      if (!gen) throw Error('Empty generation');
      const next = applyGeneratedSections({
        plan,
        sections,
        generated,
        gen,
        newId,
        confirmedSectionIds: confirmed ? sections.map((s) => s.id) : [],
      });
      ops.push(
        ...next.revisions.map((data) => ({
          op: 'put' as const,
          entity: 'section_revision' as const,
          data,
        })),
        ...next.sections.map((data) => ({
          op: 'put' as const,
          entity: 'plan_section' as const,
          data,
        })),
        { op: 'put', entity: 'plan', data: { ...next.plan, title: job.result.title || plan.title } }
      );
    } else {
      const draft = buildPrefilledDraft({
        ...task.input.input,
        resolvedObjectives: task.input.resolvedObjectives,
      });
      for (const content of draft.sections) {
        const old = sections.find((s) => s.key === content.key);
        if (old) {
          ops.push({
            op: 'put',
            entity: 'section_revision',
            data: sectionRevision(old, {
              id: newId(),
              savedAt: now().toISOString(),
              reason: 'regenerate',
            }),
          });
        }
        ops.push({
          op: 'put',
          entity: 'plan_section',
          data: PlanSection.parse({
            ...old,
            id: old?.id ?? newId(),
            planId: plan.id,
            ...content,
            origin: 'manual',
            gen: null,
            editedByTeacher: false,
          }),
        });
      }
    }
    await atomic(engine, ops);
    await tasks.update(id, { state: mode === 'result' ? 'done' : task.state });
  }
  return {
    tasks,
    request,
    tick,
    apply,
    async cancel(id: string) {
      const task = (await tasks.list()).find((t) => t.id === id);
      if (!task) return;
      await tasks.update(id, {
        cancelRequested: true,
        state: task.remoteId ? 'polling' : task.state === 'sending' ? 'sending' : 'cancelled',
      });
    },
  };
}
