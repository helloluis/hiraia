/**
 * Splitting a card into utterances the model can render one at a time.
 *
 * Pure text logic, in its own file so it can be tested without booting React Native —
 * importing the player would drag in expo-audio and the whole RN module graph.
 */

/**
 * The cap is in CHARACTERS because that is what predicts synthesis time; ~180 is about
 * twelve seconds of speech, so no single chunk stalls the start for long.
 */
const MAX_CHUNK = 180;

/** Sentences first, then commas, then spaces — whatever it takes to get under the cap. */
export function chunk(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= MAX_CHUNK) {
      out.push(sentence);
      continue;
    }
    let current = '';
    for (const piece of sentence.split(/(?<=,)\s+|\s+/)) {
      if (current && current.length + piece.length + 1 > MAX_CHUNK) {
        out.push(current);
        current = piece;
      } else {
        current = current ? `${current} ${piece}` : piece;
      }
    }
    if (current) out.push(current);
  }
  return out;
}
