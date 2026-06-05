/**
 * Cold-start factoids — a pre-written "Alam mo ba na…?" card is dropped into the
 * chat on every cold start so the reader has something to look at while the model
 * warms up (~25s). The prose is human-written and verified (NOT model-generated),
 * because the model isn't loaded yet when we show it.
 *
 * src/data/factoids.json is a snapshot of packages/factoids/bank/factoids.json.
 * Regenerate that bank with `pnpm --filter @hiraia/factoids generate` and re-copy.
 */
import type { Language } from '@hiraia/shared';

import bank from './factoids.json';

interface Trilingual {
  tl?: string;
  en?: string;
  ceb?: string;
}

interface Factoid {
  id: string;
  hook: Trilingual;
  body: Trilingual;
  grades?: number[];
}

const FACTOIDS = (bank as { factoids: Factoid[] }).factoids ?? [];

/** Lead-in clause per language; "{x}" is where the hook clause goes. (mirrors compose.mjs) */
const LEAD: Record<Language, string> = {
  tagalog: 'Alam mo ba na {x}?',
  english: 'Did you know that {x}?',
  cebuano: 'Nahibaw-an ba nimo nga {x}?',
};

/** Per-language fallback order for picking a trilingual string. */
const FALLBACK: Record<Language, Array<keyof Trilingual>> = {
  tagalog: ['tl', 'en', 'ceb'],
  english: ['en', 'tl', 'ceb'],
  cebuano: ['ceb', 'tl', 'en'],
};

function pickLang(tri: Trilingual | undefined, language: Language): string {
  for (const key of FALLBACK[language] ?? FALLBACK.tagalog) {
    const v = tri?.[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/** Compose the full "Alam mo ba na {hook}? {body}" text for a factoid. */
function composeText(factoid: Factoid, language: Language): string {
  const hook = pickLang(factoid.hook, language);
  const body = pickLang(factoid.body, language);
  const lead = (LEAD[language] ?? LEAD.tagalog).replace('{x}', hook);
  return body ? `💡 ${lead} ${body}` : `💡 ${lead}`;
}

/**
 * Pick a random factoid and return its composed message text, avoiding `excludeId`
 * (the one shown last cold start) when possible so it doesn't repeat back-to-back.
 * Returns null if the bank is empty.
 */
export function pickFactoidText(
  language: Language,
  excludeId?: string
): { id: string; text: string } | null {
  if (FACTOIDS.length === 0) return null;
  const pool =
    FACTOIDS.length > 1 && excludeId
      ? FACTOIDS.filter((f) => f.id !== excludeId)
      : FACTOIDS;
  const factoid = pool[Math.floor(Math.random() * pool.length)];
  if (!factoid) return null;
  return { id: factoid.id, text: composeText(factoid, language) };
}
