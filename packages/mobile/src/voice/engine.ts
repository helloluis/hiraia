/** On-device read-aloud using platform bundles and verified installed voices. */
import { InferenceSession, Tensor } from 'onnxruntime-react-native';

import type { Language } from '@hiraia/shared';

import { voiceForLanguage } from './catalog';
import { installedVoicePath } from './files';
import { encode, type Vocab } from './tokenizer';

export function hasVoice(language: Language): boolean {
  return voiceForLanguage(language) !== null;
}
export function sampleRateFor(language: Language): number {
  return voiceForLanguage(language)?.meta.sampleRate ?? 16000;
}
export function vocabFor(language: Language): Vocab | undefined {
  return voiceForLanguage(language)?.meta.vocab;
}

// One session per language, created once and kept. Loading is the expensive part
// (hundreds of ms); inference after that is cheap enough to run per sentence.
const sessions = new Map<Language, Promise<InferenceSession>>();

function sessionFor(language: Language): Promise<InferenceSession> {
  const existing = sessions.get(language);
  if (existing) return existing;
  const voice = voiceForLanguage(language);
  if (!voice) return Promise.reject(new Error(`no voice for ${language}`));
  const t0 = Date.now();
  const opening = installedVoicePath(voice).then((path) => {
    if (!path) throw new Error(`Voice download is not ready for ${language}`);
    return InferenceSession.create(path, {
      // CPU only, deliberately. NNAPI would be faster on paper, but the devices this
      // app targets are exactly the ones with flaky vendor NN drivers (see the Adreno
      // 610 notes in the engine docs) and a wrong answer here is a crash, not a slow
      // read. Revisit with a measurement on the real Redmi, not on a flagship.
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
      intraOpNumThreads: 2,
    });
  });
  void opening.then(
    () => console.log(`[voice] session ${voice.id} ready in ${Date.now() - t0}ms`),
    (e) => console.log(`[voice] session ${voice.id} FAILED: ${String(e).slice(0, 120)}`),
  );
  // A failed load must not be cached, or the button is dead for the rest of the session.
  opening.catch(() => sessions.delete(language));
  sessions.set(language, opening);
  return opening;
}

/** Warm the session ahead of the first tap, so the first card does not pay for it. */
export function preloadVoice(language: Language): void {
  const voice = voiceForLanguage(language);
  if (voice) void installedVoicePath(voice).then(path => {
    if (path) return sessionFor(language);
  }).catch(() => {});
}

/** Synthesise one chunk. Returns mono float samples at `sampleRateFor(language)`. */
export async function synthesize(text: string, language: Language): Promise<Float32Array> {
  const voice = voiceForLanguage(language);
  if (!voice) throw new Error(`no voice for ${language}`);
  const ids = encode(text, voice.meta.vocab);
  const session = await sessionFor(language);
  const input = new Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]);
  const mask = new Tensor('int64', new BigInt64Array(ids.length).fill(1n), [1, ids.length]);
  const out = await session.run({ input_ids: input, attention_mask: mask });
  const waveform = out[session.outputNames[0]!]!;
  return waveform.data as Float32Array;
}
