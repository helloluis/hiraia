import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const assetsDir = join(PKG, 'assets-png');

const args = process.argv.slice(2);
const targetTopic = args[0] || 'all';
const limit = parseInt(args[1], 10) || 10;

// Load prompts database to match images with prompts
const promptsDir = join(HERE, 'prompts');
const promptFiles = readdirSync(promptsDir).filter(f => f.endsWith('.json'));

const promptMap = new Map();
for (const file of promptFiles) {
  const data = JSON.parse(readFileSync(join(promptsDir, file), 'utf8'));
  for (const img of data.images) {
    promptMap.set(img.id, img);
  }
}

// Load QC Progress
const progressPath = join(HERE, 'qc-progress.json');
let qcProgress = {};
if (existsSync(progressPath)) {
  qcProgress = JSON.parse(readFileSync(progressPath, 'utf8'));
}

// Scan all images in assets-png subdirs
const subjects = ['biology', 'chemistry', 'earth-science', 'general', 'physics'];
const unchecked = [];

for (const sub of subjects) {
  const dir = join(assetsDir, sub);
  if (existsSync(dir)) {
    const files = readdirSync(dir).filter(f => f.endsWith('.png'));
    for (const file of files) {
      const id = file.substring(0, file.length - 4);
      // An image is unchecked if it is not in qc-progress.json OR has no progress entry
      const progressEntry = qcProgress[id];
      const isUnchecked = !progressEntry || progressEntry.needs_remake === undefined;
      
      if (isUnchecked) {
        const promptDef = promptMap.get(id);
        if (promptDef) {
          // If a target topic is specified, filter by it
          if (targetTopic === 'all' || promptDef.topic === targetTopic) {
            unchecked.push({
              id,
              subject: sub,
              topic: promptDef.topic,
              prompt: promptDef.prompt,
              absPath: join(dir, file),
              relPath: join('assets-png', sub, file)
            });
          }
        }
      }
    }
  }
}

console.log(`Found ${unchecked.length} total unchecked images for topic "${targetTopic}".`);
console.log(`Showing the first ${Math.min(limit, unchecked.length)}:\n`);

const batch = unchecked.slice(0, limit);
batch.forEach((img, index) => {
  console.log(`=== [${index + 1}/${batch.length}] ID: ${img.id} (Subject: ${img.subject}, Topic: ${img.topic}) ===`);
  console.log(`Prompt: "${img.prompt}"`);
  console.log(`Path: ${img.absPath}`);
  console.log();
});

if (batch.length > 0) {
  console.log('To view all these images at once, you can call view_file on their paths.');
  console.log('Use node update-qc.mjs to save your reviews.');
}
