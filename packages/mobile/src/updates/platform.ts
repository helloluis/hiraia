export type AppPlatform = 'android' | 'chromeos';

export function distributionPlatform(value: unknown): AppPlatform {
  if (value == null || value === 'android') return 'android';
  if (value === 'chromeos') return 'chromeos';
  throw new Error('Unsupported app distribution');
}

export function platformManifestUrl(base: string, platform: AppPlatform): string {
  const url = new URL(base);
  if (url.protocol !== 'https:') throw new Error('Update manifest must use HTTPS');
  url.searchParams.set('platform', platform);
  return url.toString();
}

export function acceptsManifestPlatform(body: unknown, platform: AppPlatform): boolean {
  if (!body || typeof body !== 'object') return false;
  const offered = (body as { platform?: unknown }).platform;
  // Only old phone releases may use the legacy, unlabelled manifest.
  return offered === platform || (platform === 'android' && offered == null);
}
