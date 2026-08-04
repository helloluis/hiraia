'use client';

/**
 * The question-cards feed — WEB DEMO shell, ported from the mobile app's home screen
 * (packages/mobile/src/components/cards/CardFeedScreen.tsx — keep in sync). A notebook
 * pad on lined paper: one fact per page, typewriter entry, and the outgoing page
 * lifting up and off the pad on navigation. Every 4-5 pages the flip is intercepted
 * by one MCQ about a recently-read fact; every 6-10 by a reward recap.
 *
 * The "ask anything" box is retrieval-only here: a confident match navigates straight
 * to the found card (with a "you asked" banner); a miss shows the submit button's
 * spinner + a thinking veil for a beat, then the honest abstention card.
 */
import { useEffect, useRef, useState } from 'react';

import type { CardChoice, CardFact, CardQuestion } from '@/data/cards';
import type { RewardContent } from '@/data/reward';
import { useCardDemoStore, type FeedResponse } from '@/store/useCardDemoStore';
import { useDemoStore } from '@/store/useDemoStore';

import { DemoCardPage } from './DemoCardPage';
import { DemoQuestionPage } from './DemoQuestionPage';
import { DemoResponseCard } from './DemoResponseCard';
import { DemoRewardCard } from './DemoRewardCard';
import { cardStrings } from './strings';

const FLIP_MS = 360;

/** What was on the pad for the page being peeled away. */
interface PageSnap {
  pageKey: number;
  fact: CardFact | null;
  choices: CardChoice[];
  question: CardQuestion | null;
  reward: RewardContent | null;
  response: FeedResponse | null;
}

