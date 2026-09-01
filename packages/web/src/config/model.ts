/**
 * Single source of truth for the DEPLOYED model — what the VPS llama-server actually runs.
 *
 * KEEP IN LOCKSTEP WITH `deploy/run-llama-server.sh`: that script is the deployment this
 * file describes, and the two must change in the same change-set. (They drifted once: the
 * VPS moved to the adapter-free Hiraia-2B in d39c0a8be while this file kept describing
 * Sailor2-3B and the route kept sending a `lora` array for adapters the server no longer
 * loaded — harmless against llama.cpp b9430, which ignores unknown adapter ids, but a
 * validating build would 400 every request and the route reads any non-ok upstream as a
 * silent abstain.)
 */

export const MODEL_INFO = {
  /** Friendly display name. */
  displayName: 'Hiraia-2B',
  /** What the model is (subtitle). */
  tagline: 'CPT + full-parameter SFT Qwen3.5-2B · Tagalog · Bisaya · English',
  /** Underlying base architecture. */
  arch: 'Qwen3.5 (CPT’d Filipino)',
  /** Approx parameter count. */
  params: '~2B',
  /** Deployment quantization. */
  quant: 'Q4_K_M',
  /** Base size on disk (GB) — measured: 1,274,396,000 bytes (hiraia-sft-2b-Q4_K_M.gguf). */
  baseSizeGB: 1.27,
  /**
   * Model id sent to the llama.cpp server in the `model` field. Most llama.cpp servers
   * ignore/echo this; kept truthful so logs read right.
   */
  serverModelId: 'hiraia-sft-2b',
  /**
   * The Hiraia-2B is a FULL-PARAMETER SFT: no LoRA adapters exist for it (the v11
   * Tagalog/Bisaya adapters belong to the retired Sailor2 line) and run-llama-server.sh
   * loads none. `loraScalesFor` keys off this so the route omits the `lora` field entirely
   * rather than addressing adapter ids the server never loaded.
   */
  hasAdapters: false,
} as const;

export type LanguageKey = 'english' | 'tagalog' | 'cebuano';

/**
 * Per-language config. `loraId` is the index of the adapter as loaded by the server
 * (`--lora` order). The deployed Hiraia-2B is adapter-free — every loraId is null, and the
 * language lives in the CARD PROMPT (@hiraia/shared buildCardPrompt), not in routing to an
 * adapter. The structure stays for any future adapter-ful deployment.
 */
export const LANGUAGES: Record<LanguageKey, {
  label: string;
  adapterLabel: string;
  loraId: number | null;
}> = {
  english: {
    label: 'English',
    adapterLabel: 'full-parameter SFT (no adapter)',
    loraId: null,
  },
  tagalog: {
    label: 'Tagalog',
    adapterLabel: 'full-parameter SFT (no adapter)',
    loraId: null,
  },
  cebuano: {
    label: 'Cebuano (Bisaya)',
    adapterLabel: 'full-parameter SFT (no adapter)',
    loraId: null,
  },
};

/**
 * Bisaya is descoped for launch (2026-06-12: Tagalog + English first — the
 * Bisaya adapter isn't at shippable quality). While true, detectLanguage never
 * routes to cebuano; obviously-Bisaya messages stay on the fallback (Tagalog
 * adapter — the best available reply quality for them today).
 */
export const CEBUANO_COMING_SOON = true;

/** All adapter ids the server is expected to have loaded (derived from LANGUAGES). */
export const ALL_LORA_IDS: number[] = Object.values(LANGUAGES)
  .map((l) => l.loraId)
  .filter((id): id is number => id !== null);

/**
 * Build the full per-request `lora` scale array for a language: the selected
 * adapter at scale 1.0, every other loaded adapter explicitly at 0.0 (so a
 * server that loaded all adapters at default scale 1.0 doesn't stack them).
 *
 * UNDEFINED — omit the field from the request entirely — when the deployed model declares
 * no adapters (the full-parameter Hiraia-2B; `JSON.stringify` drops an undefined property).
 * Addressing adapter ids the server never loaded is at best ignored (llama.cpp b9430,
 * measured 200-with-a-normal-card) and at worst a 400 on a build that validates per-request
 * ids — which the card route would read as a silent abstain on EVERY ask.
 */
