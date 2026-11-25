// One job on an uploaded PowerPoint file, in a worker thread: read it, or write it out with a teacher's changes.
//
// Plain JavaScript on purpose, and kept as a file (not bundled): the web server starts it by path (upload-jobs.ts),
// in production and in tests alike. The reader itself is TypeScript (upload-file.ts and @hiraia/tala-core/pptx);
// Node runs those files as they are by stripping their types (Node 22.18 or newer), so no build step and no
// transpiler stands between what is tested and what runs.
//
// The worker exists because the file comes from a stranger: whatever it makes the reader do, it does it here, under
// a time limit and a memory limit the web server sets, and the web server's own thread stays free.
import { registerHooks } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';

// The reader's files name each other the TypeScript way, without an extension. Node wants one.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});

let result;
try {
  const { runUploadJob } = await import('./upload-file.ts');
  result = runUploadJob(workerData);
} catch (err) {
  // A fault of the reader or of this Node, not something about the file. Only its kind leaves the worker.
  result = { ok: false, fault: String(err?.code ?? err?.name ?? 'error').slice(0, 80) };
}
const transfer = [];
// What goes back (the edited file; the file that was read, for storing) is not copied: the memory it is in is handed over.
const whole = (b) => (b.byteOffset !== 0 || b.byteLength !== b.buffer.byteLength ? b.slice() : b);
if (result.ok && result.kind === 'write') {
  result.pptx = whole(result.pptx);
  transfer.push(result.pptx.buffer);
}
if (result.ok && result.kind === 'read') {
  result.bytes = whole(result.bytes);
  transfer.push(result.bytes.buffer);
}
parentPort.postMessage(result, transfer);
