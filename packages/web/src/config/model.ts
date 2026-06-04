/**
 * Single source of truth for the deployed model + adapters.
 * Drives the status bar (display stats) and the inference wiring
 * (server model id + per-language LoRA selection + system prompts).
 */

export const MODEL_INFO = {
  /** Friendly name shown in the status bar. */
  displayName: 'Sailor2-3B',
  /** What the model has been adapted for (status bar subtitle). */
  tagline: 'Fine-tuned with Filipino & Bisaya adapters',
  /** Underlying base architecture. */
  arch: 'Qwen2 / SEA-grounded',
  /** Approx parameter count (Sailor2-3B is an expanded ~3.6B; f16 GGUF is 6.67 GiB). */
  params: '~3.6B',
  /** Deployment quantization (mradermacher build). */
  quant: 'Q4_K_M',
  /** Base size on disk (GiB) — measured: 3.01 GiB file (~2.2 GB RAM at runtime, mmap'd). */
  baseSizeGB: 3.0,
  /** Each LoRA adapter size (MB) — measured: 101.8 MiB. */
  adapterSizeMB: 102,
  /**
   * Model id sent to the QVAC/llama.cpp server in the `model` field.
   * Match this to however your server advertises the model (often the
   * gguf filename stem). Most llama.cpp servers ignore/echo this, so the
   * value that actually changes behavior is the per-request `lora` below.
   */
  serverModelId: 'sailor2-3b-chat',
} as const;

export type LanguageKey = 'english' | 'tagalog' | 'cebuano';

/**
 * Per-language config. `loraId` is the index of the adapter as loaded by the
 * server, e.g. launching with:
 *   llama-server -m sailor2-3b-chat.gguf \
 *     --lora adapter-sailor-tagalog-f16.gguf \   # -> id 0
 *     --lora adapter-sailor-bisaya-f16.gguf      # -> id 1
 * English uses no adapter (base model handles English fine).
 */
export const LANGUAGES: Record<LanguageKey, {
  label: string;
  adapterLabel: string;
  loraId: number | null;
  system: string;
}> = {
  english: {
    label: 'English',
    adapterLabel: 'base model (no adapter)',
    loraId: null,
    system:
      'You are Hiraia, a friendly science tutor for Filipino students (grades 3-10). ' +
      'Explain concepts simply and correctly for the age, use the Socratic method, and ' +
      'keep answers short (a few sentences). End with one guiding follow-up question.',
  },
  tagalog: {
    label: 'Tagalog',
    adapterLabel: 'Tagalog adapter',
    loraId: 0,
    // Exact system prompt used during fine-tuning / eval.
    system:
      'Ikaw si Hiraia, isang AI tutor na tumutulong sa mga estudyanteng Pilipino na ' +
      'matuto ng Science. Gumagamit ka ng Socratic method at natural na Tagalog.',
  },
  cebuano: {
    label: 'Cebuano (Bisaya)',
    adapterLabel: 'Bisaya adapter',
    loraId: 1,
    system:
      'Ikaw si Hiraia, usa ka AI tutor nga nagtabang sa mga estudyanteng Pilipino nga ' +
      'makat-on og Science. Naggamit ka og Socratic method ug natural nga Bisaya.',
  },
};

/** All adapter ids the server is expected to have loaded (derived from LANGUAGES). */
export const ALL_LORA_IDS: number[] = Object.values(LANGUAGES)
  .map((l) => l.loraId)
  .filter((id): id is number => id !== null);

/**
 * Build the full per-request `lora` scale array for a language: the selected
 * adapter at scale 1.0, every other loaded adapter explicitly at 0.0 (so a
 * server that loaded all adapters at default scale 1.0 doesn't stack them).
 * English (loraId null) yields all-zero -> base model.
 */
export function loraScalesFor(language: LanguageKey): Array<{ id: number; scale: number }> {
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
  if (ceb > tl) return 'cebuano'; // obvious Cebuano
  if (tl > 0) return 'tagalog'; // any Tagalog signal -> Tagalog
  // no Filipino markers: English only if it clearly reads as English, else stay put
  if (ceb === 0 && en > 0) return 'english';
  return fallback;
}

/** Short, truthful stats string for the status bar. */
export const MODEL_STATS_LINE =
  `${MODEL_INFO.params} params · ${MODEL_INFO.quant} · ` +
  `${MODEL_INFO.baseSizeGB} GB model + ${MODEL_INFO.adapterSizeMB} MB adapter`;
