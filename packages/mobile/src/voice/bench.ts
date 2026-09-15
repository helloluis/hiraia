/**
 * ON-DEVICE synthesis benchmark — a diagnostic, not a feature.
 *
 * Measured on the pilot Redmi (Helio G85): fp32 kernels run the voice at RTF ~2.0 — twice
 * as slow as real time — which put 13 seconds of dead silence between a question and its
 * answer. The Mac said int8 was the slow option (RTF 0.67 vs 0.27); this chip has the
 * `sdot` dot-product instructions the Mac argument assumed missing, so the Mac ranking
 * cannot be trusted here. Nothing settles it but running the matrix on the phone itself.
 *
 * So this runs every {model} × {execution provider} × {thread count} combination on one
 * fixed sentence and logs a `[voice-bench]` line per cell — read over adb logcat, compared,
 * then the winner is hardcoded into engine.ts and BENCH_ON_LAUNCH is flipped off. The int8
 * model and this file's launch call must NOT ship in a release: the bench burns ~2 minutes
 * of CPU after boot and the extra model is 37 MB of APK.
 */
import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import { InferenceSession, Tensor } from 'onnxruntime-react-native';

import FP16_MODEL from '../../assets/voices/tl/model.onnx';
import tlVoice from '../../assets/voices/tl/voice.json';
import { encode } from './tokenizer';

/** Flip OFF (and drop the int8 asset + import) before any release build. */
export const BENCH_ON_LAUNCH = false;

const TAG = '[voice-bench]';
// ~90 chars — the first-chunk cap, i.e. exactly the wait a tap feels.
const SENTENCE = 'Ang mga halaman ay gumagawa ng sarili nilang pagkain gamit ang sikat ng araw at tubig.';

const MODELS = [{ name: 'fp16', asset: FP16_MODEL, file: 'bench-fp16.onnx' }] as const;
// 2 was tuned on a Mac; this SoC is 2×A75 + 6×A55 and may want more hands on deck.
const THREADS = [2, 4] as const;
// 'nnapi' offloads convolutions to the Mali GPU / DSP — the untested lever, since RTF ~2
// on every CPU cell is a model-size wall no thread count clears. 'xnnpack'/'nnapi' may not
// be compiled into the RN AAR; an unavailable EP throws at create() and is logged as such.
const EPS = ['cpu', 'nnapi', 'xnnpack'] as const;

async function materialise(asset: number, name: string): Promise<string> {
  const root = new Directory(Paths.cache, 'voice-bench');
  root.create({ intermediates: true, idempotent: true });
  const file = new File(root, name);
  if (file.exists) file.delete();
  const a = Asset.fromModule(asset);
  await a.downloadAsync();
  new File(a.localUri ?? a.uri).copy(file);
  return file.uri.replace(/^file:\/\//, '');
}

let started = false;
export async function runVoiceBench(): Promise<void> {
  if (started) return;
  started = true;
  console.log(`${TAG} start — "${SENTENCE.slice(0, 40)}…"`);
  const ids = encode(SENTENCE, (tlVoice as { vocab: Record<string, number> }).vocab);
  const input = new Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]);
  const mask = new Tensor('int64', new BigInt64Array(ids.length).fill(1n), [1, ids.length]);

  for (const model of MODELS) {
    let path: string;
    try {
      path = await materialise(model.asset, model.file);
    } catch (e) {
      console.log(`${TAG} ${model.name}: materialise FAILED ${String(e).slice(0, 80)}`);
      continue;
    }
    for (const ep of EPS) {
      for (const threads of THREADS) {
        // GPU/DSP offload ignores intra-op thread count; one cell is enough.
        if (ep === 'nnapi' && threads !== THREADS[0]) continue;
        const label = `${model.name} ep=${ep} threads=${threads}`;
        try {
          const t0 = Date.now();
          const session = await InferenceSession.create(path, {
            executionProviders: [ep],
            graphOptimizationLevel: 'all',
            intraOpNumThreads: threads,
          });
          const load = Date.now() - t0;
          const t1 = Date.now();
          const out = await session.run({ input_ids: input, attention_mask: mask });
          const synth = Date.now() - t1;
          const wave = out[session.outputNames[0]!]!.data as Float32Array;
          const seconds = wave.length / 16000;
          console.log(
            `${TAG} ${label}: load ${load}ms, synth ${synth}ms → ${seconds.toFixed(1)}s ` +
              `(RTF ${(synth / 1000 / seconds).toFixed(2)})`,
          );
          await session.release();
        } catch (e) {
          console.log(`${TAG} ${label}: FAILED ${String(e).slice(0, 100)}`);
        }
      }
    }
  }
  console.log(`${TAG} done`);
}
