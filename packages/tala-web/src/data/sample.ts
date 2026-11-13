/**
 * Sample class (PACE-11, §7.5): one tap adds a multigrade class with made-up data and a few example lessons;
 * one tap removes it. Labelled sample everywhere; never postable to the community (isSample on the class).
 */
import { engine } from '@hiraia/tala-core/pacing';
import {
  BUILTIN_TEMPLATES,
  DEFAULT_PACING_PARAMS,
  type CalendarPreset,
  type ClassRecord,
  type Competency,
  type CurriculumIndex,
  type Lang,
  type PacingTrack,
  type Plan,
  type PlanSection,
  type SchoolYear,
  type SyncEngine,
  type TeachingAssignment,
} from '@hiraia/tala-core/contracts';
import { curriculumVersionFor, packIdFor } from './curriculum';
import { newId as defaultNewId } from './ids';
import { lockPlan } from '@hiraia/tala-core/plan';
import { newPlan } from './plans';

export interface SampleDeps {
  engine: SyncEngine;
  today: string;
  lang: Lang;
  index: CurriculumIndex | null;
  loadPack: (packId: string) => Promise<{ competencies: Competency[] } | null>;
  preset: CalendarPreset | null;
  existingYear: SchoolYear | null;
  newId?: () => string;
  now?: () => Date;
}

export function schoolYearFromPreset(preset: CalendarPreset, id: string, newId: () => string, schoolName = ''): { year: SchoolYear; days: Array<{ date: string; kind: 'national_holiday' | 'deped_event' | 'exam'; label: string }> } {
  return {
    year: {
      id,
      label: `${preset.startDate.slice(0, 4)}-${preset.endDate.slice(0, 4)}`,
      schoolName,
      startDate: preset.startDate,
      endDate: preset.endDate,
      terms: preset.terms.map(t => ({ id: newId(), index: t.index, name: t.name, startDate: t.startDate, endDate: t.endDate })),
      teachingWeekdays: [1, 2, 3, 4, 5],
      presetId: preset.id,
      presetVersion: preset.version,
      provisional: preset.provisional,
    },
    days: preset.days,
  };
}

/** A blank school year around `today` when no preset is available (fallback, §14.2.3). */
export function blankSchoolYear(id: string, today: string, newId: () => string): SchoolYear {
  const y = Number(today.slice(0, 4));
  const startYear = Number(today.slice(5, 7)) >= 6 ? y : y - 1;
  const q = (i: number, s: string, e: string) => ({ id: newId(), index: i, name: `Quarter ${i}`, startDate: s, endDate: e });
  return {
    id,
    label: `${startYear}-${startYear + 1}`,
    schoolName: '',
    startDate: `${startYear}-06-15`,
    endDate: `${startYear + 1}-04-10`,
    terms: [q(1, `${startYear}-06-15`, `${startYear}-08-21`), q(2, `${startYear}-08-24`, `${startYear}-10-30`), q(3, `${startYear}-11-09`, `${startYear + 1}-01-29`), q(4, `${startYear + 1}-02-01`, `${startYear + 1}-04-10`)],
    teachingWeekdays: [1, 2, 3, 4, 5],
    presetId: null,
    presetVersion: null,
    provisional: true,
  };
}

const SAMPLE_NAME: Record<Lang, string> = { fil: 'Halimbawang Klase (Grade 3 at 4)', en: 'Sample Class (Grade 3 and 4)' };

