'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Lang } from '@hiraia/tala-core/contracts';
import { en, type StringKey } from './en';
import { fil } from './fil';

export type { StringKey };
export const STRINGS: Record<Lang, Record<StringKey, string>> = { fil, en };
export const DEFAULT_LANG: Lang = 'fil';
const STORAGE_KEY = 'tala.lang';

import { format, type Vars } from './format';
export { format, type Vars };

export function translate(lang: Lang, key: StringKey, vars?: Vars): string {
  return format(STRINGS[lang][key] ?? en[key] ?? key, vars);
}

export function readStoredLang(): Lang {
  if (typeof window === 'undefined') return DEFAULT_LANG;
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === 'en' || v === 'fil' ? v : DEFAULT_LANG;
}

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: StringKey, vars?: Vars) => string;
}
const Ctx = createContext<LangCtx | null>(null);

export function LangProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLangState] = useState<Lang>(initial ?? DEFAULT_LANG);
  useEffect(() => {
    if (!initial) setLangState(readStoredLang());
  }, [initial]);
  useEffect(() => {
    document.documentElement.lang = lang === 'fil' ? 'fil' : 'en';
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* private mode */
    }
  }, []);
  const t = useCallback((key: StringKey, vars?: Vars) => translate(lang, key, vars), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useT(): LangCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useT outside LangProvider');
  return v;
}

/* ---------- dates (Philippine conventions, PRD §14.3) ---------- */

const locale = (lang: Lang) => (lang === 'fil' ? 'fil-PH' : 'en-PH');

export function formatDate(iso: string, lang: Lang, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  try {
    return new Intl.DateTimeFormat(locale(lang), opts).format(new Date(Date.UTC(y, m - 1, d, 12)));
  } catch {
    return iso;
  }
}
export const formatLongDate = (iso: string, lang: Lang) => formatDate(iso, lang, { weekday: 'long', day: 'numeric', month: 'long' });
export const formatWeekday = (iso: string, lang: Lang) => formatDate(iso, lang, { weekday: 'long' });
export function formatTime(iso: string, lang: Lang): string {
  try {
    return new Intl.DateTimeFormat(locale(lang), { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
}
