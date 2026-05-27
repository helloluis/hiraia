#!/usr/bin/env node

/**
 * Generate embeddings for chunks using QVAC SDK
 * 
 * Uses GTE embedding model to create vector representations
 */

import { readFile, writeFile } from 'fs/promises';
import { loadModel, embed, unloadModel, QWEN3_1_7B_INST_Q4 } from '@qvac/sdk';
import { RAG_CONFIG } from '../config.js';

/**
 * Generate embeddings in batches
 */
async function generateEmbeddings(chunks, modelId, batchSize) {
  const embeddings = [];
  
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(chunks.length / batchSize);
    
    console.log(`  Batch ${batchNum}/${totalBatches} (${batch.length} chunks)`);
    
    for (const chunk of batch) {
      try {
        const embedding = await embed({
          modelId,
          text: chunk.text,
        });
        
        embeddings.push({
          ...chunk,
          embedding: embedding.data,
          embeddingDim: embedding.data.length,
        });
      } catch (error) {
        console.error(`    ✗ Error embedding chunk ${chunk.id}: ${error.message}`);
        embeddings.push({
          ...chunk,
          embedding: null,
          error: error.message,
        });
      }
    }
  }
  
  return embeddings;
}

async function main() {
  console.log('🔢 Generating embeddings...\n');
  
  // Load chunks
  const chunks = JSON.parse(await readFile(RAG_CONFIG.paths.chunks, 'utf-8'));
  console.log(`Loaded ${chunks.length} chunks\n`);
  
  console.log('Loading GTE embedding model...');
  // Note: Replace with actual GTE model constant when available
  // For now, we'll use a placeholder
  const modelId = await loadModel({
    modelSrc: 'gte-base', // Replace with actual model constant
    modelType: 'embeddings',
  });
  console.log(`✓ Model loaded: ${modelId}\n`);
  
  console.log('Generating embeddings...');
  const embedded = await generateEmbeddings(
    chunks,
    modelId,
    RAG_CONFIG.processing.batchSize
  );
  
  const successCount = embedded.filter(e => e.embedding).length;
  const errorCount = embedded.filter(e => e.error).length;
  
  console.log(`\n✓ Embedded ${successCount} chunks`);
  if (errorCount > 0) {
    console.log(`✗ Failed: ${errorCount} chunks`);
  }
  
  // Save embeddings
  await writeFile(
    RAG_CONFIG.paths.embeddings,
    JSON.stringify(embedded, null, 2)
  );
  
  console.log(`\n📝 Saved to: ${RAG_CONFIG.paths.embeddings}`);
  
  // Unload model
  await unloadModel({ modelId });
  console.log('✓ Model unloaded\n');
  
  console.log('Next step: pnpm build-index\n');
}

main().catch(console.error);
