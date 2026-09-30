import { nativeFilePath } from '../platform/filePath';
/**
 * Download + VERIFY the large remote assets (the ~1.27 GB base GGUF and the
 * 384 MB LaBSE embedder — plus any per-language LoRA adapters a future model
 * declares) to local storage, so we can hand QVAC a LOCAL path instead of a URL.
 *
 * WHY THIS FILE IS NOT JUST `fetch`
 * ---------------------------------
 * The children using this app are on metered prepaid data and captive-portal
 * school Wi-Fi. Those two facts drive every decision here:
 *
 *   1. A captive portal answers EVERY request with `200 OK` and an HTML login
 *      page. A transparent proxy can truncate a response mid-stream. Both look
 *      like success to an HTTP client. The previous version of this file promoted
 *      any `status < 400` straight to the final path, so a 1 KB login page could
 *      be cached FOREVER as the base-model GGUF — a permanently bricked
 *      install whose only cure is an uninstall (release builds have no run-as).
 *      => Every byte we keep is now checked against a DECLARED size + MD5.
 *
 *   2. Re-downloading 1.27 GB because the bus went through a tunnel is real money
 *      to a family on prepaid data.
 *      => Transfers resume across app launches, from the exact byte they stopped,
 *         a failure that is not going to clear is never retried into another full
 *         download, and a genuine partial prefix is never thrown away.
 *
 * THE INTEGRITY CONTRACT
 * ----------------------
 * Every remote asset declares `{ bytes, md5 }` in `src/config/model.ts` (measured
 * from the exact files served by the mirror). Nothing reaches the final path
 * without matching both. Two tiers, deliberately asymmetric:
 *
 *   • WRITE path (once per asset, ever): full size + MD5 over the freshly written
 *     `.part` before it is promoted. MD5 is computed NATIVELY and STREAMING
 *     (expo-file-system's `md5: true` -> DigestUtils.md5 over a FileInputStream),
 *     so a 1.27 GB file costs one disk read and constant memory — no giant
 *     ArrayBuffer on the JS heap, which is why MD5 and not a JS SHA-256.
 *
 *   • READ path (every cold start): size only — a stat, ~0 ms.
 *
 * Size-only on the read path is SOUND, not a shortcut, and the reason is worth
 * keeping: the final path is now only ever created by the MD5-gated write path
 * above, so a size match there implies a content match. The one class of file
 * that can be at the final path WITHOUT having passed that gate is a legacy file
 * promoted by the old code — and the old code never resumed or appended (it
 * deleted the `.part` and restarted from byte 0 on every attempt), so its only
 * possible corrupt outputs are SHORT ones: a login page, a truncated stream, a
 * 0-byte 200. Size catches all of them. That is what makes the cheap check a
 * complete self-heal for the already-poisoned installed base (see `ensureRemoteAsset`).
 *
 * RESUME
 * ------
 * On Android expo's opaque `resumeData` token is literally the byte offset as a
 * string (FileSystemLegacyModule.kt:713 `putString("resumeData", file.length())`),
 * and it is sent as `Range: bytes=$it-` (:677) with the output stream opened in
 * APPEND mode (:938). So we do not need to persist a token at all: the `.part`
 * file on disk IS the resume state. We stat it and pass its length. This works
 * across process death, which the pause/resume token never did.
 *
 * The dangerous case is a server that IGNORES `Range` and replies `200` with the
 * whole body — native still appends, producing `partSize + fullSize` bytes of
 * garbage. We detect that on the FIRST progress event (native reports
 * `totalBytesExpectedToWrite = contentLength + resumeData`, so a 200 replay
 * declares exactly `spec.bytes + startOffset` where a correct 206 declares
 * `spec.bytes`), with a byte-counter cap and the end-of-transfer size gate behind
 * it as belt and braces.
 *
 * WHAT COSTS DATA, AND WHAT DOES NOT
 * ----------------------------------
 * The retry loop deliberately treats two failure classes differently, because
 * only one of them can be fixed by trying again:
 *
 *   • TRANSIENT (dropped socket, stall, HTTP error, short body) — retry, and
 *     resume from whatever genuine prefix is already on disk. Cheap.
 *   • DETERMINISTIC (a COMPLETE, correct-length body whose MD5 is wrong: the
 *     mirror's bytes are not the bytes we pinned) — repeating the identical
 *     request returns the identical bytes, so retrying it just spends another
 *     1.27 GB of a child's prepaid balance to fail again. Give up immediately.
 *
 * ONE TRANSFER PER FILE
 * ---------------------
 * `ensureRemoteAsset` is re-entrant by construction (see `inFlight`): two engine
 * initialisations racing each other must never open two append-mode streams onto
 * the same `.part`.
 *
 * THE LAN MIRROR
 * --------------
 * A donated classroom phone can be told, by its device owner only, about a download
 * mirror on the provisioning laptop (config/assetMirror.ts). That mirror is an
 * UNTRUSTED delivery truck and a pure accelerator: it is tried once, first, under the
 * SAME size + MD5 gate, into its OWN partial file; on any failure the canonical URL
 * runs exactly as it always has. The setting leaves the warehouse with the phone, so a
 * mirror that does not answer is then skipped by every download for a cool-off that
 * grows while it stays silent (a few probes, then one per 10 minutes, not one per file),
 * and a genuine partial it left behind is continued from the canonical URL, not bought
 * again. See `fetchFromMirror` and `adoptMirrorPartial`.
 */
