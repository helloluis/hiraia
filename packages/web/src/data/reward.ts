/**
 * Reward-card content for the question-cards feed — WEB DEMO port of
 * packages/mobile/src/data/reward.ts (keep the two in sync). The web demo has no
 * on-device model, so the reward is ALWAYS the deterministic template; either way the
 * topic NAMES come from the visitor's real view-log (data), so the card can't
 * fabricate what they "learned".
 */
import type { LanguageKey } from '@/config/model';

export interface ViewLogEntry {
  factId: string;
  topic: string;
  ts: number;
}

export interface RewardContent {
  text: string;
  topics: string[]; // the real topic labels named (from the view-log)
  count: number; // pages read in the window
  source: 'llm' | 'template';
  minutes: number; // window length, for truthful "in the last N minutes" phrasing
}

/** Distinct, human-ish recent topic labels (most-recent first, deduped, cleaned). */
export function recentTopics(log: ViewLogEntry[], max = 6): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = log.length - 1; i >= 0 && out.length < max; i--) {
    const t = (log[i]!.topic || '').trim();
    const key = t.toLowerCase();
    if (t.length < 3 || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

const HEAD: Record<LanguageKey, string> = {
  tagalog: 'Ang galing mo! 🌟',
  english: 'Wow, great job! 🌟',
  cebuano: 'Maayo kaayo! 🌟',
};
const LEARNED: Record<LanguageKey, (n: number) => string> = {
  tagalog: () => `Natutunan mo ang tungkol sa`,
  english: () => `You just learned about`,
  cebuano: () => `Nakat-on ka bahin sa`,
};
const PAGES: Record<LanguageKey, (n: number) => string> = {
  tagalog: (n) => `${n} pahina na ang nabasa mo!`,
  english: (n) => `That's ${n} pages already!`,
  cebuano: (n) => `${n} na ka panid ang imong nabasa!`,
};

/** Deterministic, always-safe reward text. */
export function templateReward(
  topics: string[],
  count: number,
  minutes: number,
  language: LanguageKey
): RewardContent {
  const lang = language ?? 'tagalog';
  const named = topics.slice(0, 3);
  const list = named.length ? named.join(', ') : '';
  const sentence = list
    ? `${LEARNED[lang](count)} ${list}. ${PAGES[lang](count)}`
    : `${PAGES[lang](count)}`;
  return { text: `${HEAD[lang]} ${sentence}`, topics: named, count, source: 'template', minutes };
}
