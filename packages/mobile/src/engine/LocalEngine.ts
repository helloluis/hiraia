import { loadModel, completion, unloadModel, embed, QWEN3_1_7B_INST_Q4 } from '@qvac/sdk';
import { Asset } from 'expo-asset';
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
import { CHAT_TEMP, SUMMARY_TEMP, CHAT_MAX_TOKENS } from '../config/inference';
import { IMAGE_CATEGORY } from '../generated/imageCategory.generated';
import { ensureRemoteModel, filenameFromUrl } from './modelDownload';
import { withModelLock } from './modelLock';
import type { AdapterLanguage } from '../config/model';
import type {
  TutorEngine,
  Message,
  ImageResult,
  RagResult,
  TutorConfig,
  Language,
  GradeLevel,
} from '@hiraia/shared';
import {
  RagStore,
  SemanticIndex,
  normalizeQuery,
  buildContextualQuery,
  CONTEXT_FALLBACK_FLOOR,
  generateSystemPrompt,
} from '@hiraia/shared';

// Minimum cosine for an [image:] description to resolve to a bundled illustration.
// Calibrated offline against the SFT tag descriptions (rag/scripts/
// validate-image-vectors.py): true matches median 0.79; every out-of-catalog decoy
// AND every observed cross-topic mismatch lands ≤0.693.
// History: 0.70 → 0.75 (2026-06-17, alongside making FACT_IMAGE the curated baseline
// and the model tag an OVERRIDE) — but that OVER-CORRECTED. A re-calibration (2026-06-20,
// 533 real tags) put the true-positive p25 at 0.746, so 0.75 was silently rejecting ~25%
// of legitimate, correctly-matched tags — e.g. "a t-rex dinosaur" (0.741), "the eight
// planets of the solar system"→solar-system (0.715), photosynthesis (0.714). Reverted to
// 0.70: it sits just above the empirical decoy/cross-topic ceiling (≤0.693) so genuine
// no-match cases still abstain, and the WITHIN-science cluster-bias class (gravity→atomic-
// model, earthquake→pangolin) is now caught independently by DOMAIN_IMAGE_CATEGORIES
// scoping below — not the floor — so the floor no longer needs to over-tighten for it.
const IMAGE_TAG_FLOOR = 0.7;

// DOMAIN SCOPING for image retrieval. The embedding match alone does naive word-association
// across topics — an EARTH_SPACE earthquake fact matched a "philippine-pangolin" (biology) image
// on the shared word "Philippine" (cos 0.59); a FORCE_MOTION_ENERGY gravity fact matched an
// atomic-model (chemistry) diagram. So we constrain candidate images to the catalog categories
// that belong to the grounded fact's science domain — a geology question can never surface an
// animal, an animal question can never surface a reaction diagram. 'general' (topic-agnostic
// filler) is allowed everywhere; 'flagged' never. An unknown/absent domain → no scoping (the
// strict cosine floor still applies). Maps the 7 fact domains to the 5 image catalog folders.
const DOMAIN_IMAGE_CATEGORIES: Record<string, ReadonlySet<string>> = {
  LIVING_THINGS: new Set(['biology', 'general']),
  EARTH_SPACE: new Set(['earth-science', 'physics', 'general']), // weather/geology + astronomy
  FORCE_MOTION_ENERGY: new Set(['physics', 'general']),
  MATTER: new Set(['chemistry', 'physics', 'general']),
  PH_GEOGRAPHY: new Set(['earth-science', 'general']),
  PH_CIVICS: new Set(['general']),
  ABOUT_HIRAIA: new Set(['general']),
};

/**
 * LocalEngine implementation using QVAC SDK.
 * Runs the configured Hiraia model (ACTIVE_MODEL — Sailor2-3B by default)
 * locally on-device for privacy and offline capability.
 */