import { readAssetMirrorSetting } from 'hiraia-managed-config';
import { withModelDownloadControl } from './modelDownloadControl';
import {
  assetMirrorRoute,
  createMirrorBreaker,
  type AssetMirrorRoute,
} from '../config/assetMirror';
import { beginDownload } from '../telemetry/download';
import { track } from '../telemetry';
import {
  documentDirectory,
  getInfoAsync,
  makeDirectoryAsync,
  moveAsync,
  deleteAsync,
  createDownloadResumable,
} from 'expo-file-system/legacy';

const MODELS_DIR = `${documentDirectory}models/`;

/**
 * A remote asset and the integrity contract it must satisfy. `bytes` and `md5`
 * are MEASURED from the exact file the mirror serves — see the table in
 * `src/config/model.ts`. Both are load-bearing; do not "fix" a failing download
 * by relaxing them, that is the bug this file exists to prevent.
 */
export interface RemoteAssetSpec {
  /** Remote URL — must serve the file directly (no redirects we need to chase). */
  url: string;
  /**
   * Stable local filename. Version this (e.g. `-v1` → `-v2`) whenever the CONTENT
   * changes: the local cache keys on filename, so a new name is what pushes a
   * new revision to an already-installed app.
   */
  filename: string;
  /** Exact expected size in bytes. Hard gate. */
  bytes: number;
  /**
   * Exact expected MD5, lowercase hex. Hard gate on the write path.
   * `null` degrades to a size-only gate — acceptable, but always pin the real
   * digest when you have it (`md5 -q <file>`).
   */
  md5: string | null;
  /** Human label for logs. */
  label: string;
  /**
   * Where the verified file lands: a `file://` directory URI with a trailing slash.
   * Defaults to the models directory under `documentDirectory`. The in-app APK updater
   * (store/updateStore.ts) points this at the CACHE directory instead — an installer
   * hand-off is the file's whole life, and the OS is welcome to reclaim it after.
   */
  dir?: string;
}

/** Restart the whole transfer up to this many times before giving up on a launch. */
const MAX_ATTEMPTS = 5;
/**
 * Zero bytes for this long means the socket is dead (backgrounded, captive
 * portal, tunnel) even though it is still "open". Native has no idle timeout, so
 * without this a stalled transfer hangs the loader forever. Generous, because a
 * genuinely slow 2G link still delivers SOMETHING continuously.
 */
const STALL_MS = 60_000;
const STALL_POLL_MS = 5_000;
/**
 * Anything smaller than this is not a prefix of a multi-hundred-MB GGUF, it is a
 * page: a captive-portal login form, a proxy error, an nginx 404 body.
 */
const MIN_PLAUSIBLE_BYTES = 4096;
/**
 * A LAN mirror answers in milliseconds. One that has not answered a HEAD in this long
 * is not there (laptop asleep, phone taken home), and the transfer's own 60 s connect
 * timeout is far too long to wait before going to the canonical host.
 */
const MIRROR_PROBE_MS = 3_000;
/** A LAN mirror that sends nothing for this long is gone; do not wait out STALL_MS. */
const MIRROR_STALL_MS = 15_000;
const MD5_HEX = /^[0-9a-f]{32}$/i;
/**
 * Shared by every download in this process: once the mirror stops answering, the other
 * files go straight to their own host for the cool-off instead of each spending
 * MIRROR_PROBE_MS to learn the same thing.
 */
const mirrorBreaker = createMirrorBreaker();

const LOG = (m: string) => console.log(`[modelDownload] ${m}`);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const stripScheme = nativeFilePath;
const mb = (n: number) => `${(n / 1e6).toFixed(0)}MB`;

/**
 * A COMPLETE transfer whose content does not match the pinned digest. Flagged so
 * the retry loop can tell it apart from a dropped socket: no number of identical
 * requests will turn the mirror's bytes into the bytes we pinned, so this must
 * not burn the retry budget (5 x 1.27 GB) on a child's prepaid data.
 *
 * A `fatal` PROPERTY rather than `instanceof`: subclassed Errors do not survive
 * every transpile/engine combination reliably, and a mis-detected fatal here
 * would silently restore the full-retry-budget (~6 GB) behaviour.
 */
class IntegrityError extends Error {
  readonly fatal = true;
}
const isFatal = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { fatal?: unknown }).fatal === true;

async function ensureDir(dir: string): Promise<void> {
  const info = await getInfoAsync(dir);
  if (!info.exists) await makeDirectoryAsync(dir, { intermediates: true });
}

/**
 * Size of a local file, or `null` when there is no file there. The distinction
 * matters exactly once — for the final path, where "absent" and "present but
 * 0 bytes" demand opposite actions (start a download vs. delete a poisoned file).
 */
async function statSize(uri: string): Promise<number | null> {
  const info = await getInfoAsync(uri);
  return info.exists && !info.isDirectory ? info.size : null;
}

/** Size of a local file, or 0 if it does not exist (i.e. a resume offset). */
async function localSize(uri: string): Promise<number> {
  return (await statSize(uri)) ?? 0;
}

