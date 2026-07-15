/**
 * Reward-card content for the question-cards feed. The card periodically celebrates how
 * much the kid just learned and names a few recent topics. The warm sentence is LLM-
 * generated when the (lazily, background-warmed) model is ready; otherwise a deterministic
 * TEMPLATE is used. Either way the topic NAMES come from the kid's real view-log (data),
 * never the model — so the reward can't fabricate what they "learned".
 */
import type { Language } from '@hiraia/shared';

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

const HEAD: Record<Language, string> = {
  tagalog: 'Ang galing mo! 🌟',
  english: 'Wow, great job! 🌟',
  cebuano: 'Maayo kaayo! 🌟',
};
const LEARNED: Record<Language, (n: number) => string> = {
  tagalog: (n) => `Natutunan mo ang tungkol sa`,
  english: () => `You just learned about`,
  cebuano: () => `Nakat-on ka bahin sa`,
};
const PAGES: Record<Language, (n: number) => string> = {
  tagalog: (n) => `${n} pahina na ang nabasa mo!`,
  english: (n) => `That's ${n} pages already!`,
  cebuano: (n) => `${n} na ka panid ang imong nabasa!`,
};

/** Deterministic, always-safe reward text (fallback + first-run). */
export function templateReward(
  topics: string[],
  count: number,
  minutes: number,
  language: Language
): RewardContent {
  const lang = language ?? 'tagalog';
  const named = topics.slice(0, 3);
  const list = named.length
    ? named.join(language === 'english' ? ', ' : ', ') + (named.length > 1 ? '' : '')
    : '';
  const sentence = list
    ? `${LEARNED[lang](count)} ${list}. ${PAGES[lang](count)}`
    : `${PAGES[lang](count)}`;
  return { text: `${HEAD[lang]} ${sentence}`, topics: named, count, source: 'template', minutes };
}

/**
 * Guard the LLM reward line before it reaches a child. Reject empty / overlong / clearly-
 * off outputs; strip to the first 1-2 sentences. On any doubt the caller uses the template.
 * (The prompt already forbids new facts + the topic names are data-provided, so this is a
 * lightweight backstop, not a content verifier.)
 */
export function sanitizeReward(raw: string): string | null {
  let t = (raw || '').replace(/\s+/g, ' ').trim();
  // drop any leaked role/think scaffolding
  t = t.replace(/<\/?think>/gi, '').replace(/^(assistant|tutor|sagot)\s*:\s*/i, '').trim();
  if (t.length < 12 || t.length > 220) return null;
  // keep the first 1-2 sentences
  const parts = t.split(/(?<=[.!?])\s+/);
  t = parts.slice(0, 2).join(' ').trim();
  if (!t) return null;
  return t;
}
