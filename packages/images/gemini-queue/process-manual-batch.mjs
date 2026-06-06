import sharp from 'sharp';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMG_DIR = join(HERE, '..');
const MANUAL_DIR = join(IMG_DIR, 'assets-png/manually-generated');
const FLAGGED_DIR = join(IMG_DIR, 'assets-png/flagged');
const QC_PROGRESS_PATH = join(HERE, 'qc-progress.json');

const itemsToProcess = [
  {
    manualFile: 'balut-roadside',
    destCategory: 'general',
    destName: 'balut-eating-roadside-scene.png',
    id: 'balut-eating-roadside-scene'
  },
  {
    manualFile: 'chicken-life-cycle.jpeg',
    destCategory: 'biology',
    destName: 'lifecycle-chicken.png',
    id: 'lifecycle-chicken'
  },
  {
    manualFile: 'coral-life-cycle',
    destCategory: 'biology',
    destName: 'lifecycle-coral-polyp.png',
    id: 'lifecycle-coral-polyp'
  },
  {
    manualFile: 'dragonfly-life-cycle.jpeg',
    destCategory: 'biology',
    destName: 'lifecycle-dragonfly.png',
    id: 'lifecycle-dragonfly'
  },
  {
    manualFile: 'fish-life-cycle',
    destCategory: 'biology',
    destName: 'lifecycle-fish.png',
    id: 'lifecycle-fish'
  },
  {
    manualFile: 'frog-life-cycle.jpeg',
    destCategory: 'biology',
    destName: 'lifecycle-frog.png',
    id: 'lifecycle-frog'
  },
  {
    manualFile: 'hand-tractor',
    destCategory: 'general',
    destName: 'kuliglig-hand-tractor-cart-scene.png',
    id: 'kuliglig-hand-tractor-cart-scene'
  },
  {
    manualFile: 'mangrove-life-cycle.jpeg',
    destCategory: 'biology',
    destName: 'lifecycle-mangrove-propagule.png',
    id: 'lifecycle-mangrove-propagule'
  },
  {
    manualFile: 'mosquito-life-cycle.jpeg',
    destCategory: 'biology',
    destName: 'lifecycle-mosquito.png',
    id: 'lifecycle-mosquito'
  },
  {
    manualFile: 'puddle-evaporation.jpeg',
    destCategory: 'chemistry',
    destName: 'evaporation-puddle-drying.png',
    id: 'evaporation-puddle-drying'
  },
  {
    manualFile: 'rice-life-cycle.jpeg',
    destCategory: 'biology',
    destName: 'lifecycle-rice-plant.png',
    id: 'lifecycle-rice-plant'
  },
  {
    manualFile: 'safe-drinking-water',
    destCategory: 'biology',
    destName: 'clean-water-drinking-safe.png',
    id: 'clean-water-drinking-safe'
  },
  {
    manualFile: 'snail-life-cycle',
    destCategory: 'biology',
    destName: 'lifecycle-snail.png',
    id: 'lifecycle-snail'
  },
  {
    manualFile: 'tricycle.jpeg',
    destCategory: 'general',
    destName: 'tricycle-front-parked.png',
    id: 'tricycle-front-parked'
  },
  {
    manualFile: 'tuba-coconut-sap',
    destCategory: 'general',
    destName: 'tuba-gatherer-coconut-scene.png',
    id: 'tuba-gatherer-coconut-scene'
  }
];

async function processImage({ manualFile, destCategory, destName, id }) {
  const srcPath = join(MANUAL_DIR, manualFile);
  const destPath = join(IMG_DIR, 'assets-png', destCategory, destName);

  if (!existsSync(srcPath)) {
    console.error(`Source file not found: ${srcPath}`);
    return false;
  }

  console.log(`Processing ${manualFile} -> ${destCategory}/${destName} (ID: ${id})`);

  try {
    const buf = await sharp(srcPath)
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .linear(1.28, -38)
      .png({ palette: true, colours: 16, effort: 10, compressionLevel: 9 })
      .toBuffer();

    writeFileSync(destPath, buf);
    console.log(`Saved optimized PNG to ${destPath} (${Math.round(buf.length / 1024)} KB)`);

    // Remove from flagged if it exists
    const flaggedPath = join(FLAGGED_DIR, destName);
    if (existsSync(flaggedPath)) {
      unlinkSync(flaggedPath);
      console.log(`Deleted flagged copy/symlink: ${flaggedPath}`);
    }

    // Delete the manual source file to clean up
    unlinkSync(srcPath);
    console.log(`Deleted source manual file: ${srcPath}`);

    return true;
  } catch (err) {
    console.error(`Failed to process ${manualFile}:`, err);
    return false;
  }
}

async function main() {
  let processedCount = 0;
  const processedIds = [];

  for (const item of itemsToProcess) {
    const success = await processImage(item);
    if (success) {
      processedCount++;
      processedIds.push(item.id);
    }
  }

  if (processedCount > 0) {
    console.log(`Successfully processed ${processedCount} images. Updating qc-progress.json...`);
    if (existsSync(QC_PROGRESS_PATH)) {
      const qcData = JSON.parse(readFileSync(QC_PROGRESS_PATH, 'utf8'));
      const timestamp = new Date().toISOString();
      for (const id of processedIds) {
        qcData[id] = {
          needs_remake: false,
          reasons: [],
          timestamp
        };
      }
      writeFileSync(QC_PROGRESS_PATH, JSON.stringify(qcData, null, 2), 'utf8');
      console.log(`Updated qc-progress.json for: ${processedIds.join(', ')}`);
    } else {
      console.error(`qc-progress.json not found at ${QC_PROGRESS_PATH}`);
    }
  } else {
    console.log('No images were processed.');
  }
}

main().catch(console.error);
