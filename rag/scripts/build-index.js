#!/usr/bin/env node

/**
 * Build HNSW vector index from embeddings
 * 
 * Creates a searchable index for fast similarity search
 */

import { readFile, writeFile } from 'fs/promises';
import { HierarchicalNSW } from 'hnswlib-node';
import { RAG_CONFIG } from '../config.js';

async function main() {
  console.log('🏗️  Building vector index...\n');
  
  // Load embeddings
  const embedded = JSON.parse(await readFile(RAG_CONFIG.paths.embeddings, 'utf-8'));
  
  // Filter out failed embeddings
  const validEmbeddings = embedded.filter(e => e.embedding && !e.error);
  console.log(`Loaded ${validEmbeddings.length} valid embeddings\n`);
  
  if (validEmbeddings.length === 0) {
    console.log('⚠️  No valid embeddings found!');
    console.log('Run "pnpm embed" first.\n');
    process.exit(1);
  }
  
  const dimension = validEmbeddings[0].embeddingDim;
  console.log(`Embedding dimension: ${dimension}`);
  console.log(`Index algorithm: ${RAG_CONFIG.indexAlgorithm}\n`);
  
  // Initialize HNSW index
  const index = new HierarchicalNSW('cosine', dimension);
  
  // Configure HNSW parameters
  index.initIndex(
    validEmbeddings.length,
    RAG_CONFIG.hnswConfig.M,
    RAG_CONFIG.hnswConfig.efConstruction
  );
  
  // Add embeddings to index
  console.log('Adding embeddings to index...');
  for (let i = 0; i < validEmbeddings.length; i++) {
    const emb = validEmbeddings[i];
    index.addPoint(emb.embedding, i);
    
    if ((i + 1) % 100 === 0) {
      console.log(`  ${i + 1}/${validEmbeddings.length} embeddings added`);
    }
  }
  
  console.log(`✓ Added ${validEmbeddings.length} embeddings\n`);
  
  // Save index
  const indexPath = RAG_CONFIG.paths.index;
  index.writeIndexSync(indexPath);
  console.log(`✓ Index saved to: ${indexPath}`);
  
  // Save metadata (maps index IDs to chunk metadata)
  const metadata = validEmbeddings.map((emb, idx) => ({
    indexId: idx,
    chunkId: emb.id,
    source: emb.source,
    type: emb.type,
    path: emb.path,
    chunkIndex: emb.chunkIndex,
    estimatedTokens: emb.estimatedTokens,
    text: emb.text.substring(0, 200) + '...', // Preview
  }));
  
  await writeFile(
    RAG_CONFIG.paths.metadata,
    JSON.stringify(metadata, null, 2)
  );
  console.log(`✓ Metadata saved to: ${RAG_CONFIG.paths.metadata}`);
  
  console.log('\n✅ Index built successfully!\n');
  console.log('Index statistics:');
  console.log(`  Total vectors: ${validEmbeddings.length}`);
  console.log(`  Dimension: ${dimension}`);
  console.log(`  Algorithm: HNSW`);
  console.log(`  Distance metric: Cosine\n`);
  
  console.log('Next step: pnpm query "your question"\n');
}

main().catch(console.error);
