import { Image, type ImageSourcePropType } from 'react-native';
export const imageSourceUri = (source: ImageSourcePropType): string | undefined => Image.resolveAssetSource(source)?.uri;