export function CardFeedDemo() {
  const language = useDemoStore((s) => s.language) ?? 'tagalog';
  const t = cardStrings(language);

  const hydrated = useCardDemoStore((s) => s.hydrated);
  const hydrate = useCardDemoStore((s) => s.hydrate);
  const relocale = useCardDemoStore((s) => s.relocale);
  const current = useCardDemoStore((s) => s.current);
  const choices = useCardDemoStore((s) => s.choices);
  const question = useCardDemoStore((s) => s.question);
  const reward = useCardDemoStore((s) => s.reward);
  const response = useCardDemoStore((s) => s.response);
  const asking = useCardDemoStore((s) => s.asking);
  const queryBanner = useCardDemoStore((s) => s.queryBanner);
  const pageKey = useCardDemoStore((s) => s.pageKey);
  const pagesRead = useCardDemoStore((s) => s.pagesRead);
  const correctCount = useCardDemoStore((s) => s.correctCount);
  const choose = useCardDemoStore((s) => s.choose);
  const answerQuestion = useCardDemoStore((s) => s.answerQuestion);
  const continueAfterQuestion = useCardDemoStore((s) => s.continueAfterQuestion);
  const continueAfterReward = useCardDemoStore((s) => s.continueAfterReward);
  const continueAfterResponse = useCardDemoStore((s) => s.continueAfterResponse);
  const ask = useCardDemoStore((s) => s.ask);
  const jumpToRandom = useCardDemoStore((s) => s.jumpToRandom);

  const [queryText, setQueryText] = useState('');
  const submitQuery = () => {
    const q = queryText.trim();
    if (!q) return;
    setQueryText('');
    ask(q, language);
  };

  useEffect(() => {
    hydrate(language);
  }, [hydrate, language]);

  // Choice labels are baked in the picked language — re-bake them if the visitor
  // closes the demo and reopens it in a different language.
  useEffect(() => {
    relocale(language);
  }, [relocale, language]);

  // ---- page-peel transition ----
  // The incoming page never carries a transform (always visible + clickable); the
  // outgoing page lifts off above it and is cleared by a plain timer.
  const [outgoing, setOutgoing] = useState<PageSnap | null>(null);
  const lastSnap = useRef<PageSnap | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prev = lastSnap.current;
    lastSnap.current = { pageKey, fact: current, choices, question, reward, response };
    if (prev && prev.pageKey !== pageKey) {
      setOutgoing(prev);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => setOutgoing(null), FLIP_MS + 80);
    }
  }, [pageKey, current, choices, question, reward, response]);

  useEffect(
    () => () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    },
    []
  );

  if (!hydrated || !current) {
    return (
      <div className="notebook-paper flex h-full w-full items-center justify-center">
        <span className="font-display text-[30px] text-[#5a7178]">…</span>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-[#fdfdf6]">
      {/* counters + spine holes (right padding clears the lightbox close button) */}
      <div className="flex items-center justify-between pb-1 pl-[22px] pr-14 pt-1.5">
        <span className="min-w-[72px] font-hand text-[15px] text-[#5a7178]">
          {t.readLabel} {pagesRead}
        </span>
        <div className="flex gap-4">
          {Array.from({ length: 5 }, (_, i) => (
            <div
              key={i}
              className="h-[9px] w-[9px] rounded-full border-[1.5px] border-[rgba(12,52,61,0.25)] bg-white"
            />
          ))}
        </div>
        <div className="flex min-w-[72px] items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={() => jumpToRandom(language)}
            aria-label="Jump to a random topic"
            className="p-0.5 text-[20px] leading-none"
          >
            🎲
          </button>
          <span className="font-display text-[19px] text-[#2743a6]">✓ {correctCount}</span>
        </div>
      </div>

      {/* persistent "ask anything" box — the kid's agency: type a topic or question.
          While an answer is being worked on the submit button becomes a progress
          circle, so it's clear the app is working and they should wait. */}
      <form
        className="mx-4 mb-1.5 flex h-10 items-center rounded-full border-[1.5px] border-[rgba(12,52,61,0.18)] bg-white px-3"
        onSubmit={(e) => {
          e.preventDefault();
          submitQuery();
        }}
      >
        <span className="mr-2 text-[15px] opacity-70">🔍</span>
        <input
          type="text"
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
          placeholder={t.searchPlaceholder}
          disabled={asking}
          className="min-w-0 flex-1 bg-transparent font-hand text-[16px] text-[#0c343d] outline-none placeholder:text-[#5a7178]"
        />
        {asking ? (
          <div className="ml-2 h-4 w-4 animate-spin rounded-full border-2 border-[#2743a6]/30 border-t-[#2743a6]" />
        ) : (
          <button
            type="submit"
            disabled={!queryText.trim()}
            aria-label="Ask"
            className="ml-2 text-[15px] text-[#2743a6] disabled:opacity-30"
          >
            ➤
          </button>
        )}
      </form>

      {/* the pad */}
      <div className="relative flex-1 overflow-hidden border-t-2 border-[rgba(12,52,61,0.18)]">
        {/* incoming page — lined paper, blank content that types itself in. NEVER
            transformed, so it's always visible + clickable. */}
        <div key={pageKey} className="notebook-paper absolute inset-0">
          {response ? (
            <DemoResponseCard
              response={response}
              language={language}
              onContinue={() => continueAfterResponse(language)}
            />
          ) : reward ? (
            <DemoRewardCard
              reward={reward}
              language={language}
              onContinue={() => continueAfterReward(language)}
            />
          ) : question ? (
            <DemoQuestionPage
              question={question}
              language={language}
              onAnswer={answerQuestion}
              onContinue={() => continueAfterQuestion(language)}
            />
          ) : (
            <DemoCardPage
              fact={current}
              choices={choices}
              language={language}
              onChoose={(c) => choose(c, language)}
            />
          )}

          {/* "you asked" ribbon when a search navigated straight to a found card */}
          {queryBanner && !response && !reward && !question ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 border-b border-[rgba(12,52,61,0.12)] bg-[rgba(240,246,247,0.92)] px-5 py-1.5">
              <span className="block truncate font-hand text-[13px] italic text-[#2743a6]">
                {t.yourQuestion}: “{queryBanner}”
              </span>
            </div>
          ) : null}
        </div>

        {/* outgoing page lifting up and off the pad */}
        {outgoing && (
          <div className="notebook-paper demo-page-peel pointer-events-none absolute inset-0">
            {outgoing.fact && !outgoing.question && !outgoing.reward && !outgoing.response ? (
              <DemoCardPage
                fact={outgoing.fact}
                choices={outgoing.choices}
                language={language}
                onChoose={() => undefined}
                instant
              />
            ) : null}
          </div>
        )}

        {/* thinking veil while the (simulated) answer beat is in flight */}
        {asking ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[rgba(247,244,236,0.72)]">
            <span className="font-display text-[22px] text-[#5a7178]">{t.thinking}…</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
