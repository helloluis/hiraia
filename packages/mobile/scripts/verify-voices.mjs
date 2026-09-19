import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The weights are local build inputs, while their identities and vocabularies are tracked.
// Refuse an old model paired with a new vocabulary/freshness marker.
export function verifyVoices(mobile) {
  for (const language of ['en', 'tl']) {
    const directory = path.join(mobile, 'assets/voices', language);
    const metadata = JSON.parse(readFileSync(path.join(directory, 'voice.json'), 'utf8'));
    const model = path.join(directory, 'model.onnx');
    let bytes;
    try { bytes = readFileSync(model); } catch {
      throw new Error(`Missing ${model}. Restore the voice whose SHA-256 is ${metadata.sha256}; see BUILD.md.`);
    }
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== metadata.sha256) {
      throw new Error(`${language} voice mismatch: expected ${metadata.sha256}, received ${actual}. Restore matching weights; do not change the pin.`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyVoices(path.resolve(import.meta.dirname, '..'));
  console.log('English and Filipino voice weights match the tracked SHA-256 pins.');
}
