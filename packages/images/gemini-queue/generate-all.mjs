import { readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(HERE, 'prompts');

const files = readdirSync(PROMPTS_DIR)
  .filter(f => f.endsWith('.json'))
  .map(f => basename(f, '.json'));

console.log(`Found topics to generate: ${files.join(', ')}`);

async function runTopic(topic) {
  return new Promise((resolve) => {
    console.log(`\n========================================`);
    console.log(`Starting topic: ${topic}`);
    console.log(`========================================\n`);

    const child = spawn('node', [
      '--env-file=gemini-queue/.env',
      'gemini-queue/batch-generator.mjs',
      topic,
      '--limit', '10000',
      '--delay', '15000'
    ], {
      cwd: join(HERE, '..'), // Run from packages/images
      stdio: 'inherit'
    });

    child.on('close', (code) => {
      console.log(`Finished topic ${topic} with code ${code}`);
      resolve(code);
    });
  });
}

async function main() {
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  for (const topic of files) {
    let completed = false;
    while (!completed) {
      const code = await runTopic(topic);
      if (code === 0) {
        completed = true;
      } else if (code === 429 || code === 173) {
        console.warn('\nRate limit (429/173) encountered. Sleeping for 60 seconds before retrying...\n');
        await sleep(60000);
      } else {
        console.error(`Topic failed with unexpected exit code: ${code}. Stopping batch run.`);
        process.exit(code);
      }
    }
  }
  console.log('All topics completed!');
}

main().catch(err => {
  console.error('Error running batch:', err);
  process.exit(1);
});
