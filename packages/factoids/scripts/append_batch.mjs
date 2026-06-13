import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const factoidsFile = '/Users/luis/Code/hiraia/packages/factoids/bank/factoids.json';
const imagesFile = '/Users/luis/Code/hiraia/packages/images/index.json';

export function appendBatch(newFactoids) {
  // 1. Read files
  const data = JSON.parse(readFileSync(factoidsFile, 'utf8'));
  const imageData = JSON.parse(readFileSync(imagesFile, 'utf8'));

  const existingIds = new Set(data.factoids.map(f => f.id));
  const validImageIds = new Set(imageData.assets.map(a => a.id));

  // 2. Validate batch
  const errors = [];
  const addedIds = new Set();

  newFactoids.forEach((f, index) => {
    const context = f.id || `index ${index}`;
    if (!f.id) errors.push(`Factoid at index ${index} is missing 'id'.`);
    if (existingIds.has(f.id)) errors.push(`ID '${f.id}' already exists in the bank.`);
    if (addedIds.has(f.id)) errors.push(`Duplicate ID '${f.id}' within the new batch.`);
    if (f.id) addedIds.add(f.id);

    if (f.imageId && !validImageIds.has(f.imageId)) {
      errors.push(`[${context}] imageId '${f.imageId}' does not exist in index.json.`);
    }

    if (!f.subject) errors.push(`[${context}] is missing 'subject'.`);
    const validSubjects = ['biology', 'chemistry', 'physics', 'earth-science', 'general'];
    if (f.subject && !validSubjects.includes(f.subject)) {
      errors.push(`[${context}] subject '${f.subject}' is invalid. Must be one of: ${validSubjects.join(', ')}`);
    }

    const hasTl = f.hook && f.hook.tl && f.body && f.body.tl;
    const hasCeb = f.hook && f.hook.ceb && f.body && f.body.ceb;
    if (!hasTl && !hasCeb) {
      errors.push(`[${context}] must have both hook and body in 'tl' or both in 'ceb'.`);
    }
    if (f.hook && !f.hook.en) {
      errors.push(`[${context}] is missing 'en' in hook.`);
    }
    if (f.body && !f.body.en) {
      errors.push(`[${context}] is missing 'en' in body.`);
    }

    if (f.hook && f.hook.tl && (f.hook.tl.startsWith('Alam mo ba na') || f.hook.tl.endsWith('?'))) {
      errors.push(`[${context}] Hook should not contain "Alam mo ba na" or end with "?"`);
    }
    if (f.hook && f.hook.ceb && (f.hook.ceb.startsWith('Nahibaw-an ba nimo') || f.hook.ceb.endsWith('?'))) {
      errors.push(`[${context}] Bisaya Hook should not contain "Nahibaw-an ba nimo" or end with "?"`);
    }

    if (!Array.isArray(f.grades)) errors.push(`[${context}] 'grades' must be an array.`);
    if (!Array.isArray(f.tags)) errors.push(`[${context}] 'tags' must be an array.`);
    if (!f.source) errors.push(`[${context}] is missing 'source'.`);
    if (f.verified !== false) errors.push(`[${context}] 'verified' must be false.`);
    if (f.verifiedBy !== null) errors.push(`[${context}] 'verifiedBy' must be null.`);
    if (f.verifiedAt !== null) errors.push(`[${context}] 'verifiedAt' must be null.`);
  });

  if (errors.length > 0) {
    console.error('Validation failed with the following errors:');
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }

  // 3. Append and write back
  data.factoids.push(...newFactoids);
  data.count = data.factoids.length;
  data.builtAt = new Date().toISOString();

  writeFileSync(factoidsFile, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Successfully appended ${newFactoids.length} factoids. Total count is now ${data.count}.`);
}
