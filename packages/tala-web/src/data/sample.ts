/**
 * Sample class (PACE-11, §7.5): one tap adds worker B's shared demo bundle (`@hiraia/tala-core/sample`: Grade 2 +
 * Grade 4 Mathematics, fictional learners, three example plans, one locked) and one tap removes it. Labelled sample
 * everywhere; never postable to the community (isSample on the class).
 */
import { buildSampleClass, buildSampleCompetencies } from '@hiraia/tala-core/sample';
import type { CalendarPreset, ClassRecord, Competency, Lang, SchoolYear, SyncEngine } from '@hiraia/tala-core/contracts';
import { newId as defaultNewId } from './ids';

export interface SampleDeps {
  engine: SyncEngine;
  today: string;
  lang: Lang;
  preset: CalendarPreset | null;
  existingYear: SchoolYear | null;
  newId?: () => string;
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

/** Write the school year (if new) and the whole sample bundle as one durable operation. */
export async function createSampleClass(deps: SampleDeps): Promise<{ classId: string; yearId: string }> {
  const newId = deps.newId ?? defaultNewId;
  const eng = deps.engine;
  const ops: Array<{ op: 'put'; entity: 'school_year' | 'calendar_day' | 'profile' | 'class' | 'assignment' | 'pacing_track' | 'student' | 'plan' | 'plan_section'; data: unknown }> = [];
  let year = deps.existingYear;
  if (!year) {
    const yid = newId();
    if (deps.preset) {
      const built = schoolYearFromPreset(deps.preset, yid, newId);
      year = built.year;
      ops.push({ op: 'put', entity: 'school_year', data: year });
      for (const d of built.days) ops.push({ op: 'put', entity: 'calendar_day', data: { id: newId(), schoolYearId: yid, date: d.date, kind: d.kind, label: d.label, classId: null, minutesOverride: null, source: 'preset', followsWeekday: null, assignmentIds: null } });
    } else {
      year = blankSchoolYear(yid, deps.today, newId);
      ops.push({ op: 'put', entity: 'school_year', data: year });
    }
    const profile = (await eng.get('profile', 'profile'))?.data;
    if (profile) ops.push({ op: 'put', entity: 'profile', data: { ...profile, activeSchoolYearId: year.id } });
  }
  const bundle = buildSampleClass({ schoolYear: year, today: deps.today, newId, lang: deps.lang });
  for (const r of bundle.records) ops.push({ op: 'put', entity: r.entity, data: r.data });
  for (const d of bundle.calendarDays) ops.push({ op: 'put', entity: 'calendar_day', data: d });
  await eng.batch(ops);
  return { classId: bundle.classRecord.id, yearId: year.id };
}

/** The bundle's fixture competencies, so the timeline can pace a sample class offline (matches the server fixtures). */
export function sampleCompetenciesFor(classes: ClassRecord[], termIndexes: number[]): Competency[] {
  const out: Competency[] = [];
  const seen = new Set<string>();
  for (const c of classes.filter(c => c.isSample)) {
    for (const g of c.gradeGroups) {
      for (const comp of buildSampleCompetencies(g.grade, termIndexes)) {
        if (!seen.has(comp.id)) {
          seen.add(comp.id);
          out.push(comp);
        }
      }
    }
  }
  return out;
}

/** Remove every record that belongs only to sample classes, as one operation. */
export async function removeSampleClasses(eng: SyncEngine): Promise<number> {
  const classes = (await eng.list('class')).map(r => r.data).filter(c => c.isSample);
  if (!classes.length) return 0;
  const ids = new Set(classes.map(c => c.id));
  const ops: Array<{ op: 'remove'; entity: 'assignment' | 'pacing_track' | 'pairing_override' | 'session_mark' | 'day_note' | 'student' | 'calendar_day' | 'unit' | 'plan' | 'plan_section' | 'section_revision' | 'class'; id: string }> = [];
  const drop = async (entity: 'assignment' | 'pacing_track' | 'pairing_override' | 'session_mark' | 'day_note' | 'student' | 'calendar_day' | 'unit', pick: (d: { classId?: string | null }) => boolean) => {
    for (const r of await eng.list(entity)) if (pick(r.data as { classId?: string | null })) ops.push({ op: 'remove', entity, id: r.id });
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
  const sections = await eng.list('plan_section');
  const revisions = await eng.list('section_revision');
  for (const p of plans) {
    if (p.data.placements.length && p.data.placements.every(pl => ids.has(pl.classId))) {
      for (const s of sections) if (s.data.planId === p.id) ops.push({ op: 'remove', entity: 'plan_section', id: s.id });
      for (const s of revisions) if (s.data.planId === p.id) ops.push({ op: 'remove', entity: 'section_revision', id: s.id });
      ops.push({ op: 'remove', entity: 'plan', id: p.id });
    }
  }
  for (const c of classes) ops.push({ op: 'remove', entity: 'class', id: c.id });
  await eng.batch(ops);
  return classes.length;
}
