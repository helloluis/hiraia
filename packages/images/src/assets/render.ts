/**
 * Asset element renderer.
 *
 * Handles embedding curated SVG assets from the AssetLibrary into the
 * main scene SVG. Supports `asset` (single embed) and `compose` (multi-asset
 * layout) element types.
 */

import type {
  AssetElement,
  ComposeElement,
  SceneStyle,
  Element,
} from '../types.js';
import type { AssetLibrary } from './library.js';
import { renderElement } from '../elements/render.js';

/** Shared library instance — set via setAssetLibrary(). */
let library: AssetLibrary | undefined;

/** Register the global AssetLibrary for the renderer to use. */
export function setAssetLibrary(lib: AssetLibrary): void {
  library = lib;
}

/** Render an asset element by embedding its SVG content. */
export function renderAsset(
  el: AssetElement,
  sceneStyle: SceneStyle,
  rng: () => number,
  warnings: string[]
): string {
  if (!library) {
    warnings.push(`AssetLibrary not initialized. Call setAssetLibrary() before rendering asset elements.`);
    return '';
  }

  const loaded = library.get(el.assetId);
  if (!loaded) {
    warnings.push(`Asset not found: "${el.assetId}". Available: ${library.list().join(', ')}`);
    return '';
  }

  const scale = el.scale ?? 1;
  const opacity = el.style?.opacity ?? 1;
  const id = el.id ? ` id="${el.id}"` : '';

  // Parse viewBox to get original dimensions
  const vbParts = loaded.viewBox.split(/\s+/).map(Number);
  const vbX = vbParts[0] ?? 0;
  const vbY = vbParts[1] ?? 0;

  return `<g${id} transform="translate(${el.x}, ${el.y}) scale(${scale})" opacity="${opacity}">
    ${loaded.svgContent}
  </g>`;
}

/** Render a compose element by embedding multiple assets and overlays. */
export function renderCompose(
  el: ComposeElement,
  sceneStyle: SceneStyle,
  rng: () => number,
  warnings: string[]
): string {
  const parts: string[] = [];

  // Embed each asset
  for (const placement of el.assets) {
    const assetEl: AssetElement = {
      type: 'asset',
      assetId: placement.assetId,
      x: placement.x,
      y: placement.y,
      scale: placement.scale,
    };
    parts.push(renderAsset(assetEl, sceneStyle, rng, warnings));
  }

  // Render overlays (labels, arrows, annotations)
  if (el.overlays) {
    for (const overlay of el.overlays) {
      parts.push(renderElement(overlay, sceneStyle, rng, warnings));
    }
  }

  const id = el.id ? ` id="${el.id}"` : '';
  return `<g${id}>${parts.join('\n')}</g>`;
}

/** Check if an element is an asset type. */
export function isAsset(el: Element): boolean {
  return el.type === 'asset' || el.type === 'compose';
}
