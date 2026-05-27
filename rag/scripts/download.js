#!/usr/bin/env node

/**
 * Download DepEd curriculum materials
 * 
 * This script provides instructions and automated download helpers
 * for DepEd curriculum guides and Self-Learning Modules.
 */

import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { RAG_CONFIG, DOWNLOAD_SOURCES } from '../config.js';

async function createDirectories() {
  console.log('Creating directory structure...\n');
  
  const dirs = [
    RAG_CONFIG.paths.sources,
    RAG_CONFIG.paths.curriculumGuides,
    RAG_CONFIG.paths.learningModules,
  ];
  
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
      console.log(`✓ Created: ${dir}`);
    } else {
      console.log(`✓ Exists: ${dir}`);
    }
  }
}

async function downloadCurriculumGuides() {
  console.log('\n📚 Curriculum Guides\n');
  
  for (const source of DOWNLOAD_SOURCES) {
    if (source.type !== 'curriculum-guide') continue;
    
    console.log(`\n${source.name}`);
    console.log(`  URL: ${source.url}`);
    console.log(`  Grades: ${source.grades.join(', ')}`);
    
    if (source.url.endsWith('.pdf')) {
      console.log(`  ⚠️  Manual download required`);
      console.log(`  📥 Download to: ${RAG_CONFIG.paths.curriculumGuides}/`);
    } else {
      console.log(`  ℹ️  Visit the page and download PDFs manually`);
    }
  }
}

async function downloadLearningModules() {
  console.log('\n📖 Self-Learning Modules\n');
  
  for (const source of DOWNLOAD_SOURCES) {
    if (source.type !== 'learning-modules') continue;
    
    console.log(`\n${source.name}`);
    console.log(`  URL: ${source.url}`);
    console.log(`  Grades: ${source.grades.join(', ')}`);
    console.log(`  ℹ️  ${source.note}`);
    console.log(`  📥 Download to: ${RAG_CONFIG.paths.learningModules}/`);
    console.log(`\n  Instructions:`);
    console.log(`  1. Visit ${source.url}`);
    console.log(`  2. Select "Science" as the subject`);
    console.log(`  3. Download modules for each grade level (3-10)`);
    console.log(`  4. Save PDFs to: ${RAG_CONFIG.paths.learningModules}/`);
  }
}

async function main() {
  console.log('🚀 Hiraia RAG - Download Curriculum Materials\n');
  
  await createDirectories();
  await downloadCurriculumGuides();
  await downloadLearningModules();
  
  console.log('\n✅ Setup complete!\n');
  console.log('Next steps:');
  console.log('  1. Download the curriculum guides and learning modules');
  console.log('  2. Place PDFs in the appropriate directories');
  console.log('  3. Run: pnpm extract');
  console.log('\nFor questions, see: rag/README.md\n');
}

main().catch(console.error);
