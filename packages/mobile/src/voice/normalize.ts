/**
 * Turning card text into something the voice can actually say.
 *
 * MMS vocabularies are ~40 characters and the tokenizer DROPS everything outside them,
 * silently. So `100°C` reaches the model as `100c`, and `78%` as `78` — and the digits
 * themselves are no better off: the fine-tuning corpus excluded digits outright (a
 * transcript that prints "6" but says "anim" desynchronises training), so those
 * embeddings are whatever the Bible-reading base left behind. 10.7% of the fact bank
 * contains a digit, so this is not a corner.
 *
 * The fix is a front-end: expand numbers and symbols into WORDS the voice was trained on,
 * before anything is tokenized.
 *
 * Numbers are spoken in ENGLISH in every language, deliberately. That is how measurements
 * are said in a Philippine classroom — "one hundred degrees Celsius", not the native
 * numeral — and Tagalog's teen/tens forms carry sandhi (labing-isa, labindalawa,
 * labimpito) that is easy to get subtly wrong. Units and connectives DO use the local
 * word, because those are read in Tagalog.
 */
import type { Language } from '@hiraia/shared';

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen',
];
const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
];
const SCALES: [number, string][] = [
  [1_000_000_000, 'billion'],
  [1_000_000, 'million'],
  [1_000, 'thousand'],
];

function underThousand(n: number): string {
  if (n < 20) return ONES[n]!;
  if (n < 100) {
    const rest = n % 10;
    return rest ? `${TENS[Math.floor(n / 10)]}-${ONES[rest]}` : TENS[Math.floor(n / 10)]!;
  }
  const rest = n % 100;
  const head = `${ONES[Math.floor(n / 100)]} hundred`;
  return rest ? `${head} ${underThousand(rest)}` : head;
}

/** Cardinal words for a non-negative integer. Anything absurd is read digit by digit. */
export function numberToWords(n: number): string {
  if (!Number.isFinite(n)) return '';
  if (n >= 1_000_000_000_000) {
    return String(n)
      .split('')
      .map((d) => ONES[Number(d)] ?? d)
      .join(' ');
  }
  if (n === 0) return 'zero';
  const parts: string[] = [];
  let rest = n;
  for (const [value, name] of SCALES) {
    if (rest >= value) {
      parts.push(`${underThousand(Math.floor(rest / value))} ${name}`);
      rest %= value;
    }
  }
  if (rest) parts.push(underThousand(rest));
  return parts.join(' ');
}

interface Words {
  /** "20-25" */
  readonly range: string;
  readonly percent: string;
  readonly equals: string;
  readonly point: string;
  readonly times: string;
  readonly per: string;
  readonly plus: string;
  readonly minus: string;
}

const WORDS: Record<Language, Words> = {
  tagalog: {
    range: 'hanggang',
    percent: 'porsyento',
    equals: 'katumbas ng',
    point: 'punto',
    times: 'beses',
    per: 'kada',
    plus: 'dagdag',
    minus: 'bawas',
  },
  english: {
    range: 'to',
    percent: 'percent',
    equals: 'equals',
    point: 'point',
    times: 'times',
    per: 'per',
    plus: 'plus',
    minus: 'minus',
  },
  // Cebuano has no voice yet (see engine.ts). These are the words a Cebuano voice would
  // want; they cost nothing to carry and mean the day it lands nothing is missing.
  cebuano: {
    range: 'hangtod',
    percent: 'porsyento',
    equals: 'katumbas sa',
    point: 'punto',
    times: 'ka pilo',
    per: 'kada',
    plus: 'dugang',
    minus: 'kuha',
  },
};

/** A parenthetical that is only numbers, units and operators — e.g. "(6)", "(212°F)". */
const NUMERIC_ASIDE = /\s*\(\s*[\d\s.,:;%°CFKkmg/+×x=–—-]*\d[\d\s.,:;%°CFKkmg/+×x=–—-]*\s*\)/g;

/**
 * Expand a card into speakable words. Order matters: asides go first so their contents are
 * never expanded, ranges before plain numbers so the dash is not read as a minus sign, and
 * numbers last so the unit words they feed into are already in place.
 */
export function normalizeForSpeech(text: string, language: Language): string {
  const w = WORDS[language];
  let s = text;

  // "anim (6) na paa" — the digits are a gloss on a word that was already said.
  s = s.replace(NUMERIC_ASIDE, '');

  // Ranges before anything else, or "20-25" becomes "twenty minus twenty-five".
  s = s.replace(/(\d)\s*[–—-]\s*(?=\d)/g, `$1 ${w.range} `);

  s = s
    .replace(/°\s*C\b/g, ' degrees Celsius')
    .replace(/°\s*F\b/g, ' degrees Fahrenheit')
    .replace(/°/g, ' degrees ')
    .replace(/%/g, ` ${w.percent} `)
    .replace(/\s=\s/g, ` ${w.equals} `)
    .replace(/(\d)\s*[×x]\s*(?=\d)/g, `$1 ${w.times} `)
    .replace(/(\d)\s*\/\s*(?=\d|[a-z])/g, `$1 ${w.per} `)
    .replace(/(\d)\s*\+\s*(?=\d)/g, `$1 ${w.plus} `);

  // Numbers: thousands separators dropped, a decimal read digit by digit after the point
  // ("3.5" is "three point five", never "three point thirty-five").
  s = s.replace(/-?\d[\d,]*(?:\.\d+)?/g, (match) => {
    const negative = match.startsWith('-');
    const [whole, fraction] = match.replace(/^-/, '').replace(/,/g, '').split('.');
    let out = numberToWords(Number(whole));
    if (fraction) {
      out += ` ${w.point} ${fraction.split('').map((d) => ONES[Number(d)]).join(' ')}`;
    }
    return negative ? `${w.minus} ${out}` : out;
  });

  return s
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
