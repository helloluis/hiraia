import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const assetsDir = join(PKG, 'assets-png');
const flaggedDir = join(assetsDir, 'flagged');

if (!existsSync(flaggedDir)) {
  mkdirSync(flaggedDir, { recursive: true });
}

// Read progress
const progressPath = join(HERE, 'qc-progress.json');
if (!existsSync(progressPath)) {
  console.error('qc-progress.json not found');
  process.exit(1);
}
const progress = JSON.parse(readFileSync(progressPath, 'utf8'));

// Scan directory to map ID -> subject
const subjects = ['biology', 'chemistry', 'earth-science', 'general', 'physics'];
const idMap = new Map();

for (const sub of subjects) {
  const dir = join(assetsDir, sub);
  if (existsSync(dir)) {
    const files = readdirSync(dir).filter(f => f.endsWith('.png'));
    for (const f of files) {
      const id = f.substring(0, f.length - 4);
      idMap.set(id, { subject: sub, fileName: f });
    }
  }
}

let count = 0;
for (const id in progress) {
  if (progress[id].needs_remake) {
    const fileInfo = idMap.get(id);
    if (!fileInfo) {
      console.warn(`Could not locate image file for ID: ${id}`);
      continue;
    }
    const symlinkPath = join(flaggedDir, fileInfo.fileName);
    if (!existsSync(symlinkPath)) {
      const targetRel = join('..', fileInfo.subject, fileInfo.fileName);
      try {
        symlinkSync(targetRel, symlinkPath);
        count++;
      } catch (err) {
        console.error(`Failed to create symlink for ${id}:`, err.message);
      }
    }
  }
}

console.log(`Successfully created ${count} symlinks in ${flaggedDir}`);