/** Only an asset pinned to a full MD5 is covered end to end by the write-path gate. */
const pinnedMd5 = (spec: RemoteAssetSpec): boolean => !!spec.md5 && MD5_HEX.test(spec.md5);

/** Streaming, native, constant-memory MD5 of a local file (lowercase hex). */
async function localMd5(uri: string): Promise<string | undefined> {
  const info = await getInfoAsync(uri, { md5: true });
  return info.exists ? info.md5?.toLowerCase() : undefined;
}

/**
 * Check a fully-transferred `.part` against the declared contract. Returns null
 * when it matches, or a human reason when it does not.
 */
function checkContract(
  spec: RemoteAssetSpec,
  size: number,
  md5: string | undefined
): string | null {
  if (size !== spec.bytes) {
    return (
      `size ${size} != declared ${spec.bytes}` +
      (size < MIN_PLAUSIBLE_BYTES ? ' (looks like a captive-portal page)' : '')
    );
  }
  if (spec.md5) {
    if (!md5) return 'MD5 was requested but the platform returned none';
    if (md5.toLowerCase() !== spec.md5.toLowerCase()) {
      return `MD5 ${md5} != declared ${spec.md5}`;
    }
  }
  return null;
}

/**
 * The transfer currently running for each filename.
 *
 * Two callers CAN ask for the same asset at once — `engineStore.changeLanguage`
 * is reachable from onboarding, the sidebar and the feed's search field,
 * and English and Tagalog share ONE adapter file — and two transfers of one file
 * is not merely wasteful. Both compute the same `.part` path, the second stats it
 * mid-flight and passes that length as a resume offset, and native then opens a
 * SECOND append-mode `FileOutputStream` on the same inode. The two file positions
 * interleave; either the merged file fails the MD5 gate (several GB spent for
 * nothing) or the loser's still-open fd keeps writing into the file the winner
 * has already verified and promoted. Deleting the `.part` on failure is just as
 * bad: it unlinks the file the other writer is streaming into.
 *
 * So the downloader — the only layer that can guarantee it — serialises per
 * filename. A second caller JOINS the transfer already in flight.
 */
const inFlight = new Map<string, Promise<string>>();

export type AssetDownloadStatus = {
  phase:
    | 'checking'
    | 'missing'
    | 'paused'
    | 'downloading'
    | 'retrying'
    | 'verifying'
    | 'downloaded'
    | 'failed';
  percent: number;
};
const unchecked: AssetDownloadStatus = { phase: 'checking', percent: 0 };
const downloadStatuses = new Map<string, AssetDownloadStatus>();
const statusListeners = new Set<() => void>();
export const assetDownloadStatus = (filename: string): AssetDownloadStatus =>
  downloadStatuses.get(filename) ?? unchecked;
export function subscribeAssetDownloads(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}
function setDownloadStatus(
  filename: string,
  phase: AssetDownloadStatus['phase'],
  percent = 0
): void {
  percent = Math.max(0, Math.min(100, Math.floor(percent)));
  const previous = downloadStatuses.get(filename);
  if (previous?.phase === phase && previous.percent === percent) return;
  downloadStatuses.set(filename, { phase, percent });
  for (const listener of statusListeners) listener();
}

/** Read-only cache inspection: never starts a transfer or hashes a GB-sized file.
 * Uses the same size-checked cache contract as fetchAndVerify's read path.
 * An in-flight transfer always owns its status, including while disk reads await.
 */
export async function inspectAssetDownload(spec: RemoteAssetSpec): Promise<void> {
  if (inFlight.has(spec.filename)) return;
  const before = assetDownloadStatus(spec.filename);
  const uri = `${spec.dir ?? MODELS_DIR}${spec.filename}`;
  try {
    const [size, partial] = await Promise.all([statSize(uri), statSize(`${uri}.part`)]);
    if (inFlight.has(spec.filename) || assetDownloadStatus(spec.filename) !== before) return;
    if (size === spec.bytes) setDownloadStatus(spec.filename, 'downloaded', 100);
    else if (before.phase !== 'failed') {
      const validPartial = partial !== null && partial > 0 && partial <= spec.bytes;
      setDownloadStatus(
        spec.filename,
        validPartial ? 'paused' : 'missing',
        validPartial ? Math.min(99, (partial / spec.bytes) * 100) : 0
      );
    }
  } catch {
    if (!inFlight.has(spec.filename) && assetDownloadStatus(spec.filename) === before) {
      setDownloadStatus(spec.filename, 'failed');
    }
  }
}

/**
 * Progress callback for `ensureRemoteAsset`. `pct` is 0–100. `phase` distinguishes
 * the two very different things "99%" can mean: `'transfer'` (bytes still arriving)
 * vs `'verify'` (every byte is on disk and the streaming MD5 of the whole file is
 * running — ~15 s of silence for the 1.27 GB base GGUF on the target device). The
 * loader UI uses it to say "checking the download" instead of appearing stuck.
 */
export type DownloadProgressFn = (pct: number, phase?: 'transfer' | 'verify') => void;

/**
 * Ensure `spec` is present locally AND matches its declared contract, downloading
 * it if not. `onProgress` receives 0–100 (it stays at 99 during verification and
 * only reaches 100 once the file is verified and promoted, so callers that treat
 * 100 as "done" are telling the truth). `signal` lets a caller abort.
 *
 * Throws after MAX_ATTEMPTS failures, or immediately on a verified-complete file
 * whose content is wrong. Never returns a path to unverified bytes.
 */
