import assert from 'node:assert/strict';
import { test } from 'node:test';
import cardsIndex from '../src/generated/cardsIndex.generated.json';
import {
  populatedPrerequisite,
  prerequisitesForSubcategory,
  subcategoriesForCard,
  subcategoryGrade,
} from '../src/data/subcategoryRegression';

test('an advanced subcategory resolves to an earlier-grade populated shelf', () => {
  const target = 'g9-matter-ionic-bonds';
  assert.deepEqual(prerequisitesForSubcategory(target), ['g8-matter-electron-configurations']);
  const resolved = populatedPrerequisite(target, 1);
  assert(resolved);
  assert(resolved.cardIds.length > 0);
  assert(resolved.grade < 9);
});

test('Grade 3 foundations do not regress', () => {
  assert.deepEqual(prerequisitesForSubcategory('g3-matter-states-of-matter'), []);
  assert.equal(populatedPrerequisite('g3-matter-states-of-matter'), null);
});

test('card lookup ignores generic browsing categories and stays grade-local', () => {
  const card = (cardsIndex.cards as { id: string; cats?: string[] }[]).find((candidate) =>
    candidate.cats?.some((id) => subcategoryGrade(id) === 5)
  );
  assert(card);
  const categories = subcategoriesForCard(card, 5);
  assert(categories.length > 0);
  assert(categories.every((id) => subcategoryGrade(id) === 5));
});
