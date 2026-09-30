import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
const desktop = fileURLToPath(new URL('../', import.meta.url));
const root = path.resolve(desktop, '../..');
process.chdir(desktop);
const cache = path.join(root, 'build/windows-native/models');
fs.mkdirSync(cache, { recursive: true });
const pins = [
  ['labse.Q4_K_M.gguf', 383762048, '3869330197b5a583afc572104bf93393e384c72473a15c2dae43cab43e194b3e'],
  ['hiraia-sft-2b-v2.Q4_K_M.gguf', 1274396160, 'b13e66678be6718252c692cb765bbe1d6bafd69c11772a1d1e9c23ee6ce0cd89'],
];
for (const [name, bytes, digest] of pins) {
  const target = path.join(cache, name);
  if (!fs.existsSync(target)) {
    const response = await fetch(`https://assets.hiraia.org/models/${name}`);
    if (!response.ok || !response.body) throw new Error(`Model download HTTP ${response.status}`);
    await pipeline(response.body, fs.createWriteStream(target));
  }
  if (fs.statSync(target).size !== bytes) throw new Error(`Model size mismatch: ${name}`);
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(target)) hash.update(chunk);
  if (hash.digest('hex') !== digest) throw new Error(`Model hash mismatch: ${name}`);
}
const sdk = await import('@qvac/sdk');
const report = { platform: process.platform, arch: process.arch, cpuOnly: true, passed: false };
try {
  const embedId = await sdk.loadModel({ modelSrc: path.join(cache, pins[0][0]), modelType: 'llamacpp-embedding', modelConfig: { pooling: 'cls', embdNormalize: 2, device: 'cpu' } });
  const result = await sdk.embed({ modelId: embedId, text: 'The Sun gives plants energy.' });
  if (result.embedding.length !== 768 || !result.embedding.every(Number.isFinite)) throw new Error('Invalid LaBSE embedding');
  report.embeddingDimensions = result.embedding.length;
  await sdk.unloadModel({ modelId: embedId });
  const llmId = await sdk.loadModel({ modelSrc: path.join(cache, pins[1][0]), modelType: 'llm', modelConfig: { ctx_size: 4096, gpu_layers: 0, device: 'cpu' } });
  const run = sdk.completion({ modelId: llmId, history: [{ role: 'user', content: 'Name the star at the center of our solar system.' }], stream: true,
    generationParams: { temp: 0, predict: 24, reasoning_budget: 0 } });
  let answer = '';
  for await (const event of run.events) if (event.type === 'contentDelta') answer += event.text;
  if (!/sun/i.test(answer)) throw new Error(`Native generation did not answer the control: ${answer}`);
  report.answer = answer;
  report.stats = await run.stats;
  await sdk.unloadModel({ modelId: llmId });
  report.passed = true;
} finally {
  await sdk.close();
  fs.writeFileSync(path.join(root, 'build/windows-native/native-smoke.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
