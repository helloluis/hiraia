'use client';
/**
 * First-run setup in one sitting (PRD §7.5, SIMPLE-5): school year → class with 1–4 grade groups → subjects
 * and timetable → proposed starting positions. Every default is acceptable. Also the one-tap sample class.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { engine as pacing } from '@hiraia/tala-core/pacing';
import type {
  CalendarPreset,
  ClassRecord,
  Competency,
  GradeLevel,
  PacingTrack,
  SchoolYear,
  TeachingAssignment,
} from '@hiraia/tala-core/contracts';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { useWorkspace } from '@/data/records';
import {
  useCalendarPresets,
  useCurriculumIndex,
  loadPack,
  packIdFor,
  curriculumVersionOf,
} from '@/data/curriculum';
import { getClient } from '@/data/client';
import { isoDate, newId } from '@/data/ids';
import { ensureProfile } from '@/data/profile';
import { blankSchoolYear, createSampleClass, schoolYearFromPreset } from '@/data/sample';
import { pacingDefaults } from '@/data/timeline';
import {
  Banner,
  Button,
  Checkbox,
  Choice,
  EmptyState,
  Placeholder,
  Select,
  TextInput,
  Waiting,
} from '@/components/ui';
import { DayPicker } from './DayPicker';
import { DEFAULT_DAYS } from './days';

const GRADES: GradeLevel[] = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

interface GroupDraft {
  id: string;
  grade: GradeLevel;
  learners: string;
}
interface SubjectDraft {
  id: string;
  learningAreaId: string | null;
  name: string;
  days: number[];
  minutes: string;
  startTime: string;
  groupIds: string[];
}
interface StartDraft {
  subjectId: string;
  groupId: string;
  competencies: Competency[];
  chosen: string | null;
  proposed: string | null;
  noPack: boolean;
}

export function SetupScreen() {
  const { t, lang } = useT();
  const router = useRouter();
  const params = useSearchParams();
  const { engine, user, config, cache } = useSession();
  const ws = useWorkspace();
  const { presets, failed: presetsFailed, load: loadPreset } = useCalendarPresets();
  const { index } = useCurriculumIndex();
  const today = isoDate();
  const wantNewClass = params.get('new') === 'class';

  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [yearMode, setYearMode] = useState<'preset' | 'blank'>('preset');
  const [presetId, setPresetId] = useState<string>('');
  const [schoolName, setSchoolName] = useState('');
  const [yearLabel, setYearLabel] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [className, setClassName] = useState('');
  const [curriculum, setCurriculum] = useState<'deped' | 'none'>('deped');
  const [groups, setGroups] = useState<GroupDraft[]>([{ id: newId(), grade: '3', learners: '' }]);
  const [subjects, setSubjects] = useState<SubjectDraft[]>([]);
  const [starts, setStarts] = useState<StartDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sampleBusy, setSampleBusy] = useState(false);

  const existingYear = ws.activeYear;

  useEffect(() => {
    if (presets?.length && !presetId) setPresetId(presets[0]!.id);
    if (presetsFailed) setYearMode('blank');
  }, [presets, presetsFailed, presetId]);
  useEffect(() => {
    if (!yearLabel) {
      const blank = blankSchoolYear('x', today, () => 'x');
      setYearLabel(blank.label);
      setStartDate(blank.startDate);
      setEndDate(blank.endDate);
    }
  }, [yearLabel, today]);
  useEffect(() => {
    if (ws.profile?.schoolName && !schoolName) setSchoolName(ws.profile.schoolName);
  }, [ws.profile, schoolName]);

  const areas = useMemo(() => {
    const grades = new Set(groups.map((g) => g.grade));
    return (index?.learningAreas ?? []).filter((a) => a.grades.some((g) => grades.has(g)));
  }, [index, groups]);

  /* ---------- step 4 data ---------- */
  const prepareStarts = async (year: SchoolYear) => {
    const term = pacing.termForDate(year, today);
    const out: StartDraft[] = [];
    if (curriculum === 'none') {
      setStarts([]);
      return;
    }
    for (const s of subjects) {
      for (const gid of s.groupIds) {
        const g = groups.find((x) => x.id === gid)!;
        const pid = packIdFor(index, year.label, g.grade, s.learningAreaId);
        const pack = pid ? await loadPack(getClient(), cache, pid) : null;
        if (!pack) {
          out.push({
            subjectId: s.id,
            groupId: gid,
            competencies: [],
            chosen: null,
            proposed: null,
            noPack: true,
          });
          continue;
        }
        const comps = term ? pack.competencies.filter((c) => c.termIndex === term.index) : [];
        let proposed: string | null = null;
        if (term && comps.length) {
          const assignment = draftAssignment(s, 'class', year);
          const track: PacingTrack = {
            id: 'x',
            classId: 'class',
            assignmentId: assignment.id,
            gradeGroupId: gid,
            termId: term.id,
            curriculumVersion: pack.curriculumVersion,
            startPosition: null,
            params: {},
            overrides: {},
            allocation: null,
          };
          try {
            proposed =
              pacing.proposeStartPosition({
                track,
                schoolYear: year,
                term,
                assignment,
                calendarDays: [],
                competencies: comps,
                today,
                defaults: pacingDefaults(config),
              })?.competencyId ?? null;
          } catch {
            proposed = null;
          }
        }
        out.push({
          subjectId: s.id,
          groupId: gid,
          competencies: comps,
          chosen: proposed ?? comps[0]?.id ?? null,
          proposed,
          noPack: false,
        });
      }
    }
    setStarts(out);
  };

  const draftYear = (): SchoolYear => {
    if (existingYear) return existingYear;
    return blankSchoolYear('draft-year', today, () => newId());
  };

  /* ---------- navigation between steps with validation ---------- */
  const next = async () => {
    setError(null);
    if (step === 0) return setStep(existingYear ? 2 : 1);
    if (step === 1) return setStep(2);
    if (step === 2) {
      if (!className.trim()) return setError(t('setup.needName'));
      return setStep(3);
    }
    if (step === 3) {
      if (!subjects.length) return setError(t('setup.needSubject'));
      const missingDays = subjects.find((s) => !s.days.length);
      if (missingDays) return setError(t('setup.needDays', { subject: missingDays.name }));
      setBusy(t('common.loading'));
      try {
        let year = draftYear();
        if (!existingYear && yearMode === 'preset' && presetId) {
          const preset = await loadPreset(presetId);
          if (preset) year = schoolYearFromPreset(preset, 'draft-year', () => newId()).year;
        } else if (!existingYear) {
          year = {
            ...year,
            label: yearLabel,
            startDate,
            endDate,
            schoolName,
            terms: evenTerms(startDate, endDate),
          };
        }
        await prepareStarts(year);
        setStep(4);
      } finally {
        setBusy(null);
      }
    }
  };

  /* ---------- finish: write everything ---------- */
  const finish = async () => {
    if (!engine) return;
    setBusy(t('common.waiting'));
    setError(null);
    try {
      const profile = await ensureProfile(engine, user, lang);
      const ops: Array<{
        op: 'put';
        entity:
          | 'school_year'
          | 'calendar_day'
          | 'profile'
          | 'class'
          | 'assignment'
          | 'pacing_track';
        data: unknown;
      }> = [];
      let year = existingYear;
      if (!year) {
        const yid = newId();
        let preset: CalendarPreset | null = null;
        if (yearMode === 'preset' && presetId) preset = await loadPreset(presetId);
        if (preset) {
          const built = schoolYearFromPreset(preset, yid, newId, schoolName.trim());
          year = built.year;
          ops.push({ op: 'put', entity: 'school_year', data: year });
          for (const d of built.days) {
            ops.push({
              op: 'put',
              entity: 'calendar_day',
              data: {
                id: newId(),
                schoolYearId: yid,
                date: d.date,
                kind: d.kind,
                label: d.label,
                classId: null,
                minutesOverride: null,
                source: 'preset',
                followsWeekday: null,
                assignmentIds: null,
              },
            });
          }
        } else {
          year = {
            ...blankSchoolYear(yid, today, newId),
            label: yearLabel.trim() || yearLabel,
            startDate,
            endDate,
            schoolName: schoolName.trim(),
            terms: evenTerms(startDate, endDate),
          };
          ops.push({ op: 'put', entity: 'school_year', data: year });
        }
        ops.push({
          op: 'put',
          entity: 'profile',
          data: {
            ...profile,
            activeSchoolYearId: year.id,
            schoolName: schoolName.trim() || profile.schoolName,
          },
        });
      } else if (schoolName.trim() && !year.schoolName) {
        year = { ...year, schoolName: schoolName.trim() };
        ops.push({ op: 'put', entity: 'school_year', data: year });
      }
      const cls: ClassRecord = {
        id: newId(),
        schoolYearId: year.id,
        name: className.trim(),
        curriculum,
        gradeGroups: groups.map((g) => ({
          id: g.id,
          grade: g.grade,
          learnerCount: g.learners.trim()
            ? Math.max(0, Math.min(200, Number(g.learners) || 0))
            : null,
        })),
        languages: [lang],
        profile: {
          materials: [],
          textbooks: [],
          electricity: null,
          projector: null,
          printing: null,
          outdoorSpace: null,
          notes: '',
        },
        isSample: false,
        archived: false,
      };
      ops.push({ op: 'put', entity: 'class', data: cls });
      for (const s of subjects) {
        const a = draftAssignment(s, cls.id, year);
        ops.push({ op: 'put', entity: 'assignment', data: a });
        if (curriculum === 'none') continue;
        for (const gid of s.groupIds) {
          const chosen = starts?.find((x) => x.subjectId === s.id && x.groupId === gid);
          const grade = groups.find((x) => x.id === gid)?.grade ?? null;
          const version = grade ? curriculumVersionOf(index, year.label, grade, s.learningAreaId) : null;
          for (const term of year.terms) {
            const isCurrent = term.startDate <= today && term.endDate >= today;
            const track: PacingTrack = {
              id: newId(),
              classId: cls.id,
              assignmentId: a.id,
              gradeGroupId: gid,
              termId: term.id,
              curriculumVersion: version,
              startPosition:
                isCurrent && chosen?.chosen
                  ? {
                      competencyId: chosen.chosen,
                      date: today,
                      estimated: chosen.chosen === chosen.proposed,
                    }
                  : null,
              params: {},
              overrides: {},
              allocation: null,
            };
            ops.push({ op: 'put', entity: 'pacing_track', data: track });
          }
        }
      }
      // Class setup is one durable operation (SyncEngine.batch): a killed tab never leaves half a class.
      await engine.batch(ops);
      router.replace('/week');
    } catch {
      setError(t('error.generic'));
    } finally {
      setBusy(null);
    }
  };

  const addSample = async () => {
    if (!engine) return;
    setSampleBusy(true);
    try {
      await ensureProfile(engine, user, lang);
      const preset = presets?.length ? await loadPreset(presets[0]!.id) : null;
      await createSampleClass({ engine, today, lang, preset, existingYear });
      router.replace('/week');
    } catch {
      setError(t('error.generic'));
    } finally {
      setSampleBusy(false);
    }
  };

  if (ws.loading) return <Placeholder rows={4} />;

  const totalSteps = existingYear ? 3 : 4;
  const stepNo = existingYear ? step - 1 : step;

  return (
    <div className="flex flex-col gap-4 max-w-[40rem]">
      <h1 className="text-display">{t('setup.title')}</h1>

      {step === 0 && (
        <>
          <p>{t('setup.intro')}</p>
          <Button variant="primary" full onClick={() => void next()}>
            {wantNewClass ? t('class.addClass') : t('common.next')}
          </Button>
          {!wantNewClass && (
            <EmptyState
              action={
                sampleBusy ? (
                  <Waiting label={t('setup.sampleAdding')} />
                ) : (
                  <Button onClick={() => void addSample()}>{t('setup.sample')}</Button>
                )
              }
            >
              {t('setup.sampleBody')}
            </EmptyState>
          )}
        </>
      )}

      {step > 0 && (
        <p className="text-small text-forestMuted">
          {t('setup.step', { n: stepNo, total: totalSteps })} ·{' '}
          {step === 1
            ? t('setup.step1')
            : step === 2
              ? t('setup.step2')
              : step === 3
                ? t('setup.step3')
                : t('setup.step4')}
        </p>
      )}

      {step === 1 && (
        <>
          <h2 className="text-title">{t('setup.step1')}</h2>
          {presetsFailed && <Banner kind="warn">{t('setup.presetsUnavailable')}</Banner>}
          <Choice
            label={t('setup.yearLabel')}
            value={yearMode}
            onChange={setYearMode}
            options={[
              {
                value: 'preset',
                label: t('setup.preset'),
                hint: presets?.map((p) => p.label).join(', '),
              },
              { value: 'blank', label: t('setup.blank') },
            ]}
          />
          {yearMode === 'preset' && presets && (
            <Select
              label={t('setup.yearLabel')}
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          )}
          {yearMode === 'preset' && presets?.find((p) => p.id === presetId)?.provisional && (
            <Banner kind="info">{t('setup.provisional')}</Banner>
          )}
          {yearMode === 'blank' && (
            <>
              <TextInput
                label={t('setup.yearLabel')}
                hint={t('setup.yearLabelHint')}
                value={yearLabel}
                onChange={(e) => setYearLabel(e.target.value)}
              />
              <TextInput
                label={t('setup.startDate')}
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <TextInput
                label={t('setup.endDate')}
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </>
          )}
          <TextInput
            label={t('setup.schoolName')}
            optional
            value={schoolName}
            onChange={(e) => setSchoolName(e.target.value)}
            autoComplete="organization"
          />
        </>
      )}

      {step === 2 && (
        <>
          <h2 className="text-title">{t('setup.step2')}</h2>
          <TextInput
            label={t('setup.className')}
            hint={t('setup.classNameHint')}
            value={className}
            onChange={(e) => setClassName(e.target.value)}
            required
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="font-medium">{t('setup.gradeGroups')}</legend>
            <p className="text-small text-forestMuted">{t('setup.gradeGroupsHint')}</p>
            {groups.map((g, i) => (
              <div
                key={g.id}
                className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end rounded border border-hairline bg-white p-2"
              >
                <Select
                  label={t('setup.grade')}
                  value={g.grade}
                  onChange={(e) =>
                    setGroups((gs) =>
                      gs.map((x) =>
                        x.id === g.id ? { ...x, grade: e.target.value as GradeLevel } : x
                      )
                    )
                  }
                >
                  {GRADES.map((gr) => (
                    <option key={gr} value={gr}>
                      {gr === 'K' ? t('common.kinder') : t('common.grade', { g: gr })}
                    </option>
                  ))}
                </Select>
                <TextInput
                  label={t('setup.learners')}
                  optional
                  inputMode="numeric"
                  value={g.learners}
                  onChange={(e) =>
                    setGroups((gs) =>
                      gs.map((x) => (x.id === g.id ? { ...x, learners: e.target.value } : x))
                    )
                  }
                />
                <Button
                  variant="quiet"
                  disabled={groups.length === 1}
                  onClick={() => setGroups((gs) => gs.filter((x) => x.id !== g.id))}
                  aria-label={`${t('common.remove')} ${i + 1}`}
                >
                  ✕
                </Button>
              </div>
            ))}
            {groups.length < 4 && (
              <Button
                onClick={() =>
                  setGroups((gs) => [...gs, { id: newId(), grade: nextGrade(gs), learners: '' }])
                }
              >
                + {t('setup.addGrade')}
              </Button>
            )}
          </fieldset>
          <Choice
            label={t('class.curriculum')}
            value={curriculum}
            onChange={setCurriculum}
            options={[
              { value: 'deped', label: t('class.curriculum.deped') },
              { value: 'none', label: t('class.curriculum.none') },
            ]}
          />
        </>
      )}

      {step === 3 && (
        <>
          <h2 className="text-title">{t('setup.subjects')}</h2>
          {subjects.map((s) => (
            <div
              key={s.id}
              className="rounded border border-hairline bg-white p-3 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between gap-2">
                <strong>{s.name}</strong>
                <Button
                  variant="quiet"
                  onClick={() => setSubjects((ss) => ss.filter((x) => x.id !== s.id))}
                >
                  {t('common.remove')}
                </Button>
              </div>
              <DayPicker
                legend={t('setup.days')}
                days={s.days}
                onChange={(days) =>
                  setSubjects((ss) => ss.map((x) => (x.id === s.id ? { ...x, days } : x)))
                }
              />
              <div className="grid grid-cols-2 gap-2">
                <TextInput
                  label={t('setup.minutesPerSession')}
                  inputMode="numeric"
                  value={s.minutes}
                  onChange={(e) =>
                    setSubjects((ss) =>
                      ss.map((x) => (x.id === s.id ? { ...x, minutes: e.target.value } : x))
                    )
                  }
                />
                <TextInput
                  label={t('setup.startTime')}
                  optional
                  type="time"
                  value={s.startTime}
                  onChange={(e) =>
                    setSubjects((ss) =>
                      ss.map((x) => (x.id === s.id ? { ...x, startTime: e.target.value } : x))
                    )
                  }
                />
              </div>
              {groups.length > 1 && (
                <fieldset>
                  <legend className="font-medium mb-1">{t('setup.forGrades')}</legend>
                  {groups.map((g) => (
                    <Checkbox
                      key={g.id}
                      label={t('common.grade', { g: g.grade })}
                      checked={s.groupIds.includes(g.id)}
                      onChange={(v) =>
                        setSubjects((ss) =>
                          ss.map((x) =>
                            x.id === s.id
                              ? {
                                  ...x,
                                  groupIds: v
                                    ? [...x.groupIds, g.id]
                                    : x.groupIds.filter((y) => y !== g.id),
                                }
                              : x
                          )
                        )
                      }
                    />
                  ))}
                </fieldset>
              )}
            </div>
          ))}
          <AddSubject
            areas={areas.map((a) => ({ id: a.id, name: a.name[lang] }))}
            onAdd={(learningAreaId, name) =>
              setSubjects((ss) => [
                ...ss,
                {
                  id: newId(),
                  learningAreaId: curriculum === 'none' ? null : learningAreaId,
                  name,
                  days: [...DEFAULT_DAYS],
                  minutes: '50',
                  startTime: '',
                  groupIds: groups.map((g) => g.id),
                },
              ])
            }
          />
        </>
      )}

      {step === 4 && starts && (
        <>
          <h2 className="text-title">{t('setup.step4')}</h2>
          <p>{t('setup.startingPositions')}</p>
          {starts.map((sd) => {
            const s = subjects.find((x) => x.id === sd.subjectId)!;
            const g = groups.find((x) => x.id === sd.groupId)!;
            const label = `${s.name} · ${t('common.grade', { g: g.grade })}`;
            if (sd.noPack)
              return (
                <Banner key={sd.subjectId + sd.groupId} kind="info">
                  {label}: {t('setup.noPack')}
                </Banner>
              );
            if (!sd.competencies.length)
              return (
                <Banner key={sd.subjectId + sd.groupId} kind="info">
                  {label}: {t('week.betweenTerms')}
                </Banner>
              );
            return (
              <Select
                key={sd.subjectId + sd.groupId}
                label={label}
                hint={
                  sd.chosen === sd.proposed && sd.proposed
                    ? `${t('setup.estimated')} · ${t('setup.coveredBefore')}`
                    : t('setup.coveredBefore')
                }
                value={sd.chosen ?? ''}
                onChange={(e) =>
                  setStarts((st) =>
                    st!.map((x) => (x === sd ? { ...x, chosen: e.target.value } : x))
                  )
                }
              >
                {sd.competencies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code ? `${c.code} — ` : ''}
                    {c.text.slice(0, 90)}
                  </option>
                ))}
              </Select>
            );
          })}
          {starts.length === 0 && <Banner kind="info">{t('setup.noPack')}</Banner>}
        </>
      )}

      {error && <Banner kind="error">{error}</Banner>}
      {busy && <Waiting label={busy} />}
      {step > 0 && (
        <div className="flex flex-col-reverse wide:flex-row wide:justify-between gap-2 pt-2">
          <Button
            onClick={() => setStep((s) => (s === 2 && existingYear ? 0 : ((s - 1) as typeof step)))}
            disabled={!!busy}
          >
            {t('common.back')}
          </Button>
          {step < 4 ? (
            <Button variant="primary" onClick={() => void next()} busy={!!busy}>
              {t('common.next')}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void finish()} busy={!!busy}>
              {t('setup.finish')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function AddSubject({
  areas,
  onAdd,
}: {
  areas: Array<{ id: string; name: string }>;
  onAdd: (learningAreaId: string | null, name: string) => void;
}) {
  const { t } = useT();
  const [choice, setChoice] = useState('');
  const [custom, setCustom] = useState('');
  const isCustom = choice === '__custom';
  return (
    <div className="rounded border border-dashed border-hairline p-3 flex flex-col gap-2">
      <Select
        label={t('setup.addSubject')}
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
      >
        <option value="">—</option>
        {areas.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
        <option value="__custom">{t('common.more')}…</option>
      </Select>
      {isCustom && (
        <TextInput
          label={t('setup.subjectName')}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
        />
      )}
      <Button
        disabled={!choice || (isCustom && !custom.trim())}
        onClick={() => {
          if (isCustom) onAdd(null, custom.trim());
          else onAdd(choice, areas.find((a) => a.id === choice)?.name ?? choice);
          setChoice('');
          setCustom('');
        }}
      >
        + {t('common.add')}
      </Button>
    </div>
  );
}

function draftAssignment(s: SubjectDraft, classId: string, year: SchoolYear): TeachingAssignment {
  void year;
  const minutes = Math.max(5, Math.min(480, Number(s.minutes) || 50));
  return {
    id: s.id,
    classId,
    learningAreaId: s.learningAreaId,
    subjectName: s.name,
    gradeGroupIds: s.groupIds,
    language: 'fil',
    slots: s.days.map((weekday) => ({
      id: `${s.id}-${weekday}`,
      weekday,
      startTime: /^\d{2}:\d{2}$/.test(s.startTime) ? s.startTime : null,
      minutes,
      rotation: null,
    })),
  };
}

function nextGrade(gs: GroupDraft[]): GradeLevel {
  const last = gs[gs.length - 1]?.grade ?? '3';
  const i = GRADES.indexOf(last);
  return GRADES[Math.min(GRADES.length - 1, i + 1)]!;
}

/** Blank year: four quarters of equal length (SIMPLE-5); the teacher can edit dates later in Settings. */
export function evenTerms(start: string, end: string): SchoolYear['terms'] {
  const s = Date.parse(start + 'T12:00:00Z');
  const e = Date.parse(end + 'T12:00:00Z');
  if (!(s < e))
    return [{ id: newId(), index: 1, name: 'Quarter 1', startDate: start, endDate: end }];
  const span = (e - s) / 4;
  return [0, 1, 2, 3].map((i) => ({
    id: newId(),
    index: i + 1,
    name: `Quarter ${i + 1}`,
    startDate: new Date(s + Math.round(span * i) + (i ? 86400_000 : 0)).toISOString().slice(0, 10),
    endDate: i === 3 ? end : new Date(s + Math.round(span * (i + 1))).toISOString().slice(0, 10),
  }));
}
