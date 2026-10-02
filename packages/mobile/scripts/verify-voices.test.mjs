import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { verifyVoices } from './verify-voices.mjs';

test('release preflight accepts matching voices and rejects stale or missing weights', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hiraia-voice-preflight-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const voices = {};
  for (const language of ['en', 'tl']) {
    const directory = path.join(root, 'assets/voices', language);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'model.onnx'), language);
    fs.writeFileSync(path.join(directory, 'voice.json'), JSON.stringify({
      sha256: createHash('sha256').update(language).digest('hex'),
    }));
    const sha256 = createHash('sha256').update(language).digest('hex');
    voices[language] = { delivery: language === 'en' ? 'bundled' : 'download',
      filename: `voice-${language}-${sha256.slice(0, 16)}.onnx`, bytes: Buffer.byteLength(language),
      md5: createHash('md5').update(language).digest('hex'), sha256 };
  }
  fs.writeFileSync(path.join(root, 'assets/voices/catalog.json'), JSON.stringify({format: 1, voices}));
  assert.doesNotThrow(() => verifyVoices(root));
  assert.doesNotThrow(() => verifyVoices(root, { includeDownloads: true }));
  fs.rmSync(path.join(root, 'assets/voices/tl/model.onnx'));
  assert.doesNotThrow(() => verifyVoices(root), 'a remote voice is not a required APK input');
  assert.throws(() => verifyVoices(root, { includeDownloads: true }), /Missing/);
  const english = path.join(root, 'assets/voices/en/model.onnx');
  fs.writeFileSync(english, 'older export');
  assert.throws(() => verifyVoices(root), /en voice mismatch/);
  fs.rmSync(english);
  assert.throws(() => verifyVoices(root), /Missing .*model.onnx/);
});
