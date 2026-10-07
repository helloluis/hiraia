import type { GradeLevel, Language } from '@hiraia/shared';
import type { RemoteAssetSpec } from '../engine/modelDownload';
import { remoteAssetUrl } from './assetDelivery';
import modelAssets from './modelAssets.json';

export interface EditionLanguage {
  lang: Language;
  label: string;
  beta: boolean;
  comingSoon?: boolean;
  voice: 'en' | 'tl' | null;
}

export interface LearningEdition {
  id: string;
  country: string;
  curriculum: string;
  languages: readonly EditionLanguage[];
  grades: readonly GradeLevel[];
  defaultLanguage: Language;
  defaultGrade: GradeLevel;
  /** All supported text is part of the APK, independent of the selected language. */
  textDelivery: 'bundled';
  modelFamily: 'hiraia-2b-qwen35-v1';
  models: Record<'base' | 'embedder' | 'vectors', RemoteAssetSpec & { md5: string }>;
}

/** An edition owns curriculum and language capabilities; a language alone is not a country. */
export const PH_EDITION: LearningEdition = {
  id: 'ph-deped', country: 'PH', curriculum: 'ph-deped',
  languages: [
    { lang: 'tagalog', label: 'Tagalog', beta: false, voice: 'tl' },
    { lang: 'english', label: 'English', beta: true, voice: 'en' },
    { lang: 'cebuano', label: 'Cebuano', beta: false, voice: null },
  ],
  grades: [3, 4, 5, 6, 7, 8, 9, 10], defaultLanguage: 'tagalog', defaultGrade: 5,
  textDelivery: 'bundled', modelFamily: 'hiraia-2b-qwen35-v1',
  models: {
    base: { ...modelAssets.base, url: remoteAssetUrl(modelAssets.base.filename) },
    vectors: { ...modelAssets.vectors, url: remoteAssetUrl(modelAssets.vectors.filename) },
    embedder: { ...modelAssets.embedder, url: remoteAssetUrl(modelAssets.embedder.filename) },
  },
};

export const SUPPORTED_EDITIONS: readonly LearningEdition[] = [PH_EDITION];
/** PH is implicit in this release. There is deliberately no country picker. */
export const ACTIVE_EDITION = PH_EDITION;

export function editionForCountry(country: string): LearningEdition {
  const edition = SUPPORTED_EDITIONS.find((entry) => entry.country === country);
  if (!edition) throw new Error(`Unsupported country: ${country}`);
  return edition;
}

export function editionLanguage(language: Language, edition = ACTIVE_EDITION): EditionLanguage {
  const selected = edition.languages.find((entry) => entry.lang === language && !entry.comingSoon);
  if (!selected) throw new Error(`Language ${language} is unavailable in ${edition.id}`);
  return selected;
}
