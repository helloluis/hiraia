import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, constants, existsSync, fstatSync, fsyncSync, linkSync, lstatSync,
  mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

export const MANUAL_TRANSFORM = Object.freeze({
  id: 'manual-512-gray16-v1',
  resize: Object.freeze({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }),
  grayscale: true,
  linear: Object.freeze({ multiplier: 1.28, offset: -38 }),
  png: Object.freeze({ palette: true, colours: 16, effort: 10, compressionLevel: 9 }),
});

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function stamp(stat) {
  return Object.fromEntries(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].map((key) => [key, String(stat[key])]));
}

function sameStamp(left, right, { afterRename = false } = {}) {
  const keys = afterRename ? ['dev', 'ino', 'size', 'mtimeNs'] : ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'];
  return keys.every((key) => left[key] === right[key]);
}

function syncDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function ensureDirectory(path) {
  const firstCreated = mkdirSync(path, { recursive: true });
  if (!firstCreated) return;
  // Fsync newly created directory entries up to the pre-existing parent too;
  // flushing only the leaf would not make a new store path durable on its own.
  for (let directory = resolve(path); ; directory = dirname(directory)) {
    syncDirectory(directory);
    if (directory === resolve(firstCreated)) {
      syncDirectory(dirname(directory));
      break;
    }
  }
}

function readStableFile(path) {
  // Manual uploads are regular files, including files with no extension. Do not
  // follow a replacement symlink during preservation or destructive cleanup.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile()) throw new Error(`Not a regular file: ${path}`);
    const bytes = readFileSync(fd);
    const after = fstatSync(fd, { bigint: true });
    const entry = lstatSync(path, { bigint: true });
    if (!entry.isFile() || !sameStamp(stamp(before), stamp(after)) || !sameStamp(stamp(after), stamp(entry))) {
      throw new Error(`File changed while reading: ${path}`);
    }
    return { bytes, stamp: stamp(after), sha256: sha256(bytes) };
  } finally {
    closeSync(fd);
  }
}

function verifyBytes(path, expected) {
  const found = readStableFile(path);
  if (found.sha256 !== sha256(expected) || !found.bytes.equals(expected)) {
    throw new Error(`Original-store hash collision or corruption: ${path}`);
  }
  return found.bytes;
}

function writeImmutable(path, bytes, { reuseIdentical = false } = {}) {
  ensureDirectory(dirname(path));
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  let fd;
  try {
    fd = openSync(temp, 'wx', 0o600);
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    try {
      // A hard link publishes complete bytes without ever replacing an existing
      // blob/event. Concurrent identical originals may safely share one blob.
      linkSync(temp, path);
    } catch (error) {
      if (error.code !== 'EEXIST' || !reuseIdentical) throw error;
      verifyBytes(path, bytes);
    }
    verifyBytes(path, bytes);
    syncDirectory(dirname(path));
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temp)) unlinkSync(temp);
  }
}

function writeEvent(store, eventId, suffix, event) {
  const eventPath = join(store, 'provenance', `${eventId}-${suffix}.json`);
  writeImmutable(eventPath, Buffer.from(`${JSON.stringify(event, null, 2)}\n`));
  return eventPath;
}

export function preserveManualOriginal({ sourcePath, outputPath, originalsDir, imageId, processor }) {
  sourcePath = resolve(sourcePath);
  outputPath = resolve(outputPath);
  originalsDir = resolve(originalsDir);
  if (sourcePath === outputPath) throw new Error('Manual source and output must be different files');
  const snapshot = readStableFile(sourcePath);
  const originalPath = join(originalsDir, 'sha256', snapshot.sha256.slice(0, 2), snapshot.sha256);
  writeImmutable(originalPath, snapshot.bytes, { reuseIdentical: true });
  const eventId = randomUUID();
  const source = {
    path: sourcePath, filename: basename(sourcePath), bytes: snapshot.bytes.length,
    sha256: snapshot.sha256, stat: snapshot.stamp,
  };
  const original = {
    path: relative(originalsDir, originalPath), bytes: snapshot.bytes.length,
    sha256: snapshot.sha256, encoding: 'unchanged source bytes; extension is not required',
  };
  const preservationEvent = writeEvent(originalsDir, eventId, 'preserved', {
    schema: 'hiraia.manual-original/v1', kind: 'original_preserved', event_id: eventId,
    created_at: new Date().toISOString(), source, original,
    intended_output: { path: outputPath, image_id: imageId },
    processor, transform: MANUAL_TRANSFORM,
  });
  return { eventId, sourcePath, outputPath, originalsDir, imageId, processor, source, original, originalPath, preservationEvent, snapshot };
}

