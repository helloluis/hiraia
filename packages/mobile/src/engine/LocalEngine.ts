import { loadModel, completion, unloadModel, embed, QWEN3_1_7B_INST_Q4 } from '@qvac/sdk';
import { Asset } from 'expo-asset';
import Constants from 'expo-constants';
import { File } from 'expo-file-system';
import {
  ACTIVE_MODEL,
  EMBEDDER,
  VECTORS_BLOB_ASSET,
  VECTORS_META,
  IMAGE_VECTORS_BLOB_ASSET,
  IMAGE_VECTORS_META,
} from '../config/model';
import { DEFAULT_GRADE } from '../config/grades';
import { WARMUP_TEMP, WARMUP_QUERY, WARMUP_FACT } from '../config/inference';
import { IMAGE_CATEGORY } from '../generated/imageCategory.generated';
import { FACT_IMAGE } from '../generated/factImage';
import { artSourceFor } from '../data/artSource';
import { openFactSource } from '../data/cardDb';
import { cardSlugForFact } from '../data/factCardSlug';
import { getSetting, setSetting } from '../db/repo';
import { ensureRemoteAsset } from './modelDownload';
import { withModelLock } from './modelLock';
import type { AdapterLanguage } from '../config/model';
import type {
  TutorEngine,
  ImageResult,
  RagResult,
  TutorConfig,
  Language,
  GradeLevel,
  ScienceFact,
  SqlFactSource,
} from '@hiraia/shared';
import {
  RagStore,
  SemanticIndex,
  ImageIndex,
  normalizeQuery,
  buildContextualQuery,
  CONTEXT_FALLBACK_FLOOR,
  isOffDomain,
  buildCardPrompt,
  sanitizeCardAnswer,
  imageDomainScope,
  acceptImageMatch,
  attributeCardToFact,
  resolveIllustrationSlug,
  CARD_TEMP,
  CARD_STOP,
  CARD_MAX_TOKENS,
  CARD_REASONING_BUDGET,
} from '@hiraia/shared';

// Minimum cosine for an [image:] description to resolve to a bundled illustration — the
// RETIRED tag path (`resolveImageTag`), not the card path. Calibrated offline against the SFT
// tag descriptions (rag/scripts/validate-image-vectors.py): true matches median 0.79; every
// out-of-catalog decoy AND every observed cross-topic mismatch lands ≤0.693.
// History: 0.70 → 0.75 (2026-06-17, alongside making FACT_IMAGE the curated baseline
// and the model tag an OVERRIDE) — but that OVER-CORRECTED. A re-calibration (2026-06-20,
// 533 real tags) put the true-positive p25 at 0.746, so 0.75 was silently rejecting ~25%
// of legitimate, correctly-matched tags — e.g. "a t-rex dinosaur" (0.741), "the eight
// planets of the solar system"→solar-system (0.715), photosynthesis (0.714). Reverted to
// 0.70: it sits just above the empirical decoy/cross-topic ceiling (≤0.693) so genuine
// no-match cases still abstain, and the WITHIN-science cluster-bias class (gravity→atomic-
// model, earthquake→pangolin) is caught independently by DOMAIN_IMAGE_CATEGORIES scoping
// (@hiraia/shared rag/images.ts) — not the floor — so the floor need not over-tighten for it.
//
// The CARD path does not use this number — it no longer uses ANY cosine: it is an id lookup
// (resolveFactImage → resolveIllustrationSlug). This floor exists only for the tag path.
const IMAGE_TAG_FLOOR = 0.7;

/**
 * Runaway backstop for the one-shot reward line (generateReward) — phone-only, so it lives
 * here rather than in @hiraia/shared: unlike the card request (three callers, one constant)
 * nothing else sends this generation. The prompt asks for ≤20 words; at the worst measured
 * ratio (2.33 tokens/word, gate draws 2026-09-01) that is ~47 tokens, so 80 binds only on a
 * degenerate draw. Without it QVAC's effectivePredict is undefined = unlimited, and a
 * runaway holds withModelLock at ~7 t/s on the SD685.
 */
const REWARD_MAX_TOKENS = 80;

// ============================================================================
// GPU→CPU LOAD FALLBACK — the Adreno-610 trap.
// ============================================================================
// ACTIVE_MODEL asks for full GPU/Vulkan offload (gpuLayers 99) because a working
// GPU wins prefill, and prefill dominates TTFT. But on the Filipino budget
// mainstream (measured 2026-09-01: Xiaomi SM6225 / Adreno 610, 7.8 GB RAM —
// passes minRamGB 6) ggml-vulkan initialises and then the load dies with
// MODEL_LOAD_FAILED (52200). Left alone, that device has a working zero-model
// feed and a PERMANENTLY dead ask box.
//
// So the engine PROBES: try the configured GPU placement once; on a load failure,
// retry ONCE with the CPU config (`device: 'cpu', gpu_layers: 0` — the exact
// placement the retired kitten tier shipped with, so QVAC provably accepts it).
// Deliberately probe-and-fall-back rather than pre-gating on GPU model strings:
// allowlists rot, the probe is ground truth on the device in hand.
//
// WHAT CPU COSTS, PLAINLY: on SD685-class hardware a ~2B Q4_K_M runs ~11 t/s
// prefill / ~7 t/s decode (measured on the Redmi), so a ~500-token card prompt
// means TENS OF SECONDS of TTFT. That is the honest floor: a slow card beats a
// dead ask box, and the feed (the home screen) never depends on the model at all.
//
// The verdict is PERSISTED (same settings table engineStore uses for language/
// grade) so every later launch goes straight to CPU instead of failing the GPU
// probe first. But a verdict is EVIDENCE, not a life sentence — the catch that
// records it matches ANY load error, not just the measured 52200-after-vulkan-
// init, so one TRANSIENT failure (momentary GPU memory pressure from a game, a
// QVAC hiccup) on a Vulkan-capable phone must not pin it to tens-of-seconds
// TTFT forever. So the verdict EXPIRES two ways:
//   • APP VERSION: an app update (how a QVAC upgrade that fixes Vulkan would
//     arrive) invalidates it and re-probes the GPU once.
//   • AGE: after CPU_VERDICT_TTL_MS the GPU is re-probed regardless — an
//     offline-first rural install may never see another APK, and if
//     `Constants.expoConfig?.version` resolves null APP_VERSION is a stable
//     'unknown' that no update ever changes, so version-keying alone could pin
//     a device for its lifetime. The re-probe costs a genuinely CPU-only
//     device one failed load every TTL; an eternal false pin costs every card.
const CPU_FALLBACK_KEY = 'llmCpuFallback';
const APP_VERSION: string = Constants.expoConfig?.version ?? 'unknown';
/** How long a persisted CPU verdict is trusted before the GPU is probed again. */
const CPU_VERDICT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * True when this device has a LIVE CPU verdict: recorded by THIS app version, younger than
 * the TTL. Anything else — no verdict, another version's, an expired one, a clock that went
 * backwards past it, an unreadable value (including the legacy bare-version format, which
 * carries no timestamp) — probes the GPU, the honest default.
 */
