/**
 * Community (PRD §11) on the client: search/detail through the typed client (needs a connection), copy into the
 * teacher's own records through the sync engine with lineage, and the pre-post review that shows exactly what
 * will be public (shared `stripForPublish`) with the rule detectors as early warnings (`@hiraia/tala-core/moderation`).
 */
import { stripForPublish, type PublishSnapshot } from '@hiraia/tala-core/plan';
import {
  detectPersonalData,
  hasBlockingFinding,
  knownNameVariants,
  type PersonalDataFinding,
} from '@hiraia/tala-core/moderation';
import type {
  ClassRecord,
  Plan,
  PlanSection,
  Student,
  SyncEngine,
  TalaClient,
  Template,
} from '@hiraia/tala-core/contracts';

export interface PrePostReview {
  snapshot: PublishSnapshot;
  findings: PersonalDataFinding[];
  blocking: boolean;
}

export function prePostReview(args: {
  plan: Plan;
  sections: PlanSection[];
  template: Template;
  cls: ClassRecord | null;
  schoolName: string;
  teacherName: string;
  includeSchoolName: boolean;
  students: Student[];
  title: string;
  summary: string;
}): PrePostReview {
  const snapshot = stripForPublish(args.plan, args.sections, {
    template: args.template,
    schoolName: args.schoolName,
    includeSchoolName: args.includeSchoolName,
    classNames: args.cls ? [args.cls.name] : [],
    teacherName: args.teacherName,
  });
  const knownNames = args.students.flatMap((s) =>
    knownNameVariants({
      displayName: s.displayName,
      givenName: s.givenName,
      familyName: s.familyName,
    })
  );
  const findings = detectPersonalData(
    { title: args.title, summary: args.summary, sections: snapshot.sections },
    { knownNames }
  );
  return { snapshot, findings, blocking: hasBlockingFinding(findings) };
}

/**
 * Copy a community version into a class as a private draft with lineage (COM-4), as one durable operation.
 * `gradeGroupIds` maps the artifact's grade groups (in order) onto the class's own groups; the server needs exactly
 * one per artifact group. Omit it to let the server create placeholder groups.
 */
export async function copyArtifact(
  engine: SyncEngine,
  client: TalaClient,
  artifactId: string,
  cls: ClassRecord,
  gradeGroupIds?: string[],
  versionId?: string
): Promise<string> {
  const res = await client.call('community.copy', {
    params: { artifactId },
    body: { versionId, gradeGroupIds },
  });
  const plan: Plan = {
    ...res.plan,
    placements: res.plan.placements.length
      ? res.plan.placements
      : [{ classId: cls.id, assignmentId: null, dates: [] }],
    gradeGroupIds: res.plan.gradeGroupIds.length
      ? res.plan.gradeGroupIds
      : (gradeGroupIds ?? cls.gradeGroups.map((g) => g.id)),
    grades: res.plan.grades.length ? res.plan.grades : cls.gradeGroups.map((g) => g.grade),
    state: 'draft',
    lock: null,
    submitted: null,
  };
  await engine.batch([
    { op: 'put', entity: 'plan', data: plan },
    ...res.sections.map((s) => ({
      op: 'put' as const,
      entity: 'plan_section' as const,
      data: { ...s, planId: plan.id, origin: 'copied' as const },
    })),
  ]);
  return plan.id;
}

export const GRADES = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'] as const;
