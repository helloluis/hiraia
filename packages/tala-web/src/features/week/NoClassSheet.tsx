'use client';
import { useState } from 'react';
import type { CalendarDay } from '@hiraia/tala-core/contracts';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import type { Workspace } from '@/data/records';
import { newId } from '@/data/ids';
import { Banner, Button, Choice, Select, Sheet, TextInput } from '@/components/ui';

type Kind = 'suspension' | 'local_holiday' | 'school_event' | 'exam';
const KINDS: Kind[] = ['suspension', 'local_holiday', 'school_event', 'exam'];

/** Mark a date as a non-teaching day (SCH-4), for one class or all; nothing moves until confirmed (SCH-6). */
export function NoClassSheet({ open, onClose, ws, defaultDate, onSaved }: { open: boolean; onClose: () => void; ws: Workspace; defaultDate: string; onSaved: (day: CalendarDay) => void }) {
  const { t } = useT();
  const { engine } = useSession();
  const [date, setDate] = useState(defaultDate);
  const [kind, setKind] = useState<Kind>('suspension');
  const [label, setLabel] = useState('');
  const [scope, setScope] = useState<string>('all');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!engine || !ws.activeYear) return;
    setBusy(true);
    try {
      const day: CalendarDay = {
        id: newId(),
        schoolYearId: ws.activeYear.id,
        date,
        kind,
        label: label.trim(),
        classId: scope === 'all' ? null : scope,
        minutesOverride: null,
        source: 'teacher',
        followsWeekday: null,
        assignmentIds: null,
      };
      await engine.put('calendar_day', day);
      onSaved(day);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('noclass.title')}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void save()} busy={busy} disabled={!/^\d{4}-\d{2}-\d{2}$/.test(date)}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <TextInput label={t('noclass.date')} type="date" value={date} onChange={e => setDate(e.target.value)} required />
      <Select label={t('noclass.reason')} value={kind} onChange={e => setKind(e.target.value as Kind)}>
        {KINDS.map(k => (
          <option key={k} value={k}>
            {t(`noclass.kind.${k}`)}
          </option>
        ))}
      </Select>
      <TextInput label={t('noclass.label')} optional value={label} onChange={e => setLabel(e.target.value)} maxLength={200} />
      {ws.classes.length > 1 && (
        <Choice label={t('lessons.class')} value={scope} onChange={setScope} options={[{ value: 'all', label: t('noclass.allClasses') }, ...ws.classes.map(c => ({ value: c.id, label: c.name }))]} />
      )}
      <Banner kind="info">{t('noclass.preview')}</Banner>
    </Sheet>
  );
}
