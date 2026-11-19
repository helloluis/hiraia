'use client';
/**
 * "Your slide copies" on the Library front page: the decks a teacher has made their own, newest first, so an edited
 * deck is one tap away the next morning. Private to the signed-in account; shown only when there is at least one.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { DeckSummary } from '@hiraia/tala-core/contracts';
import { formatTime, useT } from '@/i18n';
import { listDecks } from '@/data/decks';
import { useSession } from '@/data/session';
import { IconBadge } from '@/components/editorial';
import { Icon } from '@/components/icons';

export function MyCopies() {
  const { t, lang } = useT();
  const { status } = useSession();
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  useEffect(() => {
    if (status !== 'signedIn') {
      setDecks([]);
      return;
    }
    let alive = true;
    listDecks()
      .then((d) => alive && setDecks(d))
      .catch(() => {
        /* offline or signed out: the section simply does not show */
      });
    return () => {
      alive = false;
    };
  }, [status]);
  if (!decks.length) return null;
  return (
    <section aria-labelledby="my-copies">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="my-copies" className="text-headline">
          {t('lib2.myCopies')}
        </h2>
        <p className="inline-flex items-center gap-1.5 text-small text-forestMuted">
          <Icon name="lock" size={14} />
          {t('lib2.myCopiesHint')}
        </p>
      </div>
      <ul className="mt-3 grid gap-3 wide:grid-cols-2">
        {decks.slice(0, 6).map((d) => (
          <li key={d.id}>
            <Link href={`/slides/${d.id}`} className="group flex items-center gap-3 rounded-lg bg-white px-4 py-3 shadow-card transition-shadow hover:shadow-lift">
              <IconBadge name="pencil" tint="teal" size={44} />
              <span className="min-w-0 flex-1">
                <span className="block font-display text-title leading-snug break-words">{d.title}</span>
                <span className="block text-small text-forestMuted break-words">
                  {t('pk.kicker', { grade: d.grade, term: d.term, week: d.week })} · {t(d.language === 'fil' ? 'lib2.inFilipino' : 'lib2.inEnglish')}
                </span>
                <span className="block text-small text-forestMuted break-words">
                  {d.changedSlides > 0 ? t('lib2.copyChanged', { n: d.changedSlides }) : t('lib2.copyUnchanged')} · {t('lib2.copySaved', { time: formatTime(d.updatedAt, lang) })}
                </span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-small font-medium text-talaTeal">
                <span className="hidden min-[480px]:inline">{t('lib2.copyOpen')}</span>
                <Icon name="arrowRight" size={18} className="transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
