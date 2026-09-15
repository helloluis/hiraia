/**
 * The bundled neural voice: an MMS-VITS checkpoint fine-tuned on Hiraia's own content,
 * run on-device through onnxruntime.
 *
 * Why bundled rather than the OS engine: Android's `fil-PH` voice is NETWORK-ONLY on the
 * devices we target — it returns error -4 with no connection, which is every session this
 * app is built for. See docs/TTS.md.
 *
 * The whole runtime is this file plus a ~40-symbol character tokenizer. There is no
 * phonemizer, no espeak data, no native TTS module: MMS reads characters directly, which
 * is exactly why it is the checkpoint we fine-tuned.
 *
 * The model file has to be COPIED out of the APK before it can be opened. Inside the APK
 * it is a compressed zip member addressed as `file:///android_asset/...`, not a file with
 * a path, and onnxruntime needs a real path. That costs its size again on disk, once, on
 * first use — the same trade the card database makes.
 */
import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import { InferenceSession, Tensor } from 'onnxruntime-react-native';

import type { Language } from '@hiraia/shared';

import EN_MODEL from '../../assets/voices/en/model.onnx';
import enVoice from '../../assets/voices/en/voice.json';
import TL_MODEL from '../../assets/voices/tl/model.onnx';
import tlVoice from '../../assets/voices/tl/voice.json';
import { encode, type Vocab } from './tokenizer';

interface VoiceMeta {
  /** Content hash of the model file, written by scripts/package-voices.py. */
  readonly sha256: string;
  readonly sampleRate: number;
  readonly vocab: Record<string, number>;
}

interface Voice {
  readonly id: string;
  readonly asset: number;
  readonly meta: VoiceMeta;
}

/**
 * One voice per language we have actually trained. A language absent from this map has
 * no read-aloud button at all — see `canSpeak` in ../speech.
 *
 * Tagalog and English are the SAME narrator by construction: the English corpus was
 * voice-cloned from a clip of the Tagalog one, and both fine-tunes land within 10 Hz of
 * each other (220 Hz and 229 Hz median F0, from male 114 Hz and 101 Hz bases).
 *
 * Cebuano is missing on purpose: the stock `mms-tts-ceb` checkpoint is male and reads
 * inconsistently, so it would be a third narrator rather than the same teacher. Its
 * fine-tuning corpus script is already written; drop the voice in here when it lands.
 */
const VOICES: Partial<Record<Language, Voice>> = {
  tagalog: { id: 'tl', asset: TL_MODEL, meta: tlVoice as VoiceMeta },
  english: { id: 'en', asset: EN_MODEL, meta: enVoice as VoiceMeta },
};

export function hasBundledVoice(language: Language): boolean {
  return VOICES[language] !== undefined;
}

export function sampleRateFor(language: Language): number {
  return VOICES[language]?.meta.sampleRate ?? 16000;
}

export function vocabFor(language: Language): Vocab | undefined {
  return VOICES[language]?.meta.vocab;
}

const dir = () => new Directory(Paths.document, 'voices');

/** Materialise the model next to its stamp, and return the path onnxruntime can open. */
async function modelPath(voice: Voice): Promise<string> {
  const root = dir();
  const file = new File(root, `${voice.id}.onnx`);
  const stamp = new File(root, `${voice.id}.sha256`);
  let fresh = false;
  try {
    fresh = file.exists && stamp.exists && stamp.textSync().trim() === voice.meta.sha256;
  } catch {
    fresh = false; // an unreadable stamp means re-copy, never means keep
  }
  if (!fresh) {
    const t0 = Date.now();
    root.create({ intermediates: true, idempotent: true });
    if (file.exists) file.delete();
    const asset = Asset.fromModule(voice.asset);
    await asset.downloadAsync();
    new File(asset.localUri ?? asset.uri).copy(file);
    stamp.write(voice.meta.sha256);
    // One-time per install (or per APK update). If this shows up before a tap in logcat,
    // the boot preload did its job; if it shows up AFTER a tap, the kid paid for it.
    console.log(`[voice] model ${voice.id}: copied out of the APK in ${Date.now() - t0}ms`);
  }
  return file.uri.replace(/^file:\/\//, '');
}

// One session per language, created once and kept. Loading is the expensive part
// (hundreds of ms); inference after that is cheap enough to run per sentence.
const sessions = new Map<Language, Promise<InferenceSession>>();

function sessionFor(language: Language): Promise<InferenceSession> {
  const existing = sessions.get(language);
  if (existing) return existing;
  const voice = VOICES[language];
  if (!voice) return Promise.reject(new Error(`no bundled voice for ${language}`));
  const t0 = Date.now();
  const opening = modelPath(voice).then((path) =>
    InferenceSession.create(path, {
      // CPU only, deliberately. NNAPI would be faster on paper, but the devices this
      // app targets are exactly the ones with flaky vendor NN drivers (see the Adreno
      // 610 notes in the engine docs) and a wrong answer here is a crash, not a slow
      // read. Revisit with a measurement on the real Redmi, not on a flagship.
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
      intraOpNumThreads: 2,
    }),
  );
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
  if (hasBundledVoice(language)) sessionFor(language).catch(() => {});
}

/** Synthesise one chunk. Returns mono float samples at `sampleRateFor(language)`. */
export async function synthesize(text: string, language: Language): Promise<Float32Array> {
  const voice = VOICES[language];
  if (!voice) throw new Error(`no bundled voice for ${language}`);
  const ids = encode(text, voice.meta.vocab);
  const session = await sessionFor(language);
  const input = new Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]);
  const mask = new Tensor('int64', new BigInt64Array(ids.length).fill(1n), [1, ids.length]);
  const out = await session.run({ input_ids: input, attention_mask: mask });
  const waveform = out[session.outputNames[0]!]!;
  return waveform.data as Float32Array;
}
