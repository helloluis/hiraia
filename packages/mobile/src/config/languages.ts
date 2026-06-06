import type { Language } from '@hiraia/shared';

/**
 * The languages the tutor offers, in display order. `beta` flags the ones whose
 * grounded adapter isn't trained yet: Tagalog runs the v3 grounded adapter (the
 * faithful one); Bisaya runs the older pre-grounded adapter and English runs the
 * base model — both can still be wrong on facts until their grounded adapters
 * ship. We surface that honestly rather than hide it.
 */
export interface LanguageOption {
  lang: Language;
  label: string;
  beta: boolean;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { lang: 'tagalog', label: 'Tagalog', beta: false },
  { lang: 'cebuano', label: 'Bisaya', beta: true },
  { lang: 'english', label: 'English', beta: true },
];

export const DEFAULT_LANGUAGE: Language = 'tagalog';
