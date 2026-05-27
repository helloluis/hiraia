#!/usr/bin/env node

/**
 * Chunk extracted text into semantic segments
 * 
 * Splits text into chunks suitable for embedding and retrieval
 */

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { RAG_CONFIG } from '../config.js';

/**
 * Simple token estimator (rough approximation)
 * In production, use a proper tokenizer like tiktoken
 */
function estimateTokens(text) {
  // Rough estimate: 1 token ≈ 4 characters for English
  // For Filipino languages, use ~3 characters per token
  return Math.ceil(text.length / 3.5);
}

/**
 * Chunk text with overlap, respecting paragraph boundaries
 */
function chunkText(text, chunkSize, overlap) {
  const chunks = [];
  const paragraphs = text.split(/\n\s*\n/);
  
  let currentChunk = '';
  let currentTokens = 0;
  
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    
    const paragraphTokens = estimateTokens(trimmed);
    
    // If adding this paragraph exceeds chunk size, save current chunk
    if (currentTokens + paragraphTokens > chunkSize && currentChunk) {
      chunks.push(currentChunk.trim());
      
      // Keep overlap from end of previous chunk
      const words = currentChunk.split(/\s+/);
      const overlapWords = words.slice(-Math.ceil(overlap / 4));
      currentChunk = overlapWords.join(' ') + '\n\n' + trimmed;
      currentTokens = estimateTokens(currentChunk);
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmed;
      currentTokens += paragraphTokens;
    }
  }
  
  // Add final chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

async function main() {
  console.log('✂️  Chunking extracted text...\n');
  
  // Load extracted data
  const extractedPath = join(RAG_CONFIG.paths.sources, 'extracted.json');
  const extracted = JSON.parse(await readFile(extractedPath, 'utf-8'));
  
  console.log(`Loaded ${extracted.length} documents\n`);
  
  const chunks = [];
  
  for (const doc of extracted) {
    console.log(`Chunking: ${doc.filename}`);
    
    const docChunks = chunkText(
      doc.text,
      RAG_CONFIG.chunkSize,
      RAG_CONFIG.chunkOverlap
    );
    
    // Add metadata to each chunk
    docChunks.forEach((chunkText, idx) => {
      chunks.push({
        id: `${doc.filename}_chunk_${idx}`,
        text: chunkText,
        source: doc.filename,
        type: doc.type,
        path: doc.path,
        chunkIndex: idx,
        totalChunks: docChunks.length,
        estimatedTokens: estimateTokens(chunkText),
      });
    });
    
    console.log(`  ✓ ${docChunks.length} chunks`);
  }
  
  // Save chunks
  const outputPath = RAG_CONFIG.paths.chunks;
  await writeFile(outputPath, JSON.stringify(chunks, null, 2));
  
  console.log(`\n✅ Created ${chunks.length} chunks`);
  console.log(`📝 Saved to: ${outputPath}`);
  
  const avgTokens = chunks.reduce((sum, c) => sum + c.estimatedTokens, 0) / chunks.length;
  console.log(`📊 Average chunk size: ${Math.round(avgTokens)} tokens\n`);
  
  console.log('Next step: pnpm embed\n');
}

main().catch(console.error);
