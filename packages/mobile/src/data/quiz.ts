/**
 * Quiz bank loader + topic resolver.
 *
 * src/data/quiz-bank.json is a bundled SAMPLE (~50 questions/topic) of the full
 * verified bank (rag/bank/quiz-bank.jsonl, 9,497 trilingual grade-5 MCQs). The full
 * bank is too large for the JS bundle; the sample gives plenty of replay variety.
 * Regenerate the sample from the source jsonl (see scripts / the build step).
 *
 * Questions are PRE-VERIFIED (correctness + single-answer checked, difficulty-scored
 * offline). The on-device model is NOT in the quiz loop — everything here is rendered
 * deterministically. Distractor order is shuffled at RENDER time (see quizStore), so
 * the stored `a` (answer index) stays canonical and "memorize the letter" fails.
 */
import type { Language } from '@hiraia/shared';

import bankJson from './quiz-bank.json';

export type Tri = { en?: string; tl?: string; bis?: string };

export interface QuizQuestion {
  id: string;
  t: string; // quizTopic
  q: Tri;
  o: Tri[]; // options (canonical order)
  a: number; // index of the correct option in `o`
  e: Tri; // explanation
  d: number; // hidden difficulty 0-2
}

export interface QuizTopic {
  topic: string;
  domain: string;
  count: number;
}

interface QuizBank {
  aliases: Record<string, string>;
  topics: QuizTopic[];
  questions: QuizQuestion[];
}

const BANK = bankJson as unknown as QuizBank;

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

const BY_TOPIC = new Map<string, QuizQuestion[]>();
for (const q of BANK.questions) {
  const arr = BY_TOPIC.get(q.t) ?? [];
  arr.push(q);
  BY_TOPIC.set(q.t, arr);
}

/** Supported topics (with in-sample counts), biggest first — used for suggestion chips. */
export const TOPICS: QuizTopic[] = BANK.topics.filter((t) => BY_TOPIC.has(t.topic));

/**
 * Resolve a kid's freeform topic ("dinosaur", "mga halaman", "space") to a canonical
 * quizTopic, or null if unsupported. Offline heuristic (alias map → topic-name match →
 * word overlap). A learned/embedding resolver can replace this later.
 */
export function resolveTopic(input: string): string | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  // 1. alias map (kid terms → canonical topic)
  for (const [alias, topic] of Object.entries(BANK.aliases)) {
    if ((s === alias || s.includes(alias)) && BY_TOPIC.has(topic)) return topic;
  }
  // 2. topic-name substring, either direction (e.g. "animals" ⊂ "Animals")
  for (const t of BY_TOPIC.keys()) {
    const tl = t.toLowerCase();
    const head = (tl.split(' &')[0] ?? tl).split(',')[0]?.trim() ?? '';
    if (tl.includes(s) || (head.length > 2 && s.includes(head))) return t;
  }
  // 3. shared significant word
  const words = s.split(/[^a-z]+/).filter((w) => w.length > 2);
  for (const t of BY_TOPIC.keys()) {
    const tw = new Set(t.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2));
    if (words.some((w) => tw.has(w))) return t;
  }
  return null;
}

/**
 * Pick `count` questions for a topic, preferring ones not in `seen` (soft no-repeat
 * for replayability). Falls back to the full pool when the unseen pool is too thin.
 */
export function pickQuestions(topic: string, count: number, seen: Set<string>): QuizQuestion[] {
  const pool = BY_TOPIC.get(topic) ?? [];
  if (pool.length === 0) return [];
  const unseen = pool.filter((q) => !seen.has(q.id));
  const src = unseen.length >= count ? unseen : pool;
  const shuffled = [...src].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}
