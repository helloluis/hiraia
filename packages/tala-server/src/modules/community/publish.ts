/**
 * Turn a teacher's locked plan into what the community sees (PRD §11.2–11.4, DOC-7, PRIV-3).
 *
 * Content always comes from the server's own stored snapshot, never from the request.
 * Stripping is worker H's shared `stripForPublish` / `createPublishCleaner` (tala-core/plan), the same code the
 * device uses for the pre-post preview: reflection / outside-lock sections, week dates, local grade-group ids,
 * signature blocks, the school name (unless the author opts in), class/section names and the plan's own dates.
 * Rosters are never read into a post; learner names typed into the body are a moderation finding, not
 * silently edited (PRIV-9).
 */
import { BUILTIN_TEMPLATES, GradeLevel, LIMITS } from '@hiraia/tala-core';
import type { ArtifactTags, ArtifactVersion, Plan, PlanLineage, PostArtifactRequest, SectionContent, Template } from '@hiraia/tala-core';
import { createPublishCleaner, planProvenance, stripForPublish } from '@hiraia/tala-core/plan';
import { knownNameVariants } from '@hiraia/tala-core/moderation';
import type { z } from 'zod';
import { HttpError } from '../../kernel/types';
import type { RecordStore } from '../../kernel/types';

export type VersionContent = Pick<ArtifactVersion, 'templateId' | 'gradeGroups' | 'competencies' | 'customObjectives' | 'sections' | 'template'>;

/** The public text a moderation check reads for a version: its sections, plus a custom template's labels. */
export function moderationSections(content: VersionContent): Array<{ key: string; content: SectionContent }> {
  if (!content.template) return content.sections;
  const t = content.template;
  const items = [t.name.fil, t.name.en, ...t.sections.flatMap((s) => [s.label.fil, s.label.en])].filter((x) => x.trim());
  return [...content.sections, { key: 'template', content: { type: 'list', items } }];
}

export interface VersionMeta {
  title: string;
  summary: string;
  authorDisplayName: string;
  authorSchool: string | null;
  tags: ArtifactTags;
  provenance: { aiDrafted: boolean; adapted: boolean };
  lineage: PlanLineage | null;
}

export interface PreparedPost {
  planId: string;
  planRevision: number | null;
  revisionCode: string | null;
  content: VersionContent;
  meta: VersionMeta;
  knownNames: string[];
}

type PostBody = z.output<typeof PostArtifactRequest>;

