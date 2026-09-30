import { Asset } from 'expo-asset';
import type { ImageSourcePropType } from 'react-native';
export function imageSourceUri(source: ImageSourcePropType): string | undefined {
  if (typeof source === 'number') return Asset.fromModule(source).uri;
  if (typeof source === 'string') return source;
  return (Array.isArray(source) ? source[0] : source)?.uri;
}
