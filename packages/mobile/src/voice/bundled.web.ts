/** Preserve the Windows edition's existing offline English and Tagalog voices. */
export const isBundledVoice = (id: string): boolean => id === 'en' || id === 'tl';
export function bundledVoiceModule(id: string): number {
  if (id === 'en') return require('../../assets/voices/en/model.onnx');
  if (id === 'tl') return require('../../assets/voices/tl/model.onnx');
  throw new Error(`No bundled voice for ${id}`);
}
