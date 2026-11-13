/**
 * Test helpers for the community module: a scriptable LlmGateway, and builders that write a teacher's
 * classes and locked plans through the REAL record store (worker A's), the way a device would.
 *
 * FAKED: `services.llm` only (tests never call a real provider).
 */
import { BUILTIN_TEMPLATES, parseRecordData } from '@hiraia/tala-core';
import type { EntityName, LlmRoute, RecordEnvelope, SectionContent } from '@hiraia/tala-core';
import type { LlmGateway, LlmRequest, LlmResult, RecordStore } from '../../kernel/types';
import type { ModelVerdict } from './moderate';

export const T0 = '2026-11-16T00:00:00.000Z';

/** Write a record through the real store, validating loose test data first. */
export function put<E extends EntityName>(store: RecordStore, ownerId: string, entity: E, data: unknown): RecordEnvelope<E> {
  return store.put(ownerId, entity, parseRecordData(entity, data));
}

/* ---------------- LLM ---------------- */

export type LlmScript = (req: LlmRequest<unknown>) => LlmResult<unknown> | Promise<LlmResult<unknown>>;

export interface FakeLlm extends LlmGateway {
  calls: Array<LlmRequest<unknown>>;
  script: LlmScript;
  route: LlmRoute;
}

export function okVerdict(verdict: ModelVerdict | { decision: 'allow' | 'return'; reasons?: unknown[] }): LlmResult<unknown> {
  return {
    ok: true,
    data: { reasons: [], ...verdict },
    provider: 'deepseek',
    model: 'fake-flash',
    promptId: 'moderation/moderate',
    promptVersion: 1,
    usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
    fellBack: false,
  };
}

export const allowAll: LlmScript = () => okVerdict({ decision: 'allow', reasons: [] });
export const unavailable: LlmScript = () => ({ ok: false, reason: 'providers_unavailable', message: 'down' });

export function createFakeLlm(script: LlmScript = allowAll): FakeLlm {
  const llm: FakeLlm = {
    calls: [],
    script,
    route: 'cloud',
    routeFor: () => llm.route,
    async complete<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
      llm.calls.push(req as LlmRequest<unknown>);
      const r = await llm.script(req as LlmRequest<unknown>);
      if (!r.ok) return r;
      // Like the real gateway: the caller's schema and check run on the model output.
      const parsed = req.schema.safeParse(r.data);
      if (!parsed.success) return { ok: false, reason: 'invalid_output', message: 'schema' };
      if (req.check?.(parsed.data).length) return { ok: false, reason: 'invalid_output', message: 'check' };
      return { ...r, data: parsed.data };
    },
  };
  return llm;
}

/* ---------------- a teacher's data ---------------- */

const p = (...lines: string[]) => lines.map((text) => ({ t: 'p' as const, spans: [{ text }] }));

export interface TeacherSetup {
  classId: string;
  groupIds: string[];
  schoolYearId: string;
}

let seq = 0;
export const fid = (prefix: string) => `${prefix}-${String(++seq).padStart(6, '0')}`;

/** Profile, a school year with four quarters, and a class with `grades.length` grade groups. */
export function seedTeacher(
  store: RecordStore,
  ownerId: string,
  opts: { grades?: string[]; schoolName?: string; className?: string; isSample?: boolean; students?: Array<{ givenName: string; familyName: string }> } = {},
): TeacherSetup {
  const grades = opts.grades ?? ['4'];
  put(store, ownerId, 'profile', { id: 'profile', displayName: 'Gng. Teacher', schoolName: opts.schoolName ?? 'Malinao Elementary School', region: 'Region V' });
  const schoolYearId = fid('sy');
  put(store, ownerId, 'school_year', {
    id: schoolYearId,
    label: '2026-2027',
    schoolName: opts.schoolName ?? 'Malinao Elementary School',
    startDate: '2026-06-15',
    endDate: '2027-03-31',
    terms: [
      { id: fid('term'), index: 1, name: 'Q1', startDate: '2026-06-15', endDate: '2026-08-28' },
      { id: fid('term'), index: 2, name: 'Q2', startDate: '2026-08-31', endDate: '2026-11-06' },
      { id: fid('term'), index: 3, name: 'Q3', startDate: '2026-11-09', endDate: '2027-01-29' },
      { id: fid('term'), index: 4, name: 'Q4', startDate: '2027-02-01', endDate: '2027-03-31' },
    ],
  });
  const groupIds = grades.map(() => fid('gg'));
  const classId = fid('class');
  put(store, ownerId, 'class', {
    id: classId,
    schoolYearId,
    name: opts.className ?? 'Grade 4 - Sampaguita',
    gradeGroups: grades.map((grade, i) => ({ id: groupIds[i], grade, learnerCount: 20 })),
    isSample: opts.isSample ?? false,
  });
  for (const s of opts.students ?? []) {
    put(store, ownerId, 'student', { id: fid('st'), classId, displayName: `${s.givenName} ${s.familyName}`, givenName: s.givenName, familyName: s.familyName });
  }
  return { classId, groupIds, schoolYearId };
}

