/** Fail closed on archived-source markers. No download, mutation or marker removal. */
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, basename, isAbsolute, sep } from 'node:path';

export const MARKER_NAME = '.hiraia-archive-offloaded.json';

function present(path) {
  try { lstatSync(path); return true; }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

function canonical(path) {
  // Resolve aliases even when the final file (or an intermediate directory) is absent.
  const missing = [];
  let parent = path;
  for (;;) {
    try { return join(realpathSync.native(parent), ...missing.reverse()); }
    catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      const next = dirname(parent);
      if (next === parent) throw error;
      missing.push(basename(parent));
      parent = next;
    }
  }
}

export function assertLocal(...paths) {
  const checked = new Set();
  for (const value of paths) {
    const path = resolve(value);
    // Keep '..' intact for native realpath: it must follow preceding symlinks first.
    const original = isAbsolute(value) ? value : process.cwd() + sep + value;
    for (const candidate of new Set([path, canonical(original)])) {
      const markers = [candidate + MARKER_NAME];
      for (let parent = candidate; ; parent = dirname(parent)) {
        markers.push(join(parent, MARKER_NAME));
        if (dirname(parent) === parent) break;
      }
      for (const marker of markers) {
        if (checked.has(marker)) continue;
        checked.add(marker);
        if (present(marker)) {
          const error = new Error(`ARCHIVE_OFFLOADED: ${path}\nBlocking marker: ${marker}\n`
            + 'Restore or reconstruct the archived sources at their original locations and validate '
            + 'the recorded provenance before removing this marker. See tools/reference-archive/OFFLOAD.md. '
            + 'Do not regenerate missing images or create placeholder files.');
          error.code = 'ARCHIVE_OFFLOADED';
          throw error;
        }
      }
    }
  }
}
