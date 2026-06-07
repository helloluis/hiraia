import {
  loadModel,
  completion,
  unloadModel,
  embed,
  QWEN3_1_7B_INST_Q4,
} from '@qvac/sdk';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { ACTIVE_MODEL, EMBEDDER, VECTORS_BLOB_ASSET, VECTORS_META } from '../config/model';
import { CHAT_TEMP, SUMMARY_TEMP } from '../config/inference';
import type { AdapterLanguage } from '../config/model';
import type {
  TutorEngine,
  Message,
  ImageResult,
  RagResult,
  TutorConfig,
  Language,
} from '@hiraia/shared';
import { RagStore, SemanticIndex, normalizeQuery, buildContextualQuery } from '@hiraia/shared';

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

  async initialize(config: TutorConfig): Promise<void> {
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
            ...(loraPath ? { lora: loraPath } : {}),
          },
          onProgress: (p) =>
            console.log(
              `[LocalEngine] ${ACTIVE_MODEL.displayName} loading: ${Math.round(p.percentage ?? 0)}%`
            ),
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
        });
      }

      // Build the lexical grounding retriever (indexes the fact bank in RAM).
      this.rag = new RagStore();
      console.log(`RAG bank ready: ${this.rag.size} facts`);

      // Load the semantic embedder + vectors blob in the BACKGROUND — the app is
      // usable on lexical retrieval immediately; the hybrid upgrades in when ready.
      void this.initSemantic();

      this.isReadyFlag = true;

      console.log(`${ACTIVE_MODEL.displayName} model loaded successfully`);
    } catch (error) {
      console.error('Failed to load model:', error);
      throw new Error(
        `Failed to initialize LocalEngine: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async *chat(messages: Message[]): AsyncIterable<string> {
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
      const run = completion({
        modelId: this.modelId,
        history,
        stream: true,
        generationParams: { temp: CHAT_TEMP },
      });

      // Yield each token as it's generated
      for await (const event of run.events) {
        if (event.type === 'contentDelta' && event.text) {
          yield event.text;
        }
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
      'Sumagot ng buod lamang, walang ibang sasabihin.\n\nSAGOT:\n' + text;
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
      try {
        // Embed the NORMALIZED query (strip conversational filler) so covered topics
        // don't fall under the abstain floor — see normalizeQuery / SEMANTIC_FLOOR.
        queryVec = Float32Array.from(await this.embed(normalizeQuery(query)));
      } catch (e) {
        console.warn('[LocalEngine] query embed failed; lexical fallback:', e);
      }
      hits = this.rag.retrieveForGroundingHybrid(query, queryVec, language, topK, 0.5, context, seenIds);
      // R2: a bare follow-up ("anong pinakamalaki sa kanila?") is topic-blind and
      // abstains. Retry once with the conversation topic folded into the embed.
      if (hits.length === 0 && queryVec && context.trim()) {
        try {
          const foldedVec = Float32Array.from(await this.embed(buildContextualQuery(query, context)));
          hits = this.rag.retrieveForGroundingHybrid(query, foldedVec, language, topK, 0.5, context, seenIds);
        } catch (e) {
          console.warn('[LocalEngine] contextual re-embed failed:', e);
        }
      }
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
