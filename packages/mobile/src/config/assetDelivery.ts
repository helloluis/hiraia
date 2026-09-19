/** Canonical pilot transport. All optional assets come from HTTPS, never peer discovery.
 * Set EXPO_PUBLIC_ASSETS_BASE_URL at build time to a verified CDN prefix. Asset
 * filenames and integrity contracts stay identical when moving between hosts.
 */
export function assetUrl(filename: string, base: string): string {
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Asset origin must be an HTTPS URL without credentials, query or fragment');
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(filename)) {
    throw new Error('Asset filename must be a single versioned filename');
  }
  return `${url.toString().replace(/\/+$/, '')}/${filename}`;
}

// Verified production CDN. Use immutable assets directly rather than relying on
// legacy VPS redirects, whose cached error responses can outlive a route fix.
export const ASSETS_BASE_URL =
  process.env.EXPO_PUBLIC_ASSETS_BASE_URL || 'https://assets.hiraia.org/models';

export function remoteAssetUrl(filename: string): string {
  return assetUrl(filename, ASSETS_BASE_URL);
}
