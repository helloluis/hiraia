/** Native libraries take a filesystem path; Expo File takes a file URI. */
export const nativeFilePath = (uri: string): string => uri.replace(/^file:\/\//, '');
export const fileUri = (path: string): string => path.startsWith('file:') ? path : 'file://' + path;
