'use client';
/** The days a subject meets, Monday to Sunday, as toggle buttons. Used by setup and by the class screen. */
import { formatDate, useT } from '@/i18n';
import { cx } from '@/components/ui';
import { WEEKDAYS, hasWeekend, toggleDay, weekdayReference } from './days';

export function DayPicker({
  legend,
  days,
  onChange,
}: {
  legend: string;
  days: readonly number[];
  onChange: (days: number[]) => void;
}) {
  const { t, lang } = useT();
  return (
    <fieldset>
      <legend className="font-medium mb-1">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {WEEKDAYS.map((d) => {
          const on = days.includes(d);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              aria-label={formatDate(weekdayReference(d), lang, { weekday: 'long' })}
              onClick={() => onChange(toggleDay(days, d))}
              className={cx(
                'min-h-touch min-w-touch px-3 rounded border',
                on ? 'bg-talaTeal text-white border-talaTeal' : 'bg-white border-hairline'
              )}
            >
              {formatDate(weekdayReference(d), lang, { weekday: 'short' })}
            </button>
          );
        })}
      </div>
      {hasWeekend(days) && (
        <p className="mt-2 text-small text-forestMuted">{t('setup.weekendHint')}</p>
      )}
    </fieldset>
  );
}
