/**
 * Turn a teacher's locked plan into what the community sees (PRD §11.2–11.4, DOC-7, PRIV-3).
 *
 * Content always comes from the server's own stored snapshot, never from the request.
 * Stripping = worker H's `stripForPublish` (reflection / outside-lock sections, week dates, local grade-group
 * ids) plus, here, the text-level parts it leaves to the community module: the school name (unless the
 * author opts in), the section (class) name, the plan's own dates, and signature blocks.
 * Rosters are never read into a post; learner names typed into the body are a moderation finding, not
 * silently edited (PRIV-9).
 */
import { BUILTIN_TEMPLATES, GradeLevel, LIMITS } from '@hiraia/tala-core';
import type { ArtifactTags, ArtifactVersion, Plan, PlanLineage, PostArtifactRequest, RichText, SectionContent, Template } from '@hiraia/tala-core';
import { planProvenance, stripForPublish } from '@hiraia/tala-core/plan';
import { knownNameVariants } from '@hiraia/tala-core/moderation';
import type { z } from 'zod';
import { HttpError } from '../../kernel/types';
import type { RecordStore } from '../../kernel/types';

export type VersionContent = Pick<ArtifactVersion, 'templateId' | 'gradeGroups' | 'competencies' | 'customObjectives' | 'sections'>;

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

const PLACEHOLDER = {
  fil: { school: '[paaralan]', section: '[seksiyon]', date: '[petsa]' },
  en: { school: '[school]', section: '[section]', date: '[date]' },
} as const;