export async function createSampleClass(deps: SampleDeps): Promise<{ classId: string; yearId: string }> {
  const newId = deps.newId ?? defaultNewId;
  const now = deps.now ?? (() => new Date());
  const eng = deps.engine;
  let year = deps.existingYear;
  if (!year) {
    const yid = newId();
    if (deps.preset) {
      const built = schoolYearFromPreset(deps.preset, yid, newId);
      year = built.year;
      await eng.put('school_year', year);
      for (const d of built.days) {
        await eng.put('calendar_day', { id: newId(), schoolYearId: yid, date: d.date, kind: d.kind, label: d.label, classId: null, minutesOverride: null, source: 'preset', followsWeekday: null, assignmentIds: null });
      }
    } else {
      year = blankSchoolYear(yid, deps.today, newId);
      await eng.put('school_year', year);
    }
    const profile = (await eng.get('profile', 'profile'))?.data;
    if (profile) await eng.put('profile', { ...profile, activeSchoolYearId: year.id });
  }

  const g3 = newId();
  const g4 = newId();
  const cls: ClassRecord = {
    id: newId(),
    schoolYearId: year.id,
    name: SAMPLE_NAME[deps.lang],
    curriculum: 'deped',
    gradeGroups: [
      { id: g3, grade: '3', learnerCount: 14 },
      { id: g4, grade: '4', learnerCount: 11 },
    ],
    languages: [deps.lang],
    profile: { materials: ['chalkboard', 'printed modules'], textbooks: [], electricity: true, projector: false, printing: false, outdoorSpace: true, notes: 'Sample data only.' },
    isSample: true,
    archived: false,
  };
  await eng.put('class', cls);

  const version = curriculumVersionFor(deps.index, year.label);
  const mathHasPack = cls.gradeGroups.some(g => packIdFor(deps.index, year.label, g.grade, 'mathematics'));
  const science: TeachingAssignment = {
    id: newId(),
    classId: cls.id,
    learningAreaId: 'science',
    subjectName: deps.lang === 'fil' ? 'Agham' : 'Science',
    gradeGroupIds: [g3, g4],
    language: deps.lang,
    slots: [1, 3, 5].map(weekday => ({ id: newId(), weekday, startTime: '08:00', minutes: 50, rotation: null })),
  };
  const math: TeachingAssignment = {
    id: newId(),
    classId: cls.id,
    // Without a Mathematics pack the subject still works with typed objectives (CUR-10) and shows the fallback.
    learningAreaId: mathHasPack ? 'mathematics' : null,
    subjectName: deps.lang === 'fil' ? 'Matematika' : 'Mathematics',
    gradeGroupIds: [g3, g4],
    language: deps.lang,
    slots: [1, 2, 3, 4, 5].map(weekday => ({ id: newId(), weekday, startTime: '09:00', minutes: 50, rotation: null })),
  };
  await eng.put('assignment', science);
  await eng.put('assignment', math);

  const allCompetencies: Competency[] = [];
  for (const a of [science, math]) {
    for (const g of cls.gradeGroups) {
      const pid = packIdFor(deps.index, year.label, g.grade, a.learningAreaId);
      const pack = pid ? await deps.loadPack(pid) : null;
      if (pack) allCompetencies.push(...pack.competencies);
    }
  }

  for (const a of [science, math]) {
    for (const g of cls.gradeGroups) {
      for (const term of year.terms) {
        const track: PacingTrack = { id: newId(), classId: cls.id, assignmentId: a.id, gradeGroupId: g.id, termId: term.id, curriculumVersion: version, startPosition: null, params: {}, overrides: {}, allocation: null };
        const comps = allCompetencies.filter(c => c.grade === g.grade && c.learningAreaId === a.learningAreaId);
        if (comps.length && term.startDate <= deps.today && term.endDate >= deps.today) {
          const proposed = engine.proposeStartPosition({ track, schoolYear: year, term, assignment: a, calendarDays: [], competencies: comps, today: deps.today, defaults: DEFAULT_PACING_PARAMS });
          if (proposed) track.startPosition = proposed;
        }
        await eng.put('pacing_track', track);
      }
    }
  }

  // Example lessons on the next two Science sessions and one locked Math lesson in the past week.
  const term = engine.termForDate(year, deps.today);
  if (term) {
    const sciSessions = engine.enumerateSessions(year, term, science, []).filter(s => s.date >= deps.today).slice(0, 2);
    const mathSessions = engine.enumerateSessions(year, term, math, []).filter(s => s.date < deps.today).slice(-1);
    const sampleText = (t: string) => [{ t: 'p' as const, spans: [{ text: t }] }];
    const mg = BUILTIN_TEMPLATES.find(t => t.kind === 'multigrade')!;
    const dlp = BUILTIN_TEMPLATES.find(t => t.kind === 'dlp')!;
    if (sciSessions[0]) {
      const { plan, sections } = newPlan({ template: mg, cls, assignment: science, dates: [sciSessions[0].date], language: deps.lang, curriculumVersion: version, newId, title: deps.lang === 'fil' ? 'Halimbawa: Mga Anyo ng Bagay' : 'Sample: States of Matter' });
      fillSample(plan, sections, [g3, g4], sampleText, deps.lang, newId);
      await eng.put('plan', plan);
      for (const s of sections) await eng.put('plan_section', s);
    }
    if (sciSessions[1]) {
      const { plan, sections } = newPlan({ template: mg, cls, assignment: science, dates: [sciSessions[1].date], language: deps.lang, curriculumVersion: version, newId, title: deps.lang === 'fil' ? 'Halimbawa: Burador na walang laman' : 'Sample: Empty draft' });
      await eng.put('plan', plan);
      for (const s of sections) await eng.put('plan_section', s);
    }
    if (mathSessions[0]) {
      const { plan, sections } = newPlan({ template: dlp, cls, assignment: math, dates: [mathSessions[0].date], language: deps.lang, curriculumVersion: version, newId, title: deps.lang === 'fil' ? 'Halimbawa: Naka-lock na aralin' : 'Sample: Locked lesson' });
      for (const s of sections) {
        if (s.content.type === 'list') s.content = { type: 'list', items: [deps.lang === 'fil' ? 'Halimbawang aytem' : 'Sample item'] };
        if (s.content.type === 'text') s.content = { type: 'text', blocks: sampleText(deps.lang === 'fil' ? 'Halimbawang teksto.' : 'Sample text.') };
        if (s.content.type === 'procedure') s.content = { type: 'procedure', steps: [{ id: newId(), title: deps.lang === 'fil' ? 'Panimula' : 'Opening', minutes: 10, body: sampleText('…') }] };
      }
      const g3Comp = allCompetencies.find(c => c.grade === '3' && c.learningAreaId === 'mathematics');
      if (g3Comp) plan.competencies = { [g3]: [g3Comp.id] };
      let locked: Plan = plan;
      try {
        locked = lockPlan({ plan, sections, template: dlp, class: cls, teacherName: '', at: now().toISOString(), revision: null });
      } catch {
        /* keep it a draft if the sample content does not pass DOC-1 */
      }
      await eng.put('plan', locked);
      for (const s of sections) await eng.put('plan_section', s);
      await eng.put('session_mark', { id: newId(), classId: cls.id, assignmentId: math.id, gradeGroupId: g3, date: mathSessions[0].date, slotId: null, planId: locked.id, competencyIds: [], status: 'taught', remark: '' });
    }
  }
  return { classId: cls.id, yearId: year.id };
}

