import { NativeModules } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { ACTIVE_MODEL, EMBEDDER, REMOTE_ASSETS } from '../config/model';
import { installedModelUpdate } from '../updates/model';
import { memoryBlock, semanticMemoryBlock, type MemoryBlock, type MemorySnapshot } from './memoryPolicy';

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
  const remote = await installedModelUpdate() ?? ACTIVE_MODEL.remote;
  if (beforeDownload && remote) {
    const file = new File(Paths.document, 'models', remote.filename);
    needsDownload = !file.exists || file.size !== remote.bytes;
  }
  const memory = await readMemory();
  const reason = memoryBlock(memory, needsDownload);
  console.log(`[memory] ${reason ?? 'eligible'} total=${memory?.totalBytes} available=${memory?.availableBytes}`);
  if (reason) throw new MemoryBlockedError(reason);
  return memory!;
}

/** Check before downloads, then again before either native/JS allocation. */
export async function requireSemanticMemory(beforeDownload = false): Promise<MemorySnapshot> {
  const needsDownload = beforeDownload && [EMBEDDER.remote, REMOTE_ASSETS.vectors].some(remote => {
    const file = new File(Paths.document, 'models', remote.filename);
    return !file.exists || file.size !== remote.bytes;
  });
  const memory = await readMemory();
  const reason = semanticMemoryBlock(memory, needsDownload);
  console.log(`[memory] semantic ${reason ?? 'eligible'} total=${memory?.totalBytes} available=${memory?.availableBytes}`);
  if (reason) throw new MemoryBlockedError(reason);
  return memory!;
}