export function preparePost(records: RecordStore, userId: string, body: PostBody): PreparedPost {
  const snap = records.planSnapshot(userId, body.planId);
  if (!snap) throw new HttpError('not_found', 'We could not find this lesson on Tala yet. Connect to the internet so it is saved, then try again.');
  const plan = snap.plan.data;
  const sections = snap.sections.filter((s) => !s.deletedAt).map((s) => s.data);
  if (plan.state !== 'locked' || !plan.lock) {
    throw new HttpError('conflict', 'Only locked lessons can be posted. Lock this lesson first, then post it.');
  }

  const classes = [...new Set(plan.placements.map((p) => p.classId))]
    .map((id) => records.get(userId, 'class', id))
    .filter((c): c is NonNullable<typeof c> => !!c && !c.deletedAt)
    .map((c) => c.data);
  if (classes.some((c) => c.isSample)) throw new HttpError('forbidden', 'Lessons from the sample class cannot be posted to the community.');

  const profile = records.get(userId, 'profile', 'profile')?.data ?? null;
  const schoolYears = [...new Set(classes.map((c) => c.schoolYearId))]
    .map((id) => records.get(userId, 'school_year', id)?.data)
    .filter((y): y is NonNullable<typeof y> => !!y);

  const template = findTemplate(records, userId, plan.templateId);
  const stripped = stripForPublish(plan, sections, template ? { template } : {});

  const lang = plan.language;
  const replacements: Array<{ pattern: RegExp; with: string }> = [];
  const schoolNames = [profile?.schoolName ?? '', ...schoolYears.map((y) => y.schoolName)].map((s) => s.trim()).filter((s) => s.length >= 4);
  if (!body.showSchool) for (const n of schoolNames) replacements.push({ pattern: literal(n), with: PLACEHOLDER[lang].school });
  for (const c of classes) if (isDistinctiveClassName(c.name)) replacements.push({ pattern: literal(c.name.trim()), with: PLACEHOLDER[lang].section });
  for (const d of new Set(plan.placements.flatMap((p) => p.dates))) for (const re of datePatterns(d)) replacements.push({ pattern: re, with: PLACEHOLDER[lang].date });
  // Longest first, so "Rizal Elementary School" is replaced before "Rizal".
  replacements.sort((a, b) => b.pattern.source.length - a.pattern.source.length);
  const clean = (s: string) => replacements.reduce((acc, r) => acc.replace(r.pattern, r.with), s);

  const content: VersionContent = {
    templateId: stripped.templateId,
    gradeGroups: stripped.gradeGroups,
    competencies: stripped.competencies,
    customObjectives: stripped.customObjectives.map(clean),
    sections: stripped.sections.map((s) => ({ key: s.key, content: cleanContent(s.content, clean) })),
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

/* ---------------- text-level stripping ---------------- */

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function literal(s: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(s).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'giu');
}

/** "Grade 4" or "Kinder" says nothing about a school; "Grade 4 - Sampaguita" does. */
function isDistinctiveClassName(name: string): boolean {
  const n = name.trim();
  return n.length >= 4 && !/^(?:grade|baitang|gr\.?|g|kinder(?:garten)?|k)\s*-?\s*(?:\d{1,2}|k)?$/i.test(n);
}

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_FIL = ['Enero', 'Pebrero', 'Marso', 'Abril', 'Mayo', 'Hunyo', 'Hulyo', 'Agosto', 'Setyembre', 'Oktubre', 'Nobyembre', 'Disyembre'];

/** The plan's own session dates, in the forms teachers write them. Other dates (1898, a due date) stay. */
function datePatterns(iso: string): RegExp[] {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return [];
  const [, y, mo, d] = m;
  const mi = Number(mo) - 1;
  const day = String(Number(d));
  const months = [MONTHS_EN[mi]!, MONTHS_EN[mi]!.slice(0, 3), MONTHS_FIL[mi]!].map(escapeRegExp).join('|');
  const b = (s: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${s})(?![\\p{L}\\p{N}])`, 'giu');
  return [
    b(escapeRegExp(iso)),
    b(`(?:${months})\\.?\\s+0?${day},?\\s+${y}`),
    b(`0?${day}\\s+(?:${months})\\.?,?\\s+${y}`),
    b(`0?${Number(mo)}[/-]0?${day}[/-]${y}`),
  ];
}

const SIGNATURE_LABEL =
  /^\s*(?:(?:prepared|submitted|checked|noted|reviewed|approved|verified|recommending\s+approval|attested)\s+by|(?:inihanda|isinumite|sinuri|binigyang[\s-]pansin|pinagtibay|iniwasto|binigyang[\s-]pansin)\s+(?:ni|nina))\b/i;
const SIGNATURE_TAIL_ROLE =
  /\b(?:teacher|principal|head\s*teacher|master\s*teacher|coordinator|school\s*head|adviser|guro|punong[\s-]guro|tagapayo|ulong[\s-]guro|department\s+head|signature|lagda)\b/i;

function isSignatureTail(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 80) return false;
  return /^[\p{Lu}\s.,'’-]+$/u.test(t) || SIGNATURE_TAIL_ROLE.test(t) || /^_{3,}$/.test(t);
}

const spanText = (spans: Array<{ text: string }>) => spans.map((s) => s.text).join('');

function stripSignatures(blocks: RichText): RichText {
  const out: RichText = [];
  let tail = 0;
  for (const b of blocks) {
    const text = b.t === 'p' ? spanText(b.spans) : '';
    if (b.t === 'p' && SIGNATURE_LABEL.test(text)) {
      tail = 3;
      continue;
    }
    if (tail > 0 && b.t === 'p' && isSignatureTail(text)) {
      tail--;
      continue;
    }
    tail = 0;
    out.push(b);
  }
  return out;
}

function stripSignatureItems(items: string[]): string[] {
  const out: string[] = [];
  let tail = 0;
  for (const item of items) {
    if (SIGNATURE_LABEL.test(item)) {
      tail = 2;
      continue;
    }
    if (tail > 0 && isSignatureTail(item)) {
      tail--;
      continue;
    }
    tail = 0;
    out.push(item);
  }
  return out;
}

function cleanRich(blocks: RichText, clean: (s: string) => string): RichText {
  return stripSignatures(blocks).map((b) =>
    b.t === 'p' ? { ...b, spans: b.spans.map((s) => ({ ...s, text: clean(s.text) })) } : { ...b, items: b.items.map((it) => it.map((s) => ({ ...s, text: clean(s.text) }))) },
  );
}

export function cleanContent(c: SectionContent, clean: (s: string) => string): SectionContent {
  switch (c.type) {
    case 'text':
      return { ...c, blocks: cleanRich(c.blocks, clean) };
    case 'list':
      return { ...c, items: stripSignatureItems(c.items).map(clean) };
    case 'procedure':
      return { ...c, steps: c.steps.map((s) => ({ ...s, title: clean(s.title), body: cleanRich(s.body, clean) })) };
    case 'weekgrid':
      return { ...c, days: c.days.map((d) => ({ ...d, date: null, body: cleanRich(d.body, clean) })) };
    case 'pergroup':
      return { ...c, groups: Object.fromEntries(Object.entries(c.groups).map(([k, v]) => [k, cleanRich(v, clean)])) };
    case 'multigrade':
      return {
        ...c,
        blocks: c.blocks.map((b) => ({
          ...b,
          label: clean(b.label),
          groups: Object.fromEntries(Object.entries(b.groups).map(([k, g]) => [k, { ...g, activity: cleanRich(g.activity, clean) }])),
        })),
      };
  }
}

