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

const GUTTER_LEFT = 58;

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
    <div
      className="relative flex h-full flex-col pb-[78px] pr-[26px] pt-2.5"
      style={{ paddingLeft: GUTTER_LEFT }}
    >
      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="demo-star-pop mb-3.5 text-[72px] leading-none">🌟</div>
        <p className="text-center font-display text-[28px] leading-[38px] text-[#0c343d]">
          {reward.text}
        </p>
        {reward.topics.length > 0 && (
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {reward.topics.map((tp) => (
              <span
                key={tp}
                className="max-w-[80%] truncate rounded-2xl border border-[rgba(12,52,61,0.12)] bg-[#e8f1f2] px-3 py-1.5 font-hand text-[15px] text-[#165a69]"
              >
                {tp}
              </span>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onContinue}
        className="absolute bottom-3.5 right-6 rotate-[1.5deg] border-b-[1.5px] border-[#2743a6] pb-px"
      >
        <span className="font-display text-[23px] text-[#2743a6]">
          {t.continueNote} <span className="text-[16px]">⤴</span>
        </span>
      </button>
    </div>
  );
}
