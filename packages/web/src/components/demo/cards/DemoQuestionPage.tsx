'use client';

/**
 * Interject MCQ page of the question-cards feed — WEB DEMO port of the mobile
 * packages/mobile/src/components/cards/QuestionPage.tsx (keep in sync): ONE multiple-
 * choice question about a fact read in the last few pages. Options shuffle at render
 * (canonical answer index stored). After the reveal, a single blue "continue ⤴" note
 * resumes the walk onto the card the visitor had chosen.
 */
import { useMemo, useState } from 'react';

import type { LanguageKey } from '@/config/model';
import { localize, type CardQuestion } from '@/data/cards';

import { cardStrings } from './strings';

const LETTERS = ['A', 'B', 'C', 'D'];

function shuffled(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

interface DemoQuestionPageProps {
  question: CardQuestion;
  language: LanguageKey;
  onAnswer: (correct: boolean) => void;
  onContinue: () => void;
}

export function DemoQuestionPage({ question, language, onAnswer, onContinue }: DemoQuestionPageProps) {
  const t = cardStrings(language);
  const order = useMemo(() => shuffled(question.o.length), [question.f, question.o.length]);
  const [selected, setSelected] = useState<number | null>(null);
  const revealed = selected !== null;
  const correctDisplay = order.indexOf(question.a);
  const gotIt = revealed && selected === correctDisplay;

  const pickOption = (displayIdx: number) => {
    if (revealed) return;
    setSelected(displayIdx);
    onAnswer(displayIdx === correctDisplay);
  };

  return (
    <div className="relative z-[1] flex h-full flex-col overflow-y-auto">
      <div className="mc-band mc-band-gold mb-3">
        <span className="mc-chip">?</span>
        <span className="mc-topic">{t.questionHeader}</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/hiraia-profile.png" alt="" width={26} height={26} className="mc-stamp" />
      </div>
      <p className="mb-4 font-zilla text-[17px] font-bold leading-snug text-[var(--ink)]">
        {localize(question.q, language)}
      </p>

      {order.map((optIdx, displayIdx) => {
        const isCorrect = displayIdx === correctDisplay;
        const isChosen = displayIdx === selected;
        let cls = 'border-[var(--ink)] bg-[var(--stock)]';
        let mark = '';
        if (revealed) {
          if (isCorrect) {
            cls = 'border-[var(--ink)] bg-[var(--gold)]';
            mark = '✓';
          } else if (isChosen) {
            cls = 'border-[var(--accent)] bg-[var(--stock)] opacity-70';
            mark = '✗';
          } else {
            cls = 'border-[var(--ink)]/40 bg-[var(--stock)] opacity-45';
          }
        }
        return (
          <button
            key={displayIdx}
            type="button"
            onClick={() => pickOption(displayIdx)}
            disabled={revealed}
            className={`mb-2 flex w-full items-center gap-3 rounded-[13px] border-[3px] px-3 py-2.5 text-left ${cls}`}
          >
            <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-[var(--ink)] font-slab text-[12px] text-[var(--stock)]">
              {LETTERS[displayIdx] ?? displayIdx + 1}
            </span>
            <span className="flex-1 font-zilla text-[15px] font-medium leading-snug text-[var(--ink)]">
              {localize(question.o[optIdx], language)}
            </span>
            {!!mark && <span className="font-slab text-[16px] text-[var(--ink)]">{mark}</span>}
          </button>
        );
      })}

      {revealed && (
        <div className="mt-1">
          {gotIt && (
            <div className="mb-1 font-zilla text-[18px] font-bold text-[var(--ink)]">{t.correct}</div>
          )}
          <p className="font-zilla text-[14px] font-medium leading-snug text-[var(--olive)]">
            {localize(question.e, language)}
          </p>
        </div>
      )}

      {revealed && (
        <div className="mc-ledge mt-4">
          <button type="button" onClick={onContinue} className="mc-ticket">
            <span className="flex-1">{t.continueNote}</span>
            <span className="mc-arrow" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
