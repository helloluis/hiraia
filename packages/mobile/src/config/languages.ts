import type { Language } from '@hiraia/shared';

/** Display labels keep the existing language keys used by model prompts and retrieval. */
export interface LanguageOption {
  lang: Language;
  label: string;
  beta: boolean;
  comingSoon?: boolean;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { lang: 'tagalog', label: 'Tagalog', beta: false },
  { lang: 'english', label: 'English', beta: true },
  { lang: 'cebuano', label: 'Cebuano', beta: false },
];

export const DEFAULT_LANGUAGE: Language = 'tagalog';
