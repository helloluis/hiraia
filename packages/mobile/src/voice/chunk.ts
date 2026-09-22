/** Speech phrasing before the MMS tokenizer drops punctuation. Pure, offline logic. */
const MAX_CHUNK = 180;
const MAX_FIRST = 90;

export interface SpeechChunk {
  text: string;
  /** Deliberate silence after this phrase, separate from model/synthesis latency. */
  pauseAfterMs: number;
}

export const SPEECH_PAUSE_MS = { comma: 180, clause: 280, sentence: 420 } as const;
const PUNCTUATION = /[,.;:!?…—–]/u;
const CLOSING = /["'”’»\)\]]/u;

function internalPunctuation(text: string, i: number): boolean {
  const mark = text[i];
  // Normally numbers are already expanded by normalizeForSpeech. Keep this helper
  // safe for callers using raw decimals/thousands-separated numbers as well.
  if (
    (mark === '.' || mark === ',') &&
    /\d/.test(text[i - 1] ?? '') &&
    /\d/.test(text[i + 1] ?? '')
  )
    return true;
  if (mark !== '.') return false;
  // Do not pause inside an abbreviation or between a title/initial and its name.
  const token = text.slice(0, i).match(/[^\s]+$/)?.[0] ?? '';
  return /^(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr|St|Fig|vs|e\.g|i\.e|[A-Z]|(?:[A-Z]\.)+[A-Z])$/i.test(token);
}

function pauseFor(marks: string): number {
  if (/[.!?…]/u.test(marks)) return SPEECH_PAUSE_MS.sentence;
  if (/[—–;:]/u.test(marks)) return SPEECH_PAUSE_MS.clause;
  return SPEECH_PAUSE_MS.comma;
}

/**
 * Phrase at commas, dashes and sentence endings BEFORE encoding. Length-only seams
 * carry no extra pause. Hyphens inside words stay intact; numeric ranges/units should
 * be normalized before calling this. Closing quotes belong to the preceding phrase.
 */
export function speechChunks(text: string): SpeechChunk[] {
  const out: SpeechChunk[] = [];
  function append(value: string, pauseAfterMs: number) {
    const phrase = value.trim();
    if (!/[\p{L}\p{N}]/u.test(phrase)) {
      // Repeated/isolated punctuation must not become an extra synthesis request.
      if (out.length && pauseAfterMs)
        out[out.length - 1]!.pauseAfterMs = Math.max(
          out[out.length - 1]!.pauseAfterMs,
          pauseAfterMs
        );
      return;
    }
    let current = '';
    for (const word of phrase.split(/\s+/)) {
      const cap = out.length === 0 ? MAX_FIRST : MAX_CHUNK;
      if (current && current.length + word.length + 1 > cap) {
        out.push({ text: current, pauseAfterMs: 0 });
        current = word;
      } else current = current ? `${current} ${word}` : word;
    }
    if (current) out.push({ text: current, pauseAfterMs });
  }
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (!PUNCTUATION.test(text[i]!) || internalPunctuation(text, i)) continue;
    let end = i + 1;
    while (end < text.length && (PUNCTUATION.test(text[end]!) || CLOSING.test(text[end]!)))
      end += 1;
    append(text.slice(start, end), pauseFor(text.slice(i, end)));
    start = end;
    i = end - 1;
  }
  append(text.slice(start), 0);
  // There is no next phrase to separate at the end of the card.
  if (out.length) out[out.length - 1]!.pauseAfterMs = 0;
  return out;
}

/** Backwards-compatible text-only view for callers that don't play the clips. */
export function chunk(text: string): string[] {
  return speechChunks(text).map((part) => part.text);
}
