// Provisional limits from the September emulator audit; real-device validation pending.
export const GiB = 1024 ** 3;
export type MemorySnapshot = {
  totalBytes: number; availableBytes: number; thresholdBytes: number;
  freeStorageBytes: number; lowMemory: boolean; lowRamDevice: boolean;
};
export type MemoryBlock = 'unsupported' | 'pressure' | 'storage' | 'unknown';
export function memoryBlock(s: MemorySnapshot | null, needsDownload = false): MemoryBlock | null {
  if (!s || ![s.totalBytes, s.availableBytes, s.thresholdBytes, s.freeStorageBytes].every(n => Number.isFinite(n) && n >= 0) || s.totalBytes === 0) return 'unknown';
  if (s.totalBytes < 3.5 * GiB || s.lowRamDevice) return 'unsupported';
  if (s.lowMemory || s.availableBytes < Math.max(1.5 * GiB, s.thresholdBytes + 0.5 * GiB)) return 'pressure';
  if (needsDownload && s.freeStorageBytes < 2 * GiB) return 'storage';
  return null;
}
export function canLoadSemantic(s: MemorySnapshot | null): boolean {
  return !!s && s.totalBytes >= 5.5 * GiB && !s.lowMemory && !s.lowRamDevice && s.availableBytes >= GiB;
}
