'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { BUILTIN_TEMPLATES } from '@hiraia/tala-core/contracts';
import { formatWeekday, useT } from '@/i18n';
import { useSession } from '@/data/session';
import { isoDate, newId } from '@/data/ids';
import { useTimeline } from '@/data/timeline';
import { curriculumVersionOf } from '@/data/curriculum';
import { defaultTemplateFor, newPlan } from '@/data/plans';
import { topicLabel } from '@/data/topics';
import {
  Banner,
  Button,
  LinkButton,
  PageHeader,
  Placeholder,
  Select,
  Sparkle,
  TextInput,
} from '@/components/ui';
import { MatchingLessons } from '@/features/community/MatchingLessons';
import { outsideSchoolWeek } from '@/features/week/weekdays';

/** Create: write by hand (works offline), draft with AI (wave 2), or find in the community (wave 2). */
export function NewLessonScreen() {
  const { t, lang } = useT();
  const router = useRouter();
  const params = useSearchParams();
  const { engine } = useSession();
  const [classId, setClassId] = useState(params.get('classId') ?? '');
  const [assignmentId, setAssignmentId] = useState(params.get('assignmentId') ?? '');
  const [date, setDate] = useState(params.get('date') ?? isoDate());
  const [templateId, setTemplateId] = useState('');
  const [templateTouched, setTemplateTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const tl = useTimeline(date, date);
  const { ws, index } = tl;

  useEffect(() => {
    if (!classId && ws.classes[0]) setClassId(ws.classes[0].id);
  }, [ws.classes, classId]);
  const cls = ws.classes.find((c) => c.id === classId) ?? null;
  const assignments = useMemo(
    () => ws.assignments.filter((a) => a.classId === classId),
    [ws.assignments, classId]
  );
  useEffect(() => {
    if (assignments.length && !assignments.some((a) => a.id === assignmentId))
      setAssignmentId(assignments[0]!.id);
  }, [assignments, assignmentId]);
  const assignment = assignments.find((a) => a.id === assignmentId) ?? null;
  useEffect(() => {
    if (!templateTouched) setTemplateId(defaultTemplateFor(cls, assignment).id);
  }, [cls, assignment, templateTouched]);

  // The class period from This Week applies to the date it came with; another date (Saturday instead of Friday)
  // takes that day's own period, so the lesson still starts with that day's competencies.
  const slotId = params.get('date') === date ? params.get('slotId') : null;
  const entry = tl.entries.find(
    (e) =>
      e.classId === classId &&
      e.assignmentId === assignmentId &&
      e.date === date &&
      (!slotId || e.slotId === slotId)
  );
  const competencyIds = entry ? Object.values(entry.byGroup).flat() : [];

  const create = async (ai = false) => {
    if (!engine) return;
    setBusy(true);
    try {
      const template =
        BUILTIN_TEMPLATES.find((x) => x.id === templateId) ?? defaultTemplateFor(cls, assignment);
      const competencies = entry
        ? Object.fromEntries(Object.entries(entry.byGroup).map(([g, ids]) => [g, [...ids]]))
        : {};
      // The curriculum version must be the one the slot's competencies belong to (the track's), not a year-wide guess.
      const track = ws.tracks.find(
        (tr) => tr.classId === classId && tr.assignmentId === assignmentId && tr.curriculumVersion
      );
      const firstId = Object.values(competencies).flat()[0];
      const curriculumVersion =
        track?.curriculumVersion ??
        (firstId ? (tl.competencyById.get(firstId)?.id.split('.')[0] ?? null) : null) ??
        curriculumVersionOf(
          index,
          ws.activeYear?.label ?? null,
          cls?.gradeGroups.find((g) => assignment?.gradeGroupIds.includes(g.id))?.grade ??
            cls?.gradeGroups[0]?.grade ??
            '',
          assignment?.learningAreaId ?? null
        );
      const { plan, sections } = newPlan({
        template,
        cls,
        assignment,
        dates: date ? [date] : [],
        language: lang,
        competencies,
        curriculumVersion,
        newId,
      });
      await engine.batch([
        { op: 'put', entity: 'plan', data: plan },
        ...sections.map((s) => ({ op: 'put' as const, entity: 'plan_section' as const, data: s })),
      ]);
      router.replace(ai ? `/generate?planId=${plan.id}` : `/lessons/${plan.id}`);
    } finally {
      setBusy(false);
    }
  };

  if (ws.loading) return <Placeholder rows={4} />;

  return (
    <div className="flex flex-col gap-4 max-w-[36rem]">
      <PageHeader title={t('lessons.new')} back={{ href: '/lessons', label: t('lessons.title') }} />
      {!ws.classes.length && (
        <Banner
          kind="info"
          action={
            <LinkButton href="/setup" variant="primary">
              {t('week.setupAction')}
            </LinkButton>
          }
        >
          {t('week.noClass')}
        </Banner>
      )}
      {ws.classes.length > 1 && (
        <Select
          label={t('lessons.class')}
          value={classId}
          onChange={(e) => setClassId(e.target.value)}
        >
          {ws.classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      )}
      {assignments.length > 0 && (
        <Select
          label={t('lessons.subject')}
          value={assignmentId}
          onChange={(e) => setAssignmentId(e.target.value)}
        >
          {assignments.map((a) => (
            <option key={a.id} value={a.id}>
              {a.subjectName}
            </option>
          ))}
        </Select>
      )}
      <TextInput
        label={t('lessons.date')}
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      <Select
        label={t('lessons.template')}
        value={templateId}
        onChange={(e) => {
          setTemplateTouched(true);
          setTemplateId(e.target.value);
        }}
      >
        {BUILTIN_TEMPLATES.map((tp) => (
          <option key={tp.id} value={tp.id}>
            {tp.name[lang]}
          </option>
        ))}
      </Select>
      {competencyIds.length > 0 && (
        <p className="text-small text-forestMuted">
          {t('editor.competencies')}:{' '}
          {competencyIds
            .map((id) => {
              const c = tl.competencyById.get(id);
              return c ? topicLabel(c, lang).heading : id;
            })
            .join('; ')}
        </p>
      )}
      {/* A Saturday or Sunday class: DepEd's weeks run Monday to Friday, so these are Tala's suggestion. */}
      {competencyIds.length > 0 && outsideSchoolWeek(date, ws.activeYear?.teachingWeekdays) && (
        <p className="text-small text-forestMuted" data-testid="weekend-note">
          {t('wk.weekend.note', { weekday: formatWeekday(date, lang) })}
        </p>
      )}
      <h2 className="text-title">{t('lessons.howToStart')}</h2>
      <Button
        variant="primary"
        full
        onClick={() => void create()}
        busy={busy || tl.loading}
        disabled={!cls}
      >
        {t('lessons.write')}
      </Button>
      <Button
        variant="ai"
        full
        onClick={() => void create(true)}
        disabled={busy || tl.loading || !cls}
      >
        <Sparkle /> {t('lessons.generate')}
      </Button>
      <LinkButton
        href={`/community${entry ? `?competencyId=${encodeURIComponent(Object.values(entry.byGroup).flat()[0] ?? '')}&grade=${cls?.gradeGroups[0]?.grade ?? ''}` : ''}`}
        full
      >
        {t('lessons.fromCommunity')}
      </LinkButton>
      <MatchingLessons
        entry={entry}
        grade={cls?.gradeGroups[0]?.grade ?? null}
        language={assignment?.language ?? lang}
      />
    </div>
  );
}
