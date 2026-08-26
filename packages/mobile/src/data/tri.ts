/**
 * The trilingual string type and its language picker — MOVED VERBATIM from data/quiz.ts.
 *
 * It lives apart from that module on purpose. QuestionPage — the card feed's interject,
 * which is very much alive — needed only `localize`, but importing it from quiz.ts pulled
 * that module's top-level `import bankJson from './quiz-bank.json'` along with it, bundling
 * 2.2 MB of practice-quiz data into every APK. Quiz mode is archived and unreachable, so
 * that payload is pure weight — and unwiring the UI alone would NOT have dropped it: Metro
 * keeps whatever is reachable, and quiz.ts stayed reachable through this one function.
 *
 * The behaviour is copied exactly, trim and all. Paraphrasing it would have quietly changed
 * the feed's language fallback, which is not a thing to change as a side effect of a
 * bundle-size cleanup.
 */
import type { Language } from '@hiraia/shared';

export type Tri = { en?: string; tl?: string; bis?: string };

/** Per-language fallback order for picking a trilingual string (mirrors factoids.ts). */
const FALLBACK: Record<Language, Array<keyof Tri>> = {
  tagalog: ['tl', 'en', 'bis'],
  english: ['en', 'tl', 'bis'],
  cebuano: ['bis', 'tl', 'en'],
};

export function localize(tri: Tri | undefined, language: Language): string {
  for (const k of FALLBACK[language] ?? FALLBACK.tagalog) {
    const v = tri?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}
