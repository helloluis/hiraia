'use client';

import { DemoTitleCard } from './DemoTitleCard';
import type { TitleCardContent } from '@/data/titleCard';
import { Wordmark } from '@/components/brand/Wordmark';
import { BrandLoadingScreen } from '@/components/brand/GrowingGlyph';

/**
 * The question-cards feed — WEB DEMO shell, ported from the mobile app's home screen
 * (packages/mobile/src/components/cards/CardFeedScreen.tsx — keep in sync). A laminated
 * mid-century flash card on the dark board: one fact per card, typewriter entry, and
 * the outgoing card peeling up on navigation. Every 4-5 pages the flip is intercepted
 * by one MCQ about a recently-read fact; every 6-10 by a reward recap.
 *
 * The "ask anything" box is the visitor's agency, and it answers for REAL. A confident match
 * in the bundled subset navigates straight to the found card (instant, zero-model, with a
 * "you asked" banner). A miss goes to /api/demo/card, which retrieves from the WHOLE fact bank
 * on the server and comes back with one of three cards — a printed fact card, an honest
 * in-domain gap, or "I'm only a science tutor" — the same three the phone prints on-device.
 * The submit button becomes a progress circle and a thinking veil covers the pad while that is
 * in flight, so it is clear the app is working and the visitor should wait.
 */
import { useEffect, useRef, useState } from 'react';

import { cardCurriculum, loadGradeQ1, warmQuestions, type CardChoice, type CardFact, type CardQuestion } from '@/data/cards';
import { GRADE_OPTIONS, GRADE_WORD } from '@/config/grades';
import type { RewardContent } from '@/data/reward';
import { useCardDemoStore, type FeedResponse } from '@/store/useCardDemoStore';
import { useDemoStore } from '@/store/useDemoStore';

import { LANGUAGE_OPTIONS } from '../onboarding/copy';

import { DemoCardPage } from './DemoCardPage';
import { DemoQuestionPage } from './DemoQuestionPage';
import { DemoResponseCard } from './DemoResponseCard';
import { DemoRewardCard } from './DemoRewardCard';
import { cardStrings } from './strings';

const FLIP_MS = 360;

/** Grade a card is pitched at if onboarding somehow did not set one (the project default). */
const DEMO_DEFAULT_GRADE = 5;

/** What was on the pad for the page being peeled away. */
interface PageSnap {
  titleCard: TitleCardContent | null;
  pageKey: number;
  fact: CardFact | null;
  choices: CardChoice[];
  question: CardQuestion | null;
  reward: RewardContent | null;
  response: FeedResponse | null;
}

