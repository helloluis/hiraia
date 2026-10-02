import type { Language } from '@hiraia/shared';
import { ACTIVE_EDITION } from './edition';

/** Display labels keep the existing language keys used by model prompts and retrieval. */
export interface LanguageOption {
  lang: Language;
  label: string;
  beta: boolean;
  comingSoon?: boolean;
}

export const LANGUAGE_OPTIONS: readonly LanguageOption[] = ACTIVE_EDITION.languages;

export const DEFAULT_LANGUAGE: Language = ACTIVE_EDITION.defaultLanguage;
