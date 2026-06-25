import { create } from 'zustand';

import type { Language } from '@hiraia/shared';

import { localize, pickQuestions, resolveTopic, type QuizQuestion } from '../data/quiz';
import { useChatStore } from './chatStore';
import { useEngineStore } from './engineStore';

export const QUESTIONS_PER_QUIZ = 5;
export const SECONDS_PER_QUESTION = 15;

interface AnswerLog {
  question: string;
  chosen: string | null; // null = ran out of time
  correct: string;
  isCorrect: boolean;
}

interface QuizState {
  active: boolean;
  phase: 'topic' | 'playing' | 'result';
  topic: string | null;
  unsupported: boolean;
  questions: QuizQuestion[];
  index: number;
  /** Render-time shuffle of the current question's option indices (so "memorize the letter" fails). */
  order: number[];
  /** Display index the kid tapped (null = not yet / timed out). */
  selected: number | null;
  revealed: boolean;
  correctCount: number;
  log: AnswerLog[];
  /** In-memory seen-question set (soft no-repeat across rounds this session). */
  seen: Set<string>;

  open: () => void;
  submitTopic: (input: string) => void;
  clearUnsupported: () => void;
  selectOption: (displayIdx: number | null) => void;
  next: () => void;
  restart: () => void;
  exit: () => Promise<void>;
}

function shuffleOrder(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

const RECAP: Record<Language, { quiz: string; score: string; you: string }> = {
  tagalog: { quiz: 'Pagsusulit', score: 'Iskor', you: 'sagot mo' },
  english: { quiz: 'Quiz', score: 'Score', you: 'you' },
  cebuano: { quiz: 'Pagsulay', score: 'Iskor', you: 'tubag nimo' },
};

function buildRecap(topic: string, correct: number, log: AnswerLog[], lang: Language): string {
  const L = RECAP[lang] ?? RECAP.tagalog;
  const lines = log.map((l, i) => {
    const head = `${i + 1}. ${l.question}`;
    const ans = l.isCorrect
      ? `✅ ${l.correct}`
      : `❌ ${l.chosen ? `${l.chosen} → ` : ''}${l.correct}`;
    return `${head}\n${ans}`;
  });
  return `📝 ${L.quiz}: ${topic} — ${L.score}: ${correct}/${log.length}\n\n${lines.join('\n\n')}`;
}

const BLANK = {
  phase: 'topic' as const,
  topic: null,
  unsupported: false,
  questions: [] as QuizQuestion[],
  index: 0,
  order: [] as number[],
  selected: null as number | null,
  revealed: false,
  correctCount: 0,
  log: [] as AnswerLog[],
};

function startRound(topic: string, seen: Set<string>) {
  const qs = pickQuestions(topic, QUESTIONS_PER_QUIZ, seen);
  qs.forEach((q) => seen.add(q.id));
  return {
    topic,
    unsupported: false,
    questions: qs,
    index: 0,
    order: shuffleOrder(qs[0]?.o.length ?? 4),
    selected: null,
    revealed: false,
    correctCount: 0,
    log: [] as AnswerLog[],
    phase: 'playing' as const,
  };
}

export const useQuizStore = create<QuizState>()((set, get) => ({
  active: false,
  ...BLANK,
  seen: new Set<string>(),

  open: () => set({ active: true, ...BLANK }),

  submitTopic: (input) => {
    const topic = resolveTopic(input);
    if (!topic) {
      set({ unsupported: true });
      return;
    }
    set(startRound(topic, get().seen));
  },

  clearUnsupported: () => set({ unsupported: false }),

  selectOption: (displayIdx) => {
    if (get().revealed) return;
    const { questions, index, order } = get();
    const q = questions[index];
    if (!q) return;
    const lang = useEngineStore.getState().language ?? 'tagalog';
    const correctDisplay = order.indexOf(q.a);
    const isCorrect = displayIdx === correctDisplay;
    const chosen = displayIdx == null ? null : localize(q.o[order[displayIdx]!], lang);
    set((s) => ({
      selected: displayIdx,
      revealed: true,
      correctCount: s.correctCount + (isCorrect ? 1 : 0),
      log: [
        ...s.log,
        { question: localize(q.q, lang), chosen, correct: localize(q.o[q.a], lang), isCorrect },
      ],
    }));
  },

  next: () => {
    const { index, questions } = get();
    const ni = index + 1;
    if (ni >= questions.length) {
      set({ phase: 'result' });
      return;
    }
    set({
      index: ni,
      order: shuffleOrder(questions[ni]!.o.length),
      selected: null,
      revealed: false,
    });
  },

  restart: () => {
    const { topic, seen } = get();
    if (!topic) {
      set({ ...BLANK });
      return;
    }
    set(startRound(topic, seen));
  },

  exit: async () => {
    const { log, topic, correctCount } = get();
    if (log.length > 0 && topic) {
      const lang = useEngineStore.getState().language ?? 'tagalog';
      try {
        await useChatStore.getState().addQuizRecap(buildRecap(topic, correctCount, log, lang));
      } catch (e) {
        console.warn('[quiz] recap append failed', e);
      }
    }
    set({ active: false, ...BLANK });
  },
}));
