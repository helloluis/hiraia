/** Stage immutable voice downloads from the same catalog/vocab pins the app consumes. */
import fs from 'node:fs';
import path from 'node:path';
import { verifyVoices } from './verify-voices.mjs';

const mobile = path.resolve(import.meta.dirname, '..');
verifyVoices(mobile, {includeDownloads: true});
const catalog = JSON.parse(fs.readFileSync(path.join(mobile, 'assets/voices/catalog.json'), 'utf8'));
const output = path.join(mobile, 'build/voice-packages');
fs.mkdirSync(output, {recursive: true});
const downloads = [];
for (const [language, spec] of Object.entries(catalog.voices)) {
  if (spec.delivery !== 'download') continue;
  const file = path.join(output, spec.filename);
  fs.copyFileSync(path.join(mobile, 'assets/voices', language, 'model.onnx'), file);
  downloads.push({...spec, language, file, key: `models/${spec.filename}`});
}
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({format: 1, downloads}, null, 2) + '\n');
console.log(JSON.stringify(downloads.map(({language, filename, bytes}) => ({language, filename, bytes}))));