export class LocalEngine implements TutorEngine {
  private modelId: string | null = null;
  private isReadyFlag = false;
  private config: TutorConfig | null = null;
  // Grade whose system prompt is currently primed in QVAC's KV cache (see warmUp/setGrade).
  private primedGrade: GradeLevel | null = null;
  // In-memory grounding bank. Built at init; no native deps, so it works offline.
  private rag: RagStore | null = null;
  // Semantic embedder (LaBSE via QVAC) for the hybrid retriever. Loaded in the
  // BACKGROUND after the LLM (lexical-first); until ready, retrieval is lexical.
  private embedModelId: string | null = null;
  private semanticReady = false;
  // Image-tag retrieval blob (one vector per bundled PNG); loaded with the
  // semantic init. Null → resolveImageTag returns null (no picture, never wrong).
  private imageVectors: Int8Array | null = null;

  /**
   * Resolve the bundled LoRA adapter GGUF for a language to an absolute on-device
   * file path (for QVAC's `modelConfig.lora`). The adapter ships inside the APK
   * as a Metro asset; expo-asset copies it out to a readable path on first use.
   * Returns undefined only if no adapter is bundled / resolution fails.
   */
  private async resolveAdapterPath(language: Language): Promise<string | undefined> {
    // English routes through the TAGALOG adapter, not the base model: the
    // capability A/B (2026-06-11) scored the English probes 3.75/5 through the
    // tagalog adapter vs 1.78/5 on the raw base path — the SFT'd tutor behavior
    // (grounding adherence, abstention, brevity) transfers across languages,
    // while raw Sailor2 fabricates. No separate English LoRA needed.
    const adapterLang: AdapterLanguage | null =
      language === 'tagalog' || language === 'cebuano' ? language
      : language === 'english' ? 'tagalog'
      : null;
    if (!adapterLang) return undefined;
    const src = ACTIVE_MODEL.loraAssets[adapterLang];
    if (src == null) return undefined;
    try {
      // A string source is a MIRROR URL → download it (resilient chunked downloader, cached
      // on first run) so the adapter does NOT bloat the APK. A numeric source is a bundled
      // Metro asset (legacy path). Either resolves to a bare on-device path for QVAC's lora.
      if (typeof src === 'string') {
        const path = await ensureRemoteModel({ url: src, filename: filenameFromUrl(src) });
        console.log(`[LocalEngine] using downloaded ${adapterLang} adapter for ${language}: ${path}`);
        return path;
      }
      const asset = Asset.fromModule(src);
      await asset.downloadAsync(); // bundled asset → copied to cache, sets localUri
      const uri = asset.localUri ?? asset.uri;
      const path = uri ? uri.replace(/^file:\/\//, '') : undefined;
      if (path) console.log(`[LocalEngine] using bundled ${adapterLang} adapter for ${language}: ${path}`);
      return path;
    } catch (e) {
      console.warn(`[LocalEngine] failed to resolve ${language} adapter; running base model:`, e);
      return undefined;
    }
  }

  async initialize(config: TutorConfig, onProgress?: (p: number) => void): Promise<void> {
    try {
      this.config = config;
      console.log(`Loading ${ACTIVE_MODEL.displayName} model...`);

      // Resolve the bundled LoRA adapter for the active language (Filipino
      // fine-tune; English uses the base model).
      const loraPath = await this.resolveAdapterPath(config.language);

      if (ACTIVE_MODEL.modelSrc) {
        // For a REMOTE GGUF (our nginx mirror), download it ourselves with the
        // resilient resumable downloader (retry + resume + survives backgrounding —
        // see modelDownload.ts) and hand QVAC the LOCAL path. QVAC's own URL
        // downloader has no retry and stalls when the app is backgrounded. A bundled
        // / local path or pear:// key is passed straight through. ensureRemoteModel
        // drives the loader's download band; once it returns, loadModel reads from
        // disk (no network) so its own onProgress just snaps to 100.
        const src = /^https?:\/\//.test(ACTIVE_MODEL.modelSrc)
          ? await ensureRemoteModel(
              { url: ACTIVE_MODEL.modelSrc, filename: filenameFromUrl(ACTIVE_MODEL.modelSrc) },
              onProgress
            )
          : ACTIVE_MODEL.modelSrc;

        // Load the configured GGUF. `lora` applies our bundled fine-tuned
        // Tagalog/Bisaya adapter; without it the base model runs.
        this.modelId = await loadModel({
          modelSrc: src,
          modelType: ACTIVE_MODEL.modelType,
          modelConfig: {
            ctx_size: ACTIVE_MODEL.ctxSize,
            // Per-tier runtime placement (config/model.ts ACTIVE_MODEL.runtime). The cat (3B)
            // offloads to GPU/Vulkan (gpuLayers 99). The kitten (1B) on a budget Adreno-6xx
            // CANNOT use the GPU (ggml-vulkan 16-bit-storage device gate; OpenCL unsupported),
            // so it pins device:'cpu' + gpuLayers 0 — paired with the build.gradle backend gate
            // that keeps only the armv8.0 CPU .so (ggml otherwise mis-picks a higher ISA the A73
            // can't run → "no backends loaded"). Driving this from the model config means
            // flipping ACTIVE_MODEL_KEY can never silently force the 3B onto CPU.
            ...(ACTIVE_MODEL.runtime.device ? { device: ACTIVE_MODEL.runtime.device } : {}),
            gpu_layers: ACTIVE_MODEL.runtime.gpuLayers,
            ...(loraPath ? { lora: loraPath } : {}),
          },
          onProgress: (p) => {
            // Local-file load — no network. Log only; the bar already finished its
            // download band via ensureRemoteModel above.
            console.log(`[LocalEngine] ${ACTIVE_MODEL.displayName} loading: ${Math.round(p.percentage ?? 0)}%`);
          },
        });
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

      // Build the lexical grounding retriever (indexes the fact bank in RAM).
      this.rag = new RagStore();
      console.log(`RAG bank ready: ${this.rag.size} facts`);

      // Load the semantic embedder + vectors blob in the BACKGROUND — the app is
      // usable on lexical retrieval immediately; the hybrid upgrades in when ready.
      void this.initSemantic();

      // NO warm-up here — see primeSystemPrompt(). The system-prompt prefill is the slow
      // tail of a cold start (measured `warm-up complete (77835ms)` on the target Redmi) and
      // it is keyed on the GRADE, which the child is still choosing while this load runs:
      // onboarding's grade slide lands seconds after the language pick that kicked the load
      // off. Warming in here would prime the grade captured at load START and then have to
      // throw that away and prefill again for the grade actually picked — two ~78s prefills
      // for 7 of the 8 grades. The caller (engineStore.changeLanguage) instead primes ONCE,
      // explicitly, with the settled grade, before it flips isReady.
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
   * Run a single throwaway completion to warm the model (driven by primeSystemPrompt /
   * setGrade — never by initialize() itself; see there). The
   * history is just the STATIC system prompt + a trivial user turn, with predict:1
   * (we discard the token) and kvCache:true. This must mirror EXACTLY the static
   * system prompt chatStore sends — generateSystemPrompt(lang, grade, true) — so the
   * KV cache primed here is the same one the first real turn looks up. Non-fatal:
   * a failure just means the first real message pays the normal cold TTFT.
   */
  private async warmUp(): Promise<void> {
    if (!this.modelId || !this.config) return;
    try {
      const t0 = Date.now();
      // language + grade (both from the engineStore-built config; chatStore reads the same
      // store) + imageTags=true => byte-for-byte match with chatStore's system prompt.
      const grade = this.config.gradeLevel;
      const systemPrompt = generateSystemPrompt(this.config.language, grade, true);
      // predict:1 (not 0): generating a single throwaway token guarantees the prompt is fully
      // prefilled and the KV cache persisted. QVAC 0.13 has no public `prefill: true` completion
      // flag (only an internal VLA path), and predict:0 risks short-circuiting before the eval that
      // primes the cache — so the 1-token warm-up stays the reliable prime. The token is discarded.
      const run = completion({
        modelId: this.modelId,
        history: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Hello' },
        ],
        stream: true,
        generationParams: { temp: CHAT_TEMP, predict: 1 },
        kvCache: true, // prime the system-prompt KV cache the first real turn will hit
      });
      // Drain and discard — we only care about the prefill side effect.
      for await (const _event of run.events) {
        // no-op
      }
      // Cold-prefill telemetry: how long the unwarmed system-prompt prefill took + its token count.
      // The first real turn should then report cacheTokens ≈ promptTokens here (cache hit).
      let warmStat = '';
      try {
        const s = await run.stats;
        if (s) warmStat = ` · prefill ${s.timeToFirstToken ?? '?'}ms · ${s.promptTokens ?? '?'} prompt tok · ${s.backendDevice ?? '?'}`;
      } catch {
        /* best-effort */
      }
      console.log(`[LocalEngine] warm-up complete (${Date.now() - t0}ms)${warmStat}`);
      this.primedGrade = grade;
    } catch (e) {
      console.warn('[LocalEngine] warm-up failed (non-fatal):', e);
    }
  }

  /**
   * Prefill the STATIC system prompt for `grade`. This is the init-time warm-up, made
   * EXPLICIT so the caller owns when it runs and which grade it runs for (initialize() no
   * longer warms up). Compiles the graph, heats the kernels, and primes QVAC's
   * system-prompt KV cache so the student's first real turn skips the full prefill.
   *
   * Deliberately does NOT take the shared model lock. It only ever runs on an engine that
   * is not ready yet, so nothing can be generating on it — while the lock is module-wide
   * and may still be held by a stale completion belonging to the engine we just shut down
   * (a feed reward prefetch holds it for a whole generation, tens of seconds on this
   * device). Taking it here would make readiness wait on that unrelated generation, and a
   * completion on an unloaded model that never settles would strand isReady for the whole
   * session. Steady-state re-priming (setGrade, below) still takes the lock, because there
   * it genuinely can collide with a live chat / feed turn.
   */
  async primeSystemPrompt(grade: GradeLevel): Promise<void> {
    if (!this.config) return;
    this.config = { ...this.config, gradeLevel: grade };
    if (this.primedGrade === grade) return;
    await this.warmUp();
  }

  /**
   * Apply a new student grade to a READY engine WITHOUT reloading the model — the LoRA
   * adapter is per-language; the grade only changes the static system prompt ("grade-N
   * students") and the feed's grounded-answer prompt. Since QVAC's KV cache is keyed on the
   * prompt text, the cache primeSystemPrompt() primed at the end of the load would MISS on
   * the next real turn, so we re-run the warm-up prefill in place (non-fatal). Use
   * primeSystemPrompt() instead while the engine is still coming up — this path is the
   * steady-state one. The re-prime is a real completion on the
   * single-instance model, so it runs under the shared model lock: it can never overlap an
   * in-flight chat / feed generation, and rapid taps queue behind each other — a queued one
   * is skipped once it is stale (superseded by a later tap) or already primed.
   */
  async setGrade(grade: GradeLevel): Promise<void> {
    if (!this.config) return;
    this.config = { ...this.config, gradeLevel: grade };
    await withModelLock(async () => {
      if (this.config?.gradeLevel !== grade || this.primedGrade === grade) return;
      await this.warmUp();
    });
  }

  async *chat(messages: Message[], kvCacheKey?: string): AsyncIterable<string> {
    if (!this.modelId || !this.isReadyFlag) {
      throw new Error('Engine not initialized. Call initialize() first.');
    }

    try {
      // Convert our Message format to QVAC's expected format
      const history = messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      // Get streaming completion from QVAC. Temp 0.5 (not the ~0.8 llama.cpp
      // default) — see CHAT_TEMP: lower temp reduces factual wandering.
      // kvCache:true turns ON QVAC's AUTO KV cache (keyed by a hash of the static system
      // prompt). It caches/reuses the prefix of the EXACT history we send — which
      // buildContext() has already WINDOWED to the last few turns — so the static system
      // prefix is reused across turns (the TTFT win) while the prefilled context stays
      // bounded.
      //
      // Do NOT use a custom string key (kvCache: convId): that mode slices by message
      // COUNT and keeps appending every turn to the on-disk KV, ignoring our windowing —
      // so a long chat's cached context grows past ctx_size and EVERY later prompt fails
      // with "context overflow at prefill" (confirmed on-device 2026-06-08, 4266 > 4096).
      // `kvCacheKey` is still just the on/off signal from the caller.
      const run = completion({
        modelId: this.modelId,
        history,
        stream: true,
        generationParams: { temp: CHAT_TEMP, predict: CHAT_MAX_TOKENS },
        ...(kvCacheKey ? { kvCache: true } : {}),
      });

      // [perf] split the latency: TTFT (prompt prefill) vs decode (tok/s), so we
      // can tell whether the cost is the prompt size or the per-token generation.
      const t0 = Date.now();
      let firstAt = 0;
      let toks = 0;
      for await (const event of run.events) {
        if (event.type === 'contentDelta' && event.text) {
          if (!firstAt) firstAt = Date.now();
          toks++;
          yield event.text;
        }
      }
      const total = Date.now() - t0;
      const ttft = firstAt ? firstAt - t0 : total;
      const decodeMs = Math.max(1, total - ttft);
      const tps = toks > 1 ? (((toks - 1) * 1000) / decodeMs).toFixed(1) : '?';
      console.log(
        `[perf] chat: prefill/TTFT ${ttft}ms · decode ${decodeMs}ms · ${toks} chunks · ${tps} tok/s · total ${total}ms`
      );
      // SDK-precise on-device metrics (QVAC ≥0.13): exact prefill TTFT + prompt-processing
      // throughput (ppTPS = promptTokens / TTFT), the KV-cache hit size — which CONFIRMS the
      // static-system-prompt cache is being reused across turns (the TTFT win) — and whether
      // the run landed on cpu/gpu. Best-effort; never breaks chat if stats are absent.
      try {
        const s = await run.stats;
        if (s) {
          const ppTps =
            s.timeToFirstToken && s.promptTokens
              ? ((s.promptTokens * 1000) / s.timeToFirstToken).toFixed(0)
              : '?';
          console.log(
            `[perf] chat(sdk): TTFT ${s.timeToFirstToken ?? '?'}ms · prompt ${s.promptTokens ?? '?'} tok ` +
              `(${s.cacheTokens ?? 0} from KV cache) · ppTPS ${ppTps} · decode ${s.tokensPerSecond?.toFixed(1) ?? '?'} tok/s · ${s.backendDevice ?? '?'}`
          );
        }
      } catch {
        /* stats are best-effort telemetry */
      }
    } catch (error) {
      console.error('Error during chat completion:', error);
      throw new Error(
        `Chat inference failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Compress an assistant answer into a 1-2 sentence factual recap (the
   * auto-compacter's memory). Single-turn utility completion — no grounding,
   * no tutor system prompt. Greedy via the model's default sampling.
   */
  async summarize(text: string): Promise<string> {
    if (!this.modelId || !this.isReadyFlag) {
      throw new Error('Engine not initialized. Call initialize() first.');
    }
    const instruction =
      'Ibuod ang sumusunod na sagot ng science tutor sa ISA o DALAWANG napakaikling pangungusap, ' +
      'para magamit bilang maikling alaala (memory) sa susunod na usapan. Panatilihin LANG ang ' +
      'mahalagang science fact at termino. Alisin ang pagbati, mga halimbawa, at ang tanong sa dulo. ' +
      'Sumagot ng buod lamang, walang ibang sasabihin.\n\nSAGOT:\n' +
      text;
    const run = completion({
      modelId: this.modelId,
      history: [{ role: 'user', content: instruction }],
      stream: true,
      generationParams: { temp: SUMMARY_TEMP }, // greedy: faithful, deterministic recap
    });
    let out = '';
    for await (const event of run.events) {
      if (event.type === 'contentDelta' && event.text) out += event.text;
    }
    return out.trim();
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
      generationParams: { temp: 0.7 }, // warmth/variety — this is prose, not a fact
    });
    let out = '';
    for await (const event of run.events) {
      if (event.type === 'contentDelta' && event.text) out += event.text;
    }
    return out.trim();
  }

  /**
   * Grounded one-shot answer to a kid's typed feed query — used ONLY as the fallback when
   * the local card search finds nothing (the feed is retrieval-first). Retrieves from the
   * full fact bank and answers STRICTLY from those facts in 1-2 short sentences; if
   * retrieval returns nothing it reports grounded:false so the caller shows an honest
   * abstention instead of a hallucination. Optional — callers feature-detect.
   */
  async answerQuery(query: string, language: string): Promise<{ text: string; grounded: boolean }> {
    if (!this.modelId || !this.isReadyFlag) {
      throw new Error('Engine not initialized. Call initialize() first.');
    }
    // ragSearch already applies its own confidence floor, so any hit is usable grounding.
    const hits = await this.ragSearch(query, 4);
    if (!hits.length) return { text: '', grounded: false };
    const context = hits.map((h) => `- ${h.content}`).join('\n');
    // Pitched at the student's grade (engineStore → config; kept current by setGrade).
    const grade = this.config?.gradeLevel ?? DEFAULT_GRADE;
    const byLang: Record<string, string> = {
      tagalog:
        `Ikaw ay isang mabait na science tutor para sa batang Grade ${grade}. Gamit LAMANG ang mga FACT sa ibaba, ` +
        `sagutin ang tanong sa 1-2 maikli at simpleng pangungusap sa Tagalog. Kung hindi masagot ng mga fact ang tanong, ` +
        `sabihin mong hindi mo pa alam. HUWAG mag-imbento ng bagong impormasyon.\n\nMGA FACT:\n${context}\n\nTANONG: ${query}\n\nSAGOT:`,
      english:
        `You are a kind science tutor for a Grade ${grade} child. Using ONLY the FACTS below, answer the question in ` +
        `1-2 short, simple English sentences. If the facts do not answer it, say you don't know yet. Do NOT invent ` +
        `new information.\n\nFACTS:\n${context}\n\nQUESTION: ${query}\n\nANSWER:`,
      cebuano:
        `Ikaw usa ka maayong science tutor para sa batang Grade ${grade}. Gamit LANG ang mga FACT sa ubos, tubaga ang ` +
        `pangutana sa 1-2 mubo ug simple nga pangungusap sa Binisaya. Kung dili matubag sa mga fact ang pangutana, ` +
        `ingna nga wala ka pa kahibalo. AYAW pag-imbento og bag-ong impormasyon.\n\nMGA FACT:\n${context}\n\nPANGUTANA: ${query}\n\nTUBAG:`,
    };
    const instruction = byLang[language] ?? byLang.tagalog!;
    const run = completion({
      modelId: this.modelId,
      history: [{ role: 'user', content: instruction }],
      stream: true,
      generationParams: { temp: 0.3 }, // low temp: faithful to the retrieved facts
    });
    let out = '';
    for await (const event of run.events) {
      if (event.type === 'contentDelta' && event.text) out += event.text;
    }
    return { text: out.trim(), grounded: true };
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
      const embedSrc = /^https?:\/\//.test(EMBEDDER.modelSrc)
        ? await ensureRemoteModel(
            { url: EMBEDDER.modelSrc, filename: filenameFromUrl(EMBEDDER.modelSrc) },
            (pct) => console.log(`[LocalEngine] LaBSE downloading: ${pct}%`)
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
      // 3) attach (size guard inside attachSemantic catches a stale blob)
      this.rag.attachSemantic(
        new SemanticIndex({
          dims: VECTORS_META.dims,
          scale: VECTORS_META.scale,
          count: VECTORS_META.count,
          langs: VECTORS_META.langs,
          data,
        })
      );
      this.semanticReady = true;
      // Warm the embed graph so the FIRST real ragSearch doesn't eat the cold
      // build/alloc spike (the chat model has warmUp(); the embedder had none — and
      // on the CPU-only kitten the LaBSE forward pass is the dominant retrieval cost).
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
    // Image-tag blob (~3MB): independent of the fact-bank blob — its failure only
    // disables [image:] resolution, never retrieval.
    try {
      const asset = Asset.fromModule(IMAGE_VECTORS_BLOB_ASSET);
      await asset.downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      const bytes = await new File(uri).bytes();
      const expected = IMAGE_VECTORS_META.count * IMAGE_VECTORS_META.dims;
      if (bytes.byteLength !== expected) {
        throw new Error(`stale image blob: ${bytes.byteLength} bytes, expected ${expected}`);
      }
      this.imageVectors = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      console.log(`[LocalEngine] image-tag index ready (${IMAGE_VECTORS_META.count} slugs)`);
    } catch (e) {
      console.warn('[LocalEngine] image-tag index failed — [image:] tags will not resolve:', e);
      this.imageVectors = null;
    }
  }

  /**
   * Resolve the tutor's `[image: <english desc>]` description to a bundled
   * illustration slug: embed the desc with the (already warm) LaBSE embedder and
   * brute-force cosine over the per-image catalog vectors. Returns null below the
   * confidence floor — better no picture than a mismatched one (same principle as
   * the FACT_IMAGE top-fact rule). The floor is calibrated offline against the
   * SFT tag descriptions (see rag/scripts/build-image-vectors.py validation).
   */
  async resolveImageTag(
    desc: string,
    minCosine: number = IMAGE_TAG_FLOOR,
    domain?: string
  ): Promise<{ slug: string; cosine: number } | null> {
    if (!this.imageVectors || !this.semanticReady || !this.embedModelId) return null;
    try {
      const t0 = Date.now();
      const q = Float32Array.from(await this.embed(desc)); // CLS + L2 (embdNormalize:2)
      const { dims, scale, count, slugs } = IMAGE_VECTORS_META;
      const vecs = this.imageVectors;
      // Scope candidates to the grounded fact's science domain so the cosine can't pick an
      // off-topic image on a shared word (see DOMAIN_IMAGE_CATEGORIES). Unknown domain → no scope.
      const allowed = domain ? DOMAIN_IMAGE_CATEGORIES[domain] : undefined;
      let best = -1;
      let bestDot = -Infinity;
      for (let i = 0; i < count; i++) {
        if (allowed && !allowed.has(IMAGE_CATEGORY[slugs[i]!] ?? 'general')) continue;
        let dot = 0;
        const off = i * dims;
        for (let d = 0; d < dims; d++) dot += q[d]! * vecs[off + d]!;
        if (dot > bestDot) {
          bestDot = dot;
          best = i;
        }
      }
      if (best < 0) return null; // domain scoping left no candidate
      const cosine = bestDot * scale; // corpus rows were unit-norm before int8 quant
      console.log(
        `[LocalEngine] resolveImageTag "${desc.slice(0, 60)}" → ${slugs[best]} ` +
          `(cos ${cosine.toFixed(3)}, cat ${IMAGE_CATEGORY[slugs[best]!] ?? '-'}, dom ${domain ?? '-'}, ${Date.now() - t0}ms)`
      );
      if (cosine < minCosine) return null;
      return { slug: slugs[best]!, cosine };
    } catch (e) {
      console.warn('[LocalEngine] resolveImageTag failed:', e);
      return null;
    }
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
    if (!this.rag) return [];
    const language: Language = this.config?.language ?? 'english';
    // Hybrid when the embedder is warm; lexical-first while it loads (or if it
    // failed). Only confidently-relevant hits — a small model is misled by noise.
    let hits;
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
    }
    return hits.map((h) => ({
      content: h.text,
      source: h.fact.source,
      score: h.score,
      metadata: { id: h.fact.id, topic: h.fact.topic, domain: h.fact.domain },
    }));
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
