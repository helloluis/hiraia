import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || '/Users/luis/.gemini/antigravity-cli/brain/5a8e777f-0a3f-4410-b4a9-5b59a260e989';

const action = process.argv[2]; // 'next' or 'done'
const topic = process.argv[3] || 'animals';

const promptFile = join(HERE, 'prompts', `${topic}.json`);
if (!existsSync(promptFile)) {
  console.error(`Prompt file not found for topic: ${topic}`);
  process.exit(1);
}

const data = JSON.parse(readFileSync(promptFile, 'utf8'));

if (action === 'next') {
  const nextItem = data.images.find(img => img.status === 'todo');
  if (!nextItem) {
    console.log('NO_MORE_TODO');
  } else {
    console.log(JSON.stringify(nextItem, null, 2));
  }
} else if (action === 'done') {
  const targetId = process.argv[4];
  if (!targetId) {
    console.error('Usage: node helper.mjs done <topic> <id>');
    process.exit(1);
  }

  const itemIndex = data.images.findIndex(img => img.id === targetId);
  if (itemIndex === -1) {
    console.error(`Item ${targetId} not found in topic ${topic}`);
    process.exit(1);
  }

  const item = data.images[itemIndex];
  
  // Find the generated image in the artifact directory
  const files = readdirSync(ARTIFACT_DIR);
  // The filename starts with targetId (with hyphens replaced by underscores or keeping hyphens)
  const normalizedId = targetId.replace(/-/g, '_');
  const foundFile = files.find(f => f.startsWith(normalizedId) && f.endsWith('.png'));

  if (!foundFile) {
    console.error(`Could not find generated image starting with ${normalizedId} in ${ARTIFACT_DIR}`);
    process.exit(1);
  }

  const sourcePath = join(ARTIFACT_DIR, foundFile);
  const destPath = join(PKG, item.output_png);

  // Make sure destination dir exists
  mkdirSync(dirname(destPath), { recursive: true });

  // Copy file
  copyFileSync(sourcePath, destPath);
  console.log(`Copied ${foundFile} to ${item.output_png}`);

  // Delete from artifact folder to keep it clean (optional, or we can keep it, let's keep it but logged)
  // Update status in JSON
  data.images[itemIndex].status = 'done';
  writeFileSync(promptFile, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Updated status of ${targetId} to done`);
} else {
  console.error('Unknown action. Use next or done.');
  process.exit(1);
}
