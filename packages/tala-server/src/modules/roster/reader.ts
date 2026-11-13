import { Worker } from 'node:worker_threads';
import { HttpError } from '../../kernel/types';
export interface ReaderInput { bytes: Uint8Array; extension: string; maxRows: number; sheet?: string; exactlyAsWritten?: boolean }
export interface ReaderOutput { rows: string[][]; sheets: string[]; encodingReview: boolean }
let active = 0;
/** No file is written to disk. Workers have bounded heap/time/concurrency and return data only. */
export async function readRoster(input: ReaderInput, maxBytes = 5 * 1024 * 1024): Promise<ReaderOutput> {
  if (input.bytes.byteLength > maxBytes) throw new HttpError('invalid_input', 'This file is too large. Use a file smaller than 5 MB.');
  if (!['txt','csv','tsv','xlsx','xls','ods','docx'].includes(input.extension)) throw new HttpError('invalid_input', 'This file format is not supported. Paste the names as text.');
  if (active >= 2) throw new HttpError('unavailable', 'Another list is being read. Please try again shortly.');
  active++;
  try {
    return await new Promise<ReaderOutput>((resolve, reject) => {
      const worker = new Worker(new URL('./reader-worker.cjs', import.meta.url), { workerData: input, resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 }, stdout: true, stderr: true });
      worker.stdout?.resume(); worker.stderr?.resume(); // Never forward parser diagnostics containing cells.
      let done = false;
      const finish = (output?: ReaderOutput) => {
        if (done) return; done = true; clearTimeout(timer); void worker.terminate();
        if (output) resolve(output); else reject(new HttpError('invalid_input', 'This file could not be read within the limits. Paste the names as text.'));
      };
      const timer = setTimeout(() => finish(), 8000);
      worker.once('message', (message: { ok: boolean; output?: ReaderOutput }) => finish(message.ok ? message.output : undefined));
      worker.once('error', () => finish()); worker.once('exit', () => finish());
    });
  } finally { active--; }
}
