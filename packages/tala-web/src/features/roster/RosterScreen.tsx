'use client';
/** The class list (ROS-7): add, edit, remove and reorder learners by hand, online or offline. Only PRIV-1 fields. */
import { useEffect, useMemo, useState } from 'react';
import type { Student } from '@hiraia/tala-core/contracts';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { useRecords, useWorkspace } from '@/data/records';
import { newId } from '@/data/ids';
import { Badge, Banner, Button, LinkButton, List, PageHeader, Placeholder, Select, Sheet, TextInput, Toast } from '@/components/ui';

export function RosterScreen() {
  const { t } = useT();
  const { engine } = useSession();
  const ws = useWorkspace();
  const students = useRecords('student');
  const [classId, setClassId] = useState('');
  const [editing, setEditing] = useState<Student | 'new' | null>(null);
  const [removing, setRemoving] = useState<Student | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!ws.classes.some(c => c.id === classId) && ws.classes[0]) setClassId(ws.classes[0].id);
  }, [ws.classes, classId]);
  const cls = ws.classes.find(c => c.id === classId) ?? null;
  const list = useMemo(() => students.items.map(s => s.data).filter(s => s.classId === classId).sort((a, b) => a.order - b.order || a.displayName.localeCompare(b.displayName)), [students.items, classId]);

  const move = async (s: Student, dir: -1 | 1) => {
    if (!engine) return;
    const i = list.findIndex(x => x.id === s.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const a = list[i]!;
    const b = list[j]!;
    await engine.batch([
      { op: 'put', entity: 'student', data: { ...a, order: j } },
      { op: 'put', entity: 'student', data: { ...b, order: i } },
    ]);
  };

  if (ws.loading || students.loading) return <Placeholder rows={5} />;
  if (!cls) {
    return (
      <>
        <PageHeader title={t('roster.learners')} back={{ href: '/class', label: t('class.title') }} />
        <Banner kind="info" action={<LinkButton href="/setup">{t('class.addClass')}</LinkButton>}>
          {t('class.none')}
        </Banner>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3 max-w-[44rem]">
      <PageHeader
        title={t('roster.learners')}
        subtitle={cls.name}
        back={{ href: '/class', label: t('class.title') }}
        action={
          <Button variant="primary" onClick={() => setEditing('new')}>
            + {t('roster.add')}
          </Button>
        }
      />
      {ws.classes.length > 1 && (
        <Select label={t('class.switch')} value={classId} onChange={e => setClassId(e.target.value)}>
          {ws.classes.map(c => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      )}
      {cls.isSample && <Banner kind="info">{t('class.sampleBanner')}</Banner>}
      <LinkButton href={`/class/roster/import?classId=${cls.id}`} full>
        {t('roster.import')}
      </LinkButton>
      {list.length === 0 ? (
        <Banner kind="info">{t('roster.empty')}</Banner>
      ) : (
        <List>
          {list.map((s, i) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-hairline last:border-b-0">
              <span className="text-small text-forestMuted w-6">{i + 1}.</span>
              <span className="flex-1 min-w-[8rem]">
                <span className="block">{s.displayName}</span>
                <span className="block text-small text-forestMuted">
                  {cls.gradeGroups.length > 1 && <Badge>{s.gradeGroupId ? t('common.grade', { g: cls.gradeGroups.find(g => g.id === s.gradeGroupId)?.grade ?? '' }) : t('roster.noGroup')}</Badge>} {s.localId ? `#${s.localId}` : ''}
                </span>
              </span>
              <span className="flex gap-1">
                <Button variant="quiet" onClick={() => void move(s, -1)} disabled={i === 0} aria-label={`${t('roster.moveUp')} ${s.displayName}`}>
                  ↑
                </Button>
                <Button variant="quiet" onClick={() => void move(s, 1)} disabled={i === list.length - 1} aria-label={`${t('roster.moveDown')} ${s.displayName}`}>
                  ↓
                </Button>
                <Button variant="quiet" onClick={() => setEditing(s)}>
                  {t('common.edit')}
                </Button>
                <Button variant="quiet" onClick={() => setRemoving(s)}>
                  {t('common.remove')}
                </Button>
              </span>
            </div>
          ))}
        </List>
      )}
      <StudentSheet
        student={editing}
        cls={cls}
        onClose={() => setEditing(null)}
        onSave={async s => {
          if (!engine) return;
          await engine.put('student', s);
          setEditing(null);
        }}
        nextOrder={list.length}
      />
      <Sheet
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={t('common.remove')}
        actions={
          <>
            <Button variant="quiet" onClick={() => setRemoving(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (engine && removing) await engine.remove('student', removing.id);
                setRemoving(null);
                setToast(t('common.done'));
              }}
            >
              {t('common.remove')}
            </Button>
          </>
        }
      >
        <p>{t('roster.removeConfirm')}</p>
      </Sheet>
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function StudentSheet({ student, cls, onClose, onSave, nextOrder }: { student: Student | 'new' | null; cls: { id: string; gradeGroups: Array<{ id: string; grade: string }> }; onClose: () => void; onSave: (s: Student) => Promise<void>; nextOrder: number }) {
  const { t } = useT();
  const [draft, setDraft] = useState<Student | null>(null);
  useEffect(() => {
    if (!student) return setDraft(null);
    setDraft(
      student === 'new'
        ? { id: newId(), classId: cls.id, gradeGroupId: cls.gradeGroups.length === 1 ? cls.gradeGroups[0]!.id : null, displayName: '', familyName: '', givenName: '', middleName: '', suffix: '', sex: null, localId: null, order: nextOrder, importId: null }
        : { ...student },
    );
  }, [student, cls, nextOrder]);
  if (!draft) return null;
  const set = (patch: Partial<Student>) => setDraft(d => (d ? { ...d, ...patch } : d));
  const name = draft.displayName.trim() || [draft.givenName, draft.middleName, draft.familyName, draft.suffix].filter(Boolean).join(' ').trim();
  return (
    <Sheet
      open={!!student}
      onClose={onClose}
      title={student === 'new' ? t('roster.add') : t('common.edit')}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!name} onClick={() => void onSave({ ...draft, displayName: name })}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-2">
        <TextInput label={t('roster.familyName')} value={draft.familyName} onChange={e => set({ familyName: e.target.value, displayName: '' })} />
        <TextInput label={t('roster.givenName')} value={draft.givenName} onChange={e => set({ givenName: e.target.value, displayName: '' })} />
        <TextInput label={t('roster.middleName')} optional value={draft.middleName} onChange={e => set({ middleName: e.target.value, displayName: '' })} />
        <TextInput label={t('roster.suffix')} optional value={draft.suffix} onChange={e => set({ suffix: e.target.value, displayName: '' })} />
      </div>
      {cls.gradeGroups.length > 1 && (
        <Select label={t('roster.gradeGroupFor')} value={draft.gradeGroupId ?? ''} onChange={e => set({ gradeGroupId: e.target.value || null })}>
          <option value="">{t('roster.noGroup')}</option>
          {cls.gradeGroups.map(g => (
            <option key={g.id} value={g.id}>
              {t('common.grade', { g: g.grade })}
            </option>
          ))}
        </Select>
      )}
      <Select label={t('roster.sex')} optional value={draft.sex ?? ''} onChange={e => set({ sex: (e.target.value || null) as Student['sex'] })}>
        <option value="">—</option>
        <option value="M">{t('roster.sexM')}</option>
        <option value="F">{t('roster.sexF')}</option>
      </Select>
      <TextInput label={t('roster.localId')} optional hint={t('roster.localIdHint')} value={draft.localId ?? ''} maxLength={40} onChange={e => set({ localId: e.target.value || null })} />
    </Sheet>
  );
}
