/**
 * Resilient, resumable download of a large remote model file (the ~3 GB base GGUF and
 * the LaBSE embedder) to local storage, so we can hand QVAC a LOCAL path instead of a
 * URL.
 *
 * WHY we own the download instead of letting QVAC fetch the URL: QVAC's built-in URL
 * downloader has no retry and does NOT survive the app being backgrounded — observed
 * on-device 2026-06-16, a first-run fetch froze at 71% after the screen locked / the
 * user switched away, and the bar sat "stuck" forever. This module replaces that with:
 *   • sessionType BACKGROUND  → the OS keeps the transfer running while the app is
 *     backgrounded or the screen is locked (the exact stall we hit);
 *   • retry with backoff      → a transient network error no longer aborts the install;
 *   • RESUME from the partial → a retry, OR a full app restart, continues from the bytes
 *     already on disk via an HTTP Range request — never re-downloading from zero (our
 *     nginx mirror serves byte ranges). The resume token is persisted in settings so
 *     even a cold kill mid-download picks up where it left off;
 *   • stall watchdog          → if bytes stop flowing, cancel and resume rather than
 *     hang forever waiting on a dead socket.
 *
 * Once a file completes it lives at a stable path and every later launch loads it
 * straight from disk (fully offline). Returns the local path in the bare form QVAC's
 * loadModel expects (no file:// scheme, matching resolveAdapterPath).
 */
import {
  createDownloadResumable,
  documentDirectory,
  getInfoAsync,
  makeDirectoryAsync,
  deleteAsync,
  moveAsync,
  FileSystemSessionType,
} from 'expo-file-system/legacy';

import { getSetting, setSetting } from '../db/repo';

const MODELS_DIR = `${documentDirectory}models/`;

export interface RemoteModelSpec {
  /** Remote URL — must be a byte-range-capable static file for resume to work. */
  url: string;
  /** Stable local filename under the app's models dir. */
  filename: string;
}

const STALL_MS = 60_000; // no byte progress for this long → cancel + resume
const MAX_ATTEMPTS = 12; // a multi-GB fetch on flaky mobile data may blip many times
const PERSIST_MS = 5_000; // how often we checkpoint the resume token to settings

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const stripScheme = (uri: string) => uri.replace(/^file:\/\//, '');
const resumeKey = (filename: string) => `dl-resume:${filename}`;

async function ensureDir(): Promise<void> {
  const info = await getInfoAsync(MODELS_DIR);
  if (!info.exists) await makeDirectoryAsync(MODELS_DIR, { intermediates: true });
}

/**
 * Ensure `spec` is present locally, downloading it resiliently if not. `onProgress`
 * receives 0–100 (download percentage). `signal` lets a caller abort (e.g. an adapter
 * swap mid-download). Throws only after MAX_ATTEMPTS exhausted or on abort.
 */
export async function ensureRemoteModel(
  spec: RemoteModelSpec,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<string> {
  await ensureDir();
  const finalUri = `${MODELS_DIR}${spec.filename}`;
  const partUri = `${finalUri}.part`;
  const RKEY = resumeKey(spec.filename);

  // Already fully downloaded? We only ever move a COMPLETED file to finalUri, so its
  // mere existence is the completion marker — load straight from disk (offline path).
  const fin = await getInfoAsync(finalUri);
  if (fin.exists) {
    onProgress?.(100);
    return stripScheme(finalUri);
  }

  // Total size up front (one HEAD) so progress is accurate. We do NOT rely on the native
  // download progress callback: with sessionType BACKGROUND it fires rarely or never on
  // Android, which would leave the bar with no real signal. Instead we POLL the partial
  // file's size on disk below — that always reflects true bytes regardless of session type.
  let totalBytes = 0;
  try {
    const head = await fetch(spec.url, { method: 'HEAD' });
    totalBytes = parseInt(head.headers.get('content-length') ?? '0', 10) || 0;
  } catch {
    /* fall back to the callback-provided total, if any */
  }

  let lastBytes = 0;
  let lastAdvance = Date.now();
  const report = (written: number, total: number) => {
    if (written > lastBytes) {
      lastBytes = written;
      lastAdvance = Date.now();
    }
    if (total > 0) onProgress?.(Math.min(99, Math.round((written / total) * 100)));
  };
  // Native callback (used when it DOES fire — faster than the poll); harmless otherwise.
  const onTick = (p: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) =>
    report(p.totalBytesWritten, totalBytes || p.totalBytesExpectedToWrite || 0);

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new Error('model download aborted');

    // Restore the resume token from a prior attempt OR a previous app run (cross-restart
    // resume). A corrupt/absent token just means a fresh start for this attempt.
    let resumeData: string | undefined;
    try {
      const saved = await getSetting(RKEY);
      if (saved) resumeData = (JSON.parse(saved).resumeData as string) || undefined;
    } catch {
      /* corrupt token → fresh download */
    }

    const dl = createDownloadResumable(
      spec.url,
      partUri,
      { sessionType: FileSystemSessionType.BACKGROUND },
      onTick,
      resumeData
    );

    lastAdvance = Date.now();
    // Poll the partial file's true size on disk → the reliable progress + stall signal,
    // independent of whether the native callback fires.
    const poll = setInterval(() => {
      void (async () => {
        try {
          const info = await getInfoAsync(partUri);
          if (info.exists) report(info.size, totalBytes);
        } catch {
          /* ignore — transient */
        }
      })();
    }, 1_000);
    // Checkpoint the resume token so a cold app-kill can still continue from here.
    const persist = setInterval(() => {
      try {
        void setSetting(RKEY, JSON.stringify(dl.savable()));
      } catch {
        /* best-effort */
      }
    }, PERSIST_MS);
    // Stall watchdog: bytes stopped (dead socket) or the caller aborted → cancel so the
    // pending await settles and we retry/resume instead of hanging.
    const watchdog = setInterval(() => {
      if (signal?.aborted || Date.now() - lastAdvance > STALL_MS) {
        void dl.cancelAsync().catch(() => {});
      }
    }, 5_000);

    try {
      const res = resumeData ? await dl.resumeAsync() : await dl.downloadAsync();
      if (res?.uri) {
        // downloadResumable resolves with a uri only on a FULLY received file, so this
        // is a complete transfer — promote it to the final path and clear the token.
        await moveAsync({ from: partUri, to: finalUri });
        await setSetting(RKEY, '');
        onProgress?.(100);
        return stripScheme(finalUri);
      }
      // res undefined → cancelled (stall/abort). Save where we are and retry/resume.
      try {
        await setSetting(RKEY, JSON.stringify(dl.savable()));
      } catch {
        /* best-effort */
      }
    } catch (e) {
      lastErr = e;
      try {
        await setSetting(RKEY, JSON.stringify(dl.savable()));
      } catch {
        /* best-effort */
      }
    } finally {
      clearInterval(poll);
      clearInterval(persist);
      clearInterval(watchdog);
    }

    if (signal?.aborted) throw new Error('model download aborted');
    // Exponential backoff, capped at 15s, before the next resume attempt.
    await sleep(Math.min(15_000, 1_000 * 2 ** Math.min(attempt - 1, 4)));
  }

  // Give up after exhausting retries — leave the .part on disk so a later launch resumes.
  throw new Error(
    `model download failed after ${MAX_ATTEMPTS} attempts: ${spec.filename}` +
      (lastErr instanceof Error ? ` (${lastErr.message})` : '')
  );
}

/** Derive a stable local filename from a model URL (last path segment, query stripped). */
export function filenameFromUrl(url: string): string {
  return url.split('?')[0]?.split('/').pop() || 'model.gguf';
}
