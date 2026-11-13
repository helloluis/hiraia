'use client';
import { useT } from '@/i18n';
import { cx } from '@/components/ui';

export function LanguageSwitch() {
  const { lang, setLang, t } = useT();
  return (
    <div
      role="group"
      aria-label={t('auth.language')}
      className="inline-flex rounded border border-hairline overflow-hidden bg-white"
    >
      {(['fil', 'en'] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          onClick={() => setLang(l)}
          className={cx(
            'min-h-touch px-3 text-small',
            lang === l ? 'bg-talaTeal text-white font-medium' : 'text-forest'
          )}
        >
          {t(`lang.${l}`)}
        </button>
      ))}
    </div>
  );
}
