'use client';
import { useEffect, useState } from 'react';
import type { SessionMark, TimelineEntry } from '@hiraia/tala-core/contracts';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import type { Workspace } from '@/data/records';
import { newId } from '@/data/ids';
import { Button, Sheet, TextArea, cx } from '@/components/ui';

type Status = SessionMark['status'];

/** Mark a session taught / partly / not taught (PLAN-12). One mark per grade group in the session. */
export function MarkSheet({
  entry,
  onClose,
  ws,
  onSaved,
}: {
  entry: TimelineEntry | null;
  onClose: () => void;
  ws: Workspace;
  onSaved: () => void;
}) {
  const { t } = useT();
  const { engine } = useSession();
  const [status, setStatus] = useState<Status | null>(null);
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!entry) return;
    const existing = ws.marks.find(
      (m) =>
        m.classId === entry.classId &&
        m.assignmentId === entry.assignmentId &&
        m.date === entry.date &&
        (m.slotId === null || m.slotId === entry.slotId)
    );
    setStatus(existing?.status ?? null);
    setRemark(existing?.remark ?? '');
  }, [entry, ws.marks]);

  const save = async () => {
    if (!entry || !engine || !status) return;
    setBusy(true);
    try {
      const ops: Array<{ op: 'put'; entity: 'session_mark'; data: SessionMark }> = [];
      for (const [gid, comps] of Object.entries(entry.byGroup)) {
        const existing = ws.marks.find(
          (m) =>
            m.classId === entry.classId &&
            m.assignmentId === entry.assignmentId &&
            m.gradeGroupId === gid &&
            m.date === entry.date &&
            (m.slotId === null || m.slotId === entry.slotId)
        );
        ops.push({
          op: 'put',
          entity: 'session_mark',
          data: {
            id: existing?.id ?? newId(),
            classId: entry.classId,
            assignmentId: entry.assignmentId,
            gradeGroupId: gid,
            date: entry.date,
            slotId: entry.slotId,
            planId: entry.planId,
            competencyIds: comps,
            status,
            remark: remark.trim(),
          },
        });
      }
      await engine.batch(ops);
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!entry || !engine) return;
    setBusy(true);
    try {
      for (const m of ws.marks.filter(
        (m) =>
          m.classId === entry.classId &&
          m.assignmentId === entry.assignmentId &&
          m.date === entry.date &&
          (m.slotId === null || m.slotId === entry.slotId)
      ))
        await engine.remove('session_mark', m.id);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const options: Array<{ v: Status; label: string; icon: string }> = [
    { v: 'taught', label: t('mark.taught'), icon: '✓' },
    { v: 'partial', label: t('mark.partial'), icon: '◐' },
    { v: 'not_taught', label: t('mark.notTaught'), icon: '✕' },
  ];

  return (
    <Sheet
      open={!!entry}
      onClose={onClose}
      title={t('mark.title')}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {ws.marks.some(
            (m) => m.date === entry?.date && m.assignmentId === entry?.assignmentId
          ) && (
            <Button variant="quiet" onClick={() => void clear()} disabled={busy}>
              {t('mark.clear')}
            </Button>
          )}
          <Button variant="primary" onClick={() => void save()} disabled={!status} busy={busy}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {entry && (
        <p className="text-forestMuted">
          {entry.subjectName} · {entry.date}
        </p>
      )}
      <div role="radiogroup" aria-label={t('mark.title')} className="grid grid-cols-1 gap-2">
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={status === o.v}
            onClick={() => setStatus(o.v)}
            className={cx(
              'flex items-center gap-3 min-h-touch rounded border px-3 text-left',
              status === o.v
                ? 'border-talaTeal ring-2 ring-talaTeal bg-white'
                : 'border-hairline bg-white'
            )}
          >
            <span aria-hidden="true" className="w-6 text-center">
              {o.icon}
            </span>
            {o.label}
          </button>
        ))}
      </div>
      <TextArea
        label={t('mark.remark')}
        optional
        value={remark}
        onChange={(e) => setRemark(e.target.value)}
        maxLength={1000}
      />
    </Sheet>
  );
}
