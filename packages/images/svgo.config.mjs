/**
 * SVGO normalization for Hiraia assets.
 *
 * Turns Illustrator / other-editor output into the clean, inline-attribute
 * style the renderer expects. Crucially it removes <style>/class blocks: class
 * names like `.cls-1` are GLOBAL once assets are embedded in one scene, so two
 * AI-exported assets would collide and bleed colors into each other. Inlining
 * to presentation attributes makes every asset self-contained.
 *
 * Run:  pnpm --filter @hiraia/images normalize
 */
export default {
  multipass: true,
  js2svg: { indent: 2, pretty: true }, // keep files human-readable for hand-editing
  plugins: [
    'removeDoctype',
    'removeComments', // strips "Generator: Adobe Illustrator …"
    'removeEditorsNSData', // strips Adobe/Inkscape private namespaces (from Save As)
    { name: 'inlineStyles', params: { onlyMatchedOnce: false } }, // push .cls rules onto elements
    'convertStyleToAttrs', // style="fill:…" -> fill="…" presentation attributes
    'removeStyleElement', // drop the now-empty <style>
    'removeUselessDefs',
    'collapseGroups', // flatten editor "Layer_1" wrapper groups
    'removeEmptyContainers',
    'cleanupIds',
    'removeDimensions', // drop width/height, keep viewBox (what the loader reads)
  ],
};
