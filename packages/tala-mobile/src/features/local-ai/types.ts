export type Memory = {
  availableBytes: number;
  totalBytes: number;
  pssBytes: number;
  peakPssBytes: number;
  lowMemory: boolean;
  lowRam: boolean;
};
export interface Engine {
  start(path: string): Promise<void>;
  complete(
    prompt: string,
    onToken: (token: string) => void
  ): Promise<{ text: string; tokens: number | null; tokensPerSecond: number | null }>;
  cancel(): Promise<void>;
  close(): Promise<void>;
}
export type Completion = {
  text: string;
  tokens: number | null;
  tokensPerSecond: number | null;
  elapsedMs: number;
  peakPssBytes: number | null;
};
