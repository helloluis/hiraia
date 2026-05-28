import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { renderScene, AssetLibrary, setAssetLibrary } from './src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const inputFile = process.argv[2];
if (!inputFile) {
  console.error('Usage: node render-hybrid.js <scene.json>');
  process.exit(1);
}

// Load asset library
const assetsDir = join(__dirname, 'assets');
const library = new AssetLibrary();
await library.load(assetsDir);
setAssetLibrary(library);

console.log(`Loaded ${library.size} assets from library`);

// Render scene
const scene = JSON.parse(readFileSync(inputFile, 'utf-8'));
const result = renderScene(scene);

const outputFile = inputFile.replace('.json', '.svg');
writeFileSync(outputFile, result.svg);

console.log(`Rendered ${inputFile} -> ${outputFile}`);
console.log(`  Elements: ${result.elementCount}`);
console.log(`  Time: ${result.renderTimeMs.toFixed(2)}ms`);
if (result.warnings.length > 0) {
  console.log(`  Warnings: ${result.warnings.join(', ')}`);
}