export async function ensureRemoteAsset(
  spec: RemoteAssetSpec,
  onProgress?: DownloadProgressFn,
  signal?: AbortSignal
): Promise<string> {
  const running = inFlight.get(spec.filename);
  if (running) {
    // Join it instead of racing it. The transfer in flight is driven by the FIRST
    // caller's `onProgress`/`signal`; a joiner cannot observe its byte counter, so
    // it just leaves the bar where it is and reports completion at the end. (A
    // joiner's own `signal` abandons its await, it does not cancel the transfer —
    // the other caller still wants those bytes.)
    LOG(`${spec.label}: already in flight — joining that transfer`);
    const path = await running;
    if (signal?.aborted) throw new Error('model download aborted');
    onProgress?.(100);
    return path;
  }
  setDownloadStatus(spec.filename, 'checking');
  const run = fetchWithDownloadControl(
    spec,
    (pct, phase) => {
      // Completion is published only after fetchAndVerify returns the installed path.
      if (pct < 100)
        setDownloadStatus(spec.filename, phase === 'verify' ? 'verifying' : 'downloading', pct);
      onProgress?.(pct, phase);
    },
    signal
  );
  // Register BEFORE the first await inside `fetchAndVerify` can yield, so there is
  // no window in which a second caller sees an empty map.
  inFlight.set(spec.filename, run);
  try {
    const path = await run;
    setDownloadStatus(spec.filename, 'downloaded', 100);
    return path;
  } catch (error) {
    setDownloadStatus(
      spec.filename,
      signal?.aborted ? 'paused' : 'failed',
      assetDownloadStatus(spec.filename).percent
    );
    throw error;
  } finally {
    inFlight.delete(spec.filename);
  }
}

/** APK downloads remain user-requested and independent of the model pause switch.
 * Already installed weights remain usable even when future downloads are paused. */
async function fetchWithDownloadControl(spec: RemoteAssetSpec, progress?: DownloadProgressFn, signal?: AbortSignal): Promise<string> {
  if (spec.dir || /\.(apk|hpak)$/i.test(spec.filename) ||
      await statSize(`${MODELS_DIR}${spec.filename}`) === spec.bytes) {
    return fetchAndVerify(spec, progress, signal);
  }
  return withModelDownloadControl(
    inner => fetchAndVerify(spec, progress, inner),
    () => setDownloadStatus(spec.filename, 'paused', assetDownloadStatus(spec.filename).percent),
    signal,
  );
}

