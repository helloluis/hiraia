import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { MANUAL_TRANSFORM, processPreservedManualImage } from './manual-originals.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const original = Buffer.from('full-resolution original bytes, including binary \x00\xff data');
const derivative = Buffer.from('small derivative');

function fixture(t, filename = 'extensionless-original') {
  const root = mkdtempSync(join(tmpdir(), 'hiraia-manual-originals-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourcePath = join(root, filename);
  const outputPath = join(root, 'output', 'image.png');
  const originalsDir = join(root, 'originals');
  mkdirSync(dirname(outputPath));
  writeFileSync(sourcePath, original);
  return {
    root, sourcePath, outputPath, originalsDir,
    imageId: 'test-image', processor: 'manual-originals.test.mjs',
    render: async (bytes) => {
      assert.deepEqual(bytes, original);
      return derivative;
    },
  };
}

function originalPath(options) {
  const hash = digest(original);
  return join(options.originalsDir, 'sha256', hash.slice(0, 2), hash);
}

test('extensionless source is retained byte-for-byte before rendering and safe cleanup', async (t) => {
  const options = fixture(t);
  options.render = async (bytes) => {
    assert.deepEqual(bytes, original);
    assert.deepEqual(readFileSync(originalPath(options)), original);
    assert.equal(existsSync(options.sourcePath), true);
    assert.equal(readdirSync(join(options.originalsDir, 'provenance')).length, 1);
    return derivative;
  };
  const result = await processPreservedManualImage(options);
  assert.equal(result.sourceDeleted, true);
  assert.equal(existsSync(options.sourcePath), false);
  assert.deepEqual(readFileSync(result.originalPath), original);
  assert.deepEqual(readFileSync(options.outputPath), derivative);
  assert.equal(basename(result.originalPath), digest(original));
  const preserved = JSON.parse(readFileSync(result.preservationEvent));
  const processed = JSON.parse(readFileSync(result.processingEvent));
  assert.equal(preserved.source.filename, 'extensionless-original');
  assert.equal(preserved.source.sha256, digest(original));
  assert.equal(preserved.original.bytes, original.length);
  assert.equal(processed.original.sha256, digest(original));
  assert.equal(processed.output.sha256, digest(derivative));
  assert.equal(processed.output.path, options.outputPath);
  assert.equal(processed.output.image_id, options.imageId);
  assert.deepEqual(processed.transform, MANUAL_TRANSFORM);
  assert.equal(processed.preservation_event, join('provenance', basename(result.preservationEvent)));
});

test('identical originals reuse one verified blob and retain independent provenance', async (t) => {
  const options = fixture(t, 'first.jpeg');
  const first = await processPreservedManualImage(options);
  options.sourcePath = join(options.root, 'second-no-extension');
  writeFileSync(options.sourcePath, original);
  const second = await processPreservedManualImage(options);
  assert.equal(first.originalPath, second.originalPath);
  assert.notEqual(first.preservationEvent, second.preservationEvent);
  assert.equal(readdirSync(dirname(first.originalPath)).length, 1);
  assert.equal(readdirSync(join(options.originalsDir, 'provenance')).length, 4);
  assert.deepEqual(readFileSync(first.originalPath), original);
});

test('corrupt existing hash-addressed original aborts without overwrite, render or deletion', async (t) => {
  const options = fixture(t);
  const path = originalPath(options);
  const corrupt = Buffer.from('different bytes at the expected content hash');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, corrupt);
  let rendered = false;
  options.render = async () => { rendered = true; return derivative; };
  await assert.rejects(processPreservedManualImage(options), /hash collision or corruption/);
  assert.equal(rendered, false);
  assert.deepEqual(readFileSync(options.sourcePath), original);
  assert.deepEqual(readFileSync(path), corrupt);
  assert.equal(existsSync(options.outputPath), false);
  assert.equal(readdirSync(dirname(path)).length, 1);
});

test('unwritable preservation destination prevents rendering and input cleanup', async (t) => {
  const options = fixture(t);
  // A file where the store directory belongs fails deterministically, including
  // when tests run under a user that can bypass Unix permission bits.
  writeFileSync(options.originalsDir, 'not a directory');
  let rendered = false;
  options.render = async () => { rendered = true; return derivative; };
  await assert.rejects(processPreservedManualImage(options));
  assert.equal(rendered, false);
  assert.deepEqual(readFileSync(options.sourcePath), original);
  assert.equal(existsSync(options.outputPath), false);
});

test('render failure retains the input, preserved original and preservation evidence', async (t) => {
  const options = fixture(t);
  options.render = async () => { throw new Error('renderer failed'); };
  await assert.rejects(processPreservedManualImage(options), /renderer failed/);
  assert.deepEqual(readFileSync(options.sourcePath), original);
  assert.deepEqual(readFileSync(originalPath(options)), original);
  assert.equal(existsSync(options.outputPath), false);
  assert.equal(readdirSync(join(options.originalsDir, 'provenance')).length, 1);
});

test('source edited during rendering is retained while the derivative refers to the original snapshot', async (t) => {
  const options = fixture(t);
  const replacement = Buffer.from('new full-resolution image uploaded during processing');
  options.render = async (bytes) => {
    assert.deepEqual(bytes, original);
    writeFileSync(options.sourcePath, replacement);
    return derivative;
  };
  const result = await processPreservedManualImage(options);
  assert.equal(result.sourceDeleted, false);
  assert.equal(result.reason, 'source_changed');
  assert.equal(result.retainedSourcePath, options.sourcePath);
  assert.deepEqual(readFileSync(options.sourcePath), replacement);
  assert.deepEqual(readFileSync(result.originalPath), original);
  const provenance = JSON.parse(readFileSync(result.processingEvent));
  assert.equal(provenance.original.sha256, digest(original));
  assert.equal(provenance.output.sha256, digest(derivative));
});

test('same-content replacement is retained because it is a new queue entry', async (t) => {
  const options = fixture(t);
  options.render = async () => {
    unlinkSync(options.sourcePath);
    writeFileSync(options.sourcePath, original);
    return derivative;
  };
  const result = await processPreservedManualImage(options);
  assert.equal(result.sourceDeleted, false);
  assert.deepEqual(readFileSync(options.sourcePath), original);
});

test('failed processed-provenance persistence after saving output never deletes source', async (t) => {
  const options = fixture(t);
  options.render = async () => {
    const directory = join(options.originalsDir, 'provenance');
    rmSync(directory, { recursive: true });
    writeFileSync(directory, 'blocks the processed provenance directory');
    return derivative;
  };
  await assert.rejects(processPreservedManualImage(options));
  assert.deepEqual(readFileSync(options.outputPath), derivative);
  assert.deepEqual(readFileSync(options.sourcePath), original);
  assert.deepEqual(readFileSync(originalPath(options)), original);
});

test('provenance paths are immutable: an existing processed record is never replaced', async (t) => {
  const options = fixture(t);
  let collisionPath;
  const sentinel = Buffer.from('existing immutable event');
  options.render = async () => {
    const directory = join(options.originalsDir, 'provenance');
    const preserved = readdirSync(directory).find((name) => name.endsWith('-preserved.json'));
    collisionPath = join(directory, preserved.replace('-preserved.json', '-processed.json'));
    writeFileSync(collisionPath, sentinel);
    return derivative;
  };
  await assert.rejects(processPreservedManualImage(options), { code: 'EEXIST' });
  assert.deepEqual(readFileSync(collisionPath), sentinel);
  assert.deepEqual(readFileSync(options.sourcePath), original);
  assert.deepEqual(readFileSync(options.outputPath), derivative);
});

test('store corrupted during rendering is detected before source removal', async (t) => {
  const options = fixture(t);
  options.render = async () => {
    writeFileSync(originalPath(options), 'unexpected corruption');
    return derivative;
  };
  await assert.rejects(processPreservedManualImage(options), /hash collision or corruption/);
  assert.deepEqual(readFileSync(options.sourcePath), original);
});
