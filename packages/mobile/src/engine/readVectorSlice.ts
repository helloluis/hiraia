/** Avoid File.bytes(): it duplicates the entire blob in Android's small Java heap.
 * Keep just the active language in JS, with bounded native transfer buffers. */
export interface VectorFile {
  size: number;
  open(): { offset: number | null; readBytes(length: number): Uint8Array; close(): void };
}
export async function readVectorSlice(
  file: VectorFile,
  expectedSize: number,
  offset: number,
  length: number,
  signal?: AbortSignal,
): Promise<Int8Array> {
  if (![expectedSize, offset, length].every(n => Number.isSafeInteger(n) && n >= 0) ||
      offset + length > expectedSize || file.size !== expectedSize) {
    throw new Error('Vector file size/range mismatch');
  }
  const check = () => { if (signal?.aborted) throw new Error('Vector read cancelled'); };
  check();
  const data = new Int8Array(length);
  const handle = file.open();
  try {
    handle.offset = offset;
    for (let written = 0; written < length;) {
      check();
      const chunk = handle.readBytes(Math.min(256 * 1024, length - written));
      if (!chunk.length || chunk.length > length - written) throw new Error('Truncated vector file');
      data.set(new Int8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), written);
      written += chunk.length;
      // Yield between chunks: typing, page turns, cancellation and GC remain possible.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    check();
    return data;
  } finally { handle.close(); }
}
