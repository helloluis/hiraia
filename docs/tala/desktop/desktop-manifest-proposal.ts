// Release-owner integration proposal: place beside the download feature, then
// pass the approved static HTTPS prefix explicitly. No host is guessed here.
export interface DesktopManifest {
  schemaVersion: 1;
  status: 'released';
  version: string;
  release: string;
  sourceCommit: string;
  artifacts: {
    platform: 'win32' | 'darwin';
    arch: 'x64' | 'arm64';
    url: string;
    bytes: number;
    sha256: string;
  }[];
}

/** Invalid or partial input hides the entire section; never show mixed editions. */
export function desktopManifest(value: unknown, approvedPrefix: string): DesktopManifest | null {
  try {
    const prefix = new URL(approvedPrefix);
    if (prefix.protocol !== 'https:' || prefix.username || prefix.password || prefix.search || prefix.hash) return null;
    const base = prefix.href.replace(/\/$/, '');
    if (!value || typeof value !== 'object') return null;
    const m = value as Record<string, unknown>;
    if (m.schemaVersion !== 1 || m.status !== 'released' ||
        typeof m.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(m.version) ||
        typeof m.release !== 'string' || !/^tala-(?:v1-demo\.\d+|desktop-preview-[A-Za-z0-9.-]+)$/.test(m.release) ||
        typeof m.sourceCommit !== 'string' || !/^[0-9a-f]{40}$/.test(m.sourceCommit) ||
        m.hostedOrigin !== 'https://tala.hiraia.org' || !Array.isArray(m.artifacts) || m.artifacts.length !== 3) return null;
    const expected = new Set(['win32-x64', 'darwin-arm64', 'darwin-x64']);
    const artifacts: DesktopManifest['artifacts'] = [];
    for (const value of m.artifacts as unknown[]) {
      if (!value || typeof value !== 'object') return null;
      const a = value as Record<string, unknown>;
      const { platform, arch, bytes, sha256, url } = a;
      if ((platform !== 'win32' && platform !== 'darwin') || (arch !== 'x64' && arch !== 'arm64') ||
          !expected.delete(`${platform}-${arch}`) ||
          a.sourceDirty !== false || ['version', 'release', 'sourceCommit', 'electron', 'hostedOrigin'].some(key => a[key] !== m[key]) ||
          typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes <= 0 ||
          typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256) || typeof url !== 'string') return null;
      const file = `Tala-${m.version}-${platform === 'win32' ? 'win' : 'mac'}-${arch}.${platform === 'win32' ? 'exe' : 'dmg'}`;
      if (a.file !== file || url !== `${base}/${m.release}/${m.sourceCommit}/${file}`) return null;
      artifacts.push({ platform, arch, url, bytes, sha256 });
    }
    if (expected.size) return null;
    // Return only display fields; the UI never consumes arbitrary manifest text.
    return { schemaVersion: 1, status: 'released', version: m.version, release: m.release, sourceCommit: m.sourceCommit, artifacts };
  } catch { return null; }
}
