import type { ImagePack } from '../images/format';

/** Data-only updates; runtime/tokenizer/schema changes must ship in an APK. */
export interface ModelUpdate {
  id: 'base'; revision: number; label: string; notes: string;
  runtime: 'hiraia-2b-qwen35-v1'; filename: string; url: string;
  bytes: number; md5: string;
}
export interface AssetCatalog {
  format: 1; revision: number; minAppVersionCode: number; maxAppVersionCode: number;
  imageBaseline: string; models: ModelUpdate[]; imagePacks: ImagePack[];
}
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const file = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}$/.test(v);
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v);

export function parseAssetCatalog(value: unknown, appVersion: number, imageBaseline: string): AssetCatalog | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as AssetCatalog;
  if (!positive(appVersion) || c.format !== 1 || !positive(c.revision) || !positive(c.minAppVersionCode) ||
      !positive(c.maxAppVersionCode) || appVersion < c.minAppVersionCode || appVersion > c.maxAppVersionCode ||
      c.imageBaseline !== imageBaseline || !Array.isArray(c.models) || c.models.length > 1 ||
      !Array.isArray(c.imagePacks) || c.imagePacks.length > 300) return null;
  for (const m of c.models) {
    if (!m || m.id !== 'base' || m.runtime !== 'hiraia-2b-qwen35-v1' || !positive(m.revision) || m.revision > c.revision ||
        !file(m.filename) || !m.filename.endsWith('.gguf') || !positive(m.bytes) || m.bytes > 2_000_000_000 ||
        !digest(m.md5) || m.url !== `https://assets.hiraia.org/models/${m.filename}` ||
        typeof m.label !== 'string' || m.label.length > 100 || typeof m.notes !== 'string' || m.notes.length > 500) return null;
  }
  const ids = new Set<string>(); const names = new Set<string>();
  for (const p of c.imagePacks) {
    if (!p || !file(p.id) || ids.has(p.id) || !/^(common|g(?:[3-9]|10)-[a-zA-Z0-9_-]+)$/.test(p.cell) ||
        !file(p.filename) || !p.filename.endsWith(`-${p.md5}.hpak`) || names.has(p.filename) || !digest(p.md5) ||
        !positive(p.bytes) || p.bytes > 100_000_000 || !positive(p.unpackedBytes) || p.unpackedBytes >= p.bytes ||
        !positive(p.images) || p.images > 1200) return null;
    ids.add(p.id); names.add(p.filename);
  }
  // Copy only accepted fields; the catalog cannot supply download directories or code.
  return {
    format: 1, revision: c.revision, minAppVersionCode: c.minAppVersionCode, maxAppVersionCode: c.maxAppVersionCode,
    imageBaseline: c.imageBaseline,
    models: c.models.map(m => ({ id: m.id, revision: m.revision, label: m.label, notes: m.notes,
      runtime: m.runtime, filename: m.filename, url: m.url, bytes: m.bytes, md5: m.md5 })),
    imagePacks: c.imagePacks.map(p => ({id: p.id, cell: p.cell, filename: p.filename, bytes: p.bytes,
      unpackedBytes: p.unpackedBytes, md5: p.md5, images: p.images})),
  };
}

export function mergeImagePacks(bundled: ImagePack[], replacements: ImagePack[]): ImagePack[] {
  const map = new Map(bundled.map(p => [p.id, p]));
  for (const p of replacements) map.set(p.id, p);
  return [...map.values()];
}

export function newerModel(offered: ModelUpdate | undefined, installed: ModelUpdate | null, baseline: {filename: string; md5: string}): ModelUpdate | null {
  if (!offered || (installed && offered.revision <= installed.revision)) return null;
  const current = installed ?? baseline;
  // Immutable filenames: never overwrite a model currently mapped by inference.
  if (offered.filename === current.filename || offered.md5 === current.md5 || offered.filename === baseline.filename) return null;
  return offered;
}
