/**
 * Main SVG renderer pipeline.
 *
 * Takes a Scene DSL object and produces a complete SVG string with
 * hand-drawn effects applied. This is the entry point for the rendering system.
 */

import type { Scene, RenderResult, Element } from './types.js';
import { createRng } from './effects/rough.js';
import { renderElement } from './elements/render.js';
import { isFigure, renderFigure } from './figures/render.js';
import { isAsset, renderAsset, renderCompose } from './assets/render.js';

/** Default scene style values. */
const DEFAULT_STYLE = {
  background: '#ffffff',
  stroke: '#000000',
  fill: 'none',
  strokeWidth: 1.5,
  fontSize: 14,
  fontFamily: 'Comic Sans MS, cursive',
  roughness: 1.2,
};

/** Validate a Scene object and return any validation errors. */
function validateScene(scene: Scene): string[] {
  const errors: string[] = [];

  if (scene.version !== 1) {
    errors.push(`Unsupported version: ${scene.version}. Expected 1.`);
  }

  if (typeof scene.width !== 'number' || scene.width <= 0) {
    errors.push(`Invalid width: ${scene.width}. Must be a positive number.`);
  }

  if (typeof scene.height !== 'number' || scene.height <= 0) {
    errors.push(`Invalid height: ${scene.height}. Must be a positive number.`);
  }

  if (!Array.isArray(scene.elements)) {
    errors.push('elements must be an array.');
  }

  return errors;
}

/** Count total elements in a scene (including nested elements in groups). */
function countElements(elements: Element[]): number {
  let count = 0;
  for (const el of elements) {
    count++;
    if (el.type === 'group') {
      count += countElements(el.children);
    }
  }
  return count;
}

/**
 * Render a Scene DSL object to SVG.
 *
 * @param scene - The scene description in DSL format
 * @param seed - Optional seed for deterministic randomness (default: 42)
 * @returns RenderResult containing the SVG string and metadata
 */
export function renderScene(scene: Scene, seed = 42): RenderResult {
  const startTime = performance.now();
  const warnings: string[] = [];

  const validationErrors = validateScene(scene);
  if (validationErrors.length > 0) {
    throw new Error(`Scene validation failed:\n${validationErrors.join('\n')}`);
  }

  const style = { ...DEFAULT_STYLE, ...scene.style };
  const rng = createRng(seed);

  const elementCount = countElements(scene.elements);

  // Reserve vertical bands for title and caption outside the user's drawing area.
  // Element coordinates stay exactly as authored — the drawing group is simply
  // shifted down by titlePad so it never overlaps title or caption.
  const TITLE_FONT_SIZE = 18;
  const CAPTION_FONT_SIZE = 12;
  const TITLE_PAD = 35; // font + top/bottom whitespace
  const CAPTION_PAD = 28;
  const EDGE_MARGIN = 8;

  const titlePad = scene.title ? TITLE_PAD : 0;
  const captionPad = scene.caption ? CAPTION_PAD : 0;

  const totalHeight = titlePad + scene.height + captionPad;

  const renderedElements: string[] = [];

  for (const el of scene.elements) {
    if (el.type.startsWith('figure:')) {
      renderedElements.push(renderFigure(el, style, rng, warnings));
    } else if (el.type === 'asset') {
      renderedElements.push(renderAsset(el, style, rng, warnings));
    } else if (el.type === 'compose') {
      renderedElements.push(renderCompose(el, style, rng, warnings));
    } else {
      renderedElements.push(renderElement(el, style, rng, warnings));
    }
  }

  const titleElement = scene.title
    ? `<text x="${scene.width / 2}" y="${titlePad - 10}" text-anchor="middle" font-size="${TITLE_FONT_SIZE}" font-weight="bold" font-family="${style.fontFamily}">${escapeXml(scene.title)}</text>`
    : '';

  const captionElement = scene.caption
    ? `<text x="${scene.width / 2}" y="${titlePad + scene.height + 18}" text-anchor="middle" font-size="${CAPTION_FONT_SIZE}" font-family="${style.fontFamily}" fill="#666">${escapeXml(scene.caption)}</text>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${totalHeight}" width="${scene.width}" height="${totalHeight}">
  <rect width="${scene.width}" height="${totalHeight}" fill="${style.background}"/>
  ${titleElement}
  <g transform="translate(0, ${titlePad})">
    ${renderedElements.join('\n    ')}
  </g>
  ${captionElement}
</svg>`;

  const renderTimeMs = performance.now() - startTime;

  return {
    svg,
    renderTimeMs,
    elementCount,
    warnings,
  };
}

/** Escape special characters for XML/SVG text content. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
