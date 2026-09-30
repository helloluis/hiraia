import { NativeModules } from 'react-native';
import type { MemorySnapshot } from '../engine/memoryPolicy';
export async function memorySnapshot(): Promise<MemorySnapshot | null> {
  return await NativeModules.HiraiaMemory?.snapshot() ?? null;
}
