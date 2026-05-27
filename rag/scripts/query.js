#!/usr/bin/env node

/**
 * Test RAG queries against the built index
 * 
 * Usage: node query.js "What is photosynthesis?"
 */

import { readFile } from 'fs/promises';
import { loadModel, embed, unloadModel } from '@qvac/sdk';
import { HierarchicalNSW } from 'hnswlib-node';
import { RAG_CONFIG } from '../config.js';

const query = process.argv[2];

if (!query) {
  console.log('Usage: node query.js "your question"');
  console.log('Example: node query.js "What is photosynthesis?"');
  process.exit(1);
}

async function searchIndex(query, modelId, index, metadata, topK) {
  // Embed the query
  const queryEmbedding = await embed({
    modelId,
    text: query,
  });
  
  // Search index
  const results = index.searchKnn(queryEmbedding.data, topK, (label) => true);
  
  // Map results to metadata
  return results.neighbors.map((neighbor, idx) => {
    const meta = metadata.find(m => m.indexId === neighbor.label);
    return {
      rank: idx + 1,
      score: 1 - neighbor.distance, // Convert distance to similarity
      chunkId: meta.chunkId,
      source: meta.source,
      text: meta.text,
      type: meta.type,
    };
  });
}

async function main() {
  console.log('🔍 RAG Query Test\n');
  console.log(`Query: "${query}"\n`);
  
  // Load index and metadata
  console.log('Loading index and metadata...');
  const indexBuffer = await readFile(RAG_CONFIG.paths.index);
  const metadata = JSON.parse(await readFile(RAG_CONFIG.paths.metadata, 'utf-8'));
  
  // Initialize HNSW index
  const dimension = RAG_CONFIG.embeddingDimension;
  const index = new HierarchicalNSW('cosine', dimension);
  index.readIndexSync(indexBuffer);
  
  console.log(`✓ Loaded ${metadata.length} vectors\n`);
  
  // Load embedding model
  console.log('Loading embedding model...');
  const modelId = await loadModel({
    modelSrc: 'gte-base',
    modelType: 'embeddings',
  });
  console.log(`✓ Model loaded: ${modelId}\n`);
  
  // Search
  console.log('Searching...\n');
  const results = await searchIndex(
    query,
    modelId,
    index,
    metadata,
    RAG_CONFIG.topK
  );
  
  // Display results
  console.log(`Top ${results.length} results:\n`);
  console.log('─'.repeat(80));
  
  for (const result of results) {
    console.log(`\n#${result.rank} - Score: ${result.score.toFixed(4)}`);
    console.log(`   Source: ${result.source} (${result.type})`);
    console.log(`   Chunk: ${result.chunkId}`);
    console.log(`   Preview: ${result.text}`);
    console.log('─'.repeat(80));
  }
  
  // Cleanup
  await unloadModel({ modelId });
  
  console.log('\n✓ Done\n');
}

main().catch(console.error);
