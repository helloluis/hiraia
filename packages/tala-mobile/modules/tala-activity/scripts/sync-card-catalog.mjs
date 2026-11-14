#!/usr/bin/env node
/**
 * Copies Tala 0.4.x's card catalog (packages/tala/android/app/src/main/assets/card-catalog.tsv on
 * the tala-0.4.x branch) into this module's Android assets. The file is ~1.9 MB and append-only;
 * V1 never edits it, it only reads the branch the 0.4.x app ships from, so the two cannot drift.
 *
 *   node modules/tala-activity/scripts/sync-card-catalog.mjs          # copy if the blob changed
 *   node modules/tala-activity/scripts/sync-card-catalog.mjs --check  # exit 1 if stale/missing
 *
 * Override the source with TALA_CATALOG_REF (default "tala-0.4.x") or TALA_CATALOG_FILE (a path).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '..', 'android', 'src', 'main', 'assets');
const target = join(assets, 'card-catalog.tsv');
const marker = join(assets, '.card-catalog.blob');
const ref = process.env.TALA_CATALOG_REF || 'tala-0.4.x';
const branchPath = 'packages/tala/android/app/src/main/assets/card-catalog.tsv';
const check = process.argv.includes('--check');

function git(args, opts = {}) {
  return execFileSync('git', ['-C', here, ...args], { encoding: 'utf8', ...opts });
}

let blob, text;
if (process.env.TALA_CATALOG_FILE) {
  text = readFileSync(process.env.TALA_CATALOG_FILE, 'utf8');
  blob = 'file:' + process.env.TALA_CATALOG_FILE;
} else {
  try {
    blob = git(['rev-parse', `${ref}:${branchPath}`]).trim();
  } catch (error) {
    console.error(
      `sync-card-catalog: cannot read ${ref}:${branchPath} (is the ${ref} branch present?)\n${error.message}`
    );
    process.exit(1);
  }
  if (existsSync(marker) && existsSync(target) && readFileSync(marker, 'utf8').trim() === blob) {
    console.log(`card-catalog.tsv is current (${blob.slice(0, 12)})`);
    process.exit(0);
  }
  if (check) {
    console.error('sync-card-catalog: assets/card-catalog.tsv is missing or stale');
    process.exit(1);
  }
  text = git(['show', `${ref}:${branchPath}`], { maxBuffer: 64 * 1024 * 1024 });
}
if (!text.startsWith('# Tala card catalog')) {
  console.error('sync-card-catalog: source does not look like the Tala card catalog');
  process.exit(1);
}
mkdirSync(assets, { recursive: true });
writeFileSync(target, text);
writeFileSync(marker, blob + '\n');
console.log(`card-catalog.tsv written (${text.length} bytes, ${blob.slice(0, 12)})`);
