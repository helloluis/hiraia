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
export function canLoadSemantic(s: MemorySnapshot | null): boolean {
  return semanticMemoryBlock(s) === null;
}
