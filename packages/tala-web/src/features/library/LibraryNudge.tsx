'use client';
/** One calm pointer to the Library, for screens where a teacher may be stuck or short on time. */
import Link from 'next/link';
import { useT } from '@/i18n';
import { IconBadge } from '@/components/editorial';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';

export function LibraryNudge({ className }: { className?: string }) {
  const { t } = useT();
  return (
    <Link href="/library" className={cx('group flex items-center gap-3 rounded-lg bg-talaTeal/10 px-4 py-3 hover:bg-talaTeal/15', className)}>
      <IconBadge name="book" tint="teal" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold break-words">{t('nudge.title')}</span>
        <span className="block text-small text-forestMuted break-words">{t('nudge.body')}</span>
      </span>
      <Icon name="arrowRight" size={20} className="text-talaTeal transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
