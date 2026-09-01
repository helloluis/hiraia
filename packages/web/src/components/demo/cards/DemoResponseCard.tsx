'use client';

/**
 * Response interject page of the question-cards feed — WEB DEMO port of the mobile
 * packages/mobile/src/components/cards/ResponseCard.tsx (keep in sync), shown when the visitor
 * TYPED a query and the local card search found no confident match in the bundled subset.
 *
 * THREE shapes, one per outcome of /api/demo/card (see useCardDemoStore.ask):
 *   generated — a short grounded fact card, written by the model from the FULL fact bank and
 *               printed under the visitor's own question, with the deck's own illustration
 *               above it when RETRIEVAL found one it is confident about (the model never picks
 *               the picture) and as plain type when it did not — which is the common case.
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
import { useState } from 'react';

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

/**
 * Longest answer that still leaves room for a picture. The sheet is one fixed page holding the
 * visitor's question, the answer in full and the continue note; past this the illustration and
 * the type cannot both fit, and the SENTENCE is the payload, so the picture yields. The prompt
 * caps a card at 30 words and the deck's median printed card is 19, so this only bites on the
 * long tail. Same number and same reasoning as the phone (mobile ResponseCard) — keep in sync.
 */
const ART_MAX_CHARS = 220;

/**
 * One step down when the card is ILLUSTRATED — the same ramp shifted, mirroring what the
 * factoid page does: with a picture above it the answer is a CAPTION, not the body of the
 * page, and a long card at full size would push the illustration off the sheet.
 */
function captionTier(text: string): { fontSize: string; lineHeight: string } {
  const shift = { '26px': '22px', '23px': '20px', '21px': '19px', '19px': '17px' } as const;
  const lead = { '38px': '32px', '33px': '29px', '30px': '27px', '27px': '25px' } as const;
  const t = answerTier(text);
  return {
    fontSize: shift[t.fontSize as keyof typeof shift],
    lineHeight: lead[t.lineHeight as keyof typeof lead],
  };
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
  /**
   * THE ILLUSTRATION. `response.slug` was chosen SERVER-side by retrieval from the top
   * grounded fact — the curated fact→slug map first, then LaBSE over the image catalog above a
   * measured floor (see @hiraia/shared rag/images.ts and server/images.ts). The model wrote the
   * sentence and was never asked what to draw.
   *
   * Null is the ORDINARY answer, not a failure: at the shipped floor most dynamic cards get no
   * confident picture, and the card then prints exactly as it did before this existed. A wrong
   * engraving under a true sentence teaches the wrong thing, so the bar is set where a picture
   * is worth trusting and the page is laid out to look complete without one.
   *
   * The route only ever returns art that is published here, so `onError` is a belt-and-braces
   * for a half-deployed public dir rather than an expected path — and it degrades to the same
   * picture-less card, never to a broken-image icon.
   */
  const [imgFailed, setImgFailed] = useState(false);
  const slug = miss || imgFailed || answer.length > ART_MAX_CHARS ? null : response.slug;

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
          <>
            {slug && (
              /* The same plate a factoid page prints (DemoCardPage): a dashed-edge square on
                 white, so a generated card reads as a card of the same deck. Sized like a
                 left-aligned factoid illustration, since an answer is never centred. */
              <div className="mb-3.5 w-[190px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/demo/cards/${slug}.png`}
                  /* Decorative: the card's meaning is entirely in the sentence directly below,
                     and the slug is a catalog key, not a caption a reader would want read out.
                     The factoid page can title its art with the card's topic; a generated card
                     has no title but the visitor's own question, and reading that back as the
                     name of the picture would be worse than silence. */
                  alt=""
                  onError={() => setImgFailed(true)}
                  className="aspect-square w-full rounded-[14px] border border-dashed border-[rgba(12,52,61,0.12)] bg-white object-cover"
                />
              </div>
            )}
            <p
              className="font-display text-[#0c343d]"
              style={slug ? captionTier(answer) : answerTier(answer)}
            >
              {answer}
            </p>
          </>
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
