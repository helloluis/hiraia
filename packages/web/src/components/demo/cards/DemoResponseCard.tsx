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
    <div className="relative z-[1] flex h-full flex-col">
      <div className="mc-band mc-band-gold mb-3">
        <span className="mc-topic">{t.yourQuestion}</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/hiraia-profile.png" alt="" width={26} height={26} className="mc-stamp" />
      </div>
      <p className="mb-4 font-zilla text-[18px] font-bold leading-snug text-[var(--ink)]">
        “{response.query}”
      </p>

      <div
        className={`flex flex-1 flex-col justify-center ${
          miss ? 'items-center text-center' : 'items-start'
        }`}
      >
        {miss ? (
          <>
            <p className="font-zilla text-[18px] font-bold leading-snug text-[var(--ink)]">
              {offDomain ? t.offdomain : t.abstain}
            </p>
            {offDomain ? (
              <p className="mt-4 font-zilla text-[15px] font-medium leading-snug text-[var(--olive)]">
                {t.offdomainHint}
              </p>
            ) : (
              response.suggestion && (
                <p className="mt-4 font-zilla text-[15px] font-medium leading-snug text-[var(--olive)]">
                  {t.abstainSuggest}:{' '}
                  <span className="font-bold text-[var(--ink)]">{response.suggestion}</span>
                </p>
              )
            )}
            <p className="mt-6 font-zilla text-[13px] italic leading-snug text-[var(--olive)]">
              {t.demoNote}
            </p>
          </>
        ) : (
          <p className="font-zilla font-medium text-[var(--ink)]" style={answerTier(answer)}>
            {answer}
          </p>
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
