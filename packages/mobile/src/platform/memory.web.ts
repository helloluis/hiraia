import { desktop } from '../desktop/bridge';
import type { MemorySnapshot } from '../engine/memoryPolicy';
export async function memorySnapshot(): Promise<MemorySnapshot | null> {
  return desktop().invoke<MemorySnapshot>('memory');
}
