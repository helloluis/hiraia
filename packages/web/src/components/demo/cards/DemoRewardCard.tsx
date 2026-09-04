'use client';

/**
 * Reward interject page of the question-cards feed — WEB DEMO port of the mobile
 * packages/mobile/src/components/cards/RewardCard.tsx (keep in sync): a periodic
 * (jittered) celebration of how much the visitor just learned, naming a few real
 * recent topics from their view-log (never fabricated). A blue "continue ⤴" note
 * resumes the walk onto the card they'd chosen.
 */
import type { LanguageKey } from '@/config/model';
import type { RewardContent } from '@/data/reward';

import { cardStrings } from './strings';

export function DemoRewardCard({
  reward,
  language,
  onContinue,
}: {
  reward: RewardContent;
  language: LanguageKey;
  onContinue: () => void;
}) {
  const t = cardStrings(language);

  return (
    <div className="relative z-[1] flex h-full flex-col">
      <div className="mc-band mc-band-gold mb-3">
        <span className="mc-topic">{t.readLabel}</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/hiraia-profile.png" alt="" width={26} height={26} className="mc-stamp" />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="demo-star-pop mb-3 text-[56px] leading-none">★</div>
        <p className="text-center font-zilla text-[20px] font-bold leading-snug text-[var(--ink)]">
          {reward.text}
        </p>
        {reward.topics.length > 0 && (
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {reward.topics.map((tp) => (
              <span
                key={tp}
                className="max-w-[80%] truncate rounded-full border-2 border-[var(--ink)] bg-[var(--stock)] px-3 py-1 font-zilla text-[13px] font-bold text-[var(--ink)]"
              >
                {tp}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mc-ledge mt-3">
        <button type="button" onClick={onContinue} className="mc-ticket">
          <span className="flex-1">{t.continueNote}</span>
          <span className="mc-arrow" aria-hidden />
        </button>
      </div>
    </div>
  );
}
