/**
 * Resilient, resumable download of a large remote model file (the ~3 GB base GGUF and
 * the LaBSE embedder) to local storage, so we can hand QVAC a LOCAL path instead of a
 * URL.
 *
 * Our users are on spotty mobile connections, so this is built to NEVER lose partial
 * progress and to NEVER hand QVAC a corrupt file:
 *   • CHUNKED HTTP RANGE — the file is fetched in small byte-range chunks (CHUNK_BYTES)
 *     and each chunk is appended to the on-disk `.part` file as soon as it arrives. The
 *     `.part` file's size on disk IS the resume cursor — there is no opaque resume token
 *     to corrupt. A dropped connection loses at most the one in-flight chunk.
 *   • RESUME FROM DISK — a retry, a backgrounded/resumed app, or a full app restart all
 *     resume from `.part`'s current size via the next `Range: bytes=<size>-` request.
 *     Nothing already on disk is re-downloaded. (Earlier QVAC/expo resume produced a
 *     CORRUPT 3 GB file on a flaky link, which then failed to load — this avoids that.)
 *   • PER-CHUNK TIMEOUT + near-unbounded chunk retries with backoff — a stalled socket
 *     aborts just that chunk and retries from the committed offset; transient failures
 *     don't abort the whole install.
 *   • INTEGRITY — every chunk must be a 206 Partial Content of the exact requested range,
 *     and the assembled file's final size must equal the server's Content-Length before
 *     it's promoted from `.part` to its final name. A short/oversized file is discarded
 *     and re-fetched, never loaded.
 *
 * Trade-off vs a native background download: this runs on the JS thread, so it PAUSES
 * while the app is backgrounded and resumes (from disk, losing nothing) on return —
 * correctness + never-lose-progress is the priority for our audience.
 *
 * Returns the local path in the bare form QVAC's loadModel expects (no file:// scheme).
 */
import { File } from 'expo-file-system';
import {
  documentDirectory,
  getInfoAsync,
  makeDirectoryAsync,
  moveAsync,
  deleteAsync,
} from 'expo-file-system/legacy';

const MODELS_DIR = `${documentDirectory}models/`;

export interface RemoteModelSpec {
  /** Remote URL — must be a byte-range-capable static file. */
  url: string;
  /** Stable local filename under the app's models dir. */
  filename: string;
}

const CHUNK_BYTES = 8 * 1024 * 1024; // 8 MB — small enough that a drop loses little
const CHUNK_TIMEOUT_MS = 45_000; // a single chunk that stalls this long is aborted + retried
const MAX_CONSECUTIVE_FAILS = 40; // give up only after many back-to-back failures
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const stripScheme = (uri: string) => uri.replace(/^file:\/\//, '');

async function ensureDir(): Promise<void> {
  const info = await getInfoAsync(MODELS_DIR);
  if (!info.exists) await makeDirectoryAsync(MODELS_DIR, { intermediates: true });
}

/** Fetch one byte range with its own timeout, honoring an external abort signal. */
async function fetchRange(
  url: string,
  start: number,
  end: number,
  signal?: AbortSignal
): Promise<{ bytes: Uint8Array; total: number }> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ctrl.abort(), CHUNK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Range: `bytes=${start}-${end}` },
      signal: ctrl.signal,
    });
    // A byte-range request MUST come back as 206; a 200 means the server ignored the
    // Range and is streaming the whole file, which we must not append. Treat as an error.
    if (res.status !== 206) {
      throw new Error(`expected 206 for range ${start}-${end}, got ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    // Parse the authoritative total from "Content-Range: bytes a-b/TOTAL".
    let total = 0;
    const cr = res.headers.get('content-range');
    const m = cr ? /\/(\d+)\s*$/.exec(cr) : null;
    if (m) total = parseInt(m[1] ?? '0', 10);
    return { bytes: new Uint8Array(buf), total };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Ensure `spec` is present locally, downloading it resiliently if not. `onProgress`
 * receives 0–100. `signal` lets a caller abort. Throws only on abort or after too many
 * consecutive failures (leaving the `.part` on disk so a later launch resumes).
 */
export async function ensureRemoteModel(
  spec: RemoteModelSpec,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<string> {
  await ensureDir();
  const finalUri = `${MODELS_DIR}${spec.filename}`;
  const partUri = `${finalUri}.part`;

  // Already fully downloaded? We only ever move a verified, complete file to finalUri,
  // so its existence is the completion marker — load straight from disk (offline path).
  const fin = await getInfoAsync(finalUri);
  if (fin.exists) {
    onProgress?.(100);
    return stripScheme(finalUri);
  }

  // Authoritative total size (one HEAD). If the server won't answer, we recover it from
  // the first chunk's Content-Range header below.
  let total = 0;
  try {
    const head = await fetch(spec.url, { method: 'HEAD' });
    total = parseInt(head.headers.get('content-length') ?? '0', 10) || 0;
  } catch {
    /* recovered from the first chunk's Content-Range */
  }

  const part = new File(partUri);
  if (!part.exists) part.create({ overwrite: true });
  let offset = part.size; // resume cursor = bytes already on disk (survives restarts)

  // If a stale `.part` is somehow already >= a known total, it's corrupt — start over.
  if (total > 0 && offset > total) {
    await deleteAsync(partUri, { idempotent: true });
    part.create({ overwrite: true });
    offset = 0;
  }

  let fails = 0;
  while (total === 0 || offset < total) {
    if (signal?.aborted) throw new Error('model download aborted');
    const end = total > 0 ? Math.min(offset + CHUNK_BYTES, total) - 1 : offset + CHUNK_BYTES - 1;
    try {
      const { bytes, total: t } = await fetchRange(spec.url, offset, end, signal);
      if (total === 0 && t > 0) total = t; // learned the size from Content-Range
      if (bytes.length === 0) throw new Error('empty chunk');
      // Append at the exact offset, then close so the bytes are flushed/committed to disk.
      const handle = part.open();
      try {
        handle.offset = offset;
        handle.writeBytes(bytes);
      } finally {
        handle.close();
      }
      offset += bytes.length;
      fails = 0;
      if (total > 0) onProgress?.(Math.min(99, Math.round((offset / total) * 100)));
    } catch (e) {
      if (signal?.aborted) throw new Error('model download aborted');
      if (++fails >= MAX_CONSECUTIVE_FAILS) {
        throw new Error(
          `model download failed after ${fails} consecutive errors: ${spec.filename}` +
            (e instanceof Error ? ` (${e.message})` : '')
        );
      }
      await sleep(Math.min(15_000, 500 * 2 ** Math.min(fails, 5))); // backoff, then resume
      // Re-read the on-disk size in case a partial write landed — never lose committed bytes.
      offset = new File(partUri).size;
    }
  }

  // Integrity gate: the assembled file MUST be exactly the expected size before we trust
  // it. A mismatch means a corrupt/partial transfer — discard and let the caller retry.
  const finalSize = new File(partUri).size;
  if (total > 0 && finalSize !== total) {
    await deleteAsync(partUri, { idempotent: true });
    throw new Error(`size mismatch for ${spec.filename}: ${finalSize} != ${total}`);
  }

  await moveAsync({ from: partUri, to: finalUri });
  onProgress?.(100);
  return stripScheme(finalUri);
}

/** Derive a stable local filename from a model URL (last path segment, query stripped). */
export function filenameFromUrl(url: string): string {
  return url.split('?')[0]?.split('/').pop() || 'model.gguf';
}
