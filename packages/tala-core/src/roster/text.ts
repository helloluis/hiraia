/** Typed facade over the shared plain-JavaScript decoder used offline and by Node workers. */
import * as runtime from './text-runtime.cjs';
export const decodeText: (bytes: Uint8Array) => { text: string; encoding: string; needsReview: boolean } = runtime.decodeText;
export const parseDelimited: (text: string, delimiter: string) => string[][] = runtime.parseDelimited;
export const extractText: (text: string, extension?: string) => string[][] = runtime.extractText;
