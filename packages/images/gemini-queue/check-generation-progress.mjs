import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const promptsDir = join(HERE, 'prompts');

async function main() {
  if (!existsSync(promptsDir)) {
    console.error('prompts directory not found');
    process.exit(1);
  }

  const topicFiles = readdirSync(promptsDir).filter(f => f.endsWith('.json'));

  let totalDone = 0;
  let totalTodo = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let totalImages = 0;

  const summary = [];

  for (const topicFile of topicFiles) {
    const topicPath = join(promptsDir, topicFile);
    const data = JSON.parse(readFileSync(topicPath, 'utf8'));
    
    let done = 0;
    let todo = 0;
    let failed = 0;
    let skipped = 0;

    for (const img of data.images) {
      if (img.status === 'done') done++;
      else if (img.status === 'todo') todo++;
      else if (img.status === 'failed') failed++;
      else if (img.status === 'skipped') skipped++;
    }

    totalDone += done;
    totalTodo += todo;
    totalFailed += failed;
    totalSkipped += skipped;
    totalImages += data.images.length;

    summary.push({
      topic: data.topic,
      total: data.images.length,
      done,
      todo,
      failed,
      skipped
    });
  }

  console.log('========================================');
  console.log('       Image Generation Progress        ');
  console.log('========================================');
  console.log(`Total Images: ${totalImages}`);
  console.log(`Done:         ${totalDone} (${((totalDone / totalImages) * 100).toFixed(1)}%)`);
  console.log(`Todo:         ${totalTodo} (${((totalTodo / totalImages) * 100).toFixed(1)}%)`);
  console.log(`Failed:       ${totalFailed}`);
  console.log(`Skipped:      ${totalSkipped}`);
  console.log('----------------------------------------');
  
  for (const s of summary.sort((a, b) => b.todo - a.todo)) {
    if (s.todo > 0 || s.done > 0) {
      console.log(`${s.topic.padEnd(25)} | Total: ${String(s.total).padStart(4)} | Done: ${String(s.done).padStart(4)} | Todo: ${String(s.todo).padStart(4)}`);
    }
  }
  console.log('========================================');
}

main().catch(err => {
  console.error(err);
});
