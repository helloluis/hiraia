'use client';
/**
 * "Suggested slides": what AI made from the lesson, shown before anything is written. The teacher looks at every
 * suggested slide (they open in the carousel), then uses them or keeps her own. Using them keeps her slides as an
 * earlier version; when her slides changed after the suggestion was made she is asked again, plainly.
 */
import { useState } from 'react';
import type { SlidesAiScope } from '@hiraia/tala-core/contracts';
import { useT } from '@/i18n';
import { Icon } from '@/components/icons';
import { Banner, Button, Sheet, Sparkle } from '@/components/ui';
import type { DeckView } from './deck-model';
import { Lightbox } from './Lightbox';
import { SlideThumb } from './SlideThumb';
import { TROUBLE_KEY } from './ai-words';
import type { SlidesAi } from './useSlidesAi';

export function AiProposalSheet({
  ai,
  view,
  scope,
  replacing,
  open,
  onClose,
}: {
  ai: SlidesAi;
  /** The suggested slides, laid out like the deck. */
  view: DeckView | null;
  scope: SlidesAiScope;
  /** How many of her slides the suggestion replaces. */
  replacing: number;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useT();
  const [lightbox, setLightbox] = useState<number | null>(null);
  const count = view?.layouts.length ?? 0;
  const conflict = ai.phase === 'conflict';
  return (
    <>
      <Sheet
        open={open && !!view}
        onClose={onClose}
        title={t('pp.ai.readyTitle')}
        actions={
          <>
            <Button onClick={() => void ai.discard().then(onClose)} disabled={ai.phase === 'applying'} data-ai-keep>
              {t('pp.ai.keepMine')}
            </Button>
            <Button variant="primary" busy={ai.phase === 'applying'} onClick={() => void ai.apply(conflict)} data-ai-use>
              <Icon name="check" size={20} />
              {conflict ? t('pp.ai.useAnyway') : t(scope === 'slide' ? 'pp.ai.useSlide' : 'pp.ai.useSlides')}
            </Button>
          </>
        }
      >
        <p className="flex items-start gap-2">
          <Sparkle className="mt-0.5 shrink-0 text-talaTeal" />
          <span>{scope === 'new' ? t('pp.ai.readyNew', { n: count }) : scope === 'lesson' ? t('pp.ai.readyLesson', { n: count, old: replacing }) : t('pp.ai.readySlide')}</span>
        </p>
        {conflict && <Banner kind="warn">{t('pp.ai.conflict')}</Banner>}
        {ai.trouble && !conflict && <Banner kind="error">{t(TROUBLE_KEY[ai.trouble])}</Banner>}
        {view && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-4 min-[560px]:grid-cols-3" data-ai-proposal>
            {view.layouts.map((l) => (
              <SlideThumb key={l.id} view={view} layout={l} onOpen={setLightbox} />
            ))}
          </div>
        )}
        <p className="text-small text-forestMuted">{t('pp.ai.checkFacts')}</p>
      </Sheet>
      {lightbox !== null && view && <Lightbox view={view} index={lightbox} onIndex={setLightbox} onClose={() => setLightbox(null)} />}
    </>
  );
}
