export type DesktopInfo = {
  version: string;
  build: number;
  platform: string;
  arch: string;
  totalMemory: number;
  screenReader: boolean;
  paths: { document: string; cache: string; database: string };
};
export interface DesktopBridge {
  info: DesktopInfo;
  sync<T = any>(operation: string, ...args: any[]): T;
  invoke<T = any>(operation: string, ...args: any[]): Promise<T>;
  subscribe(channel: string, callback: (data: any) => void): () => void;
}
declare global { interface Window { hiraiaDesktop?: DesktopBridge } }
export function desktop(): DesktopBridge {
  if (!globalThis.window?.hiraiaDesktop) throw new Error('This build must run inside Hiraia Desktop');
  return window.hiraiaDesktop;
}
/** Browser media stays on the application origin; file access is checked in the host. */
export function mediaUri(uri: string): string {
  return globalThis.window?.hiraiaDesktop && uri.startsWith('file:')
    ? `hiraia://file/${encodeURIComponent(uri)}` : uri;
}
