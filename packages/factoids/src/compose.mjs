/**
 * Compose the displayed "Alam mo ba na…?" message from a factoid.
 *
 * The factoid stores `hook` and `body` separately (and per-language); this file
 * owns the only language-specific glue: the lead-in ("Alam mo ba na …") and the
 * fallback order. Keeping phrasing out of the data means a better Tagalog/Cebuano
 * fine-tune can re-render hook/body without touching this assembly logic.
 */

/** @typedef {import('./types.mjs').Factoid} Factoid */
/** @typedef {import('./types.mjs').Trilingual} Trilingual */

/** Lead-in clause per language; "{x}" is where the hook clause goes. */
export const LEAD = {
  tagalog: 'Alam mo ba na {x}?',
  english: 'Did you know that {x}?',
  cebuano: 'Nahibaw-an ba nimo nga {x}?',
};

/** Per-language fallback order for picking a trilingual string. */
const FALLBACK = {
  tagalog: ['tl', 'en', 'ceb'],
  english: ['en', 'tl', 'ceb'],
  cebuano: ['ceb', 'tl', 'en'], // Tagalog is closer to Cebuano than English for a Filipino reader
};

/**
 * Pick the best available string from a Trilingual for a reader language.
 * @param {Trilingual} tri
 * @param {'tagalog'|'english'|'cebuano'} language
 * @returns {{ text: string, usedLang: 'tl'|'en'|'ceb'|null }}
 */
export function pickLang(tri, language) {
  for (const key of FALLBACK[language] || FALLBACK.tagalog) {
    const v = tri && tri[key];
    if (typeof v === 'string' && v.trim()) return { text: v.trim(), usedLang: key };
  }
  return { text: '', usedLang: null };
}

/**
 * Build the full message text for a factoid in the reader's language.
 * @param {Factoid} factoid
 * @param {'tagalog'|'english'|'cebuano'} [language]
 * @returns {{ text: string, usedLang: 'tl'|'en'|'ceb'|null }}
 */
export function composeText(factoid, language = 'tagalog') {
  const hook = pickLang(factoid.hook, language);
  const body = pickLang(factoid.body, language);
  const lead = (LEAD[language] || LEAD.tagalog).replace('{x}', hook.text);
  const text = body.text ? `${lead} ${body.text}` : lead;
  // usedLang reflects the hook (the headline); if hook fell back, the reader is
  // effectively reading that language. Surfaced so callers can flag mismatches.
  return { text, usedLang: hook.usedLang };
}

/** Rough word count, for keeping factoids near the ~50-word target. */
export function wordCount(text) {
  return (text.trim().match(/\S+/g) || []).length;
}
