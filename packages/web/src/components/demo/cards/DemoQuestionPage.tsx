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

const GUTTER_LEFT = 58; // stay right of the red margin rule

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
    <div
      className="relative flex h-full flex-col overflow-y-auto pb-[78px] pr-[26px] pt-2.5"
      style={{ paddingLeft: GUTTER_LEFT }}
    >
      <div className="mb-2.5 -rotate-[1.5deg] font-display text-[24px] text-[#2743a6]">
        {t.questionHeader}
      </div>
      <p className="mb-4 font-hand text-[20px] leading-[29px] text-[#0c343d]">
        {localize(question.q, language)}
      </p>

      {order.map((optIdx, displayIdx) => {
        const isCorrect = displayIdx === correctDisplay;
        const isChosen = displayIdx === selected;
        let cls = 'border-[rgba(12,52,61,0.12)] bg-white';
        let mark = '';
        let markCls = '';
        if (revealed) {
          if (isCorrect) {
            cls = 'border-[#1a7d4b] bg-[#e7f6ec]';
            mark = '✓';
            markCls = 'text-[#1a7d4b]';
          } else if (isChosen) {
            cls = 'border-[#c0392b] bg-[#fdecea]';
            mark = '✗';
            markCls = 'text-[#c0392b]';
          } else {
            cls = 'border-[rgba(12,52,61,0.12)] bg-white opacity-45';
          }
        }
        return (
          <button
            key={displayIdx}
            type="button"
            onClick={() => pickOption(displayIdx)}
            disabled={revealed}
            className={`mb-2.5 flex w-full items-center justify-between rounded-[14px] border-[1.5px] px-3.5 py-3 text-left ${cls}`}
          >
            <span className="font-hand text-[17px] leading-[23px] text-[#0c343d]">
              {localize(question.o[optIdx], language)}
            </span>
            {!!mark && <span className={`ml-2 text-[19px] font-bold ${markCls}`}>{mark}</span>}
          </button>
        );
      })}

      {revealed && (
        <div className="mt-1">
          {gotIt && (
            <div className="mb-1 font-display text-[22px] text-[#1a7d4b]">{t.correct}</div>
          )}
          <p className="font-hand text-[15px] leading-[21px] text-[#5a7178]">
            {localize(question.e, language)}
          </p>
        </div>
      )}

      {revealed && (
        <button
          type="button"
          onClick={onContinue}
          className="absolute bottom-3.5 right-6 rotate-[1.5deg] border-b-[1.5px] border-[#2743a6] pb-px"
        >
          <span className="font-display text-[23px] text-[#2743a6]">
            {t.continueNote} <span className="text-[16px]">⤴</span>
          </span>
        </button>
      )}
    </div>
  );
}
