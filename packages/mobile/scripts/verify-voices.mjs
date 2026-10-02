import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The weights are local build inputs, while their identities and vocabularies are tracked.
// Refuse an old model paired with a new vocabulary/freshness marker.
export function verifyVoices(mobile, { includeDownloads = false } = {}) {
  const catalog = JSON.parse(readFileSync(path.join(mobile, 'assets/voices/catalog.json'), 'utf8'));
  if (catalog.format !== 1 || !catalog.voices?.en || !catalog.voices?.tl) throw new Error('Invalid voice catalog');
  for (const [language, spec] of Object.entries(catalog.voices)) {
    const directory = path.join(mobile, 'assets/voices', language);
    const metadata = JSON.parse(readFileSync(path.join(directory, 'voice.json'), 'utf8'));
    if (metadata.sha256 !== spec.sha256 || !/^[a-f0-9]{32}$/.test(spec.md5) ||
        !Number.isSafeInteger(spec.bytes) || spec.bytes <= 0 || !['bundled', 'download'].includes(spec.delivery) ||
        spec.filename !== `voice-${language}-${spec.sha256.slice(0, 16)}.onnx`) {
      throw new Error(`${language} voice catalog does not match its metadata`);
    }
    if (spec.delivery !== 'bundled' && !includeDownloads) continue;
    const model = path.join(directory, 'model.onnx');
    let bytes;
    try { bytes = readFileSync(model); } catch {
      throw new Error(`Missing ${model}. Restore the voice whose SHA-256 is ${metadata.sha256}; see BUILD.md.`);
    }
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== metadata.sha256 || bytes.length !== spec.bytes || createHash('md5').update(bytes).digest('hex') !== spec.md5) {
      throw new Error(`${language} voice mismatch: expected ${metadata.sha256}, received ${actual}. Restore matching weights; do not change the pin.`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyVoices(path.resolve(import.meta.dirname, '..'), { includeDownloads: process.argv.includes('--include-downloads') });
  console.log('Voice metadata and required local weights match the catalog pins.');
}
