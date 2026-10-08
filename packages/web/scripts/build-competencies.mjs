#!/usr/bin/env node
/**
 * Publish a compact view of the SAME authored lessons shown by CurriculumSheet.
 * No card prose, embeddings, broad tagging, APK databases or mobile runtime enter
 * the website. Sources are read at build time; only this small catalogue ships.
 *
 * Run `pnpm competencies:generate` after a curriculum/content rebuild. Web builds
 * run the read-only `--check` mode and refuse an out-of-date catalogue.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const OUTPUT = resolve(ROOT, 'packages/web/public/competencies/ph-revised-k12.json');
const inputs = new Map();
const read = (path) => {
  const absolute = resolve(ROOT, path);
  const bytes = readFileSync(absolute);
  inputs.set(relative(ROOT, absolute), createHash('sha256').update(bytes).digest('hex'));
  return bytes.toString('utf8');
};
const json = (path) => JSON.parse(read(path));
const source = (path) => ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
const tags = json('packages/mobile/src/generated/curriculumTags.generated.json');
const relatedCodes = (id) => tags[id]?.[5] ?? (tags[id] ? [tags[id][0]] : []);
const schedule = json('packages/shared/src/curriculum/three-term-2026.json');
// Keep the focused editorial decisions in catalogue provenance as well as their
// compiled manifests. Counts indicate available material, not demonstrated mastery.
read('rag/pipeline/term2-pilot-review.json');
read('rag/pipeline/pilot-content-corrections.json');
read('rag/pipeline/full-year-review.json');
read('rag/pipeline/full-year-review-lock.json');
read('rag/pipeline/lesson-examples-review.json');
for (const source of schedule.sources) {
  read(source.referenceFile);
  assert.equal(
    inputs.get(source.referenceFile),
    source.sha256,
    `Reference PDF changed: ${source.referenceFile}`
  );
}

const schedulerSource = read('packages/shared/src/curriculum/scheduleLessons.ts');
const { scheduleLessons } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(
      ts.transpileModule(schedulerSource, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText
    ).toString('base64')
);

// Read literal configuration through TypeScript's parser, not source-text regexes.
// Fail when its shape changes: guessing a default could overstate public coverage.
function literal(node) {
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return literal(node.expression);
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node)) {
    return Object.fromEntries(
      node.properties.map((property) => {
        assert(ts.isPropertyAssignment(property), 'Expected a literal configuration property');
        return [property.name.text, literal(property.initializer)];
      })
    );
  }
  throw new Error(`Expected literal configuration, got ${ts.SyntaxKind[node.kind]}`);
}
function variable(file, name) {
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const declaration = statement.declarationList.declarations.find(
      (entry) => entry.name.getText(file) === name
    );
    if (declaration?.initializer) return literal(declaration.initializer);
  }
  throw new Error(`${file.fileName} has no literal ${name}`);
}
function importedJson(file, matches) {
  return file.statements
    .filter(
      (statement) =>
        ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
    )
    .map((statement) => statement.moduleSpecifier.text)
    .filter(matches)
    .map((path) => json(resolve(ROOT, dirname(file.fileName), path)));
}

const plan = source('packages/mobile/src/data/lessonPlan.ts');
const grades = variable(plan, 'auditedGrades');
const manifests = new Map(
  importedJson(plan, (path) => /grade\d+Lessons\.generated\.json$/.test(path)).map((manifest) => [
    manifest.grade,
    manifest,
  ])
);
const minimumCards = variable(source('packages/mobile/src/data/cards.ts'), 'TOPIC_MIN_CARDS');
const domains = source('packages/shared/src/curriculum/index.ts');
const domainMap = variable(domains, 'GRADE_DOMAIN_MAP');
const domainNames = variable(domains, 'DOMAIN_NAMES');
const index = json('packages/mobile/src/generated/cardsIndex.generated.json');
const supplement = source('packages/mobile/src/data/lessonSupplement.ts');
const supplements = importedJson(supplement, (path) => /LessonSupplement\.json$/.test(path));
const cards = new Map(
  [...index.cards, ...supplements.flatMap((item) => item.cards)].map((card) => [card.id, card])
);
const questionFactIds = new Set([
  ...index.questionFactIds,
  ...supplements.flatMap((item) => Object.keys(item.questions)),
]);
const guidePaths = [
  'rag/sources/curriculum-guides/matatag-elementary-competencies.json',
  'rag/sources/curriculum-guides/matatag-jhs-competencies.json',
];
const guides = guidePaths.map(json);
assert(
  guides.every((guide) => guide.source === guides[0].source),
  'Curriculum source versions differ'
);
const sourceCompetencies = new Map();
for (const guide of guides) {
  for (const quarter of guide.quarters) {
    for (const competency of quarter.competencies) {
      assert(
        !sourceCompetencies.has(competency.code),
        `Duplicate source competency ${competency.code}`
      );
      sourceCompetencies.set(competency.code, {
        ...competency,
        grade: quarter.grade,
        quarter: quarter.quarter,
      });
    }
  }
}

const unique = (values) => [...new Set(values)];
const quizCount = (ids) =>
  new Set(ids.map((id) => cards.get(id)?.factId).filter((id) => questionFactIds.has(id))).size;
const catalogueGrades = [];
const mappedCodes = new Set();
const lessonCards = new Set();
const objectiveCards = new Set();
let objectiveCount = 0;
for (const grade of grades) {
  const manifest = manifests.get(grade);
  assert(manifest, `No app lesson manifest for grade ${grade}`);
  const topicKeys = new Set();
  const topics = [];
  for (const lesson of scheduleLessons(manifest.lessons, schedule.competencies, relatedCodes)) {
    assert(!topicKeys.has(lesson.key), `Duplicate lesson ${lesson.key}`);
    topicKeys.add(lesson.key);
    const cardIds = unique(lesson.cardIds);
    if (cardIds.length < minimumCards) continue; // CurriculumSheet's actual admission floor.
    assert(
      cardIds.every((id) => cards.has(id)),
      `${lesson.key} references an absent card`
    );
    assert(lesson.codes.length, `${lesson.key} has no curriculum mapping`);
    const competencies = lesson.codes.map((code) => {
      const competency = sourceCompetencies.get(code);
      assert(competency, `${lesson.key} references unknown competency ${code}`);
      assert(
        competency.grade === grade && competency.quarter === lesson.quarter,
        `${lesson.key}: wrong grade/quarter for ${code}`
      );
      const units = lesson.units.filter((unit) => unit.competency === code);
      assert(units.length, `${lesson.key} has no authored objectives for ${code}`);
      for (const unit of units) {
        assert(unit.cardIds.length, `${unit.id} has no objective cards`);
        assert(
          unit.cardIds.every((id) => cardIds.includes(id)),
          `${unit.id} includes cards outside its lesson`
        );
        assert(
          unit.quizCardIds.every((id) => unit.cardIds.includes(id) && quizCount([id]) === 1),
          `${unit.id} has a missing practice question`
        );
      }
      const core = unique(units.flatMap((unit) => unit.cardIds));
      core.forEach((id) => objectiveCards.add(id));
      if (schedule.competencies[code].status === 'listed') mappedCodes.add(code);
      objectiveCount += units.length;
      return {
        code,
        status: schedule.competencies[code].status,
        text: competency.text,
        cardCount: core.length,
        questionCount: quizCount(unique(units.flatMap((unit) => unit.quizCardIds))),
        focuses: unique(units.map((unit) => unit.focus)),
      };
    });
    assert(
      lesson.units.every((unit) => lesson.codes.includes(unit.competency)),
      `${lesson.key} has an unmapped objective`
    );
    cardIds.forEach((id) => lessonCards.add(id));
    topics.push({
      key: lesson.key,
      term: lesson.term,
      weeks: lesson.weeks,
      domain: domainNames[domainMap[grade][lesson.quarter]].english,
      title: lesson.title,
      cardCount: cardIds.length,
      questionCount: quizCount(cardIds),
      competencies,
    });
  }
  catalogueGrades.push({
    grade,
    sourceUrl: schedule.sources.find((s) => s.grade === grade).url,
    topicCount: topics.length,
    competencyCount: unique(
      topics.flatMap((topic) =>
        topic.competencies.filter((c) => c.status === 'listed').map((entry) => entry.code)
      )
    ).length,
    terms: [1, 2, 3].map((term) => ({
      term,
      domain: unique(topics.filter((t) => t.term === term).map((t) => t.domain)).join(' · '),
      topics: topics.filter((topic) => topic.term === term),
    })),
  });
}

const provenance = [...inputs]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, sha256]) => ({ path, sha256 }));
const catalogue = {
  schema: 2,
  country: 'PH',
  curriculum: 'ph-deped-revised-k12-science-2026-three-term',
  source: {
    title: 'DepEd Revised K-12 Curriculum — Three-Term Science Budgets of Work, Grades 3–10',
    edition: 'April 8, 2026 (Grades 3–8); June 29, 2026 (Grades 9–10)',
    legacyCompetencySource: guides[0].source,
    documents: schedule.sources,
    url: 'https://sites.google.com/deped.gov.ph/lsguide/budgets-of-work',
    identifiers:
      'Codes such as G3-M-1 are Hiraia reference identifiers, not official DepEd competency codes.',
  },
  coverage:
    'An included competency has explicitly assigned objective cards in an app curriculum lesson. This is a content mapping, not proof of complete instruction, practical assessment or learner mastery.',
  counts: {
    grades: catalogueGrades.length,
    topics: catalogueGrades.reduce((total, grade) => total + grade.topicCount, 0),
    mappedCompetencies: mappedCodes.size,
    referenceCompetencies: [...sourceCompetencies.values()].filter(
      (entry) =>
        grades.includes(entry.grade) && schedule.competencies[entry.code]?.status === 'listed'
    ).length,
    objectives: objectiveCount,
    lessonCards: lessonCards.size,
    objectiveCards: objectiveCards.size,
  },
  unmappedCompetencies: [...sourceCompetencies.values()]
    .filter(
      (entry) =>
        grades.includes(entry.grade) &&
        schedule.competencies[entry.code]?.status === 'listed' &&
        !mappedCodes.has(entry.code)
    )
    .map(({ code, text, grade, quarter }) => ({ code, text, grade, quarter })),
  grades: catalogueGrades,
  provenance,
};
const output = `${JSON.stringify(catalogue, null, 2)}\n`;
if (process.argv.includes('--check')) {
  let current;
  try {
    current = readFileSync(OUTPUT, 'utf8');
  } catch {
    /* Report the rebuild command below. */
  }
  assert(
    current === output,
    'Competency catalogue is stale. Run pnpm --filter @hiraia/web competencies:generate.'
  );
} else {
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, output);
}
console.log(
  `Competencies ${process.argv.includes('--check') ? 'verified' : 'generated'}: ${catalogue.counts.mappedCompetencies}/${catalogue.counts.referenceCompetencies} competencies, ${catalogue.counts.topics} topics, ${catalogue.counts.grades} grades; ${(Buffer.byteLength(output) / 1024).toFixed(1)} KiB.`
);
