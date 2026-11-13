'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatTime, useT } from '@/i18n';
import { useSession } from '@/data/session';
import { isoDate, newId } from '@/data/ids';
import { Button, List, ListRow, Sheet, TextInput, Toast } from '@/components/ui';
import type { PlanEditor } from './usePlanEditor';

type View = 'menu' | 'duplicate' | 'submitted' | 'history' | 'delete';

/** Secondary actions behind "More" (SIMPLE-2): PDF, copy to another date, mark submitted, history, delete. */
export function MoreSheet({ open, onClose, ed, onPdf, onDeleted }: { open: boolean; onClose: () => void; ed: PlanEditor; onPdf: () => void; onDeleted: () => void }) {
  const { t, lang } = useT();
  const router = useRouter();
  const { engine } = useSession();
  const [view, setView] = useState<View>('menu');
  const [date, setDate] = useState(isoDate());
  const [note, setNote] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const close = () => {
    setView('menu');
    onClose();
  };
  if (!ed.plan) return null;
  const plan = ed.plan;
  const locked = plan.state === 'locked';

  const duplicate = async () => {
    if (!engine) return;
    const id = newId();
    const copy = { ...plan, id, title: plan.title, state: 'draft' as const, lock: null, submitted: null, conflictCopyOf: null, placements: plan.placements.slice(0, 1).map(p => ({ ...p, dates: [date] })) };
    await engine.put('plan', copy);
    for (const s of ed.sections) await engine.put('plan_section', { ...s.data, id: newId(), planId: id, origin: 'copied', gen: null });
    close();
    router.push(`/lessons/${id}`);
  };
  const markSubmitted = async () => {
    ed.savePlan({ submitted: { date, note: note.trim().slice(0, 300) } }, true);
    close();
  };
  const archive = async () => {
    if (!engine) return;
    await ed.flushAll();
    await engine.put('plan', { ...plan, state: 'archived' });
    close();
    onDeleted();
  };

  return (
    <>
      <Sheet open={open} onClose={close} title={view === 'menu' ? t('editor.moreActions') : view === 'duplicate' ? t('editor.duplicate') : view === 'submitted' ? t('editor.markSubmitted') : view === 'history' ? t('editor.history') : t('editor.delete')}>
        {view === 'menu' && (
          <List>
            <ListRow title={t('editor.pdf')} onClick={onPdf} />
            <ListRow title={t('editor.duplicate')} onClick={() => setView('duplicate')} />
            {locked && <ListRow title={t('editor.markSubmitted')} onClick={() => setView('submitted')} />}
            <ListRow title={t('editor.history')} subtitle={ed.revisions.length ? `${ed.revisions.length}` : t('editor.noHistory')} onClick={() => setView('history')} />
            {!locked && <ListRow title={<span className="text-brick">{t('editor.delete')}</span>} onClick={() => setView('delete')} />}
          </List>
        )}
        {view === 'duplicate' && (
          <>
            <TextInput label={t('lessons.date')} type="date" value={date} onChange={e => setDate(e.target.value)} />
            <Button variant="primary" full onClick={() => void duplicate()}>
              {t('editor.duplicate')}
            </Button>
          </>
        )}
        {view === 'submitted' && (
          <>
            <TextInput label={t('lessons.date')} type="date" value={date} onChange={e => setDate(e.target.value)} />
            <TextInput label={t('editor.submittedTo')} optional value={note} onChange={e => setNote(e.target.value)} maxLength={300} />
            <Button variant="primary" full onClick={() => void markSubmitted()}>
              {t('common.save')}
            </Button>
          </>
        )}
        {view === 'history' && (
          <List>
            {ed.revisions.length === 0 && <ListRow title={t('editor.noHistory')} />}
            {ed.revisions.slice(0, 40).map(r => {
              const label = ed.template?.sections.find(s => s.key === r.data.key)?.label[lang] ?? r.data.key;
              return (
                <ListRow
                  key={r.id}
                  title={label}
                  subtitle={`${t('editor.versionAt', { time: formatTime(r.data.savedAt, lang) })} · ${r.data.reason}`}
                  trailing={
                    !locked ? (
                      <Button
                        variant="quiet"
                        onClick={async () => {
                          await ed.restore(r.data);
                          setToast(t('editor.restored'));
                        }}
                      >
                        {t('editor.restore')}
                      </Button>
                    ) : undefined
                  }
                />
              );
            })}
          </List>
        )}
        {view === 'delete' && (
          <>
            <p>{t('editor.deleteConfirm')}</p>
            <Button variant="danger" full onClick={() => void archive()}>
              {t('common.delete')}
            </Button>
          </>
        )}
        {view !== 'menu' && (
          <Button variant="quiet" onClick={() => setView('menu')}>
            ← {t('common.back')}
          </Button>
        )}
      </Sheet>
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}
