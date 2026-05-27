#!/usr/bin/env node

/**
 * Extract text from PDF curriculum materials
 * 
 * Processes all PDFs in sources/ and extracts structured text
 */

import { readdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import { RAG_CONFIG } from '../config.js';

// Note: pdf-parse is a dynamic import (ESM)
let pdfParse;

async function loadPdfParser() {
  if (!pdfParse) {
    pdfParse = (await import('pdf-parse')).default;
  }
  return pdfParse;
}

async function findPdfFiles(dir) {
  if (!existsSync(dir)) return [];
  
  const files = await readdir(dir, { recursive: true });
  return files
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .map(f => join(dir, f));
}

async function extractPdf(pdfPath) {
  const parser = await loadPdfParser();
  const buffer = await readFile(pdfPath);
  const data = await parser(buffer);
  
  return {
    filename: basename(pdfPath),
    path: pdfPath,
    text: data.text,
    pages: data.numpages,
    info: data.info,
  };
}

async function main() {
  console.log('📄 Extracting text from PDFs...\n');
  
  // Find all PDFs
  const guideFiles = await findPdfFiles(RAG_CONFIG.paths.curriculumGuides);
  const moduleFiles = await findPdfFiles(RAG_CONFIG.paths.learningModules);
  
  console.log(`Found ${guideFiles.length} curriculum guides`);
  console.log(`Found ${moduleFiles.length} learning modules\n`);
  
  if (guideFiles.length === 0 && moduleFiles.length === 0) {
    console.log('⚠️  No PDF files found!');
    console.log('Run "pnpm download" first to get instructions.\n');
    process.exit(1);
  }
  
  const extracted = [];
  
  // Process curriculum guides
  console.log('Processing curriculum guides...');
  for (const pdfPath of guideFiles) {
    try {
      console.log(`  Extracting: ${basename(pdfPath)}`);
      const data = await extractPdf(pdfPath);
      extracted.push({
        ...data,
        type: 'curriculum-guide',
      });
      console.log(`    ✓ ${data.pages} pages`);
    } catch (error) {
      console.error(`    ✗ Error: ${error.message}`);
    }
  }
  
  // Process learning modules
  console.log('\nProcessing learning modules...');
  for (const pdfPath of moduleFiles) {
    try {
      console.log(`  Extracting: ${basename(pdfPath)}`);
      const data = await extractPdf(pdfPath);
      extracted.push({
        ...data,
        type: 'learning-module',
      });
      console.log(`    ✓ ${data.pages} pages`);
    } catch (error) {
      console.error(`    ✗ Error: ${error.message}`);
    }
  }
  
  // Save extracted text
  const outputPath = join(RAG_CONFIG.paths.sources, 'extracted.json');
  await writeFile(outputPath, JSON.stringify(extracted, null, 2));
  
  console.log(`\n✅ Extracted ${extracted.length} documents`);
  console.log(`📝 Saved to: ${outputPath}\n`);
  console.log('Next step: pnpm chunk\n');
}

main().catch(console.error);
