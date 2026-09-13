// Initialize Expo's normal runtime (including Symbol.asyncIterator) before QVAC.
// Bare AppRegistry registration skipped this setup and broke SDK streaming.
import { registerRootComponent } from 'expo';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Button, NativeModules, ScrollView, Share, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as FS from 'expo-file-system/legacy';
import { heartbeat, getSystemResources, loadModel, unloadModel, completion, embed } from '@qvac/sdk';
import { MODELS } from './models';
import provenance from './build/provenance.json';

const native = NativeModules.AndroidProbe;
const reportFile = new File(Paths.document, 'probe-report.json');
const PROMPT = 'Write a short science flashcard in Tagalog for a Grade 5 student. Use only this fact: Plants use sunlight, water, and carbon dioxide to make sugars through photosynthesis, releasing oxygen. Give a title and two sentences. Do not add a quiz.';

export function validateEmbedding(values) {
  if (!values || values.length !== 768 || !Array.from(values).every(Number.isFinite)) {
    throw new Error('Expected 768 finite embedding values');
  }
  const norm = Math.sqrt(Array.from(values).reduce((sum, x) => sum + x * x, 0));
  if (Math.abs(norm - 1) > 0.05) throw new Error(`Expected L2 normalized embedding, norm=${norm}`);
  return { dimensions: values.length, norm };
}

