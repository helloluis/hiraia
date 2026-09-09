import { NativeModules } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { ACTIVE_MODEL } from '../config/model';
import { memoryBlock, type MemoryBlock, type MemorySnapshot } from './memoryPolicy';

export async function readMemory(): Promise<MemorySnapshot | null> {
  try {
    const value = await NativeModules.HiraiaMemory?.snapshot();
    return value ?? null;
  } catch { return null; }
}
export class MemoryBlockedError extends Error {
  constructor(public reason: MemoryBlock) { super(`Local inference deferred: ${reason}`); }
}
export async function requireModelMemory(beforeDownload = false): Promise<MemorySnapshot> {
  let needsDownload = beforeDownload;
  if (beforeDownload && ACTIVE_MODEL.remote) {
    const file = new File(Paths.document, 'models', ACTIVE_MODEL.remote.filename);
    needsDownload = !file.exists || file.size !== ACTIVE_MODEL.remote.bytes;
  }
  const memory = await readMemory();
  const reason = memoryBlock(memory, needsDownload);
  console.log(`[memory] ${reason ?? 'eligible'} total=${memory?.totalBytes} available=${memory?.availableBytes}`);
  if (reason) throw new MemoryBlockedError(reason);
  return memory!;
}
