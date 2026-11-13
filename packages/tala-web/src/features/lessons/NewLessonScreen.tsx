'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { BUILTIN_TEMPLATES } from '@hiraia/tala-core/contracts';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { isoDate, newId } from '@/data/ids';
import { useTimeline } from '@/data/timeline';
import { curriculumVersionFor } from '@/data/curriculum';
import { defaultTemplateFor, newPlan } from '@/data/plans';
import { Banner, Button, LinkButton, PageHeader, Placeholder, Select, TextInput } from '@/components/ui';

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
  const [busy, setBusy] = useState(false);
  const tl = useTimeline(date, date);
  const { ws, index } = tl;

  useEffect(() => {
    if (!classId && ws.classes[0]) setClassId(ws.classes[0].id);
  }, [ws.classes, classId]);
  const cls = ws.classes.find(c => c.id === classId) ?? null;
  const assignments = useMemo(() => ws.assignments.filter(a => a.classId === classId), [ws.assignments, classId]);
  useEffect(() => {
    if (assignments.length && !assignments.some(a => a.id === assignmentId)) setAssignmentId(assignments[0]!.id);
  }, [assignments, assignmentId]);
  const assignment = assignments.find(a => a.id === assignmentId) ?? null;
  useEffect(() => {
    if (!templateId) setTemplateId(defaultTemplateFor(cls, assignment).id);
  }, [cls, assignment, templateId]);

  const entry = tl.entries.find(e => e.classId === classId && e.assignmentId === assignmentId && e.date === date && (!params.get('slotId') || e.slotId === params.get('slotId')));

  const create = async () => {
    if (!engine) return;
    setBusy(true);
    try {
      const template = BUILTIN_TEMPLATES.find(x => x.id === templateId) ?? defaultTemplateFor(cls, assignment);
      const competencies = entry ? Object.fromEntries(Object.entries(entry.byGroup).map(([g, ids]) => [g, [...ids]])) : {};
      const { plan, sections } = newPlan({ template, cls, assignment, dates: date ? [date] : [], language: lang, competencies, curriculumVersion: curriculumVersionFor(index, ws.activeYear?.label ?? null), newId });
      await engine.put('plan', plan);
      for (const s of sections) await engine.put('plan_section', s);
      router.replace(`/lessons/${plan.id}`);
    } finally {
      setBusy(false);
    }
  };

  if (ws.loading) return <Placeholder rows={4} />;
  const q = `?classId=${classId}&assignmentId=${assignmentId}&date=${date}`;

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
        <Select label={t('lessons.class')} value={classId} onChange={e => setClassId(e.target.value)}>
          {ws.classes.map(c => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      )}
      {assignments.length > 0 && (
        <Select label={t('lessons.subject')} value={assignmentId} onChange={e => setAssignmentId(e.target.value)}>
          {assignments.map(a => (
            <option key={a.id} value={a.id}>
              {a.subjectName}
            </option>
          ))}
        </Select>
      )}
      <TextInput label={t('lessons.date')} type="date" value={date} onChange={e => setDate(e.target.value)} />
      <Select label={t('lessons.template')} value={templateId} onChange={e => setTemplateId(e.target.value)}>
        {BUILTIN_TEMPLATES.map(tp => (
          <option key={tp.id} value={tp.id}>
            {tp.name[lang]}
          </option>
        ))}
      </Select>
      {entry && Object.values(entry.byGroup).flat().length > 0 && (
        <p className="text-small text-forestMuted">
          {t('editor.competencies')}: {Object.values(entry.byGroup).flat().map(id => tl.competencyById.get(id)?.code ?? id).join(', ')}
        </p>
      )}
      <h2 className="text-title">{t('lessons.howToStart')}</h2>
      <Button variant="primary" full onClick={() => void create()} busy={busy}>
        {t('lessons.write')}
      </Button>
      <LinkButton href={`/generate${q}`} full>
        {t('lessons.generate')} · {t('common.comingSoon')}
      </LinkButton>
      <LinkButton href="/community" full>
        {t('lessons.fromCommunity')} · {t('common.comingSoon')}
      </LinkButton>
    </div>
  );
}