/** The real work. Serialised per filename by `ensureRemoteAsset` above. */
async function fetchAndVerify(
  spec: RemoteAssetSpec,
  onProgress?: DownloadProgressFn,
  signal?: AbortSignal
): Promise<string> {
  const dir = spec.dir ?? MODELS_DIR;
  await ensureDir(dir);
  const finalUri = `${dir}${spec.filename}`;
  const partUri = `${finalUri}.part`;

  // ---------------------------------------------------------------------------
  // READ path / SELF-HEAL. A file at the final path is trusted only if its size
  // still matches the contract. This is the check that un-bricks installs already
  // poisoned by the old promote-on-any-200 code: a cached login page or truncated
  // GGUF is now DELETED and re-fetched instead of being loaded forever.
  //
  // `statSize` (null when ABSENT) rather than a 0 default, because a 0-BYTE file
  // is one of the exact shapes the old code could leave behind — a captive
  // portal's empty 200 — and it is indistinguishable from "no file" under a 0
  // default. Left undeleted, promotion would depend on `moveAsync` ->
  // `File.renameTo` silently replacing an existing destination, which is
  // documented as platform-dependent; if it ever returned false every attempt
  // would throw FileSystemCannotMoveFileException and the 0-byte file would be a
  // permanent brick that nothing removes. Delete it explicitly instead.
  //
  // The `.part` is cleared ONLY alongside a rejected final file (a poisoned pair
  // usually arrives together). When there is no final file at all — the ordinary
  // first-run path — the `.part` is the cross-launch resume state and must
  // survive, or an interrupted 1.27 GB transfer restarts from byte 0.
  // ---------------------------------------------------------------------------
  const existing = await statSize(finalUri);
  if (existing !== null) {
    if (existing === spec.bytes) {
      track('asset_available', { asset: spec.filename, bytes: existing });
      onProgress?.(100);
      return stripScheme(finalUri);
    }
    LOG(
      `${spec.label}: CACHED FILE REJECTED — ${existing} bytes, declared ${spec.bytes}. ` +
        `Deleting and re-downloading (this self-heals an install poisoned by an ` +
        `earlier build that promoted unverified downloads).`
    );
    await deleteAsync(finalUri, { idempotent: true });
    await deleteAsync(partUri, { idempotent: true });
  }

  const assetKind = /\.apk$/i.test(spec.filename)
    ? 'apk'
    : /adapter|lora/i.test(spec.filename)
      ? 'adapter'
      : /vector/i.test(spec.filename)
        ? 'vectors'
        : /\.(zip|tar|webp|hpak)$/i.test(spec.filename)
          ? 'images'
          : 'model';

  // LAN mirror first, when the device owner configured one and it has not just failed.
  // It either installs a verified file or returns null, and the canonical `.part` is not
  // touched unless the mirror succeeded (then that prefix is simply obsolete).
  const mirrorPartUri = `${finalUri}.mirror.part`;
  const mirror = await mirrorFor(spec);
  if (mirror) {
    const path = await fetchFromMirror(
      spec,
      mirror,
      finalUri,
      mirrorPartUri,
      assetKind,
      onProgress,
      signal
    );
    if (path) {
      await deleteAsync(partUri, { idempotent: true });
      return path;
    }
  }
  // No mirror (any more), cooling off, or not there: what it left carries on from spec.url.
  await adoptMirrorPartial(spec, mirrorPartUri, partUri);

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new Error('model download aborted');

    // -------------------------------------------------------------------------
    // Resume state = the .part on disk. Survives process death.
    // -------------------------------------------------------------------------
    let startOffset = await localSize(partUri);
    if (startOffset > spec.bytes) {
      // Longer than the whole file can be — a previous append-onto-garbage. Toss it.
      LOG(`${spec.label}: partial is ${startOffset}B > declared ${spec.bytes}B — discarding`);
      await deleteAsync(partUri, { idempotent: true });
      startOffset = 0;
    }

    const telemetry = beginDownload(spec.filename, assetKind, spec.bytes, startOffset, attempt);
    try {
      // What the server declared it was sending on this attempt, as reported by
      // native. Null when we never ran a transfer (or never saw a progress event).
      let declaredTotal: number | null = null;

      // Already have every byte from an earlier launch? Skip straight to verification
      // rather than re-requesting the file.
      if (startOffset !== spec.bytes) {
        onProgress?.(
          startOffset > 0 ? Math.min(99, Math.round((startOffset / spec.bytes) * 100)) : 0
        );
        declaredTotal = await runTransfer(spec, partUri, startOffset, onProgress, signal);
      } else {
        LOG(`${spec.label}: partial already complete (${mb(startOffset)}) — verifying`);
      }

      if (signal?.aborted) throw new Error('model download aborted');

      // -----------------------------------------------------------------------
      // WRITE-path gate. Nothing below this line is reached by unverified bytes.
      // MD5 is recomputed from DISK (not from the download result) so it covers
      // resumed transfers end to end, including bytes written by an earlier launch.
      // `'verify'` tells the caller these are hashing seconds, not network seconds.
      // -----------------------------------------------------------------------
      onProgress?.(99, 'verify');
      const size = await localSize(partUri);
      // Size first: it is a stat, and hashing 1.27 GB costs a full disk read
      // (~20 s on the target device). Never pay that to reject a login page.
      const t0 = Date.now();
      const md5 = size === spec.bytes && spec.md5 ? await localMd5(partUri) : undefined;
      if (md5)
        LOG(`${spec.label}: hashed ${mb(size)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

      const bad = checkContract(spec, size, md5);
      if (bad) {
        // ------------------------------------------------------------------
        // KEEP or DELETE the .part?
        //
        // Only a SHORT file can be a resumable PREFIX of the asset, and only
        // when the server told us it was sending exactly our file (the total it
        // declared matched `spec.bytes`) and then closed the body early — which
        // is precisely what a transparent proxy on school Wi-Fi does, and it
        // resolves as a clean 200 rather than throwing. Keeping those bytes is
        // the difference between resuming the last 10% and re-spending 1.27 GB
        // on the metered link this file exists to protect.
        //
        // EVERYTHING else is deleted: a login page, a body of some other length,
        // or a full-length file whose MD5 is wrong. Resuming onto any of them
        // would make a captive-portal page the permanent PREFIX of a
        // correct-length file — one that then passes the size-only read gate
        // forever, which is the original bug.
        // ------------------------------------------------------------------
        const resumablePrefix =
          size >= MIN_PLAUSIBLE_BYTES && size < spec.bytes && declaredTotal === spec.bytes;
        if (resumablePrefix) {
          LOG(
            `${spec.label}: body ended early at ${mb(size)}/${mb(spec.bytes)} but the server ` +
              `declared our exact file — keeping the prefix to resume from`
          );
        } else {
          await deleteAsync(partUri, { idempotent: true });
        }

        // ------------------------------------------------------------------
        // TRANSIENT or DETERMINISTIC?
        //
        // A COMPLETE body at exactly the declared length whose MD5 is wrong is
        // not a network glitch — the same request returns the same bytes, so
        // the remaining attempts would spend 4 more full downloads (~5 GB for
        // the base model) to fail identically. Stop now and say why.
        //
        // The single exception is a mismatch on a RESUMED transfer: there the
        // suspect bytes were the old prefix, which we have just deleted, so the
        // next attempt is a genuinely different, from-scratch request. That
        // attempt necessarily starts at offset 0, so this rule caps the extra
        // spend at exactly one download.
        // ------------------------------------------------------------------
        if (size === spec.bytes && startOffset === 0) {
          throw new IntegrityError(
            `${spec.label}: ${bad}. The transfer COMPLETED, so this is the mirror's content, ` +
              `not the connection — retrying would re-download ${mb(spec.bytes)} to fail the ` +
              `same way. Re-pin the digest in src/config/model.ts or re-upload the file.`
          );
        }
        throw new Error(`integrity check failed: ${bad}`);
      }

      await moveAsync({ from: partUri, to: finalUri });
      telemetry.installed(size);
      LOG(`${spec.label}: verified + installed (${mb(size)})`);
      onProgress?.(100);
      return stripScheme(finalUri);
    } catch (e) {
      telemetry.failed(signal?.aborted ? new Error('cancelled') : e);
      if (signal?.aborted) throw new Error('model download aborted');
      // Deterministic content failure: do not spend the rest of the budget on it.
      if (isFatal(e)) {
        LOG(`${spec.label}: giving up after attempt ${attempt} — ${(e as Error).message}`);
        throw e;
      }
      lastError = e;
      LOG(
        `${spec.label}: attempt ${attempt}/${MAX_ATTEMPTS} failed — ` +
          `${e instanceof Error ? e.message : String(e)}`
      );
      if (attempt < MAX_ATTEMPTS) {
        setDownloadStatus(spec.filename, 'retrying', assetDownloadStatus(spec.filename).percent);
        await sleep(Math.min(15_000, 1000 * 2 ** attempt));
      }
    }
  }

  throw new Error(
    `${spec.label}: download failed after ${MAX_ATTEMPTS} attempts ` +
      `(${lastError instanceof Error ? lastError.message : String(lastError)})`
  );
}

