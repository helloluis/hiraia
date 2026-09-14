/**
 * Reading a card aloud: chunk, synthesise, play, and prefetch the next chunk while the
 * current one is playing.
 *
 * Chunking (see ./chunk) is not a nicety. A whole card is 10-20 seconds of speech, and
 * the model runs at roughly real time on a budget phone — synthesising it in one shot
 * would mean a ten-second silence after the tap. Per-sentence, the first sound arrives
 * after the first sentence, and every later one is already rendered when it is needed.
 *
 * Only one read-aloud runs at a time. A second tap (or turning the page) cancels the one
 * in flight: `stop()` bumps a generation counter that every in-flight step checks, so a
 * synthesis that was already running finishes into the void instead of playing over the
 * next card.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';

import type { Language } from '@hiraia/shared';

import { chunk } from './chunk';
import { sampleRateFor, synthesize, vocabFor } from './engine';
import { normalizeForSpeech } from './normalize';
import { hasSpeakableText } from './tokenizer';
import { encodeWav } from './wav';

const dir = () => new Directory(Paths.cache, 'speech');

/** Two slots, alternating: the one playing and the one being prefetched. */
let slot = 0;
function writeClip(samples: Float32Array, sampleRate: number): string {
  const root = dir();
  root.create({ intermediates: true, idempotent: true });
  slot = (slot + 1) % 2;
  const file = new File(root, `chunk-${slot}.wav`);
  if (file.exists) file.delete();
  file.create();
  file.write(encodeWav(samples, sampleRate));
  return file.uri;
}

let generation = 0;
let player: AudioPlayer | null = null;
let audioModeSet = false;

function release() {
  player?.remove();
  player = null;
}

/** Cancel whatever is being read. Safe to call when nothing is playing. */
export function stop(): void {
  generation += 1;
  release();
}

function playFile(uri: string, mine: number): Promise<void> {
  return new Promise((resolve) => {
    if (mine !== generation) return resolve();
    release();
    const p = createAudioPlayer({ uri });
    player = p;
    const sub = p.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish) {
        sub.remove();
        resolve();
      }
    });
    p.play();
  });
}

/**
 * Read `text` aloud in `language`. Resolves when the last chunk finishes, or immediately
 * if a newer call has superseded this one.
 */
export async function speak(text: string, language: Language): Promise<void> {
  stop();
  const mine = generation;
  const vocab = vocabFor(language);
  if (!vocab) return;
  // Normalise BEFORE chunking: expansion changes the length the chunk cap is measuring,
  // and a number must never be split across two utterances.
  const parts = chunk(normalizeForSpeech(text, language)).filter((p) =>
    hasSpeakableText(p, vocab),
  );
  if (!parts.length) return;

  if (!audioModeSet) {
    // Read-aloud is the point of the tap, so it should sound even with the ringer on
    // silent, and it should not stop whatever else the phone is playing forever.
    await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers' });
    audioModeSet = true;
  }

  const sampleRate = sampleRateFor(language);
  let pending: Promise<Float32Array> | null = synthesize(parts[0]!, language);
  for (let i = 0; i < parts.length; i += 1) {
    const samples = await pending!;
    if (mine !== generation) return;
    // Kick off the next chunk BEFORE playing this one, so synthesis overlaps playback.
    pending = i + 1 < parts.length ? synthesize(parts[i + 1]!, language) : null;
    pending?.catch(() => {});
    await playFile(writeClip(samples, sampleRate), mine);
    if (mine !== generation) return;
  }
  release();
}
