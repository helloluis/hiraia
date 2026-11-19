/**
 * Teacher-facing prose, lightly marked up for scanning (pure; no React). The words are never changed:
 *  - `say`: a whole spoken sentence in quotes ('Have you seen one of these at home?'), so a teacher can find
 *    what to say at a glance. Only quoted text that ends with sentence punctuation counts; a quoted single word
 *    ('push'), an apostrophe (learners' ideas, 'yung) or an unclosed quote stays ordinary text.
 *  - `aside`: text in square brackets ([Expected: …]) — expected answers and stage directions.
 */
export interface ProseSegment {
  kind: 'text' | 'say' | 'aside';
  text: string;
}

const OPEN_BEFORE = /[\s([:—–]/;
const END_PUNCT = /[.?!…]/;
const WORD = /[\p{L}\p{N}]/u;
const MAX_SAY = 520;
const MAX_ASIDE = 320;

export function segmentProse(text: string): ProseSegment[] {
  const out: ProseSegment[] = [];
  let plain = '';
  const flush = () => {
    if (plain) out.push({ kind: 'text', text: plain });
    plain = '';
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '[') {
      const end = text.indexOf(']', i + 1);
      if (end > i && end - i <= MAX_ASIDE && !text.slice(i + 1, end).includes('[')) {
        flush();
        out.push({ kind: 'aside', text: text.slice(i, end + 1) });
        i = end + 1;
        continue;
      }
    }
    const close = ch === "'" ? "'" : ch === '"' ? '"' : ch === '‘' ? '’' : ch === '“' ? '”' : null;
    if (close && (i === 0 || OPEN_BEFORE.test(text[i - 1]!)) && i + 1 < text.length && !/\s/.test(text[i + 1]!)) {
      let end = -1;
      for (let j = i + 2; j < text.length && j - i <= MAX_SAY; j++) {
        if (text[j] !== close) continue;
        const after = text[j + 1];
        if (after !== undefined && WORD.test(after)) {
          // An apostrophe inside a word (don't) is fine; another quote OPENING here means the first one was a
          // quoted title or word, not speech: stop, so two separate quotes are never joined into one span.
          if (OPEN_BEFORE.test(text[j - 1]!)) break;
          continue;
        }
        if (END_PUNCT.test(text[j - 1]!)) {
          end = j;
          break;
        }
        if (close !== "'") break; // a double or curly quote that closes without sentence punctuation: not speech
      }
      if (end > 0 && /\s/.test(text.slice(i + 1, end))) {
        flush();
        out.push({ kind: 'say', text: text.slice(i, end + 1) });
        i = end + 1;
        continue;
      }
    }
    plain += ch;
    i += 1;
  }
  flush();
  return out;
}

/** The first sentence of a paragraph, when it is short enough to stand as a headline; else null. */
export function leadSentence(text: string, max = 150): { lead: string; rest: string } | null {
  const m = text.match(/^(.{20,}?[.!?])\s+(?=\p{Lu})/u);
  if (!m || m[1]!.length > max) return null;
  return { lead: m[1]!, rest: text.slice(m[0].length) };
}
