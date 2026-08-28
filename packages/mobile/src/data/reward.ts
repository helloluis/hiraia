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
    // Dedupe on the bare noun phrase: card titles differ by an article or a plural marker far more
    // often than by meaning ("Kulay Babala" / "Mga Kulay Babala"), and two near-identical chips in a
    // three-chip recap read as a bug.
    const key = t
      .toLowerCase()
      .replace(/^(mga|ang|ang mga|si|sina|the|a|an)\s+/u, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    if (t.length < 3 || !key || seen.has(key)) continue;
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
const PAGES: Record<Language, (n: number) => string> = {
  tagalog: (n) => `${n} pahina na ang nabasa mo.`,
  english: (n) => `That is ${n} pages so far.`,
  cebuano: (n) => `${n} na ka panid ang imong nabasa.`,
};
// The topics are PRINTED BELOW as their own chips, in the reader's language. The sentence must
// never splice them inline: a card's stored label is often an English phrase, and dropping it into
// a Tagalog clause ("Natutunan mo ang tungkol sa Mainly males grow the large sail") reads as
// nonsense. So the sentence counts pages and hands off to the list.
const RECAP: Record<Language, string> = {
  tagalog: 'Heto ang mga huling binasa mo:',
  english: 'Here is what you just read:',
  cebuano: 'Kini ang imong bag-o lang nabasa:',
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
  const sentence = named.length ? `${PAGES[lang](count)} ${RECAP[lang]}` : PAGES[lang](count);
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