export function CardFeedDemo() {
  const language = useDemoStore((s) => s.language) ?? 'tagalog';
  // Onboarding page 2's answer, via useDemoStore. It does two things: it pitches a GENERATED
  // card through /api/demo/card (which clamps it), and it weights the WALK — the store builds
  // a curriculum weigher from it in `hydrate` and every unforced draw goes through it. The
  // inventory is what makes that meaningful: the subset is quota'd by (domain, grade) cell in
  // full-pool proportion, so there is real material at every grade to weight toward.
  const grade = useDemoStore((s) => s.grade) ?? DEMO_DEFAULT_GRADE;
  const setLanguage = useDemoStore((s) => s.setLanguage);
  const setGrade = useDemoStore((s) => s.setGrade);
  const t = cardStrings(language);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const hydrated = useCardDemoStore((s) => s.hydrated);
  const hydrate = useCardDemoStore((s) => s.hydrate);
  const relocale = useCardDemoStore((s) => s.relocale);
  const titleCard = useCardDemoStore(s => s.titleCard);
  const continueAfterTitle = useCardDemoStore(s => s.continueAfterTitle);
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
  const untilQuestion = useCardDemoStore((s) => s.untilQuestion);

  const [history, setHistory] = useState<PageSnap[]>([]);
  const [historyOffset, setHistoryOffset] = useState(0);
  const suppressClick = useRef(false);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const historical = historyOffset > 0 ? history[history.length - 1 - historyOffset] : null;
  const forwardHistory = () => setHistoryOffset(n => Math.max(0, n - 1));
  useEffect(() => {
    setHistoryOffset(0);
    if (!current || question || reward || response) return;
    const snap = { pageKey, fact: current, choices, titleCard, question, reward, response };
    setHistory(old => old.at(-1)?.pageKey === pageKey ? old : [...old, snap].slice(-31));
  }, [pageKey, current, choices, titleCard, question, reward, response]);

  const [queryText, setQueryText] = useState('');
  const submitQuery = () => {
    const q = queryText.trim();
    if (!q) return;
    setQueryText('');
    void ask(q, language, grade);
  };

  useEffect(() => {
    hydrate(language, grade);
    warmQuestions();
    void loadGradeQ1(grade).then(() => relocale(language));
  }, [hydrate, relocale, language, grade]);

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
    lastSnap.current = { pageKey, fact: current, choices, question, reward, response, titleCard };
    if (prev && prev.pageKey !== pageKey) {
      setOutgoing(prev);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => setOutgoing(null), FLIP_MS + 80);
    }
  }, [pageKey, current, choices, question, reward, response, titleCard]);

  useEffect(
    () => () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    },
    []
  );

  if (!hydrated || !current) return <BrandLoadingScreen />;

  const litTicks = Math.max(0, Math.min(5, 5 - untilQuestion));
  const titleUnit = historical?.titleCard ?? titleCard;
  const unit = titleUnit ? { quarter: titleUnit.quarter, label: titleUnit.title[language === 'tagalog' ? 'tl' : language === 'cebuano' ? 'bis' : 'en'] } : !question && !reward && !response ? cardCurriculum(historical?.fact ?? current) : null;

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col bg-[var(--board)] text-[var(--stock)]">
      <div className="demo-chrome">
        <p className="demo-wordmark">
          <Wordmark />
        </p>
        <button type="button" className="demo-profile" onClick={() => setSettingsOpen(true)} aria-label={t.settingsLabel}>
          Guest <svg viewBox="0 0 28 24" width="28" height="24" aria-hidden="true"><circle cx="9" cy="6" r="4" fill="var(--gold)"/><circle cx="20" cy="4" r="4" fill="var(--sage)"/><path d="M2 20q1-10 7-10t8 10M13 18q1-10 7-10t6 10" fill="none" stroke="var(--sage)" strokeWidth="3" strokeLinecap="round"/></svg>
        </button>
      </div>

      <div className="mx-4 mb-2 flex items-center gap-2">
        <form
          className="demo-search flex h-11 min-w-0 flex-1 items-center px-3"
          onSubmit={(e) => {
            e.preventDefault();
            submitQuery();
          }}
        >
          <span className="mr-2 inline-block h-2.5 w-2.5 rotate-45 rounded-[1px] bg-[var(--gold)]" />
          <input
            type="text"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder={t.searchPlaceholder}
            disabled={asking}
            className="min-w-0 flex-1 bg-transparent font-zilla text-[15px] font-medium text-[var(--ink)] outline-none placeholder:text-[var(--olive)]"
          />
          {asking ? (
            <div className="ml-2 h-4 w-4 animate-spin rounded-full border-2 border-[var(--ink)]/30 border-t-[var(--ink)]" />
          ) : (
            <button
              type="submit"
              disabled={!queryText.trim()}
              aria-label="Ask"
              className="demo-send-chip disabled:opacity-30"
            />
          )}
        </form>
        <button
          type="button"
          onClick={() => jumpToRandom(language)}
          aria-label="Jump to a random topic"
          className="demo-grid-btn"
        >
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </button>
      </div>

      {unit ? (
        <div className="demo-ribbon mx-4 mb-2">
          <span className="demo-ribbon-label">
            {t.curriculum}
            {unit.quarter > 0 ? ` · Q${unit.quarter}` : ''}
          </span>
          <span className="demo-ribbon-topic">{unit.label}</span>
        </div>
      ) : null}

      {/* the deck — same 16px inset as the search bar, no fan (it read as a gray smear) */}
      <div className="relative min-h-0 flex-1 px-4 pb-4">
        <div
          onPointerDown={e => { suppressClick.current = false; pointerStart.current = { x: e.clientX, y: e.clientY }; }}
          onPointerCancel={() => { pointerStart.current = null; }}
          onClickCapture={e => { if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); suppressClick.current = false; } }}
          onPointerUp={e => {
            const start = pointerStart.current; pointerStart.current = null;
            if (!start || question || asking) return;
            const bounds = e.currentTarget.closest('.demo-app')!.getBoundingClientRect();
            const dx = e.clientX - start.x, dy = e.clientY - start.y;
            if (start.x <= bounds.left + bounds.width * .2 && e.clientX > bounds.left + bounds.width * .5 && Math.abs(dx) > Math.abs(dy)) {
              suppressClick.current = true;
              setHistoryOffset(n => Math.max(0, Math.min(history.length - 1, n + 1)));
            } else if (Math.max(Math.abs(dx), Math.abs(dy)) > 70) {
              suppressClick.current = true;
              if (historical) forwardHistory();
              else if (titleCard) continueAfterTitle();
              else if (choices[0] && !reward && !response) choose(choices[dx > 0 && choices.length > 1 ? 1 : 0]!, language);
            }
          }}
          className={`mc-card demo-card-pad flex h-full min-h-0 flex-col overflow-hidden ${question ? 'demo-quiz-pad' : ''}`}>
          <div className="mc-keyline" aria-hidden />
          <div className="mc-hole mc-hole-a" aria-hidden />
          <div className="mc-hole mc-hole-b" aria-hidden />
        {/* incoming page — NEVER transformed, so it's always visible + clickable. */}
        <div key={pageKey} className="relative z-[1] min-h-0 flex-1 overflow-hidden">
          {historical ? (
            historical.titleCard ? <DemoTitleCard content={historical.titleCard} language={language} onContinue={forwardHistory} /> :
            <DemoCardPage fact={historical.fact!} choices={historical.choices} language={language} instant onChoose={forwardHistory} />
          ) : titleCard ? (
            <DemoTitleCard content={titleCard} language={language} onContinue={continueAfterTitle} />
          ) : response ? (
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
          {queryBanner && !titleCard && !historical && !response && !reward && !question ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-[2] bg-[var(--gold)] px-3 py-1.5">
              <span className="block truncate font-zilla text-[12px] font-bold italic text-[var(--ink)]">
                {t.yourQuestion}: “{queryBanner}”
              </span>
            </div>
          ) : null}
        </div>

        {outgoing && (
          <div className="demo-page-peel pointer-events-none absolute inset-0 z-[2] bg-[var(--stock)]">
            {outgoing.titleCard ? <DemoTitleCard content={outgoing.titleCard} language={language} onContinue={() => undefined} /> : outgoing.fact && !outgoing.question && !outgoing.reward && !outgoing.response ? (
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

        {asking ? (
          <div className="pointer-events-none absolute inset-0 z-[3] flex items-center justify-center bg-[var(--stock)]/80">
            <span className="font-zilla text-[20px] font-bold text-[var(--ink)]">{t.thinking}…</span>
          </div>
        ) : null}

          <div className="mc-card-meter" aria-hidden>
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i} className={i < litTicks ? 'on' : ''} />
            ))}
            <em>{pagesRead}</em>
          </div>
        </div>
      </div>

      <div className="demo-caption">
        <button type="button" aria-label="Previous card" disabled={!!question || historyOffset >= history.length - 1} onClick={() => setHistoryOffset(n => Math.min(history.length - 1, n + 1))}>←</button>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label={t.settingsLabel}
          className="demo-gear"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm8.1 3.1-1.7-.3a6.8 6.8 0 0 0-.7-1.6l1-1.4-1.5-1.5-1.4 1a6.8 6.8 0 0 0-1.6-.7l-.3-1.7h-2.2l-.3 1.7a6.8 6.8 0 0 0-1.6.7l-1.4-1-1.5 1.5 1 1.4a6.8 6.8 0 0 0-.7 1.6l-1.7.3v2.2l1.7.3c.1.6.4 1.1.7 1.6l-1 1.4 1.5 1.5 1.4-1c.5.3 1 .6 1.6.7l.3 1.7h2.2l.3-1.7c.6-.1 1.1-.4 1.6-.7l1.4 1 1.5-1.5-1-1.4c.3-.5.6-1 .7-1.6l1.7-.3v-2.2Z"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="demo-caption-grade"
        >
          {GRADE_WORD[language]} {grade}

        </button>
        <span className="demo-caption-score">✓ {correctCount}</span>
      </div>

      {settingsOpen && (
        <div className="demo-settings" role="dialog" aria-label={t.settingsLabel}>
          <button
            type="button"
            className="demo-settings-scrim"
            aria-label="Close"
            onClick={() => setSettingsOpen(false)}
          />
          <div className="demo-settings-sheet">
            <p className="mc-label mb-2 text-[10px] text-[var(--olive)]">{t.languageLabel}</p>
            <div className="mb-4 grid grid-cols-3 gap-2">
              {LANGUAGE_OPTIONS.map((o) => (
                <button
                  key={o.lang}
                  type="button"
                  onClick={() => setLanguage(o.lang)}
                  className={`rounded-[12px] border-[3px] border-[var(--ink)] px-2 py-2 font-zilla text-[14px] font-bold ${
                    o.lang === language ? 'bg-[var(--ink)] text-[var(--stock)]' : 'bg-[var(--stock)] text-[var(--ink)]'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="mc-label mb-2 text-[10px] text-[var(--olive)]">{GRADE_WORD[language]}</p>
            <div className="grid grid-cols-4 gap-2">
              {GRADE_OPTIONS.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGrade(g)}
                  className={`rounded-[12px] border-[3px] border-[var(--ink)] px-2 py-2 font-zilla text-[14px] font-bold ${
                    g === grade ? 'bg-[var(--ink)] text-[var(--stock)]' : 'bg-[var(--stock)] text-[var(--ink)]'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
