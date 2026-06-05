import { readFileSync, writeFileSync, existsSync, mkdirSync, symlinkSync, unlinkSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const assetsDir = join(PKG, 'assets-png');
const flaggedDir = join(assetsDir, 'flagged');

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node update-qc.mjs \'<json_data>\' [--subagent <name>]');
  process.exit(1);
}

// Parse args
const jsonDataStr = args[0];
let subagentName = null;

for (let i = 1; i < args.length; i++) {
  if (args[i] === '--subagent') {
    subagentName = args[i + 1];
  }
}

let batchUpdates;
try {
  batchUpdates = JSON.parse(jsonDataStr);
} catch (e) {
  console.error('Failed to parse JSON argument:', e.message);
  process.exit(1);
}

// Determine progress file name
const progressFileName = subagentName ? `qc-progress-${subagentName}.json` : 'qc-progress.json';
const progressPath = join(HERE, progressFileName);

let progress = {};
if (existsSync(progressPath)) {
  try {
    progress = JSON.parse(readFileSync(progressPath, 'utf8'));
  } catch (e) {
    console.warn(`Could not parse ${progressFileName}, starting fresh.`, e.message);
  }
}

// Find all image locations for symlinks
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

if (!existsSync(flaggedDir)) {
  mkdirSync(flaggedDir, { recursive: true });
}

let flagCount = 0;
let passCount = 0;

for (const id in batchUpdates) {
  const update = batchUpdates[id];
  const needsRemake = !!update.needs_remake;
  const reasons = update.reasons || [];
  
  progress[id] = {
    needs_remake: needsRemake,
    reasons: reasons,
    timestamp: new Date().toISOString()
  };
  
  const fileInfo = idMap.get(id);
  if (!fileInfo) {
    console.warn(`Could not locate file for ID: ${id}`);
    continue;
  }
  
  const symlinkPath = join(flaggedDir, fileInfo.fileName);
  if (needsRemake) {
    flagCount++;
    if (!existsSync(symlinkPath)) {
      const targetRel = join('..', fileInfo.subject, fileInfo.fileName);
      try {
        symlinkSync(targetRel, symlinkPath);
        console.log(`[FLAGGED] Created symlink for ${id}`);
      } catch (err) {
        console.error(`Failed to create symlink for ${id}:`, err.message);
      }
    }
  } else {
    passCount++;
    if (existsSync(symlinkPath)) {
      try {
        unlinkSync(symlinkPath);
        console.log(`[PASSED] Removed symlink for ${id}`);
      } catch (err) {
        console.error(`Failed to delete symlink for ${id}:`, err.message);
      }
    }
  }
}

writeFileSync(progressPath, JSON.stringify(progress, null, 2), 'utf8');
console.log(`QC update finished for progress file: ${progressFileName}. Marked ${flagCount} as flagged, ${passCount} as passed.`);
