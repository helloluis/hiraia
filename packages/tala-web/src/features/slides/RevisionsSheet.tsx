'use client';
/**
 * "Earlier versions" of a deck: kept by Tala before AI slides were used, before a version was put back, and before
 * a copy started over. Putting one back keeps the deck as it is now as an earlier version too, so nothing is lost.
 */
import { useEffect, useState } from 'react';
import type { DeckDetail, DeckRevisionMeta } from '@hiraia/tala-core/contracts';
import { formatTime, useT } from '@/i18n';
import { listRevisions, restoreRevision } from '@/data/decks';
import { Icon } from '@/components/icons';
import { Banner, Button, Placeholder, Sheet } from '@/components/ui';

const REASON = { ai: 'pp.rev.ai', restore: 'pp.rev.restore', reset: 'pp.rev.reset' } as const;

export function RevisionsSheet({
  deckId,
  open,
  onClose,
  onRestored,
  beforeRestore,
}: {
  deckId: string | null;
  open: boolean;
  onClose: () => void;
  onRestored: (detail: DeckDetail) => void;
  /** Save what is on screen first (the deck editor); false when it could not be saved. */
  beforeRestore?: () => Promise<boolean>;
}) {
  const { t, lang } = useT();
  const [list, setList] = useState<DeckRevisionMeta[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!open || !deckId) return;
    let alive = true;
    setList(null);
    setFailed(false);
    setError(false);
    listRevisions(deckId)
      .then((r) => alive && setList(r))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [open, deckId]);
  const putBack = async (id: string) => {
    if (!deckId) return;
    setBusy(id);
    setError(false);
    try {
      if (beforeRestore && !(await beforeRestore())) throw new Error('unsaved');
      onRestored(await restoreRevision(deckId, id));
      onClose();
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('pp.rev.title')}>
      <p className="text-small text-forestMuted">{t('pp.rev.hint')}</p>
      {error && <Banner kind="error">{t('pp.rev.failed')}</Banner>}
      {failed ? (
        <Banner kind="warn">{t('pp.rev.loadFailed')}</Banner>
      ) : !list ? (
        <Placeholder rows={2} />
      ) : !list.length ? (
        <p>{t('pp.rev.none')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline" data-revisions>
          {list.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
              <span className="min-w-0 flex-1 basis-56">
                <span className="block font-medium">{t(REASON[r.reason])}</span>
                <span className="block text-small text-forestMuted">
                  {formatTime(r.createdAt, lang)} · {r.slideCount === 1 ? t('sl.countOne') : t('sl.count', { n: r.slideCount })}
                </span>
              </span>
              <Button onClick={() => void putBack(r.id)} busy={busy === r.id} disabled={busy !== null && busy !== r.id} data-revision-restore>
                <Icon name="restore" size={18} />
                {t('pp.rev.putBack')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
