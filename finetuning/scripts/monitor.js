#!/usr/bin/env node

/**
 * Monitor training status for paused/in-progress fine-tuning jobs
 */

import { finetune, loadModel, QWEN3_1_7B_INST_Q4 } from '@qvac/sdk';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const language = process.argv[2];

if (!language || !['tagalog', 'cebuano'].includes(language)) {
  console.error('Usage: node monitor.js <tagalog|cebuano>');
  process.exit(1);
}

async function monitorTraining() {
  console.log(`📊 Checking ${language} training status...\n`);

  let modelId;

  try {
    // Load model (or reconnect to existing)
    console.log('Connecting to model...');
    modelId = await loadModel({
      modelSrc: QWEN3_1_7B_INST_Q4,
      modelConfig: {
        ctx_size: 2048,
      },
    });

    const trainDatasetDir = join(__dirname, `../datasets/${language}/science-chat.jsonl`);
    const outputParametersDir = join(__dirname, `../output/${language}`);

    // Get current state
    const result = await finetune({
      modelId,
      operation: 'getState',
      options: {
        trainDatasetDir,
        validation: { type: 'split', fraction: 0.1 },
        outputParametersDir,
      },
    });

    console.log('\nTraining Status:');
    console.log(`  Status: ${result.status}`);

    if (result.stats) {
      console.log('\nStatistics:');
      console.log(`  Global steps: ${result.stats.global_steps}`);
      console.log(`  Epochs completed: ${result.stats.epochs_completed}`);
      console.log(`  Train loss: ${result.stats.train_loss?.toFixed(4) || 'N/A'}`);
      console.log(`  Val loss: ${result.stats.val_loss?.toFixed(4) || 'N/A'}`);
      console.log(`  Train accuracy: ${result.stats.train_accuracy ? (result.stats.train_accuracy * 100).toFixed(2) + '%' : 'N/A'}`);
      console.log(`  Val accuracy: ${result.stats.val_accuracy ? (result.stats.val_accuracy * 100).toFixed(2) + '%' : 'N/A'}`);
      console.log(`  Learning rate: ${result.stats.learning_rate || 'N/A'}`);
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

monitorTraining();