/**
 * The LAN mirror for this download, or null. Read as each download starts, not
 * cached: the device owner moves the mirror whenever the laptop's address changes.
 *
 * Only an asset pinned to a full MD5 may use a mirror. A size-only gate is enough to
 * catch a captive portal's login page, but a mirror that wanted to could serve any
 * bytes of exactly the right length.
 *
 * A mirror that has just stopped answering is not asked at all while it cools off: away
 * from the warehouse it is almost certainly still not there.
 */
async function mirrorFor(spec: RemoteAssetSpec): Promise<AssetMirrorRoute | null> {
  if (!pinnedMd5(spec)) return null;
  const route = await assetMirrorRoute(spec.url, readAssetMirrorSetting);
  if (!route) return null;
  if (mirrorBreaker.skipping(route.mirror)) {
    LOG(`${spec.label}: the LAN mirror failed recently — going straight to ${spec.url}`);
    return null;
  }
  LOG(`${spec.label}: trying the LAN mirror first — ${route.url}`);
  return route;
}

/**
 * THE PARTIAL HANDOFF. An interrupted mirror transfer (app backgrounded, downloads
 * paused, the mirror went quiet or the connection dropped) keeps its bytes. When the
 * mirror cannot continue them — the phone has left the warehouse, the setting is gone,
 * the breaker is open, the probe failed, the transfer just broke off — those bytes
 * become the canonical resume prefix instead of being thrown away, so a phone that got
 * 300 MB of LaBSE in the warehouse buys only the rest at school.
 *
 * Safe although the mirror is untrusted, because the canonical loop MD5s the WHOLE file
 * from disk before promoting it: mirror bytes are installed only if they are exactly
 * the pinned bytes. A bad prefix fails that gate as a RESUMED transfer (startOffset > 0),
 * which deletes the `.part` and retries from byte 0 rather than throwing IntegrityError,
 * so the worst case is paying for the remainder once. That argument needs the MD5, so a
 * size-only asset never adopts one. A partial longer than the whole file is a prefix of
 * nothing and is never moved, and a longer canonical `.part` is kept over a mirror one.
 */
async function adoptMirrorPartial(
  spec: RemoteAssetSpec,
  mirrorPartUri: string,
  partUri: string
): Promise<void> {
  const mirrorPart = await statSize(mirrorPartUri);
  if (mirrorPart === null) return;
  // Over-long partials are worth nothing: the canonical loop discards those too.
  const usable = (size: number) => (size <= spec.bytes ? size : 0);
  if (pinnedMd5(spec) && usable(mirrorPart) > usable(await localSize(partUri))) {
    // Delete, then move, rather than rely on a rename replacing its destination. A crash
    // in between leaves only the mirror partial, which the next launch adopts again.
    await deleteAsync(partUri, { idempotent: true });
    await moveAsync({ from: mirrorPartUri, to: partUri });
    LOG(`${spec.label}: continuing the mirror's ${mb(mirrorPart)} from ${spec.url}`);
  } else {
    await deleteAsync(mirrorPartUri, { idempotent: true });
  }
}

/**
 * ONE attempt at the LAN mirror, under exactly the integrity contract the canonical
 * host gets. Resolves the installed path, or null to fall back to `spec.url`; throws
 * only when the caller aborted.
 *
 * Only a probe the mirror does not answer at all opens the breaker. A mirror that
 * answers is there: a file it lacks (a sync still running, a pack newer than its
 * tables) or gets wrong costs that file alone, and the next file still asks it. That
 * is what keeps one missing pack from sending LaBSE to the internet — or, in a
 * warehouse without internet, to nowhere.
 *
 * The mirror's bytes live in their OWN partial file, never the canonical `.part`. What
 * is POISONED is deleted: `runTransfer` removes an HTTP error body or an ignored Range,
 * and a COMPLETE body of the wrong size or MD5 is removed here, so a mirror that serves
 * the wrong file costs one LAN transfer, never a retry budget. There is deliberately no
 * retry loop here either: the mirror's whole value is that it is quick, and the
 * canonical path below already knows how to be patient.
 *
 * A transfer that merely STOPPED — an abort, a stall, a dropped connection — keeps its
 * bytes, exactly as the canonical loop keeps a stalled `.part`: nothing wrong was
 * written, it just ended early. After an abort the next mirror attempt resumes them
 * with a Range request; after a stall or a drop `adoptMirrorPartial` continues them from
 * the canonical URL at once. Either way the same MD5 gate covers them end to end.
 */
