/**
 * @hiraia/images
 *
 * XKCD-style hand-drawn SVG renderer for the Hiraia AI tutor.
 *
 * This package provides a drawing DSL that the LLM can output as JSON,
 * which is then rendered to SVG with a sketchy, hand-drawn aesthetic.
 *
 * Usage:
 * ```typescript
 * import { renderScene, AssetLibrary } from '@hiraia/images';
 *
 * // Load the asset library
 * const library = new AssetLibrary();
 * await library.load('./assets');
 * setAssetLibrary(library);
 *
 * const scene = {
 *   version: 1,
 *   width: 300,
 *   height: 200,
 *   elements: [
 *     { type: 'circle', cx: 150, cy: 100, r: 40, style: { fill: '#ff0000' } }
 *   ]
 * };
 *
 * const result = renderScene(scene);
 * console.log(result.svg);
 * ```
 */

export * from './types.js';
export * from './renderer.js';
export * from './assets/types.js';
export * from './assets/library.js';
export { setAssetLibrary } from './assets/render.js';
export * from './retrieval/embeddings.js';
