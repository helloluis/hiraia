import { desktop } from './bridge';
export const documentDirectory = desktop().info.paths.document;
export const cacheDirectory = desktop().info.paths.cache;
export async function getInfoAsync(uri: string, options: { md5?: boolean } = {}) {
  const stat = await desktop().invoke('fs.stat', uri);
  if (stat.exists && options.md5) stat.md5 = await desktop().invoke('fs.hash', uri, 'md5');
  return stat;
}
export const makeDirectoryAsync = (uri: string, options = {}) => desktop().invoke('fs.mkdir', uri, options);
export const moveAsync = ({ from, to }: { from: string; to: string }) => desktop().invoke('fs.move', from, to);
export const copyAsync = ({ from, to }: { from: string; to: string }) => desktop().invoke('fs.copy', from, to);
export const deleteAsync = (uri: string, _options = {}) => desktop().invoke('fs.remove', uri);
export const readAsStringAsync = (uri: string) => desktop().invoke<string>('fs.read', uri, 'utf8');
export const writeAsStringAsync = (uri: string, value: string) => desktop().invoke('fs.write', uri, value);
export const readDirectoryAsync = async (uri: string) => (await desktop().invoke<Array<{ name: string }>>('fs.list', uri)).map(e => e.name);
export const getContentUriAsync = async (uri: string) => uri;
export function createDownloadResumable(url: string, fileUri: string, _options: unknown, onProgress?: (value: any) => void, resumeData?: string) {
  const id = crypto.randomUUID();
  let unsubscribe = () => {};
  return {
    async downloadAsync() {
      unsubscribe = desktop().subscribe('download-progress', event => { if (event.id === id) onProgress?.(event.progress); });
      try { return await desktop().invoke('download.start', { id, url, fileUri, offset: Number(resumeData ?? 0) }); }
      finally { unsubscribe(); }
    },
    async pauseAsync() { return desktop().invoke('download.cancel', id); },
    async cancelAsync() { return desktop().invoke('download.cancel', id); },
  };
}
