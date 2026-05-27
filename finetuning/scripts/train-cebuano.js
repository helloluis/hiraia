#!/usr/bin/env node

/**
 * Train Cebuano Bisaya LoRA adapter for Hiraia
 * Uses QVAC's finetune() API with Qwen3-1.7B
 */

import {
  loadModel,
  finetune,
  unloadModel,
  QWEN3_1_7B_INST_Q4,
} from '@qvac/sdk';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function trainCebuanoAdapter() {
  console.log('🚀 Starting Cebuano Bisaya LoRA training...\n');

  let modelId;

  try {
    // Load base model
    console.log('Loading Qwen3-1.7B base model...');
    modelId = await loadModel({
      modelSrc: QWEN3_1_7B_INST_Q4,
      modelConfig: {
        ctx_size: 2048,
      },
    });
    console.log(`✓ Model loaded: ${modelId}\n`);

    // Configure training
    const trainDatasetDir = join(__dirname, '../datasets/cebuano/science-chat.jsonl');
    const outputParametersDir = join(__dirname, '../output/cebuano');

    console.log('Training configuration:');
    console.log(`  Dataset: ${trainDatasetDir}`);
    console.log(`  Output: ${outputParametersDir}`);
    console.log('  Epochs: 3');
    console.log('  Learning rate: 1e-4');
    console.log('  LoRA rank: 32');
    console.log('  LoRA alpha: 64\n');

    // Start training
    const handle = finetune({
      modelId,
      options: {
        trainDatasetDir,
        validation: {
          type: 'split',
          fraction: 0.1, // 10% validation split
        },
        outputParametersDir,
        numberOfEpochs: 3,
        learningRate: 1e-4,
        contextLength: 2048,
        batchSize: 4,
        microBatchSize: 1,
        assistantLossOnly: true,
        loraRank: 32,
        loraAlpha: 64,
        loraModules: 'attn_q,attn_k,attn_v,attn_o,ffn_gate,ffn_up,ffn_down',
        lrScheduler: 'cosine',
        warmupRatio: 0.1,
      },
    });

    // Monitor progress
    let startTime = Date.now();
    let lastLoss = null;

    for await (const progress of handle.progressStream) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const eta = Math.floor(progress.eta_ms / 1000);
      const etaMin = Math.floor(eta / 60);
      const etaSec = eta % 60;

      const lossStr = progress.loss !== null ? progress.loss.toFixed(4) : 'N/A';
      const accStr = progress.accuracy !== null ? (progress.accuracy * 100).toFixed(2) + '%' : 'N/A';

      console.log(
        `Step ${progress.global_steps.toString().padStart(4)} | ` +
        `Epoch ${progress.current_epoch}/${3} | ` +
        `Batch ${progress.current_batch}/${progress.total_batches} | ` +
        `Loss: ${lossStr} | ` +
        `Acc: ${accStr} | ` +
        `ETA: ${etaMin}m ${etaSec}s`
      );

      lastLoss = progress.loss;
    }

    // Get final result
    const result = await handle.result;

    console.log('\n✓ Training completed!');
    console.log(`  Status: ${result.status}`);
    if (result.stats) {
      console.log(`  Final train loss: ${result.stats.train_loss?.toFixed(4) || 'N/A'}`);
      console.log(`  Final val loss: ${result.stats.val_loss?.toFixed(4) || 'N/A'}`);
      console.log(`  Epochs completed: ${result.stats.epochs_completed}`);
      console.log(`  Total steps: ${result.stats.global_steps}`);
    }

    const totalTime = Math.floor((Date.now() - startTime) / 1000);
    console.log(`  Total time: ${Math.floor(totalTime / 60)}m ${totalTime % 60}s`);
    console.log(`\n✓ LoRA adapter saved to: ${outputParametersDir}`);

    // Unload model
    console.log('\nUnloading model...');
    await unloadModel({ modelId });
    console.log('✓ Done\n');

  } catch (error) {
    console.error('\n✗ Training failed:', error.message);

    // Try to unload model on error
    if (modelId) {
      try {
        await unloadModel({ modelId });
      } catch (e) {
        // Ignore cleanup errors
      }
    }

    process.exit(1);
  }
}

// Run training
trainCebuanoAdapter();
