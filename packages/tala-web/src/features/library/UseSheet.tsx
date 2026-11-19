'use client';
/** "Use for my class": copies a pack's five day plans into the teacher's own records as editable drafts. */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { PackDetail } from '@hiraia/tala-core/contracts';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { useRecords } from '@/data/records';
import { newId } from '@/data/ids';
import { addPackToClass, weekdaysFrom } from '@/data/packs';
import { Banner, Button, LinkButton, Select, Sheet, TextInput } from '@/components/ui';

function nextMonday(): string {
  const d = new Date();
  const add = (8 - d.getDay()) % 7 || 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + add, 12).toISOString().slice(0, 10);
}

export function UseSheet({ detail, onClose, onDone }: { detail: PackDetail; onClose: () => void; onDone: () => void }) {
  const { t } = useT();
  const router = useRouter();
  const { engine } = useSession();
  const classes = useRecords('class');
  const assignments = useRecords('assignment');
  const live = useMemo(() => classes.items.filter((c) => !c.deletedAt).map((c) => c.data), [classes.items]);
  const [classId, setClassId] = useState<string>('');
  const preferred = live.find((c) => c.gradeGroups.some((g) => g.grade === detail.content.grade)) ?? live[0] ?? null;
  const cls = live.find((c) => c.id === classId) ?? preferred;
  const matching = cls?.gradeGroups.find((g) => g.grade === detail.content.grade) ?? null;
  const [groupId, setGroupId] = useState<string>('');
  const group = cls?.gradeGroups.find((g) => g.id === groupId) ?? matching ?? cls?.gradeGroups[0] ?? null;
  const [weekOf, setWeekOf] = useState(nextMonday());
  const [busy, setBusy] = useState(false);
  const assignment =
    assignments.items
      .map((a) => a.data)
      .find((a) => a.classId === cls?.id && a.learningAreaId === 'science' && (!group || a.gradeGroupIds.includes(group.id))) ?? null;

  const add = async () => {
    if (!engine || !cls || !group) return;
    setBusy(true);
    try {
      const ids = await addPackToClass({ engine, detail, cls, gradeGroupId: group.id, assignmentId: assignment?.id ?? null, weekOf, newId });
      onDone();
      onClose();
      router.push(`/lessons/${ids[0]}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('lib.use.title')}
      actions={
        cls ? (
          <Button variant="primary" full busy={busy} onClick={add} disabled={!group}>
            {t('lib.use.confirm')}
          </Button>
        ) : (
          <LinkButton href="/setup" variant="primary" full>
            {t('lib.use.setUp')}
          </LinkButton>
        )
      }
    >
      {!cls ? (
        <p>{t('lib.use.noClass')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {live.length > 1 && (
            <Select label={t('lib.use.class')} value={cls.id} onChange={(e) => setClassId(e.target.value)}>
              {live.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
          {cls.gradeGroups.length > 1 && (
            <Select label={t('lib.use.group')} value={group?.id ?? ''} onChange={(e) => setGroupId(e.target.value)}>
              {cls.gradeGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {`Grade ${g.grade}`}
                </option>
              ))}
            </Select>
          )}
          {!matching && <Banner kind="warn">{t('lib.use.gradeMismatch', { grade: detail.content.grade })}</Banner>}
          <TextInput label={t('lib.use.week')} type="date" value={weekOf} onChange={(e) => setWeekOf(e.target.value)} hint={weekdaysFrom(weekOf).join(' · ')} />
          <p className="text-small text-forestMuted">{t('lib.use.note')}</p>
          <p className="text-small">
            <Link href="/lessons" className="text-talaTealText underline">
              {t('nav.lessons')}
            </Link>
          </p>
        </div>
      )}
    </Sheet>
  );
}
