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
import { CHAT_TEMP, SUMMARY_TEMP, CHAT_MAX_TOKENS } from '../config/inference';
import { IMAGE_CATEGORY } from '../generated/imageCategory.generated';
import { ensureRemoteModel, filenameFromUrl } from './modelDownload';
import type { AdapterLanguage } from '../config/model';
import type {
  TutorEngine,
  Message,
  ImageResult,
  RagResult,
  TutorConfig,
  Language,
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
// validate-image-vectors.py, 2026-06-10): true matches median 0.79; every
// out-of-catalog decoy AND every observed cross-topic mismatch lands ≤0.693.
// Raised 0.70 → 0.75 (2026-06-17) alongside the chatStore.ts priority swap that
// makes FACT_IMAGE the curated baseline FIRST. The model tag is now the OVERRIDE
// path for facts not in the curated map, so its bar should be tighter — sub-0.75
// cosines are cluster-bias hits (the gravity→atomic-model class). 0.75 keeps the
// strong tags (median 0.79 still clears it) and culls the borderline noise that
// previously beat the curated baseline.
const IMAGE_TAG_FLOOR = 0.75;

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

      // Warm-up pass: prefill the model with the STATIC system prompt before the
      // user ever arrives in chat. This compiles the Metal graph, heats the
      // kernels, AND primes QVAC's system-prompt KV cache, so the student's first
      // real message hits the cache and skips the full ~1500-token prefill (the
      // big first-TTFT win). The throwaway output is discarded. This is the slow
      // tail of init — the loader bar tracks it.
      await this.warmUp();

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
   * Run a single throwaway completion at the end of init to warm the model. The
   * history is just the STATIC system prompt + a trivial user turn, with predict:1
   * (we discard the token) and kvCache:true. This must mirror EXACTLY the static
   * system prompt chatStore sends — generateSystemPrompt(lang, 5, true) — so the
   * KV cache primed here is the same one the first real turn looks up. Non-fatal:
   * a failure just means the first real message pays the normal cold TTFT.
   */
  private async warmUp(): Promise<void> {
    if (!this.modelId || !this.config) return;
    try {
      const t0 = Date.now();
      // grade 5 + imageTags=true => byte-for-byte match with chatStore's system prompt.
      const systemPrompt = generateSystemPrompt(this.config.language, 5, true);
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
    } catch (e) {
      console.warn('[LocalEngine] warm-up failed (non-fatal):', e);
    }
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
