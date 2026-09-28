// Standalone LaBSE has priority. The measured 4 GB Jambo cannot safely run the LLM.
export const GiB = 1024 ** 3;
export type MemorySnapshot = {
  totalBytes: number; availableBytes: number; thresholdBytes: number;
  freeStorageBytes: number; lowMemory: boolean; lowRamDevice: boolean;
};
export type MemoryBlock = 'unsupported' | 'pressure' | 'storage' | 'unknown';
function valid(s: MemorySnapshot | null): s is MemorySnapshot {
  return !!s && [s.totalBytes, s.availableBytes, s.thresholdBytes, s.freeStorageBytes]
    .every(n => Number.isFinite(n) && n >= 0) && s.totalBytes > 0 &&
    typeof s.lowMemory === 'boolean' && typeof s.lowRamDevice === 'boolean';
}
/** Generation is optional and checked AFTER the retrieval models are resident. */
export function memoryBlock(s: MemorySnapshot | null, needsDownload = false): MemoryBlock | null {
  if (!valid(s)) return 'unknown';
  if (s.totalBytes < 5.5 * GiB || s.lowRamDevice) return 'unsupported';
  if (s.lowMemory || s.availableBytes < Math.max(2.5 * GiB, s.thresholdBytes + GiB)) return 'pressure';
  if (needsDownload && s.freeStorageBytes < 2 * GiB) return 'storage';
  return null;
}
/** About 506 MB of weights/vectors, plus runtime and Android headroom. */
export function semanticMemoryBlock(s: MemorySnapshot | null, needsDownload = false): MemoryBlock | null {
  if (!valid(s)) return 'unknown';
  if (s.totalBytes < 3.5 * GiB || s.lowRamDevice) return 'unsupported';
  if (s.lowMemory || s.availableBytes < Math.max(1.25 * GiB, s.thresholdBytes + 0.75 * GiB)) return 'pressure';
  if (needsDownload && s.freeStorageBytes < GiB) return 'storage';
  return null;
}
/**
 * The DOWNLOAD gate for LaBSE + vectors, deliberately narrower than semanticMemoryBlock: only
 * what waiting cannot fix refuses a download — a phone too small to ever hold LaBSE
 * ('unsupported', a fixed property of the device) or no room to store it ('storage').
 * RAM 'pressure' is a moment, not a property of the phone (a game behind Hiraia, the feed
 * decoding art), so it gates only the load into RAM, which semanticMemoryBlock re-checks just
 * before loadModel. Refusing the download on it left a JP1 that was busy at first launch
 * keyword-only for good. An unreadable snapshot stays a (retryable) 'unknown': it proves
 * nothing about the phone, and the allocation gate would refuse to load on it anyway.
 */
export function semanticDownloadBlock(s: MemorySnapshot | null, needsDownload = false): MemoryBlock | null {
  const reason = semanticMemoryBlock(s, false);
  if (reason === 'unsupported' || reason === 'unknown') return reason;
  return needsDownload && s!.freeStorageBytes < GiB ? 'storage' : null;
}
export function canLoadSemantic(s: MemorySnapshot | null): boolean {
  return semanticMemoryBlock(s) === null;
}
