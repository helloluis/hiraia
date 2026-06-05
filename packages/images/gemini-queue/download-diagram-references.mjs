import { writeFileSync, existsSync, readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const flaggedDir = join(PKG, 'assets-png', 'flagged');
const referencesDir = join(HERE, 'references');

if (!existsSync(referencesDir)) {
  mkdirSync(referencesDir, { recursive: true });
}

const HEADERS = {
  'User-Agent': 'HiraiaIllustrationBot/1.0 (luis@hiraia.org; contact at luis@hiraia.org) WebSearchService/1.0'
};

async function searchWiki(query) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srnamespace=6&format=json&origin=*`;
  try {
    const res = await fetch(url, { headers: HEADERS });
    const data = await res.json();
    return data.query?.search || [];
  } catch (err) {
    console.error(`Search error for query "${query}":`, err.message);
    return [];
  }
}

async function getImageUrl(fileTitle) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(fileTitle)}&prop=imageinfo&iiprop=url&format=json&origin=*`;
  try {
    const res = await fetch(url, { headers: HEADERS });
    const data = await res.json();
    const pages = data.query?.pages || {};
    for (const pageId in pages) {
      const page = pages[pageId];
      if (page.imageinfo && page.imageinfo[0]) {
        return page.imageinfo[0].url;
      }
    }
  } catch (err) {
    console.error(`URL retrieval error for "${fileTitle}":`, err.message);
  }
  return null;
}

// Function to verify if ID represents a diagram, process, or system
function isDiagramOrCycle(id, name) {
  const hay = `${id} ${name}`.toLowerCase();
  return (
    hay.includes('diagram') ||
    hay.includes('cycle') ||
    hay.includes('lifecycle') ||
    hay.includes('loop') ||
    hay.includes('transport') ||
    hay.includes('circuit') ||
    hay.includes('structure') ||
    hay.includes('scale') ||
    hay.includes('pyramid') ||
    hay.includes('hierarchy') ||
    hay.includes('chain') ||
    hay.includes('web') ||
    hay.includes('diffusion') ||
    hay.includes('metamorphosis') ||
    hay.includes('evaporation') ||
    hay.includes('homeostasis') ||
    hay.includes('respiration') ||
    hay.includes('photosynthesis') ||
    hay.includes('transcription') ||
    hay.includes('translation') ||
    hay.includes('germination') ||
    hay.includes('cell') ||
    hay.includes('star') ||
    hay.includes('dichotomous') ||
    hay.includes('organelle') ||
    hay.includes('blood') ||
    hay.includes('model') ||
    hay.includes('factors') ||
    hay.includes('chart')
  );
}

async function downloadImage(url, destPath) {
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    writeFileSync(destPath, buffer);
    return true;
  } catch (err) {
    console.error(`Download failed for ${url}:`, err.message);
    return false;
  }
}

async function main() {
  if (!existsSync(flaggedDir)) {
    console.error('flagged folder not found.');
    process.exit(1);
  }

  const flaggedFiles = readdirSync(flaggedDir).filter(f => f.endsWith('.png'));
  const flaggedIds = flaggedFiles.map(f => f.substring(0, f.length - 4));
  console.log(`Scanning ${flaggedIds.length} flagged illustrations...`);

  // Load name mappings from prompts JSON files
  const promptsDir = join(HERE, 'prompts');
  const topicFiles = readdirSync(promptsDir).filter(f => f.endsWith('.json'));
  const nameMap = new Map();

  for (const topicFile of topicFiles) {
    const data = JSON.parse(readFileSync(join(promptsDir, topicFile), 'utf8'));
    for (const img of data.images) {
      nameMap.set(img.id, img.name);
    }
  }

  let downloadCount = 0;

  for (const id of flaggedIds) {
    const name = nameMap.get(id) || id.replace(/-/g, ' ');
    if (!isDiagramOrCycle(id, name)) {
      continue; // Skip scenes/objects that aren't diagrams
    }

    // Check if reference already exists
    const formats = ['.png', '.jpg', '.jpeg'];
    let alreadyExists = false;
    for (const fmt of formats) {
      if (existsSync(join(referencesDir, `${id}${fmt}`))) {
        alreadyExists = true;
        break;
      }
    }
    if (alreadyExists) {
      console.log(`[EXISTING] Reference already exists for ${id}`);
      continue;
    }

    console.log(`\n[DIAGRAM] Searching reference for: "${id}" (${name})...`);
    
    // Construct queries
    const queries = [
      `${name} diagram png`,
      `${name} png`,
      `${id.replace(/-/g, ' ')} png`,
      name,
      id.replace(/-/g, ' ')
    ];

    let found = false;

    for (const query of queries) {
      const results = await searchWiki(query);
      
      // Look for a suitable result (PNG or JPG)
      const suitable = results.find(r => {
        const title = r.title.toLowerCase();
        return title.endsWith('.png') || title.endsWith('.jpg') || title.endsWith('.jpeg');
      });

      if (suitable) {
        const fileTitle = suitable.title;
        const imgUrl = await getImageUrl(fileTitle);
        if (imgUrl) {
          const ext = fileTitle.split('.').pop().toLowerCase();
          const destPath = join(referencesDir, `${id}.${ext}`);
          console.log(`  -> Found: ${fileTitle}`);
          console.log(`  -> Downloading: ${imgUrl}`);
          const ok = await downloadImage(imgUrl, destPath);
          if (ok) {
            console.log(`  -> Success! Saved as references/${id}.${ext}`);
            downloadCount++;
            found = true;
            break;
          }
        }
      }
    }

    if (!found) {
      console.warn(`  -> WARNING: No suitable reference found for "${id}"`);
    }

    // Wait a brief moment to avoid hammer rate-limits on Wiki
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n========================================`);
  console.log(`Completed! Downloaded ${downloadCount} reference diagrams.`);
  console.log(`========================================`);
}

main().catch(err => console.error(err));
