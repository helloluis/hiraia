/**
 * Reading a card aloud: phrase, synthesise EAGERLY, and play with punctuation pauses.
 *
 * Chunking (see ./chunk) is not a nicety. A whole card is 10-20 seconds of speech and the
 * model is not fast on a budget phone, so synthesising a card in one pass would mean a long
 * dead silence after the tap. Per-sentence, the first sound arrives after the first
 * sentence alone.
 *
 * Synthesis runs EAGERLY down the whole card — chunk 2 starts rendering the moment chunk 1
 * hands the CPU back, not when chunk 1 finishes PLAYING. On a phone where synthesis is
 * near real-time, the lazy one-ahead version left a silence between every pair of
 * sentences (audibly: a long gap between a question and its answer); eager synthesis gives
 * later chunks the whole playback time of earlier ones as head start. Each rendered clip is
 * also wrapped in its AudioPlayer AHEAD of time, so the hand-off between clips is a play()
 * call, not a file load.
 *
 * Deliberate punctuation pauses are silent PCM at the end of a clip. Synthesis keeps
 * running during those pauses; no extra timer or model token is needed.
 *
 * Only one read-aloud runs at a time. A second tap (or turning the page) cancels the one in
 * flight: `stop()` bumps a generation counter that every async step checks, so synthesis
 * already on the CPU finishes into the void instead of playing over the next card.
 *
 * Every stage logs under the `[voice]` tag with timings — these lines are how on-device
 * latency is measured over adb logcat (there is no other instrument on a release build),
 * so they are deliberately terse, greppable, and always on.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';

import type { Language } from '@hiraia/shared';

import { speechChunks } from './chunk';
import { sampleRateFor, synthesize, vocabFor } from './engine';
import { normalizeForSpeech } from './normalize';
import { hasSpeakableText } from './tokenizer';
import { encodeWav } from './wav';

const TAG = '[voice]';
const dir = () => new Directory(Paths.cache, 'speech');

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

/** A clip rendered and already wrapped in its (paused) player, waiting for its turn. */
interface Prepared {
  player: AudioPlayer;
  seconds: number;
}

function prepare(samples: Float32Array, sampleRate: number, mine: number, i: number, pauseMs: number): Prepared {
  const root = dir();
  root.create({ intermediates: true, idempotent: true });
  // Unique per (utterance, chunk): clips of one card coexist, and the previous
  // utterance's files are swept when the next speak() starts, not reused in place.
  const file = new File(root, `u${mine}-${i}.wav`);
  if (file.exists) file.delete();
  file.create();
  file.write(encodeWav(samples, sampleRate, pauseMs));
  return { player: createAudioPlayer({ uri: file.uri }), seconds: samples.length / sampleRate };
}

/** Sweep clips of finished utterances. Unlinking a file a stale player still holds is fine. */
function sweep(mine: number) {
  try {
    for (const entry of dir().list()) {
      if (entry instanceof File && !entry.name.startsWith(`u${mine}-`)) entry.delete();
    }
  } catch {
    /* a missing dir on first run is not a problem */
  }
}

function play(p: Prepared, mine: number): Promise<void> {
  return new Promise((resolve) => {
    if (mine !== generation) return resolve();
    release();
    player = p.player;
    const sub = p.player.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish) {
        sub.remove();
        resolve();
      }
    });
    p.player.play();
  });
}

/**
 * Read `text` aloud in `language`. Resolves when the last chunk finishes, or immediately if
 * a newer call has superseded this one. `onStart` fires when the FIRST clip actually starts
 * sounding — the UI switches from "working" to "speaking" on it, and the reading guide
 * takes it as its cue, so it must track real audio, not the tap.
 */
export async function speak(
  text: string,
  language: Language,
  onStart?: () => void,
): Promise<void> {
  stop();
  const mine = generation;
  const t0 = Date.now();
  const vocab = vocabFor(language);
  if (!vocab) return;
  const parts = speechChunks(normalizeForSpeech(text, language)).filter((p) =>
    hasSpeakableText(p.text, vocab),
  );
  if (!parts.length) return;
  console.log(`${TAG} speak lang=${language} chunks=${parts.length} "${text.slice(0, 32)}…"`);
  sweep(mine);

  if (!audioModeSet) {
    // Read-aloud is the point of the tap, so it should sound even with the ringer on
    // silent, and it should not stop whatever else the phone is playing forever.
    await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers' });
    audioModeSet = true;
  }

  const sampleRate = sampleRateFor(language);

  // The synthesis line: strictly serial (the session shares two CPU threads; overlapping
  // runs just fight each other), but launched for the WHOLE card up front. prepared[i]
  // resolves when chunk i is rendered and its player is loaded.
  let line: Promise<unknown> = Promise.resolve();
  const prepared = parts.map((part, i) => {
    const step = line.then(async () => {
      if (mine !== generation) return null;
      const s0 = Date.now();
      const samples = await synthesize(part.text, language);
      if (mine !== generation) return null;
      const pauseMs = i < parts.length - 1 ? part.pauseAfterMs : 0;
      const p = prepare(samples, sampleRate, mine, i, pauseMs);
      console.log(
        `${TAG} chunk ${i + 1}/${parts.length} synth ${Date.now() - s0}ms → ` +
          `${p.seconds.toFixed(1)}s audio (RTF ${((Date.now() - s0) / 1000 / p.seconds).toFixed(2)}), pause=${pauseMs}ms`,
      );
      return p;
    });
    line = step.catch(() => null);
    return step;
  });

  try {
    for (let i = 0; i < prepared.length; i += 1) {
      const waited = Date.now();
      const clip = await prepared[i]!;
      if (!clip || mine !== generation) return;
      if (i === 0) {
        console.log(`${TAG} first sound in ${Date.now() - t0}ms`);
        onStart?.();
      } else if (Date.now() - waited > 60) {
        // The audible symptom: playback caught up with synthesis and the card went quiet
        // mid-thought. If these show up in logcat, the model is too slow for this device.
        console.log(`${TAG} GAP before chunk ${i + 1}: ${Date.now() - waited}ms of silence`);
      }
      await play(clip, mine);
      if (mine !== generation) return;
    }
    console.log(`${TAG} done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } finally {
    if (mine === generation) release();
  }
}
