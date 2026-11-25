'use client';
/**
 * One lesson plan for a multi-grade class, made from the lesson of each grade.
 *
 * The teacher chooses the class, the day, and for each grade one of her saved lessons (her own, or a day of a
 * teaching pack she added from the Library). Tala combines them without a connection or a model into ONE private
 * draft on the multi-grade template and opens it in the lesson editor, where every box can be changed, saved,
 * printed (A4 or long bond) and downloaded as a Word file. Her own lessons are not changed.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { formatDate, useT } from '@/i18n';
import { useSession } from '@/data/session';
import { useWorkspace } from '@/data/records';
import { isoDate, newId } from '@/data/ids';
import { Icon } from '@/components/icons';
import { Banner, Button, EmptyState, LinkButton, PageHeader, Placeholder, Select, TextInput } from '@/components/ui';
import {
  combineSavedLessons,
  groupsFor,
  isMultigradeClass,
  lessonChoices,
  multigradeAssignments,
  periodMinutes,
  subjectFor,
  suggestedPick,
  timeSplit,
} from './combine-model';

export function CombineScreen() {
  const { t, lang } = useT();
  const router = useRouter();
  const params = useSearchParams();
  const { engine } = useSession();
  const ws = useWorkspace();
  const [classId, setClassId] = useState(params.get('classId') ?? '');
  const [assignmentId, setAssignmentId] = useState(params.get('assignmentId') ?? '');
  // Once she has chosen a subject herself (also "no subject"), her choice is not replaced.
  const [subjectTouched, setSubjectTouched] = useState(Boolean(params.get('assignmentId')));
  const [date, setDate] = useState(params.get('date') ?? isoDate());
  const [minutes, setMinutes] = useState('');
  const [minutesTouched, setMinutesTouched] = useState(false);
  const [picks, setPicks] = useState<Record<string, string | null>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const classes = useMemo(() => ws.classes.filter(isMultigradeClass), [ws.classes]);
  useEffect(() => {
    if (classes.length && !classes.some((c) => c.id === classId)) setClassId(classes[0]!.id);
  }, [classes, classId]);
  const cls = classes.find((c) => c.id === classId) ?? null;
  const assignments = useMemo(() => (cls ? multigradeAssignments(cls, ws.assignments) : []), [cls, ws.assignments]);
  useEffect(() => {
    const next = subjectFor({ assignments, current: assignmentId, touched: subjectTouched });
    if (next !== assignmentId) setAssignmentId(next);
  }, [assignments, assignmentId, subjectTouched]);
  const assignment = assignments.find((a) => a.id === assignmentId) ?? null;
  const groups = useMemo(() => (cls ? groupsFor(cls, assignment) : []), [cls, assignment]);

  useEffect(() => {
    if (!minutesTouched) setMinutes(String(periodMinutes(assignment, date || null)));
  }, [assignment, date, minutesTouched]);
  const period = Math.max(10, Math.min(240, Math.round(Number(minutes) || 0)));

  const choices = useMemo(
    () => Object.fromEntries(groups.map((g) => [g.id, cls ? lessonChoices({ plans: ws.plans, cls, groupId: g.id, date: date || null, subjectName: assignment?.subjectName ?? null }) : []])),
    [groups, cls, ws.plans, date, assignment]
  );
  // Until she chooses for a grade herself, its lesson on the chosen date is offered.
  useEffect(() => {
    setPicks((current) => {
      const next: Record<string, string | null> = {};
      for (const g of groups) next[g.id] = touched[g.id] && (current[g.id] === null || choices[g.id]?.some((c) => c.plan.id === current[g.id])) ? (current[g.id] ?? null) : suggestedPick(choices[g.id] ?? []);
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, [groups, choices, touched]);

  const picked = groups.filter((g) => picks[g.id]).length;
  const split = timeSplit(period, Math.max(2, groups.length));
  const shortest = Math.min(...split.turns);

  const make = async () => {
    if (!engine || !cls || groups.length < 2 || !picked) return;
    setBusy(true);
    setFailed(false);
    try {
      const wanted = new Set(Object.values(picks).filter((id): id is string => !!id));
      const sections = (await engine.list('plan_section')).map((r) => r.data).filter((s) => wanted.has(s.planId));
      const { plan, sections: made } = combineSavedLessons({ cls, assignment, date: date || null, minutes: period, language: lang, picks, plans: ws.plans, sections, newId });
      await engine.batch([{ op: 'put', entity: 'plan', data: plan }, ...made.map((s) => ({ op: 'put' as const, entity: 'plan_section' as const, data: s }))]);
      router.replace(`/lessons/${plan.id}`);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  if (ws.loading) return <Placeholder rows={5} />;
  const header = <PageHeader title={t('mg.title')} back={{ href: '/lessons', label: t('lessons.title') }} subtitle={t('mg.lead')} />;
  if (!classes.length)
    return (
      <div className="flex max-w-[40rem] flex-col gap-4">
        {header}
        <EmptyState
          action={
            <LinkButton href="/class" variant="primary">
              {t('mg.noClassAction')}
            </LinkButton>
          }
        >
          {t('mg.noClass')}
        </EmptyState>
      </div>
    );

  const gradeLabel = (grade: string) => t('mg.gradeLabel', { grade });
  return (
    <div className="flex max-w-[40rem] flex-col gap-4" data-mg-screen>
      {header}
      {classes.length > 1 && (
        <Select
          label={t('mg.class')}
          value={classId}
          onChange={(e) => {
            setClassId(e.target.value);
            setSubjectTouched(false);
          }}
          data-mg-class
        >
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      )}
      {assignments.length > 0 && (
        <Select
          label={t('mg.subject')}
          value={assignmentId}
          onChange={(e) => {
            setSubjectTouched(true);
            setAssignmentId(e.target.value);
          }}
          data-mg-subject
        >
          {assignments.map((a) => (
            <option key={a.id} value={a.id}>
              {a.subjectName}
            </option>
          ))}
          <option value="">{t('mg.subjectAll')}</option>
        </Select>
      )}
      <div className="grid gap-3 wide:grid-cols-2">
        <TextInput label={t('mg.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} data-mg-date />
        <TextInput
          label={t('mg.minutes')}
          type="number"
          inputMode="numeric"
          min={10}
          max={240}
          value={minutes}
          onChange={(e) => {
            setMinutesTouched(true);
            setMinutes(e.target.value);
          }}
          data-mg-minutes
        />
      </div>
      <p className="flex items-start gap-2 text-small text-forestMuted" data-mg-split>
        <Icon name="clock" size={16} className="mt-0.5 shrink-0" />
        {t(split.opening ? 'mg.split' : 'mg.splitNoShared', { opening: split.opening, closing: split.closing, turns: `${split.turns.join(' + ')} min` })}
      </p>
      {shortest < 8 && <Banner kind="warn">{t('mg.shortTurns', { groups: groups.length, minutes: period, each: shortest })}</Banner>}

      {groups.map((g) => {
        const list = choices[g.id] ?? [];
        return (
          <div key={g.id} className="flex flex-col gap-1.5">
            <Select
              label={t('mg.lessonFor', { grade: gradeLabel(g.grade) })}
              value={picks[g.id] ?? ''}
              onChange={(e) => {
                setTouched((x) => ({ ...x, [g.id]: true }));
                setPicks((x) => ({ ...x, [g.id]: e.target.value || null }));
              }}
              data-mg-pick={g.id}
            >
              <option value="">{t('mg.leaveEmpty')}</option>
              {list.map((c) => (
                <option key={c.plan.id} value={c.plan.id}>
                  {(c.plan.title.trim() || c.plan.subjectName || t('lessons.untitled')).slice(0, 90)} · {c.onDate ? t('mg.onDate') : c.date ? formatDate(c.date, lang) : t('mg.noDate')}
                </option>
              ))}
            </Select>
            {!list.length && <p className="text-small text-forestMuted">{t('mg.noLessons', { grade: gradeLabel(g.grade) })}</p>}
          </div>
        );
      })}

      {failed && <Banner kind="warn">{t('mg.failed')}</Banner>}
      <Button variant="primary" full busy={busy} disabled={!picked || groups.length < 2} onClick={() => void make()} data-mg-make>
        <Icon name="layers" size={20} />
        {t('mg.make')}
      </Button>
      <p className="text-small text-forestMuted">{picked ? t('mg.sources') : t('mg.needOne')}</p>
    </div>
  );
}