export function loraScalesFor(language: LanguageKey): Array<{ id: number; scale: number }> | undefined {
  if (!MODEL_INFO.hasAdapters || !ALL_LORA_IDS.length) return undefined;
  const active = LANGUAGES[language]?.loraId ?? null;
  return ALL_LORA_IDS.map((id) => ({ id, scale: id === active ? 1.0 : 0.0 }));
}

/**
 * Marker words unique enough to each language to discriminate it from the others.
 * Shared Filipino particles (mga, sa, ang, ako, lang, wala, oo, salamat, pwede,
 * gusto, pero…) are deliberately left out — they'd score both sides equally and
 * add only noise. None of these collide with common English words.
 */
const TAGALOG_MARKERS = new Set([
  'ano', 'anong', 'bakit', 'sino', 'sinong', 'saan', 'paano', 'paanong', 'kailan',
  'ito', 'iyan', 'iyon', 'nito', 'niyan', 'talaga', 'naman', 'kasi', 'hindi', 'huwag',
  'ngayon', 'kahapon', 'bukas', 'ganito', 'ganyan', 'dahil', 'kung', 'kapag', 'dito',
  'doon', 'po', 'opo', 'ho', 'paki', 'magkano', 'ilan', 'meron', 'mayroon', 'nasaan',
  'kumusta', 'ng', 'nang', 'akin', 'iyo', 'kanya', 'atin', 'inyo', 'kanila', 'maganda',
]);
const CEBUANO_MARKERS = new Set([
  'unsa', 'unsay', 'unsaon', 'giunsa', 'ngano', 'kinsa', 'asa', 'naa', 'kini', 'kana',
  'kadto', 'gyud', 'gyod', 'jud', 'kaayo', 'dili', 'og', 'ug', 'nako', 'nimo', 'kanako',
  'kanimo', 'kaniya', 'nindot', 'maayo', 'palihug', 'lagi', 'bitaw', 'karon', 'ganina',
  'ugma', 'gahapon', 'pila', 'tagpila', 'mao', 'ganahan', 'makat-on', 'nakaila', 'kuan',
]);
/**
 * Common English function/question words. Used only to recognise an *obviously*
 * all-English message (so English is a deliberate switch, never the fallback).
 * None of these collide with Tagalog/Cebuano marker words above.
 */
const ENGLISH_MARKERS = new Set([
  'the', 'is', 'are', 'am', 'was', 'were', 'be', 'a', 'an', 'of', 'to', 'in', 'on', 'at',
  'what', 'why', 'how', 'when', 'where', 'who', 'which', 'can', 'could', 'would', 'should',
  'do', 'does', 'did', 'please', 'explain', 'tell', 'about', 'this', 'that', 'these', 'those',
  'and', 'or', 'but', 'with', 'for', 'your', 'you', 'i', 'me', 'my', 'we', 'they', 'it',
  'give', 'show', 'help', 'want', 'need', 'know', 'thanks', 'thank', 'yes', 'okay',
]);

/**
 * Guess the language of a user message so we can pick the matching adapter
 * automatically (no manual selector). Tagalog is the default: we only leave it
 * when the message is *obviously* Cebuano (more Cebuano marker words than
 * Tagalog) or *clearly* all-English (English words and zero Filipino markers).
 * Anything else — mixed text, or a short ambiguous reply like "oo"/"salamat" —
 * sticks to `fallback` so the conversation doesn't flip languages mid-thread.
 */
export function detectLanguage(text: string, fallback: LanguageKey = 'tagalog'): LanguageKey {
  const words = text.toLowerCase().match(/[a-zñ'-]+/g) ?? [];
  let tl = 0;
  let ceb = 0;
  let en = 0;
  for (const w of words) {
    if (TAGALOG_MARKERS.has(w)) tl++;
    if (CEBUANO_MARKERS.has(w)) ceb++;
    if (ENGLISH_MARKERS.has(w)) en++;
  }
  if (ceb > tl) return CEBUANO_COMING_SOON ? fallback : 'cebuano'; // obvious Cebuano (gated while coming soon)
  if (tl > 0) return 'tagalog'; // any Tagalog signal -> Tagalog
  // no Filipino markers: English only if it clearly reads as English, else stay put
  if (ceb === 0 && en > 0) return 'english';
  return fallback;
}

/** Short, truthful stats string. */
export const MODEL_STATS_LINE =
  `${MODEL_INFO.params} params · ${MODEL_INFO.quant} · ` +
  `${MODEL_INFO.baseSizeGB} GB model · full-parameter SFT (no adapters)`;