function fillSample(plan: Plan, sections: PlanSection[], groups: string[], text: (t: string) => Array<{ t: 'p'; spans: Array<{ text: string }> }>, lang: Lang, newId: () => string) {
  const L = (fil: string, en: string) => (lang === 'fil' ? fil : en);
  for (const s of sections) {
    if (s.content.type === 'pergroup') {
      s.content = { type: 'pergroup', groups: Object.fromEntries(groups.map((g, i) => [g, text(L(`Halimbawang layunin para sa grupo ${i + 1}.`, `Sample objective for group ${i + 1}.`))])) };
    }
    if (s.content.type === 'multigrade') {
      s.content = {
        type: 'multigrade',
        blocks: [
          { id: newId(), label: L('Panimula', 'Opening'), minutes: 10, transitionMinutes: 0, teacherWith: 'all', pairedGroupIds: groups, groups: Object.fromEntries(groups.map(g => [g, { mode: 'shared' as const, activity: text(L('Balik-aral na sama-sama.', 'Shared review.')) }])) },
          { id: newId(), label: L('Gawaing pangkat', 'Group work'), minutes: 30, transitionMinutes: 5, teacherWith: groups[0]!, pairedGroupIds: [], groups: Object.fromEntries(groups.map((g, i) => [g, { mode: i === 0 ? ('direct' as const) : ('independent' as const), activity: text(L('Halimbawang gawain.', 'Sample activity.')) }])) },
          { id: newId(), label: L('Pagtatapos', 'Wrap-up'), minutes: 10, transitionMinutes: 0, teacherWith: 'all', pairedGroupIds: groups, groups: Object.fromEntries(groups.map(g => [g, { mode: 'shared' as const, activity: text(L('Pagbabahagi.', 'Sharing.')) }])) },
        ],
      };
    }
  }
  plan.aiDraft = false;
}

/** Remove every record that belongs only to sample classes. */
export async function removeSampleClasses(eng: SyncEngine): Promise<number> {
  const classes = (await eng.list('class')).map(r => r.data).filter(c => c.isSample);
  if (!classes.length) return 0;
  const ids = new Set(classes.map(c => c.id));
  const drop = async (entity: 'assignment' | 'pacing_track' | 'pairing_override' | 'session_mark' | 'day_note' | 'student' | 'calendar_day' | 'unit', pick: (d: { classId?: string | null }) => boolean) => {
    for (const r of await eng.list(entity)) if (pick(r.data as { classId?: string | null })) await eng.remove(entity, r.id);
  };
  await drop('assignment', d => ids.has(d.classId ?? ''));
  await drop('pacing_track', d => ids.has(d.classId ?? ''));
  await drop('pairing_override', d => ids.has(d.classId ?? ''));
  await drop('session_mark', d => ids.has(d.classId ?? ''));
  await drop('day_note', d => ids.has(d.classId ?? ''));
  await drop('student', d => ids.has(d.classId ?? ''));
  await drop('unit', d => ids.has(d.classId ?? ''));
  await drop('calendar_day', d => !!d.classId && ids.has(d.classId));
  const plans = await eng.list('plan');
  for (const p of plans) {
    if (p.data.placements.length && p.data.placements.every(pl => ids.has(pl.classId))) {
      for (const s of await eng.list('plan_section')) if (s.data.planId === p.id) await eng.remove('plan_section', s.id);
      for (const s of await eng.list('section_revision')) if (s.data.planId === p.id) await eng.remove('section_revision', s.id);
      await eng.remove('plan', p.id);
    }
  }
  for (const c of classes) await eng.remove('class', c.id);
  return classes.length;
}
