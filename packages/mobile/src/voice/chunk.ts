/**
 * Splitting a card into utterances the model can render one at a time.
 *
 * Pure text logic, in its own file so it can be tested without booting React Native —
 * importing the player would drag in expo-audio and the whole RN module graph.
 */

/**
 * The caps are in CHARACTERS because that is what predicts synthesis time.
 *
 * The FIRST chunk gets a much lower cap than the rest: nothing sounds until it is
 * rendered, so its length IS the time-to-first-sound, while every later chunk renders
 * during earlier playback and only needs to keep ahead. A long opening sentence is split
 * at a comma (or a space) and the seam lands between two already-prepared players, which
 * is a far smaller cost than seconds of silence after the tap.
 */
const MAX_CHUNK = 180;
const MAX_FIRST = 90;

/** Sentences first, then commas, then spaces — whatever it takes to get under the cap. */
export function chunk(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const sentence of sentences) {
    const cap = () => (out.length === 0 ? MAX_FIRST : MAX_CHUNK);
    if (sentence.length <= cap()) {
      out.push(sentence);
      continue;
    }
    let current = '';
    for (const piece of sentence.split(/(?<=,)\s+|\s+/)) {
      if (current && current.length + piece.length + 1 > cap()) {
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
