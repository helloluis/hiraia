import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const promptsDir = join(HERE, 'prompts');

async function main() {
  const flaggedPromptsPath = join(HERE, 'flagged-prompts.json');
  const qcProgressPath = join(HERE, 'qc-progress.json');

  if (!existsSync(flaggedPromptsPath) || !existsSync(qcProgressPath)) {
    console.error('Required JSON files not found.');
    process.exit(1);
  }

  const flaggedList = JSON.parse(readFileSync(flaggedPromptsPath, 'utf8'));
  const qcProgress = JSON.parse(readFileSync(qcProgressPath, 'utf8'));

  const flaggedIds = new Set(flaggedList.map(img => img.id));
  console.log(`Processing ${flaggedIds.size} flagged images...`);

  // Load all topic prompt files
  const topicFiles = readdirSync(promptsDir).filter(f => f.endsWith('.json'));

  let updateCount = 0;

  for (const topicFile of topicFiles) {
    const topicPath = join(promptsDir, topicFile);
    const data = JSON.parse(readFileSync(topicPath, 'utf8'));
    let modified = false;

    for (const img of data.images) {
      if (flaggedIds.has(img.id)) {
        let prompt = img.prompt;

        // 1. Remove terms that cause literal "drawing hand" interpretation
        prompt = prompt.replace(/hand-drawn picture of/gi, 'sketch of');
        prompt = prompt.replace(/hand-drawn line illustration/gi, 'line-art sketch');

        // 2. Inject anti-hand/anti-pencil constraints
        const antiHandConstraint = "Do NOT show any human hand, fingers, pencil, pen, paintbrush, artist's desk, or drawing artifacts in the image; the illustration must contain only the subject itself.";
        
        if (!prompt.includes("Do NOT show any human hand")) {
          // Replace standard end clause
          const textClause = "No text, letters, numbers, or labels anywhere in the image.";
          if (prompt.includes(textClause)) {
            prompt = prompt.replace(textClause, `Absolutely no text, letters, numbers, or labels anywhere in the image. ${antiHandConstraint}`);
          } else {
            prompt = prompt + " " + antiHandConstraint;
          }
        }

        // 3. Analyze QC reasons and add target corrections
        const progressInfo = qcProgress[img.id];
        const reasons = (progressInfo && progressInfo.reasons) || [];
        const additions = [];

        for (const reason of reasons) {
          const lowerReason = reason.toLowerCase();

          // Hand anatomy
          if (lowerReason.includes('finger') || lowerReason.includes('digit') || lowerReason.includes('anatomy') || lowerReason.includes('hand on the')) {
            if (!prompt.includes("five fingers")) {
              additions.push("Ensure all human hands in the scene are drawn with correct anatomy, showing exactly five fingers and realistic joints.");
            }
          }
          // Text / Labels
          if (lowerReason.includes('text') || lowerReason.includes('label') || lowerReason.includes('word') || lowerReason.includes('sign') || lowerReason.includes('banner')) {
            if (!prompt.includes("Strictly avoid")) {
              additions.push("Strictly avoid drawing any text, letters, words, signage, or labels on objects or in the background.");
            }
          }
          // Border / Frame
          if (lowerReason.includes('border') || lowerReason.includes('frame') || lowerReason.includes('margin line') || lowerReason.includes('contour')) {
            if (!prompt.includes("border or frame")) {
              additions.push("Do NOT draw any border, frame, or boundary lines around the margins of the square image.");
            }
          }
          // Gray fills / Gradients
          if (lowerReason.includes('gray') || lowerReason.includes('gradient') || lowerReason.includes('shading') || lowerReason.includes('stippling')) {
            if (!prompt.includes("clean black ink lines")) {
              additions.push("Use only clean black ink lines on a solid white background. Do NOT use smooth gray gradients, stippling dot patterns, or solid gray fills.");
            }
          }
          // Arrows direction
          if (lowerReason.includes('arrow')) {
            if (!prompt.includes("correct direction")) {
              additions.push("Ensure all arrows are simple, clear, and point in the correct logical direction.");
            }
          }
          // Physics/Floating
          if (lowerReason.includes('float') || lowerReason.includes('physics') || lowerReason.includes('impossible')) {
            if (!prompt.includes("grounded")) {
              additions.push("Ensure realistic physics; objects and characters must be grounded logically on the surface, not floating in mid-air.");
            }
          }
        }

        if (additions.length > 0) {
          prompt = prompt + " " + additions.join(" ");
        }

        img.prompt = prompt;
        img.status = 'todo'; // Queue for remake
        updateCount++;
        modified = true;
      }
    }

    if (modified) {
      writeFileSync(topicPath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`Updated flagged prompts in ${topicFile}`);
    }
  }

  console.log(`Successfully refined and queued ${updateCount} prompts.`);
}

main().catch(err => {
  console.error(err);
});
