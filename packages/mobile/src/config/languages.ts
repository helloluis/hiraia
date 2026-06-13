import type { Language } from '@hiraia/shared';

/**
 * The languages the tutor offers, in display order. `beta` flags the ones whose
 * grounded adapter isn't trained yet: Tagalog runs the v3 grounded adapter (the
 * faithful one); English rides the tagalog adapter and can still drift — we
 * surface that honestly rather than hide it. `comingSoon` languages are shown
 * but NOT selectable: Bisaya is descoped for launch (2026-06-12 focus decision
 * — Tagalog + English first; its adapter quality isn't shippable yet).
 */
export interface LanguageOption {
  lang: Language;
  label: string;
  beta: boolean;
  comingSoon?: boolean;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { lang: 'tagalog', label: 'Tagalog', beta: false },
  { lang: 'english', label: 'English', beta: true },
  { lang: 'cebuano', label: 'Bisaya', beta: false, comingSoon: true },
];

export const DEFAULT_LANGUAGE: Language = 'tagalog';
