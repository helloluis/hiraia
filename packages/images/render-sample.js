import { readFileSync, writeFileSync } from 'fs';
import { renderScene } from './src/renderer.js';

const inputFile = process.argv[2];
if (!inputFile) {
  console.error('Usage: node render-sample.js <scene.json>');
  process.exit(1);
}

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