function App() {
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);
  const [poisoned, setPoisoned] = useState(false);
  const [progress, setProgress] = useState('');
  const guard = useRef(false);
  const report = useRef({ provenance, startedAt: new Date().toISOString(), events: [] });
  const persist = () => { reportFile.write(JSON.stringify(report.current, null, 2)); };
  const log = (stage, status, detail = null) => {
    const event = { at: new Date().toISOString(), stage, status, detail };
    report.current.events.push(event);
    persist(); // Write BEFORE each native operation so a hard crash leaves a breadcrumb.
    setLines([...report.current.events]);
    console.log('[AndroidProbe]', JSON.stringify(event));
  };

  useEffect(() => {
    try {
      if (reportFile.exists) {
        report.current = JSON.parse(reportFile.textSync());
        const previous = report.current.events.at(-1);
        log('relaunch', 'INFO', { previous, note: 'A prior RUNNING stage without PASS/FAIL may mean process death or force-stop.' });
      } else persist();
    } catch (e) { setProgress(`Cannot restore report: ${String(e)}`); }
    const sub = AppState.addEventListener('change', state => {
      log('app-state', 'INFO', state);
    });
    return () => sub.remove();
  }, []);

  async function step(name, fn, timeoutMs = 300000) {
    log(name, 'RUNNING');
    const start = Date.now();
    let timer;
    try {
      const result = await Promise.race([
        fn(),
        new Promise((_, reject) => { timer = setTimeout(() => {
          setPoisoned(true);
          reject(new Error(`Timed out after ${timeoutMs / 1000}s. Native operation may still be running: force-stop and reopen before another test.`));
        }, timeoutMs); }),
      ]);
      log(name, result?.probeWarning ? 'WARN' : 'PASS', { elapsedMs: Date.now() - start, result });
      return result;
    } catch (e) {
      log(name, 'FAIL', { elapsedMs: Date.now() - start, message: String(e), stack: e?.stack, code: e?.code });
      throw e;
    } finally { clearTimeout(timer); }
  }

  async function run(fn) {
    if (guard.current || poisoned) return;
    guard.current = true; setBusy(true); setProgress('');
    try {
      log('device', 'INFO', await native.deviceInfo());
      await fn();
    } catch (e) { setProgress(String(e)); }
    finally { guard.current = false; setBusy(false); }
  }

  const modelFile = key => new File(Paths.document, MODELS[key].filename);
  async function verify(key, file = modelFile(key)) {
    const spec = MODELS[key];
    if (!file.exists || file.size !== spec.bytes) throw new Error(`Download ${spec.name} first: missing/wrong size file`);
    const sha = await native.sha256(file.uri);
    if (sha !== spec.sha256) throw new Error(`SHA-256 mismatch for ${spec.name}; delete/download again`);
    // Expo normalizes file:///... to file:/... on Android. Accept both forms.
    return decodeURIComponent(file.uri.replace(/^file:\/*/, '/'));
  }

  async function download(key) {
    const spec = MODELS[key];
    const dest = modelFile(key);
    await step(`download:${key}`, async () => {
      if (dest.exists) return { cached: true, path: await verify(key) };
      const device = await native.deviceInfo();
      if (device.freeStorageBytes < spec.bytes + 256 * 1024 * 1024) throw new Error('Insufficient free storage (file size + 256 MiB reserve required)');
      const part = new File(Paths.document, spec.filename + '.part');
      if (part.exists) part.delete();
      const transfer = FS.createDownloadResumable(spec.url, part.uri, {}, p => {
        setProgress(`${spec.name}: ${(p.totalBytesWritten / 1e6).toFixed(1)} / ${(spec.bytes / 1e6).toFixed(1)} MB`);
      });
      const response = await transfer.downloadAsync();
      if (response?.status !== 200) throw new Error(`Download HTTP ${response?.status}`);
      setProgress(`Verifying ${spec.name} SHA-256…`);
      await verify(key, part);
      part.move(dest);
      return { bytes: spec.bytes, sha256: spec.sha256 };
    }, 30 * 60 * 1000);
    setProgress('Download verified. Ready for offline testing.');
  }

  async function worker() {
    await step('worker-heartbeat', () => heartbeat(), 60000);
    await step('system-resources', async () => {
      const resources = await getSystemResources({ sample: true });
      // The RPC can succeed while individual collectors fail (observed on the
      // Android14 emulator). Report that honestly without blocking inference.
      const failures = [];
      const walk = (value, path) => {
        if (!value || typeof value !== 'object') return;
        if (value.status === 'failed') failures.push({ path, reason: value.reason });
        for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
      };
      walk(resources, 'resources');
      return failures.length ? { ...resources, probeWarning: 'Resource collectors failed; RPC succeeded', failures } : resources;
    }, 60000);
  }

  async function generate(id, label, small = false) {
    return step(label, async () => {
      const start = Date.now();
      let firstTokenMs = null, text = '';
      const completionRun = completion({ modelId: id, stream: true,
        history: [{ role: 'user', content: small ? 'Say hello in one short sentence.' : PROMPT }],
        generationParams: { temp: 0, predict: small ? 24 : 128, reasoning_budget: 0 },
      });
      const events = completionRun.events;
      log('completion-api-shape', 'INFO', {
        keys: Object.keys(completionRun), then: typeof completionRun.then,
        events: typeof events, next: typeof events?.next,
        asyncIteratorSymbol: String(Symbol.asyncIterator),
        iterator: typeof events?.[Symbol.asyncIterator],
        legacyIterator: typeof events?.['@@asyncIterator'],
        prototypeKeys: events ? Object.getOwnPropertyNames(Object.getPrototypeOf(events)) : [],
      });
      for await (const event of completionRun.events) {
        if (event.type === 'contentDelta' && event.text) {
          if (firstTokenMs === null) firstTokenMs = Date.now() - start;
          text += event.text;
        }
      }
      // Await final too: don't mistake a closed stream or partial output for success.
      await completionRun.final;
      if (!text.trim()) throw new Error('Generation returned no visible text');
      return { text, firstTokenMs, totalMs: Date.now() - start, device: await native.deviceInfo() };
    });
  }

  async function inference(key, combined = false) {
    const path = await step(`verify:${key}`, () => verify(key));
    const embedPath = combined ? await step('verify:labse', () => verify('labse')) : null;
    await worker();
    let id, embedId;
    const load = () => loadModel({ modelSrc: path, modelType: key === 'labse' ? 'llamacpp-embedding' : 'llm',
      modelConfig: key === 'labse' ? { device: 'cpu', pooling: 'cls', embdNormalize: 2 } :
        { device: 'cpu', gpu_layers: 0, ctx_size: key === 'small' ? 1024 : 4096,
          stop_sequences: ['<|im_end|>', '<|endoftext|>'] },
    });
    // A failed/timed-out native operation leaves uncertain worker state. Force-stop
    // before retrying instead of letting two loads run concurrently.
    try {
      id = await step(`load-cpu:${key}`, load);
      if (combined) {
        embedId = await step('load-cpu:labse-alongside-hiraia', () => loadModel({ modelSrc: embedPath,
          modelType: 'llamacpp-embedding', modelConfig: { device: 'cpu', pooling: 'cls', embdNormalize: 2 } }));
        await step('embedding:alongside-hiraia', async () => validateEmbedding((await embed({ modelId: embedId, text: 'Paano gumagawa ng pagkain ang halaman?' })).embedding));
      }
      if (key === 'labse') {
        for (const text of ['Plants need sunlight.', 'Kailangan ng halaman ang sikat ng araw.', 'Ang tanom nagkinahanglan og kahayag sa adlaw.']) {
          await step(`embedding:${text}`, async () => validateEmbedding((await embed({ modelId: id, text })).embedding));
        }
      } else {
        await generate(id, `generate-cold:${key}`, key === 'small');
        await generate(id, `generate-warm:${key}`, key === 'small');
      }
      if (embedId) { await step('unload:labse', () => unloadModel({ modelId: embedId })); embedId = null; }
      await step(`unload:${key}`, () => unloadModel({ modelId: id })); id = null;
      id = await step(`reload:${key}`, load);
      if (key === 'labse') await step('embedding:after-reload', async () => validateEmbedding((await embed({ modelId: id, text: 'Plants need sunlight.' })).embedding));
      else await generate(id, `generate-after-reload:${key}`, key === 'small');
      await step(`final-unload:${key}`, () => unloadModel({ modelId: id })); id = null;
      log(`suite:${key}${combined ? '+labse' : ''}`, 'PASS', 'Runtime smoke test only; output quality and broad device support are not certified.');
    } catch (e) { setPoisoned(true); throw e; }
  }

  const disabled = busy || poisoned;
  return <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 48, paddingBottom: 60 }}>
    <Text style={{ fontSize: 25, fontWeight: 'bold', color: '#102f35' }}>Hiraia Android Probe</Text>
    <Text style={{ marginVertical: 12 }}>Android 10+ · ARM64 · QVAC 0.17.1 · CPU only</Text>
    <Text>Nothing downloads automatically. Download the selected model on Wi-Fi, then run its test offline. Start with the worker and small model. Keep the app open during testing.</Text>
    <View style={{ marginVertical: 12 }}><Button title="1. Test worker (no download)" disabled={disabled} onPress={() => run(worker)} /></View>
    {Object.entries(MODELS).map(([key, spec]) => <View key={key} style={{ marginVertical: 10, gap: 8 }}>
      <Text style={{ fontWeight: 'bold' }}>{spec.name} · {(spec.bytes / 1e6).toFixed(0)} MB</Text>
      <Button title={`Download ${spec.name}`} disabled={disabled} onPress={() => run(() => download(key))} />
      <Button title={`Test ${spec.name} on CPU`} disabled={disabled} onPress={() => run(() => inference(key))} />
    </View>)}
    <Button title="Test Hiraia + LaBSE together" disabled={disabled} onPress={() => run(() => inference('hiraia', true))} />
    <Text selectable style={{ marginVertical: 12 }}>{progress}</Text>
    {poisoned && <Text style={{ color: '#a00000' }}>Native test failed or timed out. Share the report, then force-stop this app in Android Settings and reopen before retrying.</Text>}
    <View style={{ marginVertical: 10 }}><Button title="Share diagnostic report" onPress={() => Share.share({ title: 'Hiraia Android compatibility report', message: JSON.stringify(report.current, null, 2) }).catch(e => setProgress(String(e)))} /></View>
    <Text style={{ fontWeight: 'bold' }}>Results (newest first)</Text>
    {[...lines].reverse().map((e, i) => <Text selectable key={i} style={{ fontSize: 12, marginTop: 8, color: e.status === 'FAIL' ? '#a00000' : '#16343a' }}>{e.at} {e.status} {e.stage}{'\n'}{JSON.stringify(e.detail)}</Text>)}
  </ScrollView>;
}

registerRootComponent(App);