export function preparePost(records: RecordStore, userId: string, body: PostBody): PreparedPost {
  const snap = records.planSnapshot(userId, body.planId);
  if (!snap) throw new HttpError('not_found', 'We could not find this lesson on Tala yet. Connect to the internet so it is saved, then try again.', { reason: 'plan_not_synced' });
  const plan = snap.plan.data;
  const sections = snap.sections.filter((s) => !s.deletedAt).map((s) => s.data);
  if (plan.state !== 'locked' || !plan.lock) {
    throw new HttpError('conflict', 'Only locked lessons can be posted. Lock this lesson first, then post it.', { reason: 'plan_not_locked' });
  }

  const classes = [...new Set(plan.placements.map((p) => p.classId))]
    .map((id) => records.get(userId, 'class', id))
    .filter((c): c is NonNullable<typeof c> => !!c && !c.deletedAt)
    .map((c) => c.data);
  if (classes.some((c) => c.isSample)) throw new HttpError('forbidden', 'Lessons from the sample class cannot be posted to the community.', { reason: 'sample_class' });

  const profile = records.get(userId, 'profile', 'profile')?.data ?? null;
  const schoolYears = [...new Set(classes.map((c) => c.schoolYearId))]
    .map((id) => records.get(userId, 'school_year', id)?.data)
    .filter((y): y is NonNullable<typeof y> => !!y);

  const template = findTemplate(records, userId, plan.templateId);
  const privacy = {
    schoolNames: [profile?.schoolName ?? '', ...schoolYears.map((y) => y.schoolName)].map((s) => s.trim()).filter(Boolean),
    classNames: classes.map((c) => c.name),
    teacherName: profile?.displayName ?? plan.lock.lockedBy,
    includeSchoolName: body.showSchool,
  };
  const stripped = stripForPublish(plan, sections, { ...privacy, ...(template ? { template } : {}) });
  // Same rules for the post's own text (title, summary, custom template labels); dates passed explicitly.
  const cleaner = createPublishCleaner(plan.language, { ...privacy, dates: plan.placements.flatMap((p) => p.dates) });
  const clean = cleaner.text;

  const content: VersionContent = {
    templateId: stripped.templateId,
    gradeGroups: stripped.gradeGroups,
    competencies: stripped.competencies,
    customObjectives: stripped.customObjectives,
    sections: stripped.sections,
    // A custom template travels with the version so a copier can render and save it (built-ins are known everywhere).
    ...(template && !template.builtIn ? { template: cleanTemplate(template, clean) } : {}),
  };

  const revisions = records
    .list(userId, 'section_revision')
    .filter((r) => !r.deletedAt && r.data.planId === plan.id)
    .sort((a, b) => b.rev - a.rev)
    .map((r) => r.data);
  const prov = planProvenance({ plan, sections, revisions });

  const school = body.showSchool ? (profile?.schoolName.trim() || schoolYears[0]?.schoolName.trim() || null) : null;
  const meta: VersionMeta = {
    title: clean(body.title).slice(0, 200),
    summary: clean(body.summary).slice(0, 600),
    authorDisplayName: body.displayName.trim(),
    authorSchool: school ? school.slice(0, 200) : null,
    tags: deriveTags(plan, content, template, body, termIndexFor(plan, classes, schoolYears)),
    provenance: { aiDrafted: prov.aiDrafted, adapted: prov.adapted },
    lineage: plan.lineage,
  };

  const knownNames = records
    .list(userId, 'student')
    .filter((s) => !s.deletedAt)
    .flatMap((s) => knownNameVariants(s.data));

  return { planId: plan.id, planRevision: plan.lock.revision, revisionCode: plan.lock.revisionCode, content, meta, knownNames };
}

function findTemplate(records: RecordStore, userId: string, templateId: string): Template | null {
  const builtIn = BUILTIN_TEMPLATES.find((t) => t.id === templateId);
  if (builtIn) return builtIn;
  const custom = records.get(userId, 'template', templateId);
  return custom && !custom.deletedAt ? custom.data : null;
}

function cleanTemplate(t: Template, clean: (s: string) => string): Template {
  const L = (l: { fil: string; en: string }) => ({ fil: clean(l.fil), en: clean(l.en) });
  return { ...t, name: L(t.name), sections: t.sections.map((s) => ({ ...s, label: L(s.label) })) };
}

/* ---------------- tags (§11.4) ---------------- */

export function sortGrades(grades: readonly string[]): GradeLevel[] {
  const order = GradeLevel.options as readonly string[];
  return [...new Set(grades)].filter((g): g is GradeLevel => order.includes(g)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

function deriveTags(plan: Plan, content: VersionContent, template: Template | null, body: PostBody, derivedTerm: number | null): ArtifactTags {
  const grades = sortGrades(plan.grades).slice(0, LIMITS.maxGradeGroupsPerClass);
  const competencyIds = [...new Set(Object.values(content.competencies).flat())].slice(0, 48);
  return {
    grades,
    learningAreaId: plan.learningAreaId,
    subjectName: plan.subjectName,
    termIndex: body.termIndex ?? derivedTerm,
    competencyIds,
    curriculumVersion: plan.curriculumVersion,
    language: plan.language,
    templateKind: template?.kind ?? 'custom',
    durationMinutes: plan.durationMinutes,
    multigrade: grades.length > 1 ? grades : null,
    region: body.region?.trim() || null,
  };
}

function termIndexFor(
  plan: Plan,
  classes: Array<{ id: string; schoolYearId: string }>,
  years: Array<{ id?: string; terms: Array<{ index: number; startDate: string; endDate: string }> }>,
): number | null {
  for (const p of plan.placements) {
    const cls = classes.find((c) => c.id === p.classId);
    const year = cls ? years.find((y) => y.id === cls.schoolYearId) : undefined;
    const date = [...p.dates].sort()[0];
    if (!year || !date) continue;
    const term = year.terms.find((t) => t.startDate <= date && date <= t.endDate);
    if (term) return term.index;
  }
  return null;
}