function writeDerivative(path, bytes) {
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  let fd;
  try {
    fd = openSync(temp, 'wx');
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, path);
    syncDirectory(dirname(path));
    const actual = readStableFile(path);
    if (!actual.bytes.equals(bytes)) throw new Error(`Output changed while saving: ${path}`);
    return { path, bytes: actual.bytes.length, sha256: actual.sha256 };
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temp)) unlinkSync(temp);
  }
}

function cleanupUnchangedSource(preserved) {
  const { sourcePath, snapshot } = preserved;
  let current;
  try {
    current = readStableFile(sourcePath);
  } catch (error) {
    if (error.code === 'ENOENT') return { sourceDeleted: false, reason: 'source_missing', retainedSourcePath: null };
    // An unreadable/changing/replaced source is never removed.
    return { sourceDeleted: false, reason: 'source_changed_or_unreadable', retainedSourcePath: sourcePath };
  }
  if (!sameStamp(current.stamp, snapshot.stamp) || !current.bytes.equals(snapshot.bytes)) {
    return { sourceDeleted: false, reason: 'source_changed', retainedSourcePath: sourcePath };
  }

  // Checking and then unlinking the public queue path would race a new upload.
  // Atomically claim the directory entry, verify what moved, and delete only
  // that private name. A new upload at sourcePath is left untouched.
  const claimedPath = join(dirname(sourcePath), `.${basename(sourcePath)}.hiraia-cleanup-${randomUUID()}`);
  renameSync(sourcePath, claimedPath);
  let unchanged = false;
  try {
    const claimed = readStableFile(claimedPath);
    // rename itself may change ctime; identity, size, mtime and bytes must agree.
    unchanged = sameStamp(claimed.stamp, snapshot.stamp, { afterRename: true }) && claimed.bytes.equals(snapshot.bytes);
  } catch {
    // Keep the claimed file if we cannot prove it is the preserved original.
  }
  if (!unchanged) {
    try {
      // Exclusive restore: never overwrite a newer upload now at sourcePath.
      linkSync(claimedPath, sourcePath);
      syncDirectory(dirname(sourcePath));
      unlinkSync(claimedPath);
      return { sourceDeleted: false, reason: 'source_changed', retainedSourcePath: sourcePath };
    } catch (error) {
      return { sourceDeleted: false, reason: 'source_changed_retained_separately', retainedSourcePath: claimedPath };
    }
  }
  unlinkSync(claimedPath);
  syncDirectory(dirname(sourcePath));
  if (existsSync(sourcePath)) return { sourceDeleted: false, reason: 'new_source_arrived', retainedSourcePath: sourcePath };
  return { sourceDeleted: true, reason: 'unchanged_source_removed', retainedSourcePath: null };
}

export async function processPreservedManualImage(options) {
  const { render } = options;
  const preserved = preserveManualOriginal(options);
  // Sharp receives bytes read back from the verified permanent store, never the
  // mutable upload path. A render failure leaves both the upload and original.
  const input = verifyBytes(preserved.originalPath, preserved.snapshot.bytes);
  const bytes = await render(input);
  if (!Buffer.isBuffer(bytes)) throw new TypeError('Manual renderer must return a Buffer');
  const output = writeDerivative(preserved.outputPath, bytes);
  const processingEvent = writeEvent(preserved.originalsDir, preserved.eventId, 'processed', {
    schema: 'hiraia.manual-derivative/v1', kind: 'derivative_saved',
    event_id: preserved.eventId, created_at: new Date().toISOString(),
    preservation_event: relative(preserved.originalsDir, preserved.preservationEvent),
    source: preserved.source, original: preserved.original,
    output: { ...output, image_id: preserved.imageId },
    processor: preserved.processor, transform: MANUAL_TRANSFORM,
    source_cleanup: 'attempted only after this immutable provenance record is persisted',
  });
  // No source deletion is possible before both original and derivative evidence
  // exist. Recheck the original after the potentially asynchronous renderer too.
  verifyBytes(preserved.originalPath, preserved.snapshot.bytes);
  const cleanup = cleanupUnchangedSource(preserved);
  return { ...cleanup, originalPath: preserved.originalPath, preservationEvent: preserved.preservationEvent, processingEvent, output };
}
