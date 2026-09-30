import { desktop } from '../desktop/bridge';
// Conversion lives in Node: it handles Windows drive letters, spaces, Unicode,
// and percent-encoded characters without teaching the renderer OS path rules.
export const nativeFilePath = (uri: string): string => desktop().sync('fs.path', uri);
export const fileUri = (path: string): string => desktop().sync('fs.uri', path);
