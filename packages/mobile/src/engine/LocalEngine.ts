import { loadModel, completion, unloadModel, embed, QWEN3_1_7B_INST_Q4 } from '@qvac/sdk';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { ACTIVE_MODEL, EMBEDDER, VECTORS_BLOB_ASSET, VECTORS_META } from '../config/model';
import { CHAT_TEMP, SUMMARY_TEMP, CHAT_MAX_TOKENS, GPU_LAYERS } from '../config/inference';
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
  generateSystemPrompt,
} from '@hiraia/shared';

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

  /**
   * Resolve the bundled LoRA adapter GGUF for a language to an absolute on-device
   * file path (for QVAC's `modelConfig.lora`). The adapter ships inside the APK
   * as a Metro asset; expo-asset copies it out to a readable path on first use.
   * Returns undefined for English (base model) or if no adapter is bundled.
   */
  private async resolveAdapterPath(language: Language): Promise<string | undefined> {
    if (language !== 'tagalog' && language !== 'cebuano') return undefined;
    const moduleId = ACTIVE_MODEL.loraAssets[language as AdapterLanguage];
    if (moduleId == null) return undefined;
    try {
      const asset = Asset.fromModule(moduleId);
      await asset.downloadAsync(); // bundled asset → copied to cache, sets localUri
      const uri = asset.localUri ?? asset.uri;
      const path = uri ? uri.replace(/^file:\/\//, '') : undefined;
      if (path) console.log(`[LocalEngine] using ${language} adapter: ${path}`);
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
        // Load the configured GGUF from its source (an https HuggingFace URL,
        // downloaded + cached by QVAC on first run). The string-source overload
        // needs an explicit modelType. `lora` applies our bundled fine-tuned
        // Tagalog/Bisaya adapter; without it the base model runs.
        this.modelId = await loadModel({
          modelSrc: ACTIVE_MODEL.modelSrc,
          modelType: ACTIVE_MODEL.modelType,
          modelConfig: {
            ctx_size: ACTIVE_MODEL.ctxSize,
            gpu_layers: GPU_LAYERS, // full GPU offload — default left part of the 3B on CPU (slow)
            ...(loraPath ? { lora: loraPath } : {}),
          },
          onProgress: (p) => {
            const pct = Math.round(p.percentage ?? 0);
            console.log(`[LocalEngine] ${ACTIVE_MODEL.displayName} loading: ${pct}%`);
            if (onProgress) {
              onProgress(pct);
            }
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
      console.log(`[LocalEngine] warm-up complete (${Date.now() - t0}ms)`);
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
      // 1) embedder (LaBSE GGUF via the QVAC llamacpp-embedding plugin)
      this.embedModelId = await loadModel({
        modelSrc: EMBEDDER.modelSrc,
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
      hits = this.rag.retrieveForGroundingHybrid(
        query,
        queryVec,
        language,
        topK,
        0.5,
        context,
        seenIds
      );
      let reEmbedMs = 0;
      // R2: a bare follow-up ("anong pinakamalaki sa kanila?") is topic-blind and
      // abstains. Retry once with the conversation topic folded into the embed.
      if (hits.length === 0 && queryVec && context.trim()) {
        try {
          const tRe0 = Date.now();
          const foldedVec = Float32Array.from(
            await this.embed(buildContextualQuery(query, context))
          );
          reEmbedMs = Date.now() - tRe0;
          hits = this.rag.retrieveForGroundingHybrid(
            query,
            foldedVec,
            language,
            topK,
            0.5,
            context,
            seenIds
          );
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
