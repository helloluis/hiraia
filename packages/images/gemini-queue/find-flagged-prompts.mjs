import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const assetsDir = join(PKG, 'assets-png');
const flaggedDir = join(assetsDir, 'flagged');

async function main() {
  if (!existsSync(flaggedDir)) {
    console.error('flagged directory not found');
    process.exit(1);
  }

  // Get flagged IDs
  const flaggedFiles = readdirSync(flaggedDir).filter(f => f.endsWith('.png'));
  const flaggedIds = new Set(flaggedFiles.map(f => f.substring(0, f.length - 4)));
  console.log(`Found ${flaggedIds.size} flagged images in folder.`);

  // Find where they are in prompts
  const promptsDir = join(HERE, 'prompts');
  const topicFiles = readdirSync(promptsDir).filter(f => f.endsWith('.json'));

  const flaggedMap = [];
  for (const topicFile of topicFiles) {
    const topicPath = join(promptsDir, topicFile);
    const data = JSON.parse(readFileSync(topicPath, 'utf8'));
    for (const img of data.images) {
      if (flaggedIds.has(img.id)) {
        flaggedMap.push({
          id: img.id,
          name: img.name,
          subject: img.subject,
          topic: img.topic,
          prompt: img.prompt,
          status: img.status
        });
      }
    }
  }

  const outputPath = join(HERE, 'flagged-prompts.json');
  writeFileSync(outputPath, JSON.stringify(flaggedMap, null, 2), 'utf8');
  console.log(`Saved ${flaggedMap.length} flagged prompts to flagged-prompts.json`);
}

main().catch(err => {
  console.error(err);
});
