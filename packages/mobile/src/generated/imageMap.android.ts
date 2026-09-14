/** Android illustrations live directly in the APK; Metro only bundles this inventory. */
import inventory from './bundledArt.generated.json';
import { installBundledArt } from '../data/artPresence';

const dimensions = new Map((inventory.images as [string, number, number][]).map(
  ([slug, width, height]) => [slug, { width, height }]
));
export const IMAGE_SLUGS: ReadonlySet<string> = new Set(dimensions.keys());
installBundledArt(IMAGE_SLUGS);

export function resolveImage(slug: string): { uri: string; width: number; height: number } | null {
  const key = IMAGE_SLUGS.has(slug) ? slug : slug.replace(/-g\d+$/, '').toLowerCase();
  if (!IMAGE_SLUGS.has(key)) return null;
  return { uri: `asset:/illustrations/${key}.png`, ...dimensions.get(key)! };
}
