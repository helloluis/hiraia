#!/usr/bin/env node

/**
 * Run the complete RAG pipeline
 * 
 * Executes: extract → chunk → embed → build-index
 */

import { spawn } from 'child_process';

const steps = [
  { name: 'Extract', cmd: 'node', args: ['scripts/extract.js'] },
  { name: 'Chunk', cmd: 'node', args: ['scripts/chunk.js'] },
  { name: 'Embed', cmd: 'node', args: ['scripts/embed.js'] },
  { name: 'Build Index', cmd: 'node', args: ['scripts/build-index.js'] },
];

function runStep(step) {
  return new Promise((resolve, reject) => {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`${step.name}`);
    console.log('='.repeat(80));
    
    const proc = spawn(step.cmd, step.args, { stdio: 'inherit' });
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${step.name} failed with code ${code}`));
      }
    });
    
    proc.on('error', reject);
  });
}

async function main() {
  console.log('🚀 Running complete RAG pipeline...\n');
  
  try {
    for (const step of steps) {
      await runStep(step);
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('✅ Pipeline completed successfully!');
    console.log('='.repeat(80));
    console.log('\nYou can now test queries with:');
    console.log('  pnpm query "What is photosynthesis?"\n');
  } catch (error) {
    console.error('\n❌ Pipeline failed:', error.message);
    process.exit(1);
  }
}

main();
