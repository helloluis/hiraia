/**
 * Hiraia watermark for drawings embedded in decks (Luis, 19 Nov 2026: Hiraia owns the drawings; mark them with the
 * Hiraia brand name). The approved drawing is never edited: a derived copy gets a thin white strip below the
 * drawing with the Hiraia wordmark in grey, right-aligned, so the mark is in the same place on every slide and
 * never covers any of the science. The derivative is deterministic (same source bytes → same output bytes) and is
 * recorded beside the source hash, so a deck can still be traced to the checked library file.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { BUILD, REPO_ROOT } from '../paths';

export const WATERMARK_VERSION = 'wm/1';
/** Grey on white: about 3.5:1 contrast, readable close up and on a TV, quieter than the drawing's black lines. */
const MARK_COLOUR = '#858585';
const WORDMARK = resolve(REPO_ROOT, 'packages/brand/assets/wordmark-mono.svg');

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export interface Watermarked {
  png: Buffer;
  w: number;
  h: number;
  sourceSha256: string;
  sha256: string;
}

/** The strip and mark scale with the drawing's width (512 px drawings: 34 px strip, 17 px tall wordmark). */
export async function watermark(source: Buffer): Promise<Watermarked> {
  const sourceSha256 = sha(source);
  const cacheFile = resolve(BUILD, 'watermarked', `${sourceSha256}-${WATERMARK_VERSION.replace('/', '')}.png`);
  const meta = await sharp(source).metadata();
  const w = meta.width!;
  const h = meta.height!;
  const strip = Math.round(w * 0.066);
  if (existsSync(cacheFile)) {
    const png = readFileSync(cacheFile);
    return { png, w, h: h + strip, sourceSha256, sha256: sha(png) };
  }
  const markH = Math.round(strip * 0.5);
  const svg = readFileSync(WORDMARK, 'utf8').replaceAll('#1C3B2E', MARK_COLOUR);
  const mark = await sharp(Buffer.from(svg), { density: 1200 }).resize({ height: markH }).png().toBuffer();
  const markW = (await sharp(mark).metadata()).width!;
  const pad = Math.round(w * 0.03);
  const flat = await sharp(source).flatten({ background: '#ffffff' }).png().toBuffer();
  const png = await sharp({ create: { width: w, height: h + strip, channels: 3, background: '#ffffff' } })
    .composite([
      { input: flat, left: 0, top: 0 },
      { input: mark, left: w - markW - pad, top: h + Math.round((strip - markH) / 2) },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
  mkdirSync(resolve(BUILD, 'watermarked'), { recursive: true });
  writeFileSync(cacheFile, png);
  return { png, w, h: h + strip, sourceSha256, sha256: sha(png) };
}
