/** Android and ChromeOS include English; other voices install when selected. */
export const isBundledVoice = (id: string): boolean => id === 'en';
export function bundledVoiceModule(id: string): number {
  if (id === 'en') return require('../../assets/voices/en/model.onnx');
  throw new Error(`No bundled voice for ${id}`);
}
