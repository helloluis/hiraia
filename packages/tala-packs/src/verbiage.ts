/**
 * Learner-facing wording checks: Hiraia's existing student-text rules (docs/tala/teaching-packs/VERBIAGE-RULES.md),
 * measured on every slide in both languages. Deterministic heuristics; recorded in the pack's review record.
 */
import type { PackLang, Slide, WeeklyPackContent } from '@hiraia/tala-core/contracts';

export const VERBIAGE_VERSION = 'verbiage/1';

export interface VerbiageResult {
  rulesVersion: string;
  state: 'pass' | 'warn' | 'fail';
  metrics: {
    slides: number;
    maxWordsOnSlide: number;
    slidesOver48Words: number;
    avgSentenceWords: number;
    maxSentenceWords: number;
    englishFunctionShare: number | null;
    filipinoFunctionShare: number | null;
  };
  findings: string[];
  /** Fail-level findings only: fed to the review loop as issues to fix. Not stored in the review record. */
  failures: string[];
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const sentences = (s: string) =>
  s
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => x.trim())
    .filter((x) => words(x).length > 0);

/** Function words only: a single English science noun in a Filipino sentence is normal Taglish (S1). */
const EN_FUNCTION = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'of', 'to', 'in', 'on', 'and', 'or', 'with', 'that', 'this', 'these', 'those', 'it', 'its', 'you', 'your', 'we', 'our', 'they', 'their', 'what', 'which', 'how', 'why', 'when', 'where', 'can', 'do', 'does', 'has', 'have', 'from', 'by', 'for', 'be', 'into', 'there']);
// "at" (Filipino "and") and "may" (English modal) belong to both languages and are not counted.
const FIL_FUNCTION = new Set(['ang', 'ng', 'mga', 'sa', 'ay', 'na', 'si', 'ni', 'kay', 'ito', 'iyan', 'iyon', 'ano', 'bakit', 'paano', 'kapag', 'dahil', 'para', 'hindi', 'mayroon', 'natin', 'nating', 'ninyo', 'tayo', 'kayo', 'sila']);

const learnerText = (s: Slide) => [s.title, ...s.lines, ...s.choices].join(' ');

export function checkVerbiage(pack: WeeklyPackContent): VerbiageResult {
  const lang: PackLang = pack.language;
  const elementary = Number(pack.grade) <= 6;
  const avgLimit = elementary ? 14 : 18;
  const avgFail = elementary ? 20 : 25;
  const maxLimit = elementary ? 22 : 28;
  const findings: string[] = [];
  const failures: string[] = [];
  let fail = false;
  let warn = false;
  const shown = pack.slides.filter((s) => s.kind !== 'credits');

  let maxWords = 0;
  let over48 = 0;
  for (const s of shown) {
    const n = words(learnerText(s)).length;
    maxWords = Math.max(maxWords, n);
    if (n > 60) {
      fail = true;
      findings.push(`${s.id}: ${n} words on the slide (Hiraia cards stop at 48)`);
      failures.push(`${s.id}: ${n} words on one slide; a child can read at most about 48 — cut it to the essentials or move detail to the notes`);
    } else if (n > 48) {
      over48 += 1;
      warn = true;
      findings.push(`${s.id}: ${n} words on the slide (Hiraia cards stop at 48)`);
    }
    if (words(s.title).length > 8 || /;/.test(s.title)) {
      warn = true;
      findings.push(`${s.id}: title "${s.title}" is long for a child (≤ 8 words, no semicolon)`);
    }
    if (/\b(degrees? celsius|centimet(er|re)s?|percent|sentimetro|porsiyento)\b/i.test(learnerText(s))) {
      warn = true;
      findings.push(`${s.id}: write the numeral and unit symbol (°C, cm, %) rather than the spelled-out unit`);
    }
  }

  const sents = shown.flatMap((s) => [...s.lines, ...s.choices].flatMap(sentences)).concat(shown.map((s) => s.title));
  const lens = sents.map((x) => words(x).length);
  const avg = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const maxSent = Math.max(0, ...lens);
  if (avg > avgFail) {
    fail = true;
    findings.push(`average sentence on slides is ${avg.toFixed(1)} words (limit ${avgLimit} for Grade ${pack.grade})`);
    failures.push(`slide sentences average ${avg.toFixed(1)} words; Grade ${pack.grade} needs about ${avgLimit} or fewer`);
  } else if (avg > avgLimit) {
    warn = true;
    findings.push(`average sentence on slides is ${avg.toFixed(1)} words (limit ${avgLimit} for Grade ${pack.grade})`);
  }
  if (maxSent > maxLimit) {
    warn = true;
    const longest = sents[lens.indexOf(maxSent)] ?? '';
    findings.push(`longest slide sentence has ${maxSent} words: "${longest.slice(0, 80)}…"`);
  }

  // Check → reveal: the question is the hook and no longer than its answer (S6).
  for (const [i, s] of pack.slides.entries()) {
    const next = pack.slides[i + 1];
    if (s.kind === 'check' && next?.kind === 'reveal' && next.lines.length) {
      const q = words([s.title, ...s.lines].join(' ')).length;
      const a = words(next.lines.join(' ')).length;
      if (q > a + 8) {
        warn = true;
        findings.push(`${s.id}: the question (${q} words) is much longer than its answer (${a} words)`);
      }
    }
  }

  // Language drift on learner-facing text (S7). Single English science words are fine in Filipino (S1).
  const tokens = shown.flatMap((s) => words(learnerText(s).toLowerCase().replace(/[^\p{L}\s'-]/gu, ' ')));
  const share = (set: Set<string>) => (tokens.length ? tokens.filter((w) => set.has(w)).length / tokens.length : 0);
  const en = share(EN_FUNCTION);
  const fil = share(FIL_FUNCTION);
  if (lang === 'fil') {
    if (en > 0.3) {
      fail = true;
      findings.push(`Filipino slides read as English sentences (${(en * 100).toFixed(0)}% English function words)`);
      failures.push(`Filipino slides read as English sentences (${(en * 100).toFixed(0)}% English function words)`);
    } else if (en > 0.15) {
      warn = true;
      findings.push(`Filipino slides drift into English sentences (${(en * 100).toFixed(0)}% English function words; Taglish science words are fine)`);
    }
  } else if (fil > 0.03) {
    warn = true;
    findings.push(`English slides contain Filipino sentences (${(fil * 100).toFixed(0)}% Filipino function words)`);
  }

  return {
    rulesVersion: VERBIAGE_VERSION,
    state: fail ? 'fail' : warn ? 'warn' : 'pass',
    metrics: {
      slides: shown.length,
      maxWordsOnSlide: maxWords,
      slidesOver48Words: over48,
      avgSentenceWords: Number(avg.toFixed(1)),
      maxSentenceWords: maxSent,
      englishFunctionShare: lang === 'fil' ? Number(en.toFixed(3)) : null,
      filipinoFunctionShare: lang === 'en' ? Number(fil.toFixed(3)) : null,
    },
    findings: findings.slice(0, 40),
    failures,
  };
}
