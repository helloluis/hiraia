import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const promptsDir = join(HERE, 'prompts');

async function main() {
  if (!existsSync(promptsDir)) {
    console.error('prompts folder not found');
    process.exit(1);
  }

  const topicFiles = readdirSync(promptsDir).filter(f => f.endsWith('.json'));
  let resetCount = 0;

  for (const topicFile of topicFiles) {
    const topicPath = join(promptsDir, topicFile);
    const data = JSON.parse(readFileSync(topicPath, 'utf8'));
    let modified = false;

    for (const img of data.images) {
      if (img.status === 'failed') {
        img.status = 'todo';
        resetCount++;
        modified = true;
      }
    }

    if (modified) {
      writeFileSync(topicPath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`Reset failed images in ${topicFile}`);
    }
  }

  console.log(`Successfully reset ${resetCount} failed images back to todo.`);
}

main().catch(err => console.error(err));
