'use client';

import { useState } from 'react';
import type { LanguageKey } from '@/config/model';
import { useDemoStore } from '@/store/useDemoStore';

/**
 * Web mirror of the mobile first-launch language takeover: the visitor picks
 * Tagalog / Bisaya / English before the (simulated) model warms up. Language is
 * still undecided here, so the framing line is trilingual — same as the app.
 */

interface Option {
  lang: LanguageKey;
  label: string;
  beta: boolean;
}

const OPTIONS: Option[] = [
  { lang: 'tagalog', label: 'Tagalog', beta: false },
  { lang: 'cebuano', label: 'Bisaya', beta: true },
  { lang: 'english', label: 'English', beta: true },
];

export function DemoLanguagePicker() {
  const pickLanguage = useDemoStore((s) => s.pickLanguage);
  const [picked, setPicked] = useState<LanguageKey | null>(null);

  const choose = (lang: LanguageKey) => {
    if (picked) return; // guard against double-tap during the hand-off
    setPicked(lang);
    pickLanguage(lang);
  };

  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-[#fdfdf6] px-8 py-10 notebook-paper">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/hiraia-profile.png"
        alt="Hiraia"
        className="mb-3 h-20 w-20 rounded-full ring-1 ring-[#0c343d]/10"
      />
      <h2 className="font-title text-4xl text-[#0c343d]">Hiraia</h2>
      <p className="mb-9 mt-3 whitespace-pre-line text-center font-display text-xl leading-8 text-[#0c343d]/70">
        {'Piliin ang wika\nPilia ang pinulongan\nChoose your language'}
      </p>

      <div className="flex w-full max-w-sm flex-col gap-3.5">
        {OPTIONS.map((opt) => (
          <button
            key={opt.lang}
            type="button"
            onClick={() => choose(opt.lang)}
            disabled={!!picked}
            className={`flex items-center justify-center gap-2.5 rounded-2xl border-2 border-[#0c343d] py-4 transition-colors ${
              picked === opt.lang
                ? 'bg-[#0c343d] text-white'
                : 'bg-white text-[#0c343d] hover:bg-[#0c343d]/5'
            } disabled:cursor-not-allowed`}
          >
            <span className="font-display text-2xl">{opt.label}</span>
            {opt.beta && (
              <span className="rounded-lg bg-[#f3a228] px-2 py-0.5 font-body text-xs text-[#0c343d]">
                beta
              </span>
            )}
          </button>
        ))}
      </div>

      <p className="mt-7 text-center font-body text-sm text-[#0c343d]/60">
        Mababago mo ito mamaya.
      </p>
    </div>
  );
}
