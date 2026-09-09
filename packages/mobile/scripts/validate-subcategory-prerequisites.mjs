import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mobile = path.resolve(here, '..');
const taxonomyPath = path.resolve(mobile, '../../rag/pipeline/deped-taxonomy.json');
const mapPath = path.resolve(mobile, 'src/data/subcategoryPrerequisites.json');

const taxonomy = JSON.parse(fs.readFileSync(taxonomyPath, 'utf8'));
const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const leaves = new Map(taxonomy.leaves.map((leaf) => [leaf.id, leaf]));
const targets = taxonomy.leaves.filter((leaf) => leaf.grade > 3);
const mobileIndex = JSON.parse(
  fs.readFileSync(path.resolve(mobile, 'src/generated/cardsIndex.generated.json'), 'utf8')
);
const mobileTaxonomyIds = new Set((mobileIndex.taxonomy ?? []).map((leaf) => leaf.id));

assert.equal(map.scheme, 'hiraia-subcategory-prerequisites/v1');
assert.deepEqual(
  new Set(Object.keys(map.links)),
  new Set(targets.map((leaf) => leaf.id)),
  'Every Grade 4–10 subcategory must have one prerequisite entry'
);
assert.deepEqual(
  new Set(Object.keys(map.provenance)),
  new Set(Object.keys(map.links)),
  'Every link must record how it was selected'
);

for (const [targetId, prerequisiteIds] of Object.entries(map.links)) {
  const target = leaves.get(targetId);
  assert(target, `Unknown target ${targetId}`);
  assert(Array.isArray(prerequisiteIds) && prerequisiteIds.length > 0, `${targetId} has no prerequisite`);
  assert.equal(new Set(prerequisiteIds).size, prerequisiteIds.length, `${targetId} repeats a prerequisite`);
  for (const prerequisiteId of prerequisiteIds) {
    const prerequisite = leaves.get(prerequisiteId);
    assert(prerequisite, `${targetId} points to unknown ${prerequisiteId}`);
    assert.equal(prerequisite.strand, target.strand, `${targetId} crosses science strands`);
    assert(
      prerequisite.grade < target.grade,
      `${targetId} points to Grade ${prerequisite.grade}, which is not below Grade ${target.grade}`
    );
  }
}

for (const id of leaves.keys()) {
  assert(mobileTaxonomyIds.has(id), `Generated mobile taxonomy is missing ${id}`);
}

console.log(
  `Validated ${Object.keys(map.links).length} prerequisite mappings across ${taxonomy.parents.length} strands.`
);
