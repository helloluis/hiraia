import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

async function main() {
  const mainProgressPath = join(HERE, 'qc-progress.json');
  let mainProgress = {};
  
  if (existsSync(mainProgressPath)) {
    mainProgress = JSON.parse(readFileSync(mainProgressPath, 'utf8'));
  }
  
  const files = readdirSync(HERE).filter(f => f.startsWith('qc-progress-') && f.endsWith('.json'));
  console.log(`Found ${files.length} subagent progress files to merge.`);
  
  let mergeCount = 0;
  for (const file of files) {
    const filePath = join(HERE, file);
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf8'));
      for (const id in data) {
        mainProgress[id] = data[id];
        mergeCount++;
      }
      // Delete temporary file
      unlinkSync(filePath);
      console.log(`Merged and deleted: ${file}`);
    } catch (err) {
      console.error(`Error processing ${file}:`, err.message);
    }
  }
  
  writeFileSync(mainProgressPath, JSON.stringify(mainProgress, null, 2), 'utf8');
  console.log(`QC merge complete! Merged ${mergeCount} records into qc-progress.json.`);
  
  const total = Object.keys(mainProgress).length;
  const flagged = Object.values(mainProgress).filter(x => x.needs_remake).length;
  console.log(`Main progress now contains: ${total} total records, ${flagged} flagged.`);
}

main().catch(err => {
  console.error(err);
});