async function fetchFromMirror(
  spec: RemoteAssetSpec,
  route: AssetMirrorRoute,
  finalUri: string,
  partUri: string,
  assetKind: Parameters<typeof beginDownload>[1],
  onProgress: DownloadProgressFn | undefined,
  signal: AbortSignal | undefined
): Promise<string | null> {
  const source: RemoteAssetSpec = { ...spec, url: route.url, label: `${spec.label} (mirror)` };
  const answer = await probeMirror(route.url, spec.bytes, signal);
  // Checked first: a probe cut short by the caller says nothing about the mirror.
  if (signal?.aborted) throw new Error('model download aborted');
  if (answer === 'silent') {
    const coolOffMs = mirrorBreaker.trip(route.mirror);
    LOG(
      `${source.label}: the mirror did not answer — using ${spec.url}, and skipping the ` +
        `mirror for ${coolOffMs / 60_000} min`
    );
    return null;
  }
  mirrorBreaker.answered(route.mirror);
  if (answer === 'missing') {
    LOG(`${source.label}: the mirror does not hold this file — using ${spec.url}`);
    return null;
  }

  let startOffset = await localSize(partUri);
  if (startOffset > spec.bytes) {
    await deleteAsync(partUri, { idempotent: true });
    startOffset = 0;
  }
  const telemetry = beginDownload(spec.filename, assetKind, spec.bytes, startOffset);
  try {
    if (startOffset !== spec.bytes) {
      onProgress?.(
        startOffset > 0 ? Math.min(99, Math.round((startOffset / spec.bytes) * 100)) : 0
      );
      await runTransfer(source, partUri, startOffset, onProgress, signal, MIRROR_STALL_MS);
    }
    if (signal?.aborted) throw new Error('model download aborted');

    // The same WRITE-path gate as the canonical loop: size first, then a streaming MD5
    // of every byte on disk, resumed ones included.
    onProgress?.(99, 'verify');
    const size = await localSize(partUri);
    const md5 = size === spec.bytes ? await localMd5(partUri) : undefined;
    const bad = checkContract(spec, size, md5);
    if (bad) {
      // The body ENDED and is not our file: none of it is a prefix worth keeping.
      await deleteAsync(partUri, { idempotent: true });
      throw new Error(`integrity check failed: ${bad}`);
    }

    await moveAsync({ from: partUri, to: finalUri });
    telemetry.installed(size);
    LOG(`${source.label}: verified + installed (${mb(size)})`);
    onProgress?.(100);
    return stripScheme(finalUri);
  } catch (e) {
    telemetry.failed(signal?.aborted ? new Error('cancelled') : e);
    if (signal?.aborted) throw new Error('model download aborted');
    LOG(`${source.label}: ${e instanceof Error ? e.message : String(e)} — using ${spec.url}`);
    return null;
  }
}

/**
 * Does the mirror hold a file of exactly our size? A HEAD with a short deadline, so an
 * unreachable mirror costs seconds. `'silent'` means no HTTP answer at all (nothing
 * there, a refused connection, too slow), the one outcome that says something about
 * the mirror rather than this file. Only a hint: a mirror that lies here still has to
 * get past the size + MD5 gate.
 */
async function probeMirror(
  url: string,
  bytes: number,
  signal?: AbortSignal
): Promise<'offered' | 'missing' | 'silent'> {
  if (signal?.aborted) return 'silent';
  const probe = new AbortController();
  const cancel = () => probe.abort();
  signal?.addEventListener('abort', cancel);
  const deadline = setTimeout(cancel, MIRROR_PROBE_MS);
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      // Cast: Node's AbortSignal type is not structurally RN's (see telemetry/index.ts).
      signal: probe.signal as RequestInit['signal'],
    });
    return response.status === 200 && response.headers.get('content-length') === String(bytes)
      ? 'offered'
      : 'missing';
  } catch {
    return 'silent';
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', cancel);
  }
}

/**
 * One transfer attempt into `partUri`, resuming from `startOffset`. Resolves when
 * the socket is done; the CALLER verifies what landed on disk. Throws on HTTP
 * error, stall, or a server that ignored our Range.
 *
 * Returns the total size the server DECLARED for this transfer (absolute, i.e.
 * including `startOffset`), or null if no progress event ever arrived. The caller
 * uses it to tell a genuine truncated prefix from a body that was never our file.
 * `stallMs` is shortened for the LAN mirror, which has no slow link to excuse it.
 */
