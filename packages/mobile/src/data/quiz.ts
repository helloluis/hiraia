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
  c?: number; // concept cluster id (LaBSE-clustered per topic) — within-round de-dup key
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

/** Max hard (difficulty 2) questions allowed in a single round — keep it grade-5-kind. */
const MAX_HARD_PER_ROUND = 2;

const shuffle = <T,>(arr: T[]): T[] => [...arr].sort(() => Math.random() - 0.5);

/**
 * Build a round of `count` questions for a topic:
 *  - prefer UNSEEN questions (soft no-repeat for replayability), falling back to
 *    already-seen ones only to fill a thin pool;
 *  - de-dup by CONCEPT (`c`, the LaBSE concept-cluster id from
 *    cluster-quiz-concepts.py) so one round never serves two different facts that
 *    test the same idea (e.g. two "which metals does a magnet attract" questions);
 *  - cap HARD (difficulty 2) questions at MAX_HARD_PER_ROUND so a round never stacks
 *    trivia a struggling grade-5 reader can't reach;
 *  - return them ordered EASY → HARD, so each round opens gently and ends with the
 *    hardest 1-2 (difficulty is the hidden 0-2 metric).
 *
 * Constraints relax in order (concept-dedup, then hard-cap) only if the pool is too
 * thin to fill `count` — so a small topic still yields a full round.
 */
export function pickQuestions(topic: string, count: number, seen: Set<string>): QuizQuestion[] {
  const pool = BY_TOPIC.get(topic) ?? [];
  if (pool.length === 0) return [];

  // unseen first, then seen as fallback — each group shuffled for variety.
  const ordered = [...shuffle(pool.filter((q) => !seen.has(q.id))), ...shuffle(pool.filter((q) => seen.has(q.id)))];

  const chosen: QuizQuestion[] = [];
  const picked = new Set<string>();
  const usedConcepts = new Set<number>();
  let hard = 0;
  const fill = (dedupeConcept: boolean, capHard: boolean) => {
    for (const q of ordered) {
      if (chosen.length >= count) break;
      if (picked.has(q.id)) continue;
      if (capHard && q.d >= 2 && hard >= MAX_HARD_PER_ROUND) continue;
      if (dedupeConcept && q.c != null && usedConcepts.has(q.c)) continue;
      chosen.push(q);
      picked.add(q.id);
      if (q.d >= 2) hard++;
      if (q.c != null) usedConcepts.add(q.c);
    }
  };
  fill(true, true); // ideal: distinct concepts, hard-capped
  if (chosen.length < count) fill(false, true); // thin pool: allow repeat concepts
  if (chosen.length < count) fill(false, false); // tiny/hard-heavy: allow extra hard too

  // Ramp easy → hard (difficulty asc; equal-difficulty keeps the shuffled order).
  return chosen.sort((a, b) => a.d - b.d);
}
