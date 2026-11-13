'use client';
import { formatTime, useT } from '@/i18n';
import { useSession } from '@/data/session';

/** Persistent, unobtrusive sync state (OFF-3): last sent, items waiting, conflicts. */
export function SyncIndicator({ compact }: { compact?: boolean }) {
  const { t, lang } = useT();
  const { sync, syncNow, network, status } = useSession();
  if (status !== 'signedIn') return null;
  const parts: string[] = [];
  if (sync.state === 'syncing') parts.push(t('sync.syncing'));
  else if (sync.pending > 0) parts.push(t('sync.waiting', { n: sync.pending }));
  else if (sync.lastSyncedAt)
    parts.push(compact ? '' : t('sync.lastSynced', { time: formatTime(sync.lastSyncedAt, lang) }));
  else parts.push(t('sync.never'));
  if (sync.conflicts > 0) parts.push(t('sync.conflicts', { n: sync.conflicts }));
  const text = parts.filter(Boolean).join(' · ');
  if (compact) {
    if (!text) return null;
    return (
      <button
        type="button"
        onClick={() => void syncNow()}
        className="min-h-touch px-2 text-small text-forestMuted max-w-[9rem] truncate"
        aria-label={text}
        title={text}
      >
        {sync.state === 'syncing' ? '↻' : sync.conflicts > 0 ? '⚠' : '↑'}{' '}
        {sync.pending > 0 ? sync.pending : ''}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      disabled={!network.online}
      className="text-left text-small text-forestMuted px-3 min-h-touch rounded hover:bg-cream disabled:hover:bg-transparent"
    >
      <span className="block">{text || t('sync.upToDate')}</span>
      {network.online && (
        <span className="block text-talaTealText underline">{t('sync.sendNow')}</span>
      )}
    </button>
  );
}