async function readCpuFallbackVerdict(): Promise<boolean> {
  try {
    const v = await getSetting(CPU_FALLBACK_KEY);
    if (!v) return false;
    let version = '';
    let at = 0;
    try {
      const parsed = JSON.parse(v) as { version?: unknown; at?: unknown };
      version = typeof parsed.version === 'string' ? parsed.version : '';
      at = typeof parsed.at === 'number' ? parsed.at : 0;
    } catch {
      // Legacy format: the bare app-version string, no timestamp → age unknowable → expired.
      version = v;
    }
    if (version !== APP_VERSION) {
      console.log(
        `[LocalEngine] CPU-fallback verdict was recorded by app ${version || '?'}, now ${APP_VERSION} — ` +
          `re-probing the GPU (a QVAC/driver upgrade may have fixed Vulkan).`
      );
      return false;
    }
    const age = Date.now() - at;
    if (age < 0 || age >= CPU_VERDICT_TTL_MS) {
      console.log(
        `[LocalEngine] CPU-fallback verdict is ${age < 0 ? 'from the future (clock reset)' : `${Math.round(age / 86_400_000)}d old`} — ` +
          `re-probing the GPU (one failed load beats an eternal CPU pin from a transient failure).`
      );
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[LocalEngine] could not read CPU-fallback verdict:', e);
    return false; // no verdict → probe the GPU, the honest default
  }
}

/** Record that on this app version, today, the model only loads on CPU. */
async function persistCpuFallbackVerdict(): Promise<void> {
  try {
    await setSetting(CPU_FALLBACK_KEY, JSON.stringify({ version: APP_VERSION, at: Date.now() }));
  } catch (e) {
    // Non-fatal: the next launch just pays one failed GPU probe again.
    console.warn('[LocalEngine] could not persist CPU-fallback verdict:', e);
  }
}

// DOMAIN_IMAGE_CATEGORIES moved to @hiraia/shared (rag/images.ts) with the rest of the
// illustration-selection contract: the web demo resolves the same picture for the same fact
// through server/images.ts, and a second copy of the scoping table is exactly the kind of
// divergence that makes hiraia.org stop being a demo of the app.

/**
 * LocalEngine implementation using QVAC SDK.
 * Runs the configured Hiraia model (ACTIVE_MODEL — the Hiraia-2B, our CPT'd +
 * full-parameter-SFT'd Qwen3.5-2B) locally on-device for privacy and offline
 * capability.
 */
export class LocalEngine implements TutorEngine {
  private modelId: string | null = null;
  private isReadyFlag = false;
  private config: TutorConfig | null = null;
  // Has the model been warmed for this session (graph compiled, kernels hot)? See warmUp().
  // NOT keyed on the grade any more: the warm-up no longer prefills a grade-bearing prompt.
  private warmed = false;
  // In-memory grounding bank. Built at init; no native deps, so it works offline.
  private rag: RagStore | null = null;
  // Semantic embedder (LaBSE via QVAC) for the hybrid retriever. Loaded in the
  // BACKGROUND after the LLM (lexical-first); until ready, retrieval is lexical.
  private embedModelId: string | null = null;
  private semanticReady = false;
  // Illustration catalog (one LaBSE vector per bundled clip-art PNG); loaded with the
  // semantic init. Null → no picture is ever resolved (no picture, never wrong).
  private imageIndex: ImageIndex | null = null;

  /**
   * Resolve the LoRA adapter GGUF for a language to an absolute on-device file
   * path (for QVAC's `modelConfig.lora`). The adapter is DOWNLOADED from the
   * mirror and verified against its declared size + MD5 (config/model.ts
   * REMOTE_ASSETS) by the same gate as the base model — QVAC cannot fetch it for
   * us, `modelConfig.lora` is a bare string the llama.cpp plugin never resolves.
   *
   * ABSENCE-BY-DESIGN vs DOWNLOAD FAILURE — two different things:
   *
   *   • `loraRemote` EMPTY (the shipping Hiraia-2B): the model is a
   *     full-parameter SFT with no adapters AT ALL. Loading adapter-free is the
   *     designed, correct path — return undefined quietly, no warning.
   *   • A spec IS declared for the language but cannot be fetched/verified:
   *     THE ADAPTER IS REQUIRED. A download or verification failure THROWS; it
   *     does not quietly return undefined. (This is the Sailor2-line contract,
   *     kept live for any future adapter-ful model.)
   *
   * That used to be a fallback: log a warning, load the base model anyway, "a
   * working tutor beats no tutor". It is the wrong trade here, for three reasons.
   *
   *   1. The adapter is not a polish layer, it IS the tutor. Measured on the
   *      capability probes (2026-06-11): 3.75/5 through the adapter vs 1.78/5 on
   *      raw Sailor2. The base model fabricates science at a child who has no way
   *      to tell — and this project ranks factual accuracy above everything else.
   *      A tutor that is confidently wrong in fluent Tagalog is a worse product
   *      than a tutor that is honestly unavailable.
   *   2. Failing HERE is nearly free, and failing later is not. This resolves
   *      BEFORE the multi-GB base download starts (see initialize), so a missing
   *      adapter costs a child on prepaid data ~0 MB instead of the whole base
   *      model spent on a load we already know produces the degraded tutor.
   *   3. It cannot be shipped by accident. A silent fallback looks like a working
   *      build on a device check; a thrown error does not.
   *
   * The app is NOT bricked by this throw. The card feed — the home screen — is
   * zero-model and keeps working; engineStore catches this, parks `error`, and the
   * existing UI turns the feed's search field and the chat input into an honest
   * "tap to try again" (CardFeedScreen / chat.tsx). Only the tutor is withheld,
   * and only while it would be lying.
   *
   * Returns undefined ONLY when the config genuinely declares no adapter for the
   * language (`loraRemote` empty) — the documented "no adapters yet" state, which
   * is a deliberate choice rather than a failure.
   */
  private async resolveAdapterPath(
    language: Language,
    onProgress?: (pct: number) => void,
    signal?: AbortSignal
  ): Promise<string | undefined> {
    // ABSENCE BY DESIGN: a model that declares NO adapters at all (the
    // full-parameter Hiraia-2B) loads adapter-free without complaint — this is
    // its designed shape, not a degraded fallback, so no warning either.
    if (Object.keys(ACTIVE_MODEL.loraRemote).length === 0) {
      console.log(
        `[LocalEngine] ${ACTIVE_MODEL.displayName} is a full-parameter fine-tune — no adapter, by design`
      );
      return undefined;
    }
    // English routes through the TAGALOG adapter, not the base model: the
    // capability A/B (2026-06-11) scored the English probes 3.75/5 through the
    // tagalog adapter vs 1.78/5 on the raw base path — the SFT'd tutor behavior
    // (grounding adherence, abstention, brevity) transfers across languages,
    // while raw Sailor2 fabricates. No separate English LoRA needed.
    const adapterLang: AdapterLanguage | null =
      language === 'tagalog' || language === 'cebuano'
        ? language
        : language === 'english'
          ? 'tagalog'
          : null;
    if (!adapterLang) return undefined;
    const spec = ACTIVE_MODEL.loraRemote[adapterLang];
    if (!spec) {
      console.warn(
        `[LocalEngine] no adapter configured for ${adapterLang} — loading the RAW BASE MODEL. ` +
          `This is only correct while config/model.ts deliberately ships no adapter.`
      );
      return undefined;
    }
    try {
      const path = await ensureRemoteAsset(spec, onProgress, signal);
      console.log(`[LocalEngine] using ${adapterLang} adapter for ${language}: ${path}`);
      return path;
    } catch (e) {
      const cause = e instanceof Error ? e.message : String(e);
      console.error(
        `[LocalEngine] ADAPTER UNAVAILABLE (${adapterLang}, ${spec.filename}) — REFUSING to load. ` +
          `Without it the tutor scores 1.78/5 instead of 3.75/5 and fabricates science at a ` +
          `child, so an honest "unavailable" beats a silent downgrade. The base GGUF was NOT ` +
          `downloaded (this check runs first), so nothing was spent on prepaid data. ` +
          `Most likely cause: ${spec.url} is not reachable — check it is uploaded and 200s. ` +
          `Cause: ${cause}`
      );
      throw new Error(`${spec.label} unavailable — the tutor cannot load without it (${cause})`);
    }
  }

  async initialize(config: TutorConfig, onProgress?: (p: number) => void): Promise<void> {
    try {
      this.config = config;
      console.log(`Loading ${ACTIVE_MODEL.displayName} model...`);

      // Everything that must land before the model can load goes through the
      // verifying downloader, sharing ONE 0–100 progress signal split by true
      // relative size, so the bar never stalls at 0 nor jumps backwards.
      // (engineStore consumes this unchanged: >=100 still means "download done".)
      // For the shipping Hiraia-2B that is ONE file — the ~1.27 GB base GGUF; the
      // adapter band collapses to 0 because `loraRemote` is empty by design.
      const ADAPTER_BAND = Object.keys(ACTIVE_MODEL.loraRemote).length ? 4 : 0;
      const band = (from: number, to: number) => (pct: number) =>
        onProgress?.(Math.round(from + ((to - from) * pct) / 100));

      // Resolve the LoRA adapter for the active language — undefined (quietly)
      // for the adapter-free Hiraia-2B.
      //
      // ORDER IS LOAD-BEARING for any adapter-ful model: the small adapter is
      // fetched and verified BEFORE the base GGUF, and a failure throws
      // (resolveAdapterPath). The adapter is what makes such a model a tutor
      // rather than a fabulist, so a run that cannot have one is abandoned while
      // it has cost the child ~100 MB of prepaid data instead of the full
      // download. Do not "optimise" this by starting the base download first or
      // in parallel.
      const loraPath = await this.resolveAdapterPath(config.language, band(0, ADAPTER_BAND));

      if (ACTIVE_MODEL.modelSrc) {
        // For a REMOTE GGUF (our nginx mirror), download it ourselves and hand QVAC
        // the LOCAL path. This is NOT just a transport preference: our downloader is
        // the only thing that VERIFIES the bytes against a declared size + MD5
        // before installing them. QVAC's own https loader has no checksum support at
        // all (sha256 is honoured only for `registry://` sources) and, worse, on a
        // size mismatch it leaves the bad file in place and RESUMES onto it — so a
        // captive-portal login page becomes the permanent prefix of a
        // correct-length model. See modelDownload.ts. A local path or pear:// key is
        // passed straight through. ensureRemoteAsset drives the loader's download
        // band; once it returns, loadModel reads from disk (no network) so its own
        // onProgress just snaps to 100.
        const src =
          ACTIVE_MODEL.remote
            ? await ensureRemoteAsset(ACTIVE_MODEL.remote, band(ADAPTER_BAND, 100))
            : ACTIVE_MODEL.modelSrc;

        // Load the configured GGUF. `lora` applies a downloaded + verified
        // adapter when the model declares one — absent for the full-parameter
        // Hiraia-2B (absence-by-design); a failed adapter download has already
        // thrown above rather than reaching this point.
        //
        // Placement is PROBE-AND-FALL-BACK (see the CPU-fallback block at the top
        // of this file): GPU as configured, then ONE CPU retry on a load failure,
        // with the verdict persisted per app version.
        const loadWith = (placement: { gpu_layers: number; device?: 'cpu' }) =>
          loadModel({
            modelSrc: src,
            modelType: ACTIVE_MODEL.modelType,
            modelConfig: {
              ctx_size: ACTIVE_MODEL.ctxSize,
              ...placement,
              // STOP SEQUENCE. A card is one paragraph, and the shipping model does not stop
              // on its own: with nothing to stop it, it writes the correct card and then
              // degenerates into repeated "**Pansin:** … **Paliwanag:** …" until the token
              // cap. The server paths send this per-request as `stop`; QVAC has no per-request
              // stop, so it is set once here for the model — `stop_sequences` is the SDK's
              // field name for it (the llamacpp plugin renames it to the addon's
              // `reverse_prompt`; passing THAT name straight through would be silently dropped
              // by the load-model schema). Same shared constant the web route and the gate
              // send (@hiraia/shared CARD_STOP) — the phone was the one path sending neither
              // this nor the thinking-disable.
              stop_sequences: [...CARD_STOP],
              ...(loraPath ? { lora: loraPath } : {}),
            },
            onProgress: (p) => {
              // Local-file load — no network. Log only; the bar already finished its
              // download band via ensureRemoteAsset above.
              console.log(`[LocalEngine] ${ACTIVE_MODEL.displayName} loading: ${Math.round(p.percentage ?? 0)}%`);
            },
          });

        const cpuVerdict = await readCpuFallbackVerdict();
        const gpuLayers = cpuVerdict ? 0 : ACTIVE_MODEL.runtime.gpuLayers;
        if (cpuVerdict) {
          console.log(
            `[LocalEngine] persisted CPU-fallback verdict (app ${APP_VERSION}) — ` +
              `loading on CPU directly, skipping the GPU probe this device already failed`
          );
        }
        try {
          this.modelId = await loadWith(
            cpuVerdict ? { gpu_layers: 0, device: 'cpu' } : { gpu_layers: gpuLayers }
          );
        } catch (e) {
          // THE ADRENO-610 TRAP. gpuLayers>0 asked for the GPU and the load died
          // (MODEL_LOAD_FAILED 52200 on the measured SM6225). Retry ONCE on CPU —
          // slow (tens of seconds of TTFT on SD685-class hardware) but ALIVE,
          // which beats a permanently dead ask box. A load that fails for a
          // non-GPU reason fails the CPU retry too and surfaces as before.
          if (cpuVerdict || gpuLayers <= 0) throw e;
          console.error(
            `[LocalEngine] GPU LOAD FAILED (gpu_layers ${gpuLayers}) — ` +
              `${e instanceof Error ? e.message : String(e)}. ` +
              `RETRYING ONCE on CPU (device:'cpu', gpu_layers:0).`
          );
          this.modelId = await loadWith({ gpu_layers: 0, device: 'cpu' });
          console.error(
            `[LocalEngine] CPU FALLBACK SUCCEEDED — this device cannot run the GPU path. ` +
              `Persisting the verdict for app ${APP_VERSION}; later launches load straight ` +
              `on CPU (an app update or the ${Math.round(CPU_VERDICT_TTL_MS / 86_400_000)}-day ` +
              `TTL re-probes the GPU once).`
          );
          await persistCpuFallbackVerdict();
        }
      } else {
        // No source configured — load a stock SDK model as a placeholder so the
        // app still runs.
        console.warn(
          `[LocalEngine] ${ACTIVE_MODEL.displayName} has no modelSrc — loading a stock SDK model as a placeholder.`
        );
        this.modelId = await loadModel({
          modelSrc: QWEN3_1_7B_INST_Q4,
          modelConfig: { ctx_size: ACTIVE_MODEL.ctxSize },
          onProgress: (p) => {
            const pct = Math.round(p.percentage ?? 0);
            if (onProgress) {
              onProgress(pct);
            }
          },
        });
      }

      // Build the lexical grounding retriever over the fact bank in cards.db. Nothing is
      // loaded here beyond a row count — RagStore reads the inverted index per query and
      // materialises only the handful of facts it returns (see data/cardDb openFactSource).
      // SqlFactSource's constructor THROWS on a truncated or bank-mismatched cards.db, and
      // openFactSource does not catch it. Unguarded, that rejection unwinds to this method's
      // catch and becomes `Failed to initialize LocalEngine` — engineStore then parks the app
      // on an error screen and the child gets no chat at all. Ungrounded answers are a far
      // better failure than no tutor, so the throw is folded into the same null the
      // could-not-open path already returns and handled by the branch below.
      let facts: SqlFactSource | null = null;
      try {
        facts = await openFactSource();
      } catch (e) {
        console.error('[LocalEngine] cards.db fact bank unusable — answers will be UNGROUNDED:', e);
      }
      if (facts) {
        this.rag = new RagStore(facts);
        console.log(`RAG bank ready: ${this.rag.size} facts (cards.db ${facts.bankHash ?? '?'})`);
      } else {
        // There is no in-bundle fallback bank any more, so this is not a degraded mode with a
        // slower path — it is NO grounding at all, and every answer becomes ungenerated or
        // unsourced. Loud on purpose.
        console.error('[LocalEngine] fact bank unavailable — answers will be UNGROUNDED');
      }

      // Load the semantic embedder + vectors blob in the BACKGROUND — the app is
      // usable on lexical retrieval immediately; the hybrid upgrades in when ready.
      void this.initSemantic();

      // NO warm-up here — see prime(). It stays the CALLER's call (engineStore.changeLanguage,
      // once, just before it flips isReady) so readiness owns when the cold start is paid.
      // Historically it also had to wait for the grade to settle, because the warm-up prefilled
      // a grade-bearing chat system prompt (~78 s on the target Redmi, measured `warm-up
      // complete (77835ms)`) and a grade change meant paying it twice. The warm-up is
      // grade-independent now, so that constraint is gone; what remains is that a cold prefill
      // should happen where the loader bar can cover it, not inside the model load.
      this.isReadyFlag = true;

      console.log(`${ACTIVE_MODEL.displayName} model loaded successfully`);
    } catch (error) {
      console.error('Failed to load model:', error);
      throw new Error(
        `Failed to initialize LocalEngine: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Run a single throwaway completion to warm the model — compile the graph and heat the
   * kernels — so the child's first real card does not pay a cold start. Driven by `prime()`,
   * never by initialize() itself (see there). Non-fatal: a failure just means the first real
   * generation is the slow one.
   *
   * IT NO LONGER PREFILLS THE CHAT SYSTEM PROMPT. That ~1.2-1.5k-token prompt existed to
   * prime a KV cache every chat turn re-hit, and that reuse WAS the TTFT fix — but the chat
   * surface is gone and both surviving generations (`answerQuery`, `generateReward`) send ONE
   * user message with no system prompt, so they missed the cache by construction. Priming it
   * was measured at ~78 s of prefill on the target Redmi, paid at init and AGAIN on every
   * grade change, for a cache nothing could hit. What is warmed now is a short user-only turn
   * of the shape the card writer actually sends, which is grade-independent — so the whole
   * grade-keyed re-prime machinery (primedGrade, setGrade → warmUp) goes with it.
   */
  private async warmUp(): Promise<void> {
    if (!this.modelId) return;
    try {
      const t0 = Date.now();
      // predict:1 (not 0): generating a single throwaway token guarantees the prompt is fully
      // prefilled. QVAC 0.13 has no public `prefill: true` completion flag (only an internal
      // VLA path), and predict:0 risks short-circuiting before the eval — so the 1-token
      // warm-up stays the reliable one. The token is discarded.
      // Warm the shape the card writer actually sends: a real `buildCardPrompt`, in the
      // reader's language, over one short throwaway fact. Kept tiny on purpose — the point is
      // to compile the graph and heat the kernels, not to prefill anything reusable.
      const warmPrompt = buildCardPrompt({
        query: WARMUP_QUERY,
        facts: [WARMUP_FACT],
        grade: this.config?.gradeLevel ?? DEFAULT_GRADE,
        language: this.config?.language ?? 'tagalog',
      });
      const run = completion({
        modelId: this.modelId,
        history: [{ role: 'user', content: warmPrompt }],
        stream: true,
        generationParams: {
          temp: WARMUP_TEMP,
          predict: 1,
          // Same switch the real card generation flips — a warm-up that ran with the
          // reasoning channel on would be heating a different code path than the product's.
          reasoning_budget: CARD_REASONING_BUDGET,
        },
      });
      // Drain and discard — we only care about the prefill side effect.
      for await (const _event of run.events) {
        // no-op
      }
      // Cold-prefill telemetry: how long the unwarmed prefill took + its token count.
      let warmStat = '';
      try {
        const s = await run.stats;
        if (s)
          warmStat = ` · prefill ${s.timeToFirstToken ?? '?'}ms · ${s.promptTokens ?? '?'} prompt tok · ${s.backendDevice ?? '?'}`;
      } catch {
        /* best-effort */
      }
      console.log(`[LocalEngine] warm-up complete (${Date.now() - t0}ms)${warmStat}`);
      this.warmed = true;
    } catch (e) {
      console.warn('[LocalEngine] warm-up failed (non-fatal):', e);
    }
  }

  /**
   * Warm the model for `grade`. This is the init-time warm-up, made EXPLICIT so the caller
   * owns when it runs (initialize() does not warm up). It compiles the graph and heats the
   * kernels so the child's first real card is not the cold one.
   *
   * `grade` is applied to the config (the card prompt is pitched at it) but is no longer
   * baked into the warm-up prompt: the prefill this used to prime — the chat system prompt —
   * fed a KV cache nothing reads any more. So this is now idempotent for the whole session,
   * and calling it again for a different grade costs nothing. It was `primeSystemPrompt`;
   * the name would be a lie.
   *
   * Deliberately does NOT take the shared model lock. It only ever runs on an engine that is
   * not ready yet, so nothing can be generating on it — while the lock is module-wide and may
   * still be held by a stale completion belonging to the engine we just shut down (a feed
   * reward prefetch holds it for a whole generation, tens of seconds on this device). Taking
   * it here would make readiness wait on that unrelated generation, and a completion on an
   * unloaded model that never settles would strand isReady for the whole session.
   */
  async prime(grade: GradeLevel): Promise<void> {
    if (!this.config) return;
    this.config = { ...this.config, gradeLevel: grade };
    if (this.warmed) return;
    await this.warmUp();
  }

  /**
   * Apply a new student grade to a READY engine. No model reload (the LoRA adapter is
   * per-language, not per-grade) and — since the grade-keyed system-prompt prefill is gone —
   * NO generation either: the grade is read straight out of `config` by `answerQuery` when it
   * builds the card prompt. This used to re-run a ~78 s prefill under the model lock on every
   * tap of the grade setting, to refresh a KV cache no surviving code path could hit.
   */
  async setGrade(grade: GradeLevel): Promise<void> {
    if (!this.config) return;
    this.config = { ...this.config, gradeLevel: grade };
  }

  /**
   * One-shot warm "reward card" line for the question-cards feed. GROUNDED strictly on
   * the topic labels the child actually read — the model writes ONLY the celebration and
   * is told not to add facts. The caller (cardStore) guards the output and falls back to
   * a deterministic template, so a hallucinated or empty result never reaches a child.
   */
  async generateReward(topics: string[], count: number, language: string): Promise<string> {
    if (!this.modelId || !this.isReadyFlag) {
      throw new Error('Engine not initialized. Call initialize() first.');
    }
    // The topic names are printed as chips under this line, in the reader's language; a card's
    // stored label is often an English phrase, so asking the model to name topics mixes languages
    // mid-sentence. It gets the COUNT only, and is told not to name anything.
    const n = topics.length;
    const byLang: Record<string, string> = {
      tagalog:
        `Isang bata ang kabababasa lang ng ${count} pahina tungkol sa ${n} paksa sa agham. ` +
        `Sumulat ng ISANG maikli, masaya, at nakaka-engganyong pangungusap sa Tagalog na bumabati sa kanya. ` +
        `HUWAG banggitin ang pangalan ng anumang paksa at HUWAG magdagdag ng science fact — pagbati LANG. ` +
        `Wag hihigit sa 20 salita.`,
      english:
        `A child has just read ${count} pages covering ${n} science topics. ` +
        `Write ONE short, cheerful, encouraging English sentence congratulating them. ` +
        `Do NOT name any topic and do NOT add science facts — praise ONLY. Under 20 words.`,
      cebuano:
        `Usa ka bata ang bag-o lang nakabasa og ${count} ka panid mahitungod sa ${n} ka hilisgutan sa siyensya. ` +
        `Pagsulat og USA ka mubo, malipayon, ug makadasig nga tudling-pulong sa Binisaya nga nagdayeg kaniya. ` +
        `AYAW hisguti ang ngalan sa bisan unsang hilisgutan ug ayaw pagdugang og science fact — pagdayeg LANG. ` +
        `Ilalom sa 20 ka pulong.`,
    };
    const instruction = byLang[language] ?? byLang.tagalog!;
    const run = completion({
      modelId: this.modelId,
      history: [{ role: 'user', content: instruction }],
      stream: true,
      generationParams: {
        temp: 0.7, // warmth/variety — this is prose, not a fact
        reasoning_budget: CARD_REASONING_BUDGET, // same thinking-model trap as the card path
        // Runaway backstop. QVAC's effectivePredict is `generationParams.predict ??
        // modelCfg.predict` and the model config sets none — without this a degenerate draw
        // decodes UNBOUNDED at ~7 t/s on the SD685, holding the model lock. The line is
        // asked for ≤20 words (worst measured ratio 2.33 tok/word → ~47 tokens), so 80
        // bounds only a failure, never a legitimate reward line.
        predict: REWARD_MAX_TOKENS,
      },
    });
    let out = '';
    for await (const event of run.events) {
      if (event.type === 'contentDelta' && event.text) out += event.text;
    }
    return out.trim();
  }

  /**
   * Grounded one-shot FACT CARD for a kid's typed feed query — used ONLY as the fallback when
   * the local card search finds nothing (the feed is retrieval-first). Retrieves from the full
   * fact bank and states the answer STRICTLY from those facts.
   *
   * THREE outcomes, not two (the caller renders one card per outcome):
   *   grounded            → a printed fact card;
   *   !grounded           → an honest in-domain gap ("no page on that yet");
   *   !grounded+offDomain → not science at all ("roblox") → "I'm only a science tutor".
   * The last two are model-FREE: nothing is generated, so nothing can be hallucinated.
   * Optional — callers feature-detect.
   *
   * `slug` is the card's ILLUSTRATION, resolved here rather than in the store because this is
   * where the grounded facts exist as whole facts. It comes from retrieval alone — the model is
   * never asked what to draw — and is `null` far more often than not (the measured floor leaves
   * ~88% of dynamic cards unillustrated, which the poster layout prints as an ordinary card).
   * Only the grounded outcome can carry one: the two miss shapes are not about anything in
   * particular, so there is nothing to illustrate.
   *
   * It is resolved AFTER the generation, from the fact the printed card is actually about
   * (`attributeCardToFact`) rather than from `hits[0]` — the prompt lets the model print any of
   * the four retrieved facts, and illustrating the one it did not print is how a carabao card
   * ended up under a tamaraw. Resolving after also takes the embed off the path to the first
   * painted card, which it was on for every question including the ~88% that carry no picture.
   */
  async answerQuery(
    query: string,
    language: string
  ): Promise<{ text: string; grounded: boolean; offDomain: boolean; slug: string | null }> {
    if (!this.modelId || !this.isReadyFlag) {
      throw new Error('Engine not initialized. Call initialize() first.');
    }
    // Retrieval applies its own confidence floor; the diagnostics come out of the same pass.
    const r = await this.ragSearchDiag(query, 4);
    // OFF-DOMAIN. Only classifiable when the embedder ran: without it topCos is 0 and every
    // query would look off-domain, so a warming/failed embedder falls through to the ordinary
    // gap path below rather than telling a child their science question isn't science. It is
    // not a silent hole: in that state the local card search has already found nothing either,
    // so the child gets the honest gap line with NO topic suggested (the suggestion comes from
    // the same search that just came back empty) — a vaguer card, not a wrong one. Classifying
    // on the lexical half alone would be worse than vague: without a cosine to save them,
    // "pterodactyl", "brontosaurus" and "narwhal" are all unreachable words too.
    //
    // `lexicallyUnreachable` runs the spelling probe, so it is asked HERE, behind `lexEmpty`,
    // rather than being returned by retrieval: the chat path shares that retrieval and never
    // reads this. Retrieval used the CONFIG language, so the probe must too.
    const ragLang: Language = this.config?.language ?? 'english';
    const unreachable =
      r.semantic && r.lexEmpty && !!this.rag && this.rag.lexicallyUnreachable(query, ragLang);
    if (r.semantic && isOffDomain(r.topCos, unreachable)) {
      return { text: '', grounded: false, offDomain: true, slug: null };
    }
    // IN-DOMAIN GAP, form 1: no word of the query exists anywhere in the bank. Semantic
    // retrieval will still hand back its nearest neighbours (that is what a nearest-neighbour
    // search does), but they are about something else — "roblox" fused onto a mangrove-roots
    // fact and the model dutifully wrote a card about mangrove roots. Grounding we know is
    // unrelated to the question is not grounding, so no card gets written.
    if (r.semantic && r.lexEmpty)
      return { text: '', grounded: false, offDomain: false, slug: null };
    const hits = r.hits;
    // Form 2: retrieval abstained outright (top cosine under the bank's own floor).
    if (!hits.length) return { text: '', grounded: false, offDomain: false, slug: null };
    // Pitched at the student's grade (engineStore → config; kept current by setGrade).
    const grade = this.config?.gradeLevel ?? DEFAULT_GRADE;
    // The instruction ITSELF lives in @hiraia/shared (prompts/cards.ts), not here, because the
    // web demo's /api/demo/card route runs the SAME prompt against the VPS llama-server: a card
    // printed on hiraia.org and a card printed in the APK have to be the same card. The wording
    // is calibrated (the deleted hedge, the "print the nearest FACT whole" escape, the 30-word
    // cap and the SAGOT:/ANSWER:/TUBAG: cue sanitizeCardAnswer strips) — see the notes there —
    // so a second copy of it would silently lose that calibration.
    // The retrieved bodies in the card's language, hoisted: they are what the model is given
    // to write from AND what the printed card is attributed back to below.
    const factTexts = hits.map((h) => h.content);
    const instruction = buildCardPrompt({ query, facts: factTexts, grade, language });
    // ONLY the generation is serialized on the single-instance model. The three model-free
    // outcomes above return before this point and take no lock at all, so "I'm only a science
    // tutor" prints immediately instead of queueing behind an in-flight reward line or chat
    // stream to display a fixed sentence.
    const out = await withModelLock(async () => {
      const run = completion({
        modelId: this.modelId!,
        history: [{ role: 'user', content: instruction }],
        stream: true,
        generationParams: {
          temp: CARD_TEMP, // low temp: faithful to the retrieved facts
          // The shipping model is a THINKING model. Left on, the answer lands in the
          // reasoning channel and `content` comes back EMPTY — every card would read as a
          // generation failure. The server paths flip the same switch as
          // `chat_template_kwargs: { enable_thinking: false }`; QVAC's transport for it is
          // this numeric budget (0 = off). Shared constant so the two cannot drift.
          reasoning_budget: CARD_REASONING_BUDGET,
          // The RUNAWAY BACKSTOP (@hiraia/shared CARD_MAX_TOKENS) — the same cap the web
          // route and the gate send. The phone is the SLOWEST transport (~7 t/s decode on
          // the SD685) and was the only caller not sending it: QVAC's effectivePredict is
          // `generationParams.predict ?? modelCfg.predict`, both undefined, i.e. UNLIMITED —
          // a draw that never hits a CARD_STOP entry would decode until the 4096 context
          // filled (~8 minutes under withModelLock, a frozen ask box). CARD_STOP ends every
          // measured degeneration class; this bounds the unmeasured one.
          predict: CARD_MAX_TOKENS,
        },
      });
      let acc = '';
      for await (const event of run.events) {
        if (event.type === 'contentDelta' && event.text) acc += event.text;
      }
      return acc;
    });
    const text = out.trim();

    // THE PICTURE, resolved after the card is written and from the fact the card is ABOUT.
    //
    // The prompt permits the model to print any of the four retrieved facts ("isulat na lang
    // nang buo ang pinakamalapit na FACT"), so `hits[0]` — the best hit for the QUERY — is not
    // reliably the fact on the card: "ano ang carabao" retrieves the tamaraw/carabao contrast
    // first and the card that comes back states the carabao. `attributeCardToFact` reads the
    // printed sentence and says which of the four it restates; ties and no-overlap keep
    // `hits[0]`, so this only ever CORRECTS a demonstrable mismatch.
    //
    // Attributed on the SANITIZED text, because the raw generation still carries the retired
    // `[image: …]` habit and a stray `</think>`, and those tokens are not evidence about which
    // fact was printed.
    //
    // Running here rather than before the generation also keeps the embedder and the LLM
    // strictly sequential on a device that runs one model at a time — the reason it used to run
    // first — while taking its LaBSE forward pass off the path to the first painted card.
    // Best-effort: a failed resolve is a card without a picture, never a failed card.
    let slug: string | null = null;
    if (r.facts.length) {
      const printed = sanitizeCardAnswer(text) ?? text;
      const chosen = r.facts[attributeCardToFact(printed, factTexts)]!;
      slug = await this.resolveFactImage(chosen).catch(() => null);
    }
    return { text, grounded: true, offDomain: false, slug };
  }

  /**
   * Off-domain judgement for a WEAK card-search hit (TutorEngine.weakHitOffDomain).
   *
   * EXACTLY the model-free gate `answerQuery` opens with — embed the normalized query,
   * retrieve, then `isOffDomain(topCos, unreachable)` with the OOV arm gated on real lexical
   * UNREACHABILITY — just consulted BEFORE a weak hit is served rather than after a miss.
   *
   * The OOV arm is NOT forced on, and that is a measured correction (2026-09-01, live
   * pipeline probes). An earlier version read the weak band as "no lexical evidence the
   * corpus knows this as a subject" and forced the arm; but ordinary body-function phrasings
   * — "para saan ang ating puso" (tl), "unsay gamit sa atong mata" (ceb) — land in the SAME
   * band (aboutness 0.015–0.037, diluted by function words) at topCos 0.537–0.586, which
   * OVERLAPS the junk band (0.479–0.545): the forced arm refused five canonical grade-school
   * science questions that were previously served the topically right card. No cosine floor
   * separates the two classes, and no cheap lexical rescue does either (head-anywhere,
   * head-on-served-card and df-of-head were all probed: kumusta/boring/adobo are HEAD tokens
   * on their junk cards too). So the consult now refuses only what the calibrated miss-path
   * gate itself would refuse — a query whose every word is unreachable in the bank (rare for
   * a weak HIT, whose words by construction matched a card) or one under the HARD floor
   * (0.40) — accepting that shared-vocabulary junk ("kumusta ka" → the hand-wave card) is
   * served again. That asymmetry is the product's own doctrine: a false serve costs a wry
   * card, a false refusal tells a child their science question is not science.
   *
   * Deliberately NOT gated on `isReady()`: this needs the embedder + the RAG store, not the
   * LLM. No model lock either — nothing is generated. Null (cannot judge: embedder still
   * downloading/warming/failed) tells the caller to serve the hit, today's behaviour.
   */
  async weakHitOffDomain(query: string): Promise<boolean | null> {
    const r = await this.ragSearchDiag(query, 4);
    if (!r.semantic) return null;
    // Same conjunctive arm as answerQuery: the spelling probe runs only behind lexEmpty, and
    // in the CONFIG language — the one retrieval itself just used.
    const ragLang: Language = this.config?.language ?? 'english';
    const unreachable = r.lexEmpty && !!this.rag && this.rag.lexicallyUnreachable(query, ragLang);
    return isOffDomain(r.topCos, unreachable);
  }

  async generateVisual(prompt: string): Promise<ImageResult> {
    // For now, return a placeholder
    // In the future, we'll integrate with an image generation model
    throw new Error('Visual generation not yet implemented');
  }

  /**
   * Load the LaBSE embedder (downloaded on first run) + the bundled int8 vectors
   * blob, then attach the semantic index to the lexical RagStore. Runs in the
   * background; any failure leaves the app on lexical-only retrieval.
   */
  private async initSemantic(): Promise<void> {
    try {
      if (!this.rag) return;
      const t0 = Date.now();
      // 1) embedder (LaBSE GGUF via the QVAC llamacpp-embedding plugin). Same
      // resilient local download as the base model (retry/resume/background) — it's
      // another remote file in the "lots of files" first-run set. Background phase,
      // so its progress is logged, not surfaced on the loader bar.
      const embedSrc = EMBEDDER.remote
        ? await ensureRemoteAsset(EMBEDDER.remote, (pct) =>
            console.log(`[LocalEngine] LaBSE downloading: ${pct}%`)
          )
        : EMBEDDER.modelSrc;
      this.embedModelId = await loadModel({
        modelSrc: embedSrc,
        modelType: EMBEDDER.modelType,
        modelConfig: EMBEDDER.modelConfig,
        onProgress: (p) =>
          console.log(`[LocalEngine] LaBSE loading: ${Math.round(p.percentage ?? 0)}%`),
      });
      // 2) bundled vectors blob → Int8Array
      const asset = Asset.fromModule(VECTORS_BLOB_ASSET);
      await asset.downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      const bytes = await new File(uri).bytes(); // Uint8Array
      const data = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      // 3) attach. The guard inside attachSemantic catches a stale blob two ways: the count
      // must equal the bank's row count, and — since an edit that rewrites facts without
      // adding or removing any leaves the count identical while every vector goes wrong —
      // the blob's `bankHash` must equal the one build-facts-db.py stamped into cards.db.
      // Both are md5(science-facts.jsonl)[:12], written by the two builders independently.
      this.rag.attachSemantic(
        new SemanticIndex({
          dims: VECTORS_META.dims,
          scale: VECTORS_META.scale,
          count: VECTORS_META.count,
          langs: VECTORS_META.langs,
          data,
        }),
        VECTORS_META.bankHash
      );
      this.semanticReady = true;
      // Warm the embed graph so the FIRST real ragSearch doesn't eat the cold
      // build/alloc spike (the LLM has warmUp(); the embedder had none, and the
      // LaBSE forward pass is a real share of the per-query retrieval cost).
      // Throwaway + best-effort: never block readiness on it.
      try {
        const tw = Date.now();
        await this.embed('init');
        console.log(`[LocalEngine] embed warm (${Date.now() - tw}ms)`);
      } catch {
        /* non-fatal — first real query just pays the cold cost */
      }
      console.log(`[LocalEngine] semantic hybrid ready (${Date.now() - t0}ms)`);
    } catch (e) {
      console.warn('[LocalEngine] semantic init failed — staying lexical-only:', e);
      this.semanticReady = false;
    }
    // Image catalog blob (~3MB): substrate of the retired tag path (`resolveImageTag`) and
    // nothing else now — the card path is an id lookup. Independent of the fact-bank blob;
    // its failure costs nothing the product currently exercises, never retrieval.
    try {
      const asset = Asset.fromModule(IMAGE_VECTORS_BLOB_ASSET);
      await asset.downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      const bytes = await new File(uri).bytes();
      const expected = IMAGE_VECTORS_META.count * IMAGE_VECTORS_META.dims;
      if (bytes.byteLength !== expected) {
        throw new Error(`stale image blob: ${bytes.byteLength} bytes, expected ${expected}`);
      }
      this.imageIndex = new ImageIndex({
        dims: IMAGE_VECTORS_META.dims,
        scale: IMAGE_VECTORS_META.scale,
        count: IMAGE_VECTORS_META.count,
        slugs: IMAGE_VECTORS_META.slugs,
        data: new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      });
      console.log(`[LocalEngine] image index ready (${IMAGE_VECTORS_META.count} slugs)`);
    } catch (e) {
      console.warn('[LocalEngine] image index failed — the tag path is off (card art is id-mapped):', e);
      this.imageIndex = null;
    }
  }

  /**
   * THE ONE SCAN — now serving ONLY the retired tag path (`resolveImageTag`); the card path
   * is an id lookup and never embeds. Embed `text` with the (already warm) LaBSE embedder and
   * take the nearest illustration in the bundled catalog.
   *
   * `accept` is the shared `imageDomainScope` predicate — the fact's domain scope, and ONLY
   * that. Art PRESENCE is deliberately not in it: filtering the scan by what this install can
   * draw would make the ranking a property of the device, so two devices would resolve the
   * same tag differently. Presence is asked of the WINNER instead, by `acceptImageMatch` in
   * the caller.
   *
   * No floor here on purpose: the caller applies its own measured one (IMAGE_TAG_FLOOR), and
   * the near miss is logged either way.
   */
  private async nearestImage(
    text: string,
    accept: (slug: string) => boolean,
    label: string
  ): Promise<{ slug: string; cosine: number } | null> {
    if (!this.imageIndex || !this.semanticReady || !this.embedModelId) return null;
    try {
      const t0 = Date.now();
      const q = Float32Array.from(await this.embed(text)); // CLS + L2 (embdNormalize:2)
      const hit = this.imageIndex.best(q, accept);
      console.log(
        `[LocalEngine] ${label} "${text.slice(0, 60)}" → ${hit?.slug ?? '(none)'} ` +
          `(cos ${hit ? hit.cosine.toFixed(3) : '-'}, ${Date.now() - t0}ms)`
      );
      return hit;
    } catch (e) {
      console.warn(`[LocalEngine] ${label} failed:`, e);
      return null;
    }
  }

  /**
   * THE CARD'S ILLUSTRATION — the picture for a GENERATED card, resolved from the GROUNDED
   * FACT the card states. This is the product path; `resolveImageTag` below is the retired one.
   *
   * An ID LOOKUP, not a similarity search. The precedence, its measured basis and the reason
   * the runtime LaBSE scan was deleted (27% right / 52% clearly wrong unfloored; no floor
   * rescues it) live in @hiraia/shared (rag/images.ts, `resolveIllustrationSlug`):
   *
   *   1. CARD INDEX — factId → the feed card bound to this fact → its authored slug
   *      (`cardSlugForFact`); 66% of the bank, most of it engravings drawn FOR the fact.
   *   2. FACT_IMAGE — the curated fact_id → slug map (~10% of the bank, 82% right).
   *   3. null — the poster layout, still an ordinary outcome, never a cosine guess.
   *
   * Async only to keep the signature stable for its callers — nothing here embeds or awaits.
   * The model is not consulted at any point. It writes the card; the picture is retrieval's.
   */
  async resolveFactImage(fact: ScienceFact): Promise<string | null> {
    // PRESENCE is the renderer's own question, so ask it the renderer's way: `artSourceFor`
    // is what ResponseCard resolves the slug through, and it answers for both halves of the
    // art library (bundled in the APK, or backfilled to disk since install). A slug this
    // install cannot draw yields to the next path — both paths are high-precision id
    // lookups, so the fallback is the second-best answer, never noise.
    return resolveIllustrationSlug({
      factId: fact.id,
      cardSlugOf: cardSlugForFact,
      curatedSlugOf: (id) => FACT_IMAGE[id],
      isPresent: (slug) => artSourceFor(slug) != null,
    });
  }

  /**
   * Resolve a MODEL-SUPPLIED `[image: …]` description to a bundled illustration slug. Returns
   * null below the confidence floor — better no picture than a mismatched one.
   *
   * STILL NOTHING CALLS THIS, AND THAT IS STILL ON PURPOSE — DO NOT DELETE IT AS DEAD CODE.
   * Its only caller was chatStore, gone with the chat surface. The card path deliberately does
   * NOT come through here: `desc` is a description the MODEL chose, and the settled
   * architecture is that the model does not pick illustrations — so the card asks
   * `resolveFactImage` on the grounded fact the card states, instead of pretending a fact's
   * text is a tag.
   * This is kept for the one input it is actually shaped for, should a tag ever be wanted
   * again; the model does still EMIT tags (retired SFT habit), but they are stripped in
   * `sanitizeCardAnswer` and the real fix for the emission is training-side — drop the
   * image-tag rows from the SFT mix — not a prompt patch and not a resolver.
   */
  async resolveImageTag(
    desc: string,
    minCosine: number = IMAGE_TAG_FLOOR,
    domain?: ScienceFact['domain']
  ): Promise<{ slug: string; cosine: number } | null> {
    const scope = imageDomainScope({ domain, categoryOf: (slug) => IMAGE_CATEGORY[slug] });
    if (!scope) return null;
    const hit = await this.nearestImage(desc, scope, 'resolveImageTag');
    return acceptImageMatch(hit, {
      floor: minCosine,
      isPresent: (slug) => artSourceFor(slug) != null,
    });
  }

  async embed(text: string): Promise<number[]> {
    if (!this.embedModelId) throw new Error('Embedder not loaded');
    // LaBSE takes raw text (no e5-style prefix); the load config applies CLS
    // pooling + L2 normalize, so this matches the bundled corpus vectors.
    const { embedding } = await embed({ modelId: this.embedModelId, text });
    return embedding;
  }

  async ragSearch(
    query: string,
    topK: number,
    context = '',
    seenIds?: ReadonlySet<string>
  ): Promise<RagResult[]> {
    return (await this.ragSearchDiag(query, topK, context, seenIds)).hits;
  }

  /**
   * ragSearch plus the two retrieval diagnostics the feed's card path needs to tell an
   * IN-DOMAIN GAP from an OFF-DOMAIN query: `topCos` (best LaBSE cosine of the BARE query) and
   * `lexEmpty` (no word of the query appears anywhere in the bank). Both are computed inside
   * retrieval anyway, so this costs nothing. `semantic` reports whether the embedder actually
   * ran — when it did not, topCos is 0 and NEITHER signal may be used to classify.
   *
   * `facts` are the hits as WHOLE facts, parallel to `hits`, not the display-language strings
   * `hits` carries. ALL of them, not just the best one: the card may be written from any of the
   * four (see `attributeCardToFact`), and illustrating the chosen one needs its id for the
   * curated map, its domain for scoping and its ENGLISH body to embed — RagResult keeps none
   * of the three.
   */
  private async ragSearchDiag(
    query: string,
    topK: number,
    context = '',
    seenIds?: ReadonlySet<string>
  ): Promise<{
    hits: RagResult[];
    facts: ScienceFact[];
    topCos: number;
    lexEmpty: boolean;
    semantic: boolean;
  }> {
    if (!this.rag) return { hits: [], facts: [], topCos: 0, lexEmpty: true, semantic: false };
    const language: Language = this.config?.language ?? 'english';
    // Hybrid when the embedder is warm; lexical-first while it loads (or if it
    // failed). Only confidently-relevant hits — a small model is misled by noise.
    let hits;
    // The BARE-query diagnostics (R1). A context-folded R2 answers a different question than
    // the one the child typed, so it must never decide whether that question was on-topic.
    let topCos = 0;
    let lexEmpty = true;
    let semantic = false;
    if (this.semanticReady && this.embedModelId) {
      let queryVec: Float32Array | undefined;
      const tEmbed0 = Date.now();
      try {
        // Embed the NORMALIZED query (strip conversational filler) so covered topics
        // don't fall under the abstain floor — see normalizeQuery / SEMANTIC_FLOOR.
        queryVec = Float32Array.from(await this.embed(normalizeQuery(query)));
      } catch (e) {
        console.warn('[LocalEngine] query embed failed; lexical fallback:', e);
      }
      const embedMs = Date.now() - tEmbed0;
      const tRetr0 = Date.now();
      // CONTEXT-GATING (R1): retrieve CONTEXT-FREE. A confident, self-sufficient question carries
      // its own topic; folding the prior turn in only POLLUTES it (an off-topic earlier turn drags
      // the wrong facts up — the "solar system"→solar-panel collision). topCos tells us if the bare
      // query is confident.
      const r1 = this.rag.retrieveForGroundingHybridDiag(query, queryVec, language, topK, 0.5, '', seenIds);
      hits = r1.hits;
      topCos = r1.topCos;
      lexEmpty = r1.lexEmpty;
      semantic = !!queryVec && this.rag.hasSemantic;
      let reEmbedMs = 0;
      // R2: bare query is WEAK — empty (abstained) OR low-confidence (topCos < gate floor) — i.e. a
      // topic-blind follow-up ("anong pinakamabilis sa kanila?"). NOW fold the conversation topic in.
      if ((hits.length === 0 || r1.topCos < CONTEXT_FALLBACK_FLOOR) && queryVec && context.trim()) {
        try {
          const tRe0 = Date.now();
          const foldedVec = Float32Array.from(
            await this.embed(buildContextualQuery(query, context))
          );
          reEmbedMs = Date.now() - tRe0;
          const r2 = this.rag.retrieveForGroundingHybridDiag(query, foldedVec, language, topK, 0.5, context, seenIds);
          if (r2.hits.length) hits = r2.hits; // keep R2 only if it found something (else keep R1)
        } catch (e) {
          console.warn('[LocalEngine] contextual re-embed failed:', e);
        }
      }
      // [perf] retrieval breakdown: embed (LaBSE) + vector search + optional R2 re-embed
      console.log(
        `[perf] ragSearch: embed ${embedMs}ms · search+R2 ${Date.now() - tRetr0}ms (re-embed ${reEmbedMs}ms) · ${hits.length} hits`
      );
    } else {
      hits = this.rag.retrieveForGrounding(query, language, topK, 0.5, context, seenIds);
      lexEmpty = hits.length === 0;
    }
    return {
      hits: hits.map((h) => ({
        content: h.text,
        source: h.fact.source,
        score: h.score,
        metadata: { id: h.fact.id, topic: h.fact.topic, domain: h.fact.domain },
      })),
      facts: hits.map((h) => h.fact),
      topCos,
      lexEmpty,
      semantic,
    };
  }

  isReady(): boolean {
    return this.isReadyFlag;
  }

  async shutdown(): Promise<void> {
    if (this.embedModelId) {
      try {
        await unloadModel({ modelId: this.embedModelId });
      } catch (error) {
        console.error('Error unloading embedder:', error);
      }
      this.embedModelId = null;
      this.semanticReady = false;
    }
    if (this.modelId) {
      try {
        await unloadModel({ modelId: this.modelId });
        console.log('Model unloaded successfully');
      } catch (error) {
        console.error('Error unloading model:', error);
      }
      this.modelId = null;
      this.isReadyFlag = false;
    }
  }
}
