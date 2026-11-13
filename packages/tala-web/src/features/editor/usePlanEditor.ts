'use client';
/**
 * Data for the lesson editor: the plan, its sections, section history, template, class context and competencies,
 * plus debounced saves that snapshot a section_revision before the first edit of a session (PLAN-10).
 * Saves go to the device immediately (IndexedDB) — a connection loss never loses an edit (OFF-7).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { boundSectionHistory, lockPlan, restoreSectionRevision, sectionRevision } from '@hiraia/tala-core/plan';
import type { Plan, PlanSection, SectionContent, SectionRevision, Template } from '@hiraia/tala-core/contracts';
import { useRecord, useRecords, useWorkspace } from '@/data/records';
import { useSession } from '@/data/session';
import { packIdFor, useCurriculumIndex, usePacks } from '@/data/curriculum';
import { newId, nowIso } from '@/data/ids';
import { lockProblems, templateById, type LockProblem } from '@/data/plans';
import { sampleCompetenciesFor } from '@/data/sample';

const SECTION_DEBOUNCE_MS = 700;
const PLAN_DEBOUNCE_MS = 500;
const SNAPSHOT_WINDOW_MS = 5 * 60_000;
const HISTORY_PER_SECTION = 10;

export function usePlanEditor(planId: string) {
  const { engine, user } = useSession();
  const ws = useWorkspace();
  const { record: planRecord, loading: planLoading } = useRecord('plan', planId);
  const sectionRecords = useRecords('plan_section');
  const revisionRecords = useRecords('section_revision');
  const customTemplates = useRecords('template');
  const { index } = useCurriculumIndex();

  const plan = planRecord && !planRecord.deletedAt ? planRecord.data : null;
  /**
   * Unsaved edits per section, applied synchronously so a structured editor (per-group, time blocks, steps)
   * always rebuilds from the latest content — never from a prop that is still waiting on the save debounce.
   */
  const [drafts, setDrafts] = useState<Record<string, SectionContent>>({});
  const storedSections = useMemo(() => sectionRecords.items.filter(s => s.data.planId === planId), [sectionRecords.items, planId]);
  const sections = useMemo(() => storedSections.map(s => (drafts[s.id] ? { ...s, data: { ...s.data, content: drafts[s.id]!, editedByTeacher: true } } : s)), [storedSections, drafts]);
  // Drop a draft once the stored record carries the same content.
  useEffect(() => {
    setDrafts(d => {
      let changed = false;
      const next = { ...d };
      for (const [id, content] of Object.entries(d)) {
        const rec = storedSections.find(s => s.id === id);
        if (rec && JSON.stringify(rec.data.content) === JSON.stringify(content)) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : d;
    });
  }, [storedSections]);
  const revisions = useMemo(() => revisionRecords.items.filter(r => r.data.planId === planId).sort((a, b) => b.data.savedAt.localeCompare(a.data.savedAt)), [revisionRecords.items, planId]);
  const template: Template | null = plan ? templateById(plan.templateId, customTemplates.items.map(t => t.data)) : null;
  const placement = plan?.placements[0] ?? null;
  const cls = useMemo(() => (placement ? (ws.allClasses.find(c => c.id === placement.classId) ?? null) : null), [ws.allClasses, placement]);
  const assignment = useMemo(() => (placement?.assignmentId ? (ws.assignments.find(a => a.id === placement.assignmentId) ?? null) : null), [ws.assignments, placement]);
  const groups = useMemo(() => {
    if (!plan) return [];
    const ids = plan.gradeGroupIds.length ? plan.gradeGroupIds : (cls?.gradeGroups.map(g => g.id) ?? []);
    return ids.map((id, i) => ({ id, grade: cls?.gradeGroups.find(g => g.id === id)?.grade ?? plan.grades[i] ?? plan.grades[0] ?? '' }));
  }, [plan, cls]);
  const packIds = useMemo(() => {
    if (!plan?.learningAreaId) return [];
    const year = ws.years.find(y => y.id === cls?.schoolYearId) ?? ws.activeYear;
    return [...new Set(groups.map(g => packIdFor(index, year?.label ?? null, g.grade, plan.learningAreaId)).filter((x): x is string => !!x))];
  }, [plan, groups, index, ws.years, ws.activeYear, cls]);
  const { competencies: packCompetencies } = usePacks(packIds);
  const competencies = useMemo(() => (cls?.isSample && ws.activeYear ? [...packCompetencies, ...sampleCompetenciesFor([cls], ws.activeYear.terms.map(t => t.index)).filter(c => !packCompetencies.some(p => p.id === c.id))] : packCompetencies), [packCompetencies, cls, ws.activeYear]);

  /* ---------- debounced saves ---------- */
  const sectionTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingSections = useRef(new Map<string, PlanSection>());
  const snapshotted = useRef(new Map<string, number>());
  const planTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPlan = useRef<Plan | null>(null);
  const latestPlan = useRef<Plan | null>(plan);
  latestPlan.current = plan ?? latestPlan.current;

  const flushSection = useCallback(
    async (id: string) => {
      const next = pendingSections.current.get(id);
      pendingSections.current.delete(id);
      sectionTimers.current.delete(id);
      if (!next || !engine) return;
      const current = await engine.get('plan_section', id);
      const last = snapshotted.current.get(id) ?? 0;
      if (current && Date.now() - last > SNAPSHOT_WINDOW_MS) {
        snapshotted.current.set(id, Date.now());
        await engine.put('section_revision', sectionRevision(current.data, { id: newId(), savedAt: nowIso(), reason: 'edit' }));
        // Bounded history: keep the newest N per section; never prune unsent (dirty / rev 0) revisions.
        const history = (await engine.list('section_revision')).filter(r => r.data.planId === planId).sort((a, b) => b.data.savedAt.localeCompare(a.data.savedAt));
        const { remove } = boundSectionHistory(history.map(h => h.data), HISTORY_PER_SECTION);
        for (const r of remove) {
          const rec = history.find(h => h.id === r.id);
          if (rec && !rec.dirty && rec.rev > 0) await engine.remove('section_revision', r.id);
        }
      }
      await engine.put('plan_section', current ? { ...current.data, content: next.content, editedByTeacher: true } : next);
      const p = latestPlan.current;
      if (p && p.aiDraft && next.origin === 'ai') await engine.put('plan', { ...p, aiDraft: false });
    },
    [engine, planId],
  );

  const saveSection = useCallback(
    (section: PlanSection, content: SectionContent) => {
      setDrafts(d => ({ ...d, [section.id]: content }));
      pendingSections.current.set(section.id, { ...section, content, editedByTeacher: true });
      const t = sectionTimers.current.get(section.id);
      if (t) clearTimeout(t);
      sectionTimers.current.set(
        section.id,
        setTimeout(() => void flushSection(section.id), SECTION_DEBOUNCE_MS),
      );
    },
    [flushSection],
  );

  const flushPlan = useCallback(async () => {
    const next = pendingPlan.current;
    pendingPlan.current = null;
    planTimer.current = null;
    if (next && engine) await engine.put('plan', next);
  }, [engine]);

  const savePlan = useCallback(
    (patch: Partial<Plan>, immediate = false) => {
      const base = pendingPlan.current ?? latestPlan.current;
      if (!base) return;
      pendingPlan.current = { ...base, ...patch };
      latestPlan.current = pendingPlan.current;
      if (planTimer.current) clearTimeout(planTimer.current);
      if (immediate) void flushPlan();
      else planTimer.current = setTimeout(() => void flushPlan(), PLAN_DEBOUNCE_MS);
    },
    [flushPlan],
  );

  const flushAll = useCallback(async () => {
    for (const id of [...sectionTimers.current.keys()]) {
      clearTimeout(sectionTimers.current.get(id));
      await flushSection(id);
    }
    if (planTimer.current) {
      clearTimeout(planTimer.current);
      await flushPlan();
    }
  }, [flushSection, flushPlan]);

  useEffect(() => {
    const onHide = () => void flushAll();
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onHide);
      void flushAll();
    };
  }, [flushAll]);

  const pendingCount = pendingSections.current.size + (pendingPlan.current ? 1 : 0);

  /* ---------- lock / unlock ---------- */
  const problems: LockProblem[] = useMemo(() => (plan && template ? lockProblems(plan, sections.map(s => s.data), template, cls) : []), [plan, template, sections, cls]);

  const lock = useCallback(async () => {
    if (!engine || !plan || !template) return false;
    await flushAll();
    const freshSections = (await engine.list('plan_section')).filter(s => s.data.planId === planId).map(s => s.data);
    const freshPlan = (await engine.get('plan', planId))?.data ?? plan;
    try {
      const locked = lockPlan({ plan: freshPlan, sections: freshSections, template, class: cls ?? undefined, teacherName: ws.profile?.displayName ?? user?.displayName ?? '', at: nowIso(), revision: planRecord?.rev || null });
      for (const s of freshSections) await engine.put('section_revision', sectionRevision(s, { id: newId(), savedAt: nowIso(), reason: 'lock' }));
      await engine.put('plan', locked);
      return true;
    } catch {
      return false;
    }
  }, [engine, plan, template, cls, ws.profile, user, planRecord, planId, flushAll]);

  const unlock = useCallback(async () => {
    if (!engine || !plan) return;
    const fresh = (await engine.get('plan', planId))?.data ?? plan;
    await engine.put('plan', { ...fresh, state: 'draft', lock: null, submitted: null });
  }, [engine, plan, planId]);

  const restore = useCallback(
    async (rev: SectionRevision) => {
      if (!engine) return;
      const current = await engine.get('plan_section', rev.sectionId);
      if (current) await engine.put('section_revision', sectionRevision(current.data, { id: newId(), savedAt: nowIso(), reason: 'restore' }));
      await engine.put('plan_section', restoreSectionRevision(rev));
    },
    [engine],
  );

  return {
    loading: planLoading || sectionRecords.loading || ws.loading,
    plan,
    planRecord,
    sections,
    revisions,
    template,
    cls,
    assignment,
    groups,
    competencies,
    ws,
    problems,
    pendingCount,
    saveSection,
    savePlan,
    flushAll,
    lock,
    unlock,
    restore,
  };
}

export type PlanEditor = ReturnType<typeof usePlanEditor>;