export interface PlanOptions {
  title?: string;
  /** Extra text appended to the content section. */
  contentText?: string[];
  state?: 'draft' | 'locked';
  revisionCode?: string;
  aiAssisted?: boolean;
  sectionOrigin?: 'manual' | 'ai' | 'copied';
  lineage?: { artifactId: string; versionId: string; title: string; authorDisplayName: string } | null;
  planId?: string;
  competencies?: string[];
  durationMinutes?: number;
  date?: string;
  /** Use this template id (e.g. a custom template already written for the owner). */
  templateId?: string;
}

/** A locked plan. One grade group → DLP template; several → multi-grade template with pergroup + multigrade sections. */
export function seedPlan(store: RecordStore, ownerId: string, setup: TeacherSetup, grades: string[], opts: PlanOptions = {}) {
  const planId = opts.planId ?? fid('plan');
  const multi = setup.groupIds.length > 1;
  const template = BUILTIN_TEMPLATES.find((t) => t.id === (multi ? 'tpl.multigrade.v1' : 'tpl.dlp.v1'))!;
  const competencies = Object.fromEntries(setup.groupIds.map((g, i) => [g, opts.competencies ?? [`S${grades[i]}-COMP-${i + 1}`]]));
  const planData = {
    id: planId,
    title: opts.title ?? 'Parts of a Plant',
    templateId: opts.templateId ?? template.id,
    language: 'en',
    subjectName: 'Science',
    learningAreaId: 'science',
    grades,
    gradeGroupIds: setup.groupIds,
    competencies,
    curriculumVersion: 'science-bow-2026',
    durationMinutes: opts.durationMinutes ?? 50,
    placements: [{ classId: setup.classId, assignmentId: null, dates: [opts.date ?? '2026-11-16'] }],
    aiAssisted: opts.aiAssisted ?? false,
    lineage: opts.lineage ?? null,
  };
  // Like a device: write the plan as a draft (unlocking it if it was locked), replace its sections, then lock.
  put(store, ownerId, 'plan', { ...planData, state: 'draft', lock: null });
  for (const s of store.list(ownerId, 'plan_section')) if (s.data.planId === planId) store.remove(ownerId, 'plan_section', s.id);
  const origin = opts.sectionOrigin ?? 'manual';
  const section = (key: string, content: SectionContent) =>
    put(store, ownerId, 'plan_section', { id: fid('sec'), planId, key, content, origin, editedByTeacher: false });
  const contentLines = [
    'Plants have roots, stems and leaves. This lesson was used at Malinao Elementary School in Grade 4 - Sampaguita on November 16, 2026.',
    ...(opts.contentText ?? []),
  ];
  if (!multi) {
    section('objectives', { type: 'list', items: ['Identify the parts of a plant'] });
    section('content', { type: 'text', blocks: p(...contentLines) });
    section('materials', { type: 'list', items: ['Manila Paper', 'Pentel Pen', 'Prepared by:', 'MARIA C. SANTOS', 'Teacher III'] });
    section('procedure', { type: 'procedure', steps: [{ id: fid('step'), title: 'Motivation', minutes: 10, body: p('Show a real plant.') }] });
    section('assessment', { type: 'text', blocks: p('Label the parts of a plant.', 'Prepared by:', 'MARIA C. SANTOS', 'Teacher III', 'Noted by: JUAN DELA CRUZ, Principal I') });
    section('reflection', { type: 'text', blocks: p('Juan Reyes was absent today.') });
  } else {
    const groups = Object.fromEntries(setup.groupIds.map((g, i) => [g, p(`Objective for grade ${grades[i]}`, ...(i === 0 ? contentLines : []))]));
    section('objectives', { type: 'pergroup', groups });
    section('materials', { type: 'pergroup', groups: Object.fromEntries(setup.groupIds.map((g) => [g, p('Manila Paper')])) });
    section('multigrade', {
      type: 'multigrade',
      blocks: [
        {
          id: fid('blk'),
          label: 'Direct teaching',
          minutes: 20,
          transitionMinutes: 2,
          teacherWith: setup.groupIds[0]!,
          pairedGroupIds: setup.groupIds.slice(1, 2),
          groups: Object.fromEntries(setup.groupIds.map((g, i) => [g, { mode: i === 0 ? 'direct' : 'independent', activity: p(`Activity ${i + 1}`) }])),
        },
      ],
    });
    section('assessment', { type: 'pergroup', groups: Object.fromEntries(setup.groupIds.map((g) => [g, p('Quiz')])) });
    section('reflection', { type: 'text', blocks: p('Private notes.') });
  }
  if ((opts.state ?? 'locked') === 'locked') {
    put(store, ownerId, 'plan', { ...planData, state: 'locked', lock: { lockedAt: T0, lockedBy: 'Gng. Teacher', revisionCode: opts.revisionCode ?? 'ABC123', revision: null } });
  }
  return planId;
}

export function postBody(planId: string, extra: Record<string, unknown> = {}) {
  return { planId, title: 'Parts of a Plant', summary: 'A short lesson.', displayName: 'Teacher Ana', licenseAccepted: true as const, affirmed: true as const, ...extra };
}
