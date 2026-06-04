import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');

// Helper to print usage
function printUsage() {
  console.log(`
Usage:
  GEMINI_API_KEY=your_key node batch-generator.mjs <topic_name> [options]

Options:
  --limit <number>   Limit the number of images to generate in this run (default: 5)
  --delay <ms>       Delay between requests in milliseconds (default: 3000)

Examples:
  GEMINI_API_KEY=xxx node batch-generator.mjs animals --limit 10
  GEMINI_API_KEY=xxx node batch-generator.mjs plants
`);
}

// Parse args
const args = process.argv.slice(2);
const topic = args[0];

if (!topic || topic === '--help' || topic === '-h') {
  printUsage();
  process.exit(0);
}

let limit = 5;
let delay = 3000;

for (let i = 1; i < args.length; i++) {
  if (args[i] === '--limit') {
    limit = parseInt(args[++i], 10);
  } else if (args[i] === '--delay') {
    delay = parseInt(args[++i], 10);
  }
}

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('Error: GEMINI_API_KEY environment variable is required.');
  printUsage();
  process.exit(1);
}

const promptFile = join(HERE, 'prompts', `${topic}.json`);
if (!existsSync(promptFile)) {
  console.error(`Error: Prompt file not found: ${promptFile}`);
  process.exit(1);
}

const data = JSON.parse(readFileSync(promptFile, 'utf8'));
const todoItems = data.images.filter(img => img.status === 'todo');

if (todoItems.length === 0) {
  console.log(`All images in topic "${topic}" are already done!`);
  process.exit(0);
}

console.log(`Found ${todoItems.length} todo images in "${topic}". Will process up to ${limit} in this run.`);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

for (let i = 0; i < Math.min(limit, todoItems.length); i++) {
  const item = todoItems[i];
  console.log(`\n[${i + 1}/${limit}] Generating "${item.id}"...`);
  console.log(`Prompt: "${item.prompt.substring(0, 100)}..."`);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instances: [
            {
              prompt: item.prompt,
            },
          ],
          parameters: {
            sampleCount: 1,
            aspectRatio: '1:1',
            outputOptions: {
              mimeType: 'image/png',
            },
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API returned status ${response.status}: ${errorText}`);
    }

    const resJson = await response.json();
    if (!resJson.predictions || resJson.predictions.length === 0) {
      throw new Error(`API response did not contain predictions: ${JSON.stringify(resJson)}`);
    }

    const base64Data = resJson.predictions[0].bytesBase64Encoded;
    if (!base64Data) {
      throw new Error('API prediction did not contain base64 bytes.');
    }

    const buffer = Buffer.from(base64Data, 'base64');
    const destPath = join(PKG, item.output_png);

    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, buffer);

    console.log(`Success! Saved to ${item.output_png}`);

    // Update status in JSON memory
    const originalIndex = data.images.findIndex(img => img.id === item.id);
    if (originalIndex !== -1) {
      data.images[originalIndex].status = 'done';
    }

    // Write progress back to the file
    writeFileSync(promptFile, JSON.stringify(data, null, 2), 'utf8');

  } catch (err) {
    console.error(`Failed to generate "${item.id}":`, err.message);
  }

  if (i < limit - 1 && i < todoItems.length - 1) {
    console.log(`Waiting ${delay}ms before next image...`);
    await sleep(delay);
  }
}

console.log('\nBatch run complete!');