async function runTransfer(
  spec: RemoteAssetSpec,
  partUri: string,
  startOffset: number,
  onProgress: DownloadProgressFn | undefined,
  signal: AbortSignal | undefined,
  stallMs = STALL_MS
): Promise<number | null> {
  if (signal?.aborted) throw new Error('model download aborted');
  LOG(
    `${spec.label}: ${startOffset > 0 ? `resuming at ${mb(startOffset)}/${mb(spec.bytes)}` : `starting (${mb(spec.bytes)})`}`
  );

  let lastPct = -1;
  let lastAdvanceAt = Date.now();
  let declaredTotal: number | null = null;
  let rangeIgnored = false;
  let overran = false;
  let stalled = false;

  const resumable = createDownloadResumable(
    spec.url,
    partUri,
    // md5 here is belt-and-braces; the authoritative digest is recomputed from
    // disk by the caller so that resumed transfers are covered too.
    { md5: false },
    (dl) => {
      lastAdvanceAt = Date.now();
      // Native reports these ALREADY including startOffset (it adds resumeData to
      // both counters), so they are absolute file offsets.
      declaredTotal = dl.totalBytesExpectedToWrite;

      // THE RANGE-IGNORED SIGNATURE, readable on the FIRST progress event.
      // Native sets `totalBytesExpectedToWrite = contentLength + resumeData`, so a
      // server that honoured `Range` sends the REMAINDER and declares exactly
      // `spec.bytes`, while one that ignored it sends the WHOLE body and declares
      // exactly `spec.bytes + startOffset`. Catching it here rather than waiting
      // for the byte cap below saves everything between the two: resuming the base
      // model at 100 MB, the cap does not trip until ~3.1 GB of replay has been
      // paid for. An unknown-length (chunked) body reports -1 and cannot collide
      // with this test, so there are no false positives.
      if (startOffset > 0 && !rangeIgnored && declaredTotal === spec.bytes + startOffset) {
        rangeIgnored = true;
        resumable.pauseAsync().catch(() => {});
        return;
      }

      const written = dl.totalBytesWritten;
      if (written > spec.bytes && !overran) {
        // The server ignored `Range` and is replaying the whole body on top of our
        // partial. Every further byte is wasted prepaid data — stop now.
        overran = true;
        resumable.pauseAsync().catch(() => {});
        return;
      }
      const pct = Math.min(99, Math.round((written / spec.bytes) * 100));
      if (pct !== lastPct) {
        lastPct = pct;
        onProgress?.(pct);
      }
    },
    // THE resume token. On Android this is the byte offset -> `Range: bytes=N-`.
    startOffset > 0 ? String(startOffset) : undefined
  );

  const onAbort = () => {
    resumable.pauseAsync().catch(() => {});
  };
  signal?.addEventListener('abort', onAbort);

  // Native has no idle timeout: a socket that goes quiet (backgrounded, captive
  // portal, tunnel) would hang here forever. Pausing cancels the call, which makes
  // downloadAsync resolve null — and leaves the .part intact for the next attempt
  // to resume from.
  const watchdog = setInterval(() => {
    if (Date.now() - lastAdvanceAt > stallMs && !stalled) {
      stalled = true;
      LOG(`${spec.label}: no data for ${stallMs / 1000}s — treating as stalled`);
      resumable.pauseAsync().catch(() => {});
    }
  }, STALL_POLL_MS);

  try {
    const result = await resumable.downloadAsync();
    // Once downloadAsync has settled the native write loop has stopped, so it is
    // safe to delete the .part below without racing the writer.

    if (signal?.aborted) throw new Error('model download aborted');

    // ORDER IS LOAD-BEARING. Both faults below POISONED the .part by appending to
    // it, and both are detected by PAUSING — which makes downloadAsync resolve
    // null and, in `overran`'s case, also leaves `result?.status === 200` false.
    // Checked after the stall branch (as they used to be) a paused-then-stalled
    // replay would be classified as "stalled", whose whole contract is that the
    // partial is GOOD and worth resuming — so `good prefix + body-from-byte-0`
    // would be kept, resumed onto, and only caught by the MD5 gate a full
    // transfer later. Classify the poisoning faults FIRST.
    if (rangeIgnored || overran) {
      await deleteAsync(partUri, { idempotent: true });
      throw new Error(
        `server ignored Range (${rangeIgnored ? 'declared the whole body, not the remainder' : '200, not 206'}) ` +
          `— discarded the appended partial`
      );
    }

    // A stall is the ONLY failure that leaves a good partial: nothing bad was
    // written, we just stopped early. Keep it so the next attempt resumes.
    if (stalled) throw new Error(`stalled (no data for ${stallMs / 1000}s)`);

    // Null means the native call was cancelled — a pause we did not classify.
    if (!result) throw new Error('transfer cancelled');
    if (result.status >= 400) {
      // The error page (or the 416 body) was just appended to our bytes. Whether
      // we had a partial or not, what is on disk is no longer the model.
      await deleteAsync(partUri, { idempotent: true });
      throw new Error(`HTTP ${result.status}`);
    }
    if (startOffset > 0 && result.status === 200) {
      // Belt and braces behind the progress-event signature above: a 200 answer to
      // a Range request replayed the whole body on top of our partial.
      await deleteAsync(partUri, { idempotent: true });
      throw new Error('server ignored Range (200, not 206) — discarded the appended partial');
    }
    return declaredTotal;
  } finally {
    clearInterval(watchdog);
    signal?.removeEventListener('abort', onAbort);
  }
}
