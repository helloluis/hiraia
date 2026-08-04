'use client';

/**
 * Response interject page of the question-cards feed — WEB DEMO port of the mobile
 * packages/mobile/src/components/cards/ResponseCard.tsx (keep in sync), shown when the
 * visitor TYPED a query and the local card search found no confident match. The web
 * demo has no on-device model, so this is always the honest abstention shape — "I
 * don't know that yet", the nearest topic as a soft landing, and a small note that
 * the real app answers on-device. A confident retrieval HIT never reaches here — it
 * navigates straight to the found card with a "you asked" banner instead.
 */
import type { LanguageKey } from '@/config/model';
import type { FeedResponse } from '@/store/useCardDemoStore';

import { cardStrings } from './strings';

const GUTTER_LEFT = 58;

export function DemoResponseCard({
  response,
  language,
  onContinue,
}: {
  response: FeedResponse;
  language: LanguageKey;
  onContinue: () => void;
}) {
  const t = cardStrings(language);
  const abstain = response.kind === 'abstain';

  return (
    <div
      className="relative flex h-full flex-col pb-[78px] pr-[26px] pt-[18px]"
      style={{ paddingLeft: GUTTER_LEFT }}
    >
      {/* the visitor's question, as a teacher's note */}
      <div className="mb-1 font-hand text-[14px] uppercase tracking-[1px] text-[#5a7178]">
        {t.yourQuestion}
      </div>
      <p className="mb-5 font-display text-[24px] leading-[32px] text-[#2743a6]">
        “{response.query}”
      </p>

      <div className="flex flex-1 flex-col items-start justify-center">
        {abstain ? (
          <>
            <div className="mb-3 text-[52px] leading-none">🤔</div>
            <p className="font-display text-[24px] leading-[34px] text-[#0c343d]">{t.abstain}</p>
            {response.suggestion && (
              <p className="mt-4 font-hand text-[18px] leading-[26px] text-[#5a7178]">
                {t.abstainSuggest}:{' '}
                <span className="font-display text-[#2743a6]">{response.suggestion}</span>
              </p>
            )}
            <p className="mt-6 font-hand text-[14px] italic leading-[20px] text-[#5a7178]">
              {t.demoNote}
            </p>
          </>
        ) : (
          <p className="font-display text-[26px] leading-[38px] text-[#0c343d]">{response.text}</p>
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
