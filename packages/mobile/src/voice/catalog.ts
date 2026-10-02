import type { Language } from '@hiraia/shared';
import catalog from '../../assets/voices/catalog.json';
import enVoice from '../../assets/voices/en/voice.json';
import tlVoice from '../../assets/voices/tl/voice.json';
import { editionLanguage } from '../config/edition';
import { remoteAssetUrl } from '../config/assetDelivery';
import { isBundledVoice } from './bundled';

export interface VoiceMeta {
  readonly sha256: string;
  readonly sampleRate: number;
  readonly vocab: Record<string, number>;
}
export interface VoiceSpec {
  id: 'en' | 'tl';
  delivery: 'bundled' | 'download';
  filename: string;
  bytes: number;
  md5: string;
  sha256: string;
  url: string;
  label: string;
  meta: VoiceMeta;
}

export const VOICES: Readonly<Record<'en' | 'tl', VoiceSpec>> = {
  en: { ...catalog.voices.en, delivery: isBundledVoice('en') ? 'bundled' : 'download', id: 'en', label: 'English voice',
    url: remoteAssetUrl(catalog.voices.en.filename), meta: enVoice },
  tl: { ...catalog.voices.tl, delivery: isBundledVoice('tl') ? 'bundled' : 'download', id: 'tl', label: 'Tagalog voice',
    url: remoteAssetUrl(catalog.voices.tl.filename), meta: tlVoice },
};

export function voiceForLanguage(language: Language): VoiceSpec | null {
  const id = editionLanguage(language).voice;
  return id ? VOICES[id] : null;
}
