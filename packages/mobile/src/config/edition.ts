import type { GradeLevel, Language } from '@hiraia/shared';
import type { RemoteAssetSpec } from '../engine/modelDownload';
import { remoteAssetUrl } from './assetDelivery';

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
    base: {
      filename: 'hiraia-sft-2b-v2.Q4_K_M.gguf', url: remoteAssetUrl('hiraia-sft-2b-v2.Q4_K_M.gguf'),
      bytes: 1274396160, md5: 'fe2d0ab2ad856f2a42c5add5872c4234', label: 'Hiraia-2B base',
    },
    vectors: {
      filename: 'vectors-labse-45f9310c4179.i8.bin', url: remoteAssetUrl('vectors-labse-45f9310c4179.i8.bin'),
      bytes: 122162688, md5: 'deee5b7a02d9d7503e961057fcfc6b10', label: 'Hiraiapedia vectors',
    },
    embedder: {
      filename: 'labse.Q4_K_M.gguf', url: remoteAssetUrl('labse.Q4_K_M.gguf'),
      bytes: 383762048, md5: '2667f69edfbcb68acf617187fe817fae', label: 'LaBSE embedder',
    },
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
