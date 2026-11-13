/**
 * Copy a community version into the caller's own plans (COM-4). The server builds the records; the CLIENT
 * stores them through the sync engine. The copy is a private draft with fresh ids and a lineage link.
 */
import { CopyArtifactResponse, Plan, PlanSection } from '@hiraia/tala-core';
import type { MultigradeBlock, SectionContent } from '@hiraia/tala-core';
import type { z } from 'zod';
import { HttpError } from '../../kernel/types';
import type { SessionUser } from '../../kernel/types';
import type { VersionContent, VersionMeta } from './publish';
import type { CommunityDeps } from './service';
import { getArtifact, getVersion } from './store';

export function remapContent(c: SectionContent, map: Map<string, string>, newId: () => string): SectionContent {
  const groups = <T>(rec: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(rec).flatMap(([k, v]) => (map.has(k) ? [[map.get(k)!, v] as const] : [])));
  switch (c.type) {
    case 'pergroup':
      return { ...c, groups: groups(c.groups) };
    case 'procedure':
      return { ...c, steps: c.steps.map((s) => ({ ...s, id: newId() })) };
    case 'multigrade':
      return {
        ...c,
        blocks: c.blocks.map(
          (b): MultigradeBlock => ({
            ...b,
            id: newId(),
            teacherWith: b.teacherWith === 'all' || b.teacherWith === 'none' ? b.teacherWith : (map.get(b.teacherWith) ?? 'none'),
            pairedGroupIds: b.pairedGroupIds.flatMap((g) => (map.has(g) ? [map.get(g)!] : [])),
            groups: groups(b.groups),
          }),
        ),
      };
    default:
      return structuredClone(c);
  }
}

export function copyArtifact(
  deps: CommunityDeps,
  user: SessionUser,
  artifactId: string,
  body: { versionId?: string; gradeGroupIds?: string[] },
): z.output<typeof CopyArtifactResponse> {
  const { db } = deps;
  const a = getArtifact(db, artifactId);
  const mine = a?.author_id === user.id;
  if (!a || a.status === 'removed' || (a.status !== 'visible' && !mine)) throw new HttpError('not_found', 'This community lesson is no longer available.', { reason: 'artifact_unavailable' });
  const v = getVersion(db, body.versionId ?? a.current_version_id);
  if (!v || v.artifact_id !== a.id || (v.status !== 'allowed' && !mine)) throw new HttpError('not_found', 'That version of the lesson is not available.', { reason: 'version_unavailable' });

  const content = JSON.parse(v.content_json) as VersionContent;
  const meta = JSON.parse(v.meta_json) as VersionMeta;

  const source = content.gradeGroups;
  if (body.gradeGroupIds && body.gradeGroupIds.length !== source.length) {
    throw new HttpError(
      'invalid_input',
      source.length === 1
        ? 'This lesson is for one grade. Choose one grade group of your class.'
        : `This lesson is for ${source.length} grade groups. Choose ${source.length} grade groups of your class, in the same order.`,
      { reason: 'grade_groups_mismatch', expected: source.length },
    );
  }
  if (body.gradeGroupIds && new Set(body.gradeGroupIds).size !== body.gradeGroupIds.length) {
    throw new HttpError('invalid_input', 'Choose a different grade group for each grade.', { reason: 'grade_groups_duplicate' });
  }
  const map = new Map(source.map((g, i) => [g.id, body.gradeGroupIds?.[i] ?? deps.newId()]));

  const planId = deps.newId();
  const plan = Plan.parse({
    id: planId,
    title: meta.title,
    templateId: content.templateId,
    language: meta.tags.language,
    subjectName: meta.tags.subjectName,
    learningAreaId: meta.tags.learningAreaId,
    grades: source.length ? source.map((g) => g.grade) : meta.tags.grades,
    gradeGroupIds: source.map((g) => map.get(g.id)!),
    competencies: Object.fromEntries(Object.entries(content.competencies).flatMap(([k, ids]) => (map.has(k) ? [[map.get(k)!, [...ids]]] : []))),
    curriculumVersion: meta.tags.curriculumVersion,
    customObjectives: [...content.customObjectives],
    durationMinutes: Math.min(600, Math.max(5, meta.tags.durationMinutes)),
    placements: [],
    state: 'draft',
    lock: null,
    submitted: null,
    aiDraft: false,
    // Carries the AI-drafted provenance forward until the copier rewrites it (§11.3).
    aiAssisted: meta.provenance.aiDrafted,
    lineage: { artifactId: a.id, versionId: v.id, title: meta.title, authorDisplayName: meta.authorDisplayName },
    unitId: null,
    conflictCopyOf: null,
  });
  const sections = content.sections.map((s) =>
    PlanSection.parse({ id: deps.newId(), planId, key: s.key, content: remapContent(s.content, map, deps.newId), origin: 'copied', editedByTeacher: false, gen: null }),
  );

  // Copy count = distinct teachers other than the author (COM-6).
  if (!mine) {
    const inserted = db
      .prepare('INSERT OR IGNORE INTO community_copies (artifact_id, user_id, version_id, created_at) VALUES (?, ?, ?, ?)')
      .run(a.id, user.id, v.id, deps.now().toISOString());
    if (inserted.changes > 0) db.prepare('UPDATE community_artifacts SET copy_count = copy_count + 1 WHERE id = ?').run(a.id);
  }
  deps.log.info('community.copy', { artifactId: a.id, versionId: v.id });
  return CopyArtifactResponse.parse({ plan, sections });
}
