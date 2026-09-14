/**
 * The MMS-VITS character tokenizer, in plain TypeScript.
 *
 * This is the whole reason the bundled voices need no native tokenizer and no espeak
 * data: MMS models are character-level. A vocabulary of ~44 symbols maps text straight
 * to model ids — Piper-style voices would instead need espeak-ng's phonemizer and its
 * ~15 MB of language data compiled in.
 *
 * Three details from the checkpoint's `tokenizer_config.json` are load-bearing; each
 * one silently ruins the audio rather than throwing if it is wrong:
 *
 *  * the pad token is a NORMAL LETTER at id 0, and WHICH letter differs per language —
 *    "a" in Tagalog, "k" in English. Only the id is stable, so the pad must be taken
 *    from the vocabulary rather than hardcoded; hardcoding "a" silently interleaves a
 *    real letter between every character of an English word.
 *  * `add_blank` interleaves that pad id before, between and after every token.
 *  * `normalize` lowercases and DROPS anything outside the vocabulary. There is no
 *    punctuation in it at all, so "Bakit?" and "Bakit" tokenize identically — the
 *    question intonation has to come from the training data, not the input.
 */

/** symbol -> id, straight out of the voice's `vocab.json`. */
export type Vocab = Readonly<Record<string, number>>;

/**
 * MMS assigns the pad token id 0 in every language — it is the letter that happens to sit
 * first in that language's vocabulary ("a" for Tagalog, "k" for English). Staging asserts
 * exactly one symbol holds it (scripts/voice/package-voices.py).
 */
const PAD_ID = 0;

export function encode(text: string, vocab: Vocab): number[] {
  const pad = PAD_ID;
  const ids: number[] = [];
  for (const ch of text.toLowerCase()) {
    const id = vocab[ch];
    if (id !== undefined) ids.push(id);
  }
  // add_blank: pad, token, pad, token, ... pad
  const seq: number[] = new Array(ids.length * 2 + 1).fill(pad);
  for (let i = 0; i < ids.length; i += 1) seq[i * 2 + 1] = ids[i]!;
  return seq;
}

/** Whether anything in this text is speakable at all (all-digit strings are not). */
export function hasSpeakableText(text: string, vocab: Vocab): boolean {
  for (const ch of text.toLowerCase()) {
    if (ch !== ' ' && vocab[ch] !== undefined) return true;
  }
  return false;
}
