'use client';
/**
 * A short welcome for a teacher's first visits: three steps, in the order a week goes. It can be put away for good
 * ("Got it"); the choice is kept on the device. Nothing here is required reading.
 */
import { useEffect, useState } from 'react';
import { useT, type StringKey } from '@/i18n';
import { IconBadge } from '@/components/editorial';
import { Icon, type IconName } from '@/components/icons';

const KEY = 'tala.firstSteps.done';
const STEPS: Array<{ icon: IconName; title: StringKey; body: StringKey }> = [
  { icon: 'calendar', title: 'first.1.title', body: 'first.1.body' },
  { icon: 'book', title: 'first.2.title', body: 'first.2.body' },
  { icon: 'pencil', title: 'first.3.title', body: 'first.3.body' },
];

export function FirstSteps() {
  const { t } = useT();
  const [show, setShow] = useState(false);
  // Open on a wide screen; one quiet row on a phone, so "Up next" stays the first thing a teacher sees.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setShow(window.localStorage.getItem(KEY) !== '1');
      setOpen(window.matchMedia('(min-width: 840px)').matches);
    } catch {
      setShow(false);
    }
  }, []);
  if (!show) return null;
  const done = () => {
    setShow(false);
    try {
      window.localStorage.setItem(KEY, '1');
    } catch {
      /* private mode: it simply shows again next time */
    }
  };
  return (
    <section aria-labelledby="first-steps" className="rounded-xl bg-yellow/20 px-4 py-2 wide:px-6 wide:py-4">
      <div className="flex items-center justify-between gap-3">
        <button type="button" aria-expanded={open} aria-controls="first-steps-list" onClick={() => setOpen((v) => !v)} className="flex min-h-touch min-w-0 flex-1 items-center gap-3 text-left">
          <span className="min-w-0 flex-1">
            <span className="kicker block text-forest">{t('first.kicker')}</span>
            <span id="first-steps" className="block font-display text-title leading-snug">
              {t('first.title')}
            </span>
          </span>
          <Icon name={open ? 'chevronUp' : 'chevronDown'} size={20} className="text-forestMuted wide:hidden" />
        </button>
        <button type="button" onClick={done} className="hidden min-h-touch shrink-0 items-center gap-1.5 rounded-full border border-forest bg-white px-4 font-medium wide:inline-flex">
          <Icon name="check" size={18} />
          {t('first.done')}
        </button>
      </div>
      {open && (
        <div id="first-steps-list" className="pb-2 pt-1 wide:pb-0">
          <ol className="grid gap-3 wide:grid-cols-3 wide:gap-5">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-3">
                <IconBadge name={s.icon} tint="yellow" />
                <div className="min-w-0">
                  <p className="font-semibold break-words">
                    <span className="text-forestMuted">{i + 1}. </span>
                    {t(s.title)}
                  </p>
                  <p className="text-small text-forestMuted break-words">{t(s.body)}</p>
                </div>
              </li>
            ))}
          </ol>
          <button type="button" onClick={done} className="mt-3 inline-flex min-h-touch items-center gap-1.5 rounded-full border border-forest bg-white px-4 font-medium wide:hidden">
            <Icon name="check" size={18} />
            {t('first.done')}
          </button>
        </div>
      )}
    </section>
  );
}
