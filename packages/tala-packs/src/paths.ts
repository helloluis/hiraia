import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = resolve(PKG_ROOT, '../..');
export const CURRICULUM_PACKS = resolve(REPO_ROOT, 'packages/tala-server/data/packs');
export const DATA = resolve(PKG_ROOT, 'data');
export const PROMPTS = resolve(PKG_ROOT, 'prompts');
/** Committed, reviewable pack content: one folder per pack (pack.json, review.json). */
export const LIBRARY = resolve(PKG_ROOT, 'library/science-bow-2026');
/** Hiraia checkout that holds the approved illustrations (read-only). */
export const REFERENCE_ROOT = process.env.TALA_PACKS_REFERENCE_ROOT || '/home/b11/code/hiraia';
/** Uncommitted working state and built files. */
export const BUILD = process.env.TALA_PACKS_BUILD_DIR || resolve(PKG_ROOT, 'build');
export const WORK = resolve(BUILD, 'work');
export const ARTIFACTS = resolve(BUILD, 'artifacts');
export const CHROMIUM =
  process.env.TALA_PACKS_CHROMIUM ||
  '/home/b11/code/hiraia/build/browser-runtime-145/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell';
export const SOFFICE = process.env.TALA_PACKS_SOFFICE || '/home/b11/.local/bin/lo-soffice';
export const BRAND = resolve(REPO_ROOT, 'packages/brand/assets');
export const TALA_BRAND = resolve(REPO_ROOT, 'packages/tala/brand/assets');
export const PIPELINE_VERSION = 'tala-packs/1';
