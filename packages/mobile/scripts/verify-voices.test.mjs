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
  for (const language of ['en', 'tl']) {
    const directory = path.join(root, 'assets/voices', language);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'model.onnx'), language);
    fs.writeFileSync(path.join(directory, 'voice.json'), JSON.stringify({
      sha256: createHash('sha256').update(language).digest('hex'),
    }));
  }
  assert.doesNotThrow(() => verifyVoices(root));
  const english = path.join(root, 'assets/voices/en/model.onnx');
  fs.writeFileSync(english, 'older export');
  assert.throws(() => verifyVoices(root), /en voice mismatch/);
  fs.rmSync(english);
  assert.throws(() => verifyVoices(root), /Missing .*model.onnx/);
});
