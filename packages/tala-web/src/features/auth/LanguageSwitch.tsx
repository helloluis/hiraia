'use client';
/**
 * Language control: a compact EN | FIL segmented pill in the Hiraia language (forest hairline, cream card,
 * teal active segment), 44 px targets, visible focus ring, full accessible names.
 */
import { useT } from '@/i18n';
import { cx } from '@/components/ui';

const OPTIONS = [
  { code: 'en', short: 'EN', nameKey: 'lang.en' },
  { code: 'fil', short: 'FIL', nameKey: 'lang.fil' },
] as const;

export function LanguageSwitch({ className }: { className?: string }) {
  const { lang, setLang, t } = useT();
  return (
    <div
      role="group"
      aria-label={t('auth.language')}
      className={cx(
        'inline-flex items-center rounded-full border-2 border-forest bg-cream p-0.5 shadow-[0_2px_0_rgba(28,59,46,0.35)]',
        className
      )}
    >
      {OPTIONS.map((o) => {
        const active = lang === o.code;
        return (
          <button
            key={o.code}
            type="button"
            lang={o.code === 'fil' ? 'fil' : 'en'}
            aria-label={t(o.nameKey)}
            aria-pressed={active}
            aria-current={active ? 'true' : undefined}
            onClick={() => setLang(o.code)}
            className={cx(
              'min-h-[44px] min-w-[44px] px-3 rounded-full font-display text-small tracking-[0.08em] transition-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-talaTeal',
              active ? 'bg-talaTeal text-white' : 'text-forest hover:bg-white'
            )}
          >
            {o.short}
          </button>
        );
      })}
    </div>
  );
}
