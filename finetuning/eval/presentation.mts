/**
 * Objective "presentation" metrics for a single tutor reply — deterministic, no LLM judge.
 *
 * Encodes v3's training targets so every adapter is measured on them PERMANENTLY, in both
 * eval instruments (harness/run-eval.mts hard gate + capability/run-capability.mts scored
 * benchmark). v3 set out to fix three behaviors; the objective slice of each lives here:
 *
 *   1. Illustration restraint — the tutor self-tags `[image: <english desc>]` so retrieval
 *      shows a picture (the tag is stripped before display). The INVARIANTS: a tag must be
 *      well-formed (non-empty description), at most ONE per reply, and not repeated within a
 *      conversation (v3 over-eager-illustration fix). Malformed / multiple / repeated tags are
 *      always wrong → the gate hard-fails them; the benchmark reports the rates.
 *   2. Engagement — warm, kid-facing replies carry a few emoji (the system prompt says ~1–3)
 *      and use **bold** for key terms. OBJECTIVE part: count emoji + detect spam (> SPAM_MAX)
 *      and detect bold. The *quality* of engagement stays a judge call (naturalness/pedagogy).
 *   3. Endings/persona — whether an ending is natural vs a forced persona-leak is a judge call
 *      (see the `presentation` probe tier + rubric). The only objective slice we flag is a
 *      LANGUAGE leak: an English reply that carries Tagalog/Bisaya persona markers.
 *
 * Keep this the single source of truth — both harnesses import it, so an invariant added here
 * is enforced everywhere at once.
 */

/** `[image: ...]` control token. Global+case-insensitive; capture group = the description. */
export const IMAGE_TAG_RE = /\[image:\s*([^\]]*)\]/gi;
/** Emoji proxy: Unicode Extended_Pictographic (covers the emoji the tutor actually uses). */
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
/** Markdown bold **like this** (non-empty, single-line). */
const BOLD_RE = /\*\*[^*\n]+\*\*/;
/** Emoji count above this in one reply reads as spam (system prompt: "no more than a few"). */
export const EMOJI_SPAM_MAX = 4;

/**
 * Tagalog/Bisaya persona markers that should NOT appear in an English-mode reply (the
 * English "almost perfect except the ending" persona-leak). Deliberately distinctive words
 * (not shared-with-English particles) so an English answer mentioning "sari-sari" or a proper
 * noun doesn't false-positive. Word-boundary matched, lowercased.
 */
const FIL_PERSONA_MARKERS = [
  'ano', 'bakit', 'paano', 'kasi', 'naman', 'talaga', 'ngayon', 'kaya', 'natin', 'tayo',
  'mo', 'ko', 'po', 'opo', 'ba', 'yung', 'ito', 'iyan', 'meron', 'sige', 'hindi', 'wala',
  'unsa', 'ngano', 'kaayo', 'gyud', 'nimo', 'nato', 'kini', 'dili', 'maayong', 'salamat',
];

export interface Presentation {
  /** number of `[image: …]` tags in the reply */
  imageTags: number;
  /** the tag descriptions (trimmed) */
  imageDescs: string[];
  /** every tag has a non-empty description AND there is at most one tag */
  imageWellFormed: boolean;
  /** emoji count */
  emoji: number;
  /** at least one emoji present */
  emojiPresent: boolean;
  /** emoji count exceeds EMOJI_SPAM_MAX */
  emojiSpam: boolean;
  /** uses **bold** at least once */
  bold: boolean;
}

/** Compute objective presentation metrics for one RAW reply (keep the `[image:]` tag in). */
export function presentation(rawReply: string): Presentation {
  const reply = rawReply ?? '';
  const descs: string[] = [];
  for (const m of reply.matchAll(IMAGE_TAG_RE)) descs.push((m[1] ?? '').trim());
  const emoji = (reply.match(EMOJI_RE) ?? []).length;
  return {
    imageTags: descs.length,
    imageDescs: descs,
    imageWellFormed: descs.length <= 1 && descs.every((d) => d.length > 0),
    emoji,
    emojiPresent: emoji > 0,
    emojiSpam: emoji > EMOJI_SPAM_MAX,
    bold: BOLD_RE.test(reply),
  };
}

/**
 * Hard invariants for the regression gate. Returns a list of violation strings (empty = clean).
 * These are ALWAYS wrong regardless of probe — a malformed/duplicate image tag or an emoji
 * storm should never ship. `lang` (optional) enables the English language-leak check.
 */
export function presentationViolations(rawReply: string, lang?: string): string[] {
  const reply = rawReply ?? '';
  const p = presentation(reply);
  const v: string[] = [];
  if (p.imageTags > 1) v.push(`image-tag: ${p.imageTags} tags in one reply (max 1)`);
  if (p.imageDescs.some((d) => d.length === 0)) v.push('image-tag: empty/malformed [image:] description');
  if (p.emojiSpam) v.push(`emoji: ${p.emoji} emoji (spam; max ${EMOJI_SPAM_MAX})`);
  if (lang === 'english' || lang === 'en') {
    const leaked = filPersonaLeak(reply);
    if (leaked.length) v.push(`persona-leak: Filipino markers in an English reply: ${leaked.slice(0, 4).join(', ')}`);
  }
  return v;
}

/** Tagalog/Bisaya persona markers found in an (English-mode) reply. Empty = clean. */
export function filPersonaLeak(reply: string): string[] {
  const words = new Set((reply.toLowerCase().match(/[a-zñ']+/g) ?? []));
  return FIL_PERSONA_MARKERS.filter((m) => words.has(m));
}

/**
 * Cross-turn invariant for multi-turn dialogues: the SAME image (by normalized description)
 * must not be shown twice in one conversation (v3 "don't repeat a picture" fix). Pass the
 * list of per-turn raw tutor replies in order; returns the repeated descriptions (empty = clean).
 */
export function repeatedImagesAcrossTurns(turns: string[]): string[] {
  const seen = new Set<string>();
  const repeated: string[] = [];
  for (const t of turns) {
    for (const m of (t ?? '').matchAll(IMAGE_TAG_RE)) {
      const key = (m[1] ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (!key) continue;
      if (seen.has(key)) repeated.push(key);
      else seen.add(key);
    }
  }
  return repeated;
}
