import { Plan, PlanSection, BUILTIN_TEMPLATES, ArtifactDetail } from '@hiraia/tala-core/contracts';
import type {
  SyncEngine,
  LocalStore,
  TalaClient,
  ArtifactDetail as Detail,
  PostArtifactRequest,
  ArtifactSearchQuery,
  ReportRequest,
} from '@hiraia/tala-core/contracts';
import type { z } from 'zod';
import { stripForPublish, createPublishCleaner } from '@hiraia/tala-core/plan';
import {
  detectPersonalData,
  knownNameVariants,
  hasBlockingFinding,
} from '@hiraia/tala-core/moderation';
import { atomic, type Operation } from './atomic';
import type { SectionContent } from '@hiraia/tala-core/contracts';
import type { taskStore, DurableTask } from './tasks';
import { retryDelay } from '../runtime/ladder';
export interface PostTask {
  body: z.infer<typeof PostArtifactRequest>;
  revisionCode: string;
  snapshot: string;
  result?: unknown;
}
export function filterSaved(items: Detail[], query: z.input<typeof ArtifactSearchQuery>) {
  const grades = (value: string) =>
    value
      .split(',')
      .map((g) => g.trim())
      .sort((a, b) => (a === 'K' ? 0 : Number(a)) - (b === 'K' ? 0 : Number(b)))
      .join(',');
  return items.filter(
    (a) =>
      (!query.q || `${a.title} ${a.summary}`.toLowerCase().includes(query.q.toLowerCase())) &&
      (!query.grade || a.tags.grades.includes(query.grade)) &&
      (!query.language || a.tags.language === query.language) &&
      (!query.learningAreaId || a.tags.learningAreaId === query.learningAreaId) &&
      (!query.competencyId || a.tags.competencyIds.includes(query.competencyId)) &&
      (!query.termIndex || a.tags.termIndex === Number(query.termIndex)) &&
      (!query.maxMinutes || a.tags.durationMinutes <= Number(query.maxMinutes)) &&
      (!query.region || a.tags.region?.toLowerCase() === query.region.toLowerCase()) &&
      (!query.multigrade ||
        grades(a.tags.multigrade?.join(',') ?? '') === grades(query.multigrade)) &&
      (!query.mine || a.mine)
  );
}
export function createCommunity(deps: {
  engine: SyncEngine;
  store: LocalStore;
  client: TalaClient;
  newId(): string;
  now(): Date;
  tasks: ReturnType<typeof taskStore>;
}) {
  const { engine, store, client, newId, now, tasks } = deps;
  async function saved(): Promise<Detail[]> {
    return JSON.parse((await store.getMeta('community.saved')) ?? '[]').map((v: unknown) =>
      ArtifactDetail.parse(v)
    );
  }
  async function cache(detail: Detail) {
    const all = await saved();
    await store.commit({
      meta: {
        'community.saved': JSON.stringify(
          [detail, ...all.filter((a) => a.id !== detail.id)].slice(0, 200)
        ),
      },
    });
    return detail;
  }
  async function detail(id: string, online: boolean, versionId?: string) {
    if (online)
      return cache(
        await client.call('community.get', { params: { artifactId: id }, query: { versionId } })
      );
    const found = (await saved()).find(
      (a) => a.id === id && (!versionId || a.version.id === versionId)
    );
    if (!found) throw Error('Not saved');
    return found;
  }
  async function preview(body: z.infer<typeof PostArtifactRequest>) {
    const plan = (await engine.get('plan', body.planId))?.data;
    if (!plan || plan.state !== 'locked' || !plan.lock) throw Error('Lock lesson');
    const classes = (await engine.list('class')).filter((c) =>
      plan.placements.some((p) => p.classId === c.id)
    );
    if (classes.some((c) => c.data.isSample)) throw Error('Sample cannot be posted');
    const sections = (await engine.list('plan_section'))
        .filter((s) => s.data.planId === plan.id)
        .map((s) => s.data),
      template =
        BUILTIN_TEMPLATES.find((t) => t.id === plan.templateId) ??
        (await engine.get('template', plan.templateId))?.data;
    const profile = (await engine.get('profile', 'profile'))?.data;
    const years = (await engine.list('school_year')).filter((y) =>
      classes.some((c) => c.data.schoolYearId === y.id)
    );
    const privacy = {
      template,
      includeSchoolName: body.showSchool,
      schoolNames: [profile?.schoolName ?? '', ...years.map((y) => y.data.schoolName)],
      classNames: classes.map((c) => c.data.name),
      dates: plan.placements.flatMap((p) => p.dates),
      teacherName: profile?.displayName ?? plan.lock.lockedBy,
    };
    const stripped = stripForPublish(plan, sections, privacy);
    const cleaner = createPublishCleaner(plan.language, privacy);
    const cleanLabel = (value: { fil: string; en: string }) => ({
      fil: cleaner.text(value.fil),
      en: cleaner.text(value.en),
    });
    const publicContent = {
      ...stripped,
      ...(template && !template.builtIn
        ? {
            template: {
              ...template,
              name: cleanLabel(template.name),
              sections: template.sections.map((s) => ({ ...s, label: cleanLabel(s.label) })),
            },
          }
        : {}),
    };
    const title = cleaner.text(body.title),
      summary = cleaner.text(body.summary);
    const names = (await engine.list('student')).flatMap((s) => knownNameVariants(s.data));
    const findings = detectPersonalData(
      {
        title,
        summary,
        sections: [
          ...publicContent.sections,
          {
            key: 'displayName',
            content: { type: 'text', blocks: [{ t: 'p', spans: [{ text: body.displayName }] }] },
          },
        ],
      },
      { knownNames: names }
    );
    return {
      plan,
      title,
      summary,
      authorDisplayName: body.displayName,
      authorSchool: body.showSchool
        ? profile?.schoolName || years[0]?.data.schoolName || null
        : null,
      publicContent,
      findings,
      blocked: hasBlockingFinding(findings),
    };
  }
  const snapshot = (value: Awaited<ReturnType<typeof preview>>) =>
    JSON.stringify({
      title: value.title,
      summary: value.summary,
      authorDisplayName: value.authorDisplayName,
      authorSchool: value.authorSchool,
      publicContent: value.publicContent,
      placements: value.plan.placements,
    });
  async function post(body: z.infer<typeof PostArtifactRequest>, reviewedSnapshot?: string) {
    const result = await preview(body);
    if (result.blocked) throw Error('Remove personal data');
    if (reviewedSnapshot !== undefined && snapshot(result) !== reviewedSnapshot)
      throw Object.assign(Error('Review changed'), { code: 'conflict' });
    const task: DurableTask<PostTask> = {
      id: newId(),
      kind: 'post',
      state: 'queued',
      input: { body, revisionCode: result.plan.lock!.revisionCode, snapshot: snapshot(result) },
      attempts: 0,
      nextAt: 0,
      createdAt: now().toISOString(),
    };
    await tasks.put(task);
    return task;
  }
  async function tick(online: boolean) {
    if (!online) return;
    for (const raw of await tasks.list()) {
      if (raw.kind !== 'post' || raw.state !== 'queued' || raw.nextAt > now().getTime()) continue;
      const task = raw as DurableTask<PostTask>;
      try {
        const checked = await preview(task.input.body);
        if (
          checked.blocked ||
          checked.plan.lock?.revisionCode !== task.input.revisionCode ||
          snapshot(checked) !== task.input.snapshot
        ) {
          await tasks.update(task.id, { state: 'failed', error: 'reviewPostAgain' });
          continue;
        }
        const sync = await engine.sync();
        if (!sync.ok || (await engine.get('plan', task.input.body.planId))?.dirty)
          throw Error('Not synced');
        const synced = await preview(task.input.body);
        if (synced.blocked || snapshot(synced) !== task.input.snapshot) {
          await tasks.update(task.id, { state: 'failed', error: 'reviewPostAgain' });
          continue;
        }
        // Server deduplicates repeat posts of the same locked revision.
        if ((await tasks.list()).find((t) => t.id === task.id)?.state === 'cancelled') continue;
        await tasks.update(task.id, { state: 'sending' });
        const result = await client.call('community.post', { body: task.input.body });
        await tasks.update(task.id, {
          state: result.moderation.decision === 'return' ? 'failed' : 'done',
          result,
          error: result.moderation.decision === 'return' ? 'postReturned' : undefined,
        });
      } catch {
        await tasks.update(task.id, {
          state: 'queued',
          attempts: task.attempts + 1,
          nextAt: now().getTime() + retryDelay(task.attempts),
          error: 'waiting',
        });
      }
    }
  }
  async function copy(artifact: Detail, online: boolean, classId: string | null) {
    const cls = classId ? (await engine.get('class', classId))?.data : null;
    if (
      cls &&
      (cls.gradeGroups.length !== artifact.version.gradeGroups.length ||
        cls.gradeGroups.some((g) => !artifact.version.gradeGroups.some((v) => v.grade === g.grade)))
    )
      throw Error('Choose matching grades');
    let plan: Plan, sections: PlanSection[];
    const sourceTemplate = artifact.version.template;
    const template =
      sourceTemplate && !BUILTIN_TEMPLATES.some((t) => t.id === sourceTemplate.id)
        ? { ...sourceTemplate, id: newId(), builtIn: false as const }
        : undefined;
    if (online) {
      const result = await client.call('community.copy', {
        params: { artifactId: artifact.id },
        body: {
          versionId: artifact.version.id,
          gradeGroupIds: cls
            ? artifact.version.gradeGroups.map(
                (g) => cls.gradeGroups.find((c) => c.grade === g.grade)!.id
              )
            : undefined,
        },
      });
      plan = result.plan;
      sections = result.sections;
    } else {
      const ids = Object.fromEntries(
        artifact.version.gradeGroups.map((g, i) => [
          g.id,
          cls?.gradeGroups.find((c) => c.grade === g.grade)?.id ?? newId(),
        ])
      );
      const id = newId();
      const remap = (content: SectionContent): SectionContent => {
        switch (content.type) {
          case 'pergroup':
            return {
              ...content,
              groups: Object.fromEntries(
                Object.entries(content.groups).map(([id, value]) => [ids[id] ?? id, value])
              ),
            };
          case 'multigrade':
            return {
              ...content,
              blocks: content.blocks.map((b) => ({
                ...b,
                id: newId(),
                teacherWith: ids[b.teacherWith] ?? b.teacherWith,
                pairedGroupIds: b.pairedGroupIds.map((id) => ids[id] ?? id),
                groups: Object.fromEntries(
                  Object.entries(b.groups).map(([id, value]) => [ids[id] ?? id, value])
                ),
              })),
            };
          case 'weekgrid':
            return { ...content, days: content.days.map((d) => ({ ...d, date: null })) };
          default:
            return content;
        }
      };
      plan = Plan.parse({
        id,
        title: artifact.title,
        templateId: artifact.version.templateId,
        language: artifact.tags.language,
        grades: artifact.tags.grades,
        gradeGroupIds: Object.values(ids),
        competencies: Object.fromEntries(
          Object.entries(artifact.version.competencies).map(([k, v]) => [ids[k] ?? k, v])
        ),
        customObjectives: artifact.version.customObjectives,
        curriculumVersion: artifact.tags.curriculumVersion,
        subjectName: artifact.tags.subjectName,
        learningAreaId: artifact.tags.learningAreaId,
        durationMinutes: artifact.tags.durationMinutes,
        lineage: {
          artifactId: artifact.id,
          versionId: artifact.version.id,
          title: artifact.title,
          authorDisplayName: artifact.authorDisplayName,
        },
        aiAssisted: artifact.provenance.aiDrafted,
        placements: [],
      });
      sections = artifact.version.sections.map((s) =>
        PlanSection.parse({
          id: newId(),
          planId: id,
          key: s.key,
          content: remap(s.content),
          origin: 'copied',
        })
      );
    }
    if (template) plan = { ...plan, templateId: template.id };
    if (cls) plan = { ...plan, placements: [{ classId: cls.id, assignmentId: null, dates: [] }] };
    const ops: Operation[] = [
      ...(template && !BUILTIN_TEMPLATES.some((t) => t.id === template.id)
        ? [
            {
              op: 'put' as const,
              entity: 'template' as const,
              data: { ...template, builtIn: false },
            },
          ]
        : []),
      { op: 'put', entity: 'plan', data: plan },
      ...sections.map((data) => ({ op: 'put' as const, entity: 'plan_section' as const, data })),
    ];
    await atomic(engine, ops);
    await cache(artifact);
    return plan;
  }
  return {
    saved,
    snapshot,
    detail,
    preview,
    post,
    tick,
    copy,
    async search(query: z.input<typeof ArtifactSearchQuery>) {
      return client.call('community.search', { query });
    },
    async remove(id: string) {
      await client.call('community.remove', { params: { artifactId: id } });
      await store.commit({
        meta: { 'community.saved': JSON.stringify((await saved()).filter((a) => a.id !== id)) },
      });
    },
    async report(id: string, body: z.infer<typeof ReportRequest>) {
      return client.call('community.report', { params: { artifactId: id }, body });
    },
  };
}
