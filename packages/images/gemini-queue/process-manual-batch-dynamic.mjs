import sharp from 'sharp';
import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync, lstatSync, readlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMG_DIR = join(HERE, '..');
const MANUAL_DIR = join(IMG_DIR, 'assets-png/manually-generated');
const FLAGGED_DIR = join(IMG_DIR, 'assets-png/flagged');
const QC_PROGRESS_PATH = join(HERE, 'qc-progress.json');

const manualFiles = readdirSync(MANUAL_DIR).filter(f => !f.startsWith('.'));
const flaggedFiles = readdirSync(FLAGGED_DIR).filter(f => !f.startsWith('.'));

// Build flagged map
const flaggedMap = {};
for (const file of flaggedFiles) {
  const fullPath = join(FLAGGED_DIR, file);
  if (lstatSync(fullPath).isSymbolicLink()) {
    const target = readlinkSync(fullPath); // e.g. ../biology/punnett-square.png
    // Extract target category (e.g. biology) and filename
    const parts = target.split('/');
    const category = parts[parts.length - 2];
    const name = parts[parts.length - 1];
    const id = name.replace(/\.png$/, '');
    flaggedMap[file] = { category, name, id };
  }
}

// Function to map manual filename to flagged filename
function getFlaggedMatch(filename) {
  const mfLower = filename.toLowerCase();
  
  // Direct matches
  for (const ff of flaggedFiles) {
    const ffNoExt = ff.replace(/\.[^/.]+$/, '');
    const mfNoExt = filename.replace(/\.[^/.]+$/, '');
    if (ffNoExt === mfNoExt) return ff;
  }
  
  // Fuzzy rules
  if (mfLower.includes('bougainvillea')) return 'incomplete-dominance-bougainvillea.png';
  if (mfLower.includes('brake-pedal')) return 'jeepney-brake-pedal-lever.png';
  if (mfLower.includes('butterfly')) return 'lifecycle-butterfly.png';
  if (mfLower.includes('cicada')) return 'cicada-molt-shell.png';
  if (mfLower.includes('cloud')) return 'cloud-types-chart.png';
  if (mfLower.includes('drift')) return 'continental-drift-pangaea.png';
  if (mfLower.includes('dengue')) return 'mosquito-borne-illness-prevention.png';
  if (mfLower.includes('element')) return 'periodic-table-cell.png';
  if (mfLower.includes('evacuation-drill')) return 'fire-drill-evacuation.png';
  if (mfLower.includes('flag-ceremony')) return 'school-flag-ceremony-morning.png';
  if (mfLower.includes('food-chain')) return 'food-chain-generic.png';
  if (mfLower.includes('posture')) return 'good-vs-slouch-posture-sitting.png';
  if (mfLower.includes('goosebumps')) return 'goosebumps-skin-cold.png';
  if (mfLower.includes('snacks')) return 'healthy-vs-unhealthy-snacks.png';
  if (mfLower.includes('limbs')) return 'homologous-limbs-comparison.png';
  if (mfLower.includes('eye-sees')) return 'how-eye-sees-light.png';
  if (mfLower.includes('jeepney-with-vendor')) return 'vendors-at-jeepney-stop-scene.png';
  if (mfLower.includes('tinik')) return 'kids-playing-luksong-tinik-scene.png';
  if (mfLower.includes('circuit')) return 'build-simple-circuit-hands-on.png';
  if (mfLower.includes('vacuole')) return 'vacuole-plant-cell-closeup.png';
  if (mfLower.includes('punnett')) return 'punnett-square.png';
  if (mfLower.includes('seed')) return 'germination-cup-row-conditions.png';
  if (mfLower.includes('star')) return 'life-cycle-of-a-star.png';
  if (mfLower.includes('stomata')) return 'guard-cells-stomata.png';
  if (mfLower.includes('walo')) return 'sea-snake-walo-walo.png';
  if (mfLower.includes('pulse')) return 'heartbeat-pulse-wrist.png';
  if (mfLower.includes('yoyo')) return 'yoyo-energy-transformation.png';

  return null;
}

async function processImage(manualFile) {
  const flaggedName = getFlaggedMatch(manualFile);
  if (!flaggedName || !flaggedMap[flaggedName]) {
    console.error(`Could not map file: ${manualFile}`);
    return null;
  }
  
  const { category, name: destName, id } = flaggedMap[flaggedName];
  const srcPath = join(MANUAL_DIR, manualFile);
  const destPath = join(IMG_DIR, 'assets-png', category, destName);
  const flaggedPath = join(FLAGGED_DIR, flaggedName);

  console.log(`Processing ${manualFile} -> ${category}/${destName} (ID: ${id})`);

  try {
    const buf = await sharp(srcPath)
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .linear(1.28, -38)
      .png({ palette: true, colours: 16, effort: 10, compressionLevel: 9 })
      .toBuffer();

    writeFileSync(destPath, buf);
    console.log(`  Saved optimized PNG (${Math.round(buf.length / 1024)} KB)`);

    if (existsSync(flaggedPath)) {
      unlinkSync(flaggedPath);
      console.log(`  Deleted flagged copy/symlink: ${flaggedPath}`);
    }

    unlinkSync(srcPath);
    console.log(`  Deleted source manual file: ${srcPath}`);

    return id;
  } catch (err) {
    console.error(`  Failed to process ${manualFile}:`, err);
    return null;
  }
}

async function main() {
  const processedIds = [];
  
  for (const file of manualFiles) {
    const id = await processImage(file);
    if (id) processedIds.push(id);
  }
  
  if (processedIds.length > 0) {
    console.log(`Successfully processed ${processedIds.length} images. Updating qc-progress.json...`);
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
    }
  } else {
    console.log('No images were processed.');
  }
}

main().catch(console.error);
