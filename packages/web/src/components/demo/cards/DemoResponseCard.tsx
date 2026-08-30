'use client';

/**
 * Response interject page of the question-cards feed — WEB DEMO port of the mobile
 * packages/mobile/src/components/cards/ResponseCard.tsx (keep in sync), shown when the visitor
 * TYPED a query and the local card search found no confident match in the bundled subset.
 *
 * THREE shapes, one per outcome of /api/demo/card (see useCardDemoStore.ask):
 *   generated — a short grounded fact card, written by the model from the FULL fact bank and
 *               printed under the visitor's own question. The demo answers for real.
 *   abstain   — an in-domain GAP: it is science, we just have no page for it. Offers the
 *               nearest DEMO-SUBSET topic as a soft landing.
 *   offdomain — the query wasn't science at all. States what the DECK holds and offers four
 *               example subjects; deliberately NO nearest topic, because answering "roblox"
 *               with a science card is the thing this shape exists to stop.
 * The two miss shapes share the centred layout — they are the same KIND of page, and the only
 * visible difference is the sentence. A confident retrieval HIT never reaches here: it
 * navigates straight to the found card with a "you asked" banner instead.
 *
 * Nothing here is red, dimmed or warning-coloured: a miss is a different kind of card, not a
 * failed one, so it gets the same continue note out as every other page.
 */
import type { LanguageKey } from '@/config/model';
import type { FeedResponse } from '@/store/useCardDemoStore';

import { cardStrings } from './strings';

const GUTTER_LEFT = 58;

/**
 * The answer's type ramp — four steps off `string.length` alone, mirroring the mobile card so
 * an answer and a factoid read as the same size of thing. The shared `sanitizeCardAnswer` caps
 * a generated card at 320 characters, which is exactly what the last step is for.
 */
function answerTier(text: string): { fontSize: string; lineHeight: string } {
  // Explicit px on BOTH: React leaves `lineHeight` unitless (a multiplier), so a bare 38
  // would set 38x the font size, not 38 pixels.
  const n = text.length;
  if (n <= 120) return { fontSize: '26px', lineHeight: '38px' };
  if (n <= 220) return { fontSize: '23px', lineHeight: '33px' };
  if (n <= 300) return { fontSize: '21px', lineHeight: '30px' };
  return { fontSize: '19px', lineHeight: '27px' };
}

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
  const offDomain = response.kind === 'offdomain';
  // Both misses print the emoji and one centred sentence; only `generated` prints an answer.
  const miss = response.kind !== 'generated';
  const answer = response.text ?? '';

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

      <div
        className={`flex flex-1 flex-col justify-center ${
          miss ? 'items-center text-center' : 'items-start'
        }`}
      >
        {miss ? (
          <>
            <div className="mb-3 text-[52px] leading-none">🤔</div>
            <p className="font-display text-[24px] leading-[34px] text-[#0c343d]">
              {offDomain ? t.offdomain : t.abstain}
            </p>
            {offDomain ? (
              /* No retrieved topic exists for an off-domain query, and offering one anyway is
                 precisely the behaviour we removed — so this line is STATIC: four subjects the
                 bank is genuinely dense in, so a visitor who follows it lands on a real card. */
              <p className="mt-4 font-hand text-[18px] leading-[26px] text-[#5a7178]">
                {t.offdomainHint}
              </p>
            ) : (
              response.suggestion && (
                <p className="mt-4 font-hand text-[18px] leading-[26px] text-[#5a7178]">
                  {t.abstainSuggest}:{' '}
                  <span className="font-display text-[#2743a6]">{response.suggestion}</span>
                </p>
              )
            )}
            <p className="mt-6 font-hand text-[14px] italic leading-[20px] text-[#5a7178]">
              {t.demoNote}
            </p>
          </>
        ) : (
          <p className="font-display text-[#0c343d]" style={answerTier(answer)}>
            {answer}
          </p>
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
