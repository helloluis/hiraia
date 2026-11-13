'use client';
import { useEffect, useMemo, useState } from 'react';
import type { RealignmentOption } from '@hiraia/tala-core/contracts';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import type { useTimeline } from '@/data/timeline';
import {
  affectedTracks,
  applyPreview,
  optionsFor,
  previewOption,
  undoApplied,
  type CombinedPreview,
} from '@/data/realign';
import { addDays } from '@/data/ids';
import { Badge, Banner, Button, Placeholder, Sheet, TextInput, cx } from '@/components/ui';

/** Preview-and-confirm realignment (§7.6, PACE-6). Default option first; apply is reversible in one step. */
export function RealignSheet({
  open,
  onClose,
  dayIds,
  tl,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  dayIds: string[];
  tl: ReturnType<typeof useTimeline>;
  onApplied: (undo: () => void) => void;
}) {
  const { t } = useT();
  const { engine } = useSession();
  const days = useMemo(
    () => tl.ws.calendarDays.filter((d) => dayIds.includes(d.id)),
    [tl.ws.calendarDays, dayIds]
  );
  const tracks = useMemo(
    () => (tl.currentTerm ? affectedTracks(tl.ws, days, tl.currentTerm.id) : []),
    [tl.ws, days, tl.currentTerm]
  );
  const options = useMemo(
    () => optionsFor(tl.ws, tl.competencies, tracks, tl.today, tl.defaults),
    [tl.ws, tl.competencies, tracks, tl.today, tl.defaults]
  );
  const [option, setOption] = useState<RealignmentOption | null>(null);
  const [makeup, setMakeup] = useState(() => nextSaturday(tl.today));
  const [preview, setPreview] = useState<CombinedPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!option && options.length) setOption(options[0]!);
  }, [options, option]);

  useEffect(() => {
    if (!option) return;
    setPreview(null);
    const id = setTimeout(() => {
      try {
        setPreview(
          previewOption(tl.ws, tl.competencies, tracks, dayIds, option, tl.today, tl.defaults, {
            makeupDates: option === 'add_time' ? [makeup] : undefined,
          })
        );
        setFailed(false);
      } catch {
        setFailed(true);
      }
    }, 0);
    return () => clearTimeout(id);
  }, [option, tl.ws, tl.competencies, tracks, dayIds, tl.today, tl.defaults, makeup]);

  const apply = async () => {
    if (!engine || !preview) return;
    setBusy(true);
    try {
      const undo = await applyPreview(engine, preview);
      onApplied(() => void undoApplied(engine, undo));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const nothingToDo = preview && preview.tracks.length === 0;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('realign.title')}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            {t('realign.later')}
          </Button>
          <Button
            variant="primary"
            onClick={() => void apply()}
            disabled={!preview || nothingToDo === true}
            busy={busy}
          >
            {t('realign.apply')}
          </Button>
        </>
      }
    >
      <p>{t('realign.intro')}</p>
      <div role="radiogroup" aria-label={t('realign.title')} className="flex flex-col gap-2">
        {options.map((o, i) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={option === o}
            onClick={() => setOption(o)}
            className={cx(
              'flex flex-col items-start gap-0.5 min-h-touch rounded border px-3 py-2 text-left bg-white',
              option === o ? 'border-talaTeal ring-2 ring-talaTeal' : 'border-hairline'
            )}
          >
            <span className="flex items-center gap-2 font-medium">
              {t(`realign.option.${o}`)}
              {i === 0 && <Badge tone="teal">{t('realign.recommended')}</Badge>}
            </span>
            <span className="text-small text-forestMuted">{t(`realign.desc.${o}`)}</span>
          </button>
        ))}
      </div>
      {option === 'add_time' && (
        <TextInput
          label={t('realign.pickDate')}
          type="date"
          value={makeup}
          onChange={(e) => setMakeup(e.target.value)}
        />
      )}
      {failed && <Banner kind="error">{t('error.generic')}</Banner>}
      {!preview && !failed && option && <Placeholder rows={2} />}
      {preview && (
        <div className="rounded border border-hairline bg-cream p-3 flex flex-col gap-1">
          {nothingToDo ? (
            <span>{t('realign.nothingMoves')}</span>
          ) : (
            <>
              <span>{t('realign.moved', { n: preview.movedCompetencies })}</span>
              {preview.movedPlans > 0 && (
                <span>{t('realign.plansMoved', { n: preview.movedPlans })}</span>
              )}
              {preview.dropped > 0 && (
                <span className="text-brick">⚠ {t('realign.dropped', { n: preview.dropped })}</span>
              )}
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

function nextSaturday(today: string): string {
  let d = today;
  for (let i = 0; i < 7; i++) {
    d = addDays(today, i + 1);
    const w = new Date(d + 'T12:00:00Z').getUTCDay();
    if (w === 6) return d;
  }
  return d;
}
