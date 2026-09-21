# Mobile retrieval before generation

The mobile engine initializes the indexed fact bank, then LaBSE and its vectors, then the optional generation model. The card search field remains interactive throughout: keyword search does not depend on an engine. Semantic misses can resolve ranked source-fact IDs to authored feed cards and their topic queues. They are never labelled generated cards.

`TutorEngine.isReady()` describes completed setup. `canGenerate()` and `isSemanticReady()` describe actual capabilities; consumers must not infer LLM availability from completed setup. Generation failure leaves semantic retrieval available. On 4 GB devices, generated rewards use the existing templates and dynamic card generation is skipped.

`memoryPolicy.ts` separates budgets:

- LaBSE: at least 3.5 GiB physical RAM, no low-RAM/low-memory flag, and at least 1.25 GiB available (also at least Android's low-memory threshold plus 0.75 GiB).
- LLM: at least 5.5 GiB physical RAM and at least 2.5 GiB available **after** LaBSE is resident (also threshold plus 1 GiB).
- Missing/invalid snapshots fail closed for model allocation. Keyword search remains available.
- Recheck headroom after downloads. Download space is checked only for missing assets.

The 122 MB vector blob must not use Expo `File.bytes()` on Android: it duplicates large buffers in the Java heap. `readVectorSlice.ts` uses 256 KiB file-handle reads, retains only the active language's 40.7 MB slice, yields between chunks, and closes on errors/cancellation. Full blob size, download verification, fact count and bank-hash checks remain intact. Language changes rebuild the engine with the corresponding slice.

Engine loads, language changes and shutdown are serialized. A superseding language/profile request cancels initialization downloads before waiting for any native allocation to finish and unloading it.

## Validation

Run from the repository root:

```sh
pnpm --filter @hiraia/mobile type-check
node --import tsx packages/mobile/scripts/memory-policy.test.mts
node --import tsx --test packages/mobile/scripts/retrieval-first.test.mts packages/mobile/scripts/vector-slice.test.mts packages/mobile/scripts/engine-lifecycle.test.mts packages/mobile/scripts/search-magnet.test.mts
```

On 20 September 2026, the USB Jambo JP1 (3.666 GiB physical RAM) ran with `semantic=true generation=false`. Peak process RSS high-water mark was approximately 1.27 GiB, versus 2.87 GiB in the previous LLM workload. Sampled system headroom stayed above 1.36 GiB during searches, read-aloud and background/resume. Cached semantic setup took 26.1 seconds; keyword search remains usable during setup. Semantic retrieval took approximately 3.4–4.3 seconds. These are observations on one phone, not fleet or higher-RAM validation.

Search quality remains approximate: `fotosintesis` recovered useful authored cards, but `camello` and `goto` returned poor matches. Existing shared thresholds were preserved rather than tuned to these probes. An intermittent native SVG GroupView startup null-bitmap crash was separately recorded before any model setup. Detailed logs, original/test APKs and the measurement report are in `/Users/luis/Code/hiraia-device-profiles/jambo-labse-first-20260920/`.
