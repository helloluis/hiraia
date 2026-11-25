// Evidence files for the combined multi-grade lesson plan: for two, three and four grades, in English and Filipino,
// on A4 and long bond, short and long lessons, with and without a teacher's edit, write
//   <name>.docx   the Word export (made by @hiraia/tala-core/docx)
//   <name>.html   the print page in the table layout (made by @hiraia/tala-core/print)
//   <name>.pdf    that page printed by Chromium at the paper size the page asks for
// and manifest.json saying what each file must contain. The files are then judged by tools that share no code with
// Tala: scripts/multigrade-evidence-check.py (python-docx, LibreOffice, pypdf).
//
//   PLAYWRIGHT_PATH=… CHROMIUM_PATH=… pnpm exec tsx scripts/multigrade-evidence.mjs <outDir>
//
// Everything in the plans is invented (packages/tala-core/src/plan/combine-fixtures.ts).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2];
if (!out) throw new Error('usage: multigrade-evidence.mjs <outDir>');
const { combinedPrintFixture } = await import('../../tala-core/src/plan/combine-fixtures.ts');
const { renderPlanDocx, planDocxFileName } = await import('@hiraia/tala-core/docx');
const { renderPlanHtml, renderPlanText, printPageSize, printOrientation, PRINT_LABELS, TABLE_WORDS } = await import('@hiraia/tala-core/print');
const { richTextPlainText } = await import('../../tala-core/src/plan/text.ts');
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright-core');
mkdirSync(out, { recursive: true });

const CASES = [
  { name: 'two-grades-a4-en', grades: ['4', '5'], lang: 'en', paper: 'a4' },
  { name: 'two-grades-long-fil', grades: ['4', '5'], lang: 'fil', paper: 'long' },
  { name: 'three-grades-a4-en', grades: ['3', '4', '5'], lang: 'en', paper: 'a4' },
  { name: 'three-grades-long-en', grades: ['3', '4', '5'], lang: 'en', paper: 'long', minutes: 60 },
  { name: 'four-grades-long-fil', grades: ['3', '4', '5', '6'], lang: 'fil', paper: 'long', minutes: 60 },
  // Long lessons: the session runs over several pages.
  { name: 'two-grades-a4-en-long-lessons', grades: ['4', '5'], lang: 'en', paper: 'a4', length: 7 },
  { name: 'three-grades-long-en-long-lessons', grades: ['3', '4', '5'], lang: 'en', paper: 'long', minutes: 60, length: 5 },
  // What a teacher changed before printing.
  { name: 'two-grades-a4-en-edited', grades: ['4', '5'], lang: 'en', paper: 'a4', edit: true },
];
const EDIT = { activity: 'Edited by the teacher: measure the classroom door with a metre stick.', note: 'My own note: Grade 5 sits by the window today.', label: 'Grade 4 measures' };

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const manifest = [];
for (const c of CASES) {
  let o = combinedPrintFixture({ grades: c.grades, lang: c.lang, paper: c.paper, minutes: c.minutes, length: c.length });
  if (c.edit) {
    o = {
      ...o,
      sections: o.sections.map((s) =>
        s.content.type !== 'multigrade'
          ? s
          : {
              ...s,
              editedByTeacher: true,
              content: {
                ...s.content,
                note: EDIT.note,
                blocks: s.content.blocks.map((b, i) =>
                  i === 1 ? { ...b, label: EDIT.label, groups: { ...b.groups, group001: { ...b.groups.group001, activity: [{ t: 'p', spans: [{ text: EDIT.activity }] }] } } } : b
                ),
              },
            }
      ),
    };
  }
  const flow = o.sections.find((s) => s.content.type === 'multigrade').content;
  const docx = renderPlanDocx(o);
  const html = renderPlanHtml(o);
  writeFileSync(join(out, `${c.name}.docx`), docx);
  writeFileSync(join(out, `${c.name}.html`), html);
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: join(out, `${c.name}.pdf`), preferCSSPageSize: true, printBackground: true });
  await page.close();
  const [width, height] = printPageSize(o);
  const groups = o.class.gradeGroups.map((g) => `${PRINT_LABELS[c.lang].grade} ${g.grade}`);
  // Sentences the files must hold: each grade's own words in each block, taken from the plan itself.
  const sentences = {};
  const where = {};
  flow.blocks.forEach((b, i) => {
    for (const g of Object.values(b.groups))
      for (const line of richTextPlainText(g.activity).split('\n')) {
        const text = line.replace(/^[•\d.]+\s*/, '').trim();
        if (text.length <= 12) continue;
        sentences[text] = (sentences[text] ?? 0) + 1;
        (where[text] ??= new Set()).add(i);
      }
  });
  // Sentences that occur once in the whole PLAN (not only in the session): they say which page a time block is on.
  const everything = renderPlanText(o);
  const times = (s) => everything.split(s).length - 1;
  const own = (i) => Object.keys(sentences).filter((s) => sentences[s] === 1 && where[s].has(i) && times(s) === 1);
  manifest.push({
    name: c.name,
    lang: c.lang,
    paper: c.paper,
    grades: c.grades,
    docxName: planDocxFileName(o),
    pagePt: [Math.round(width * 100) / 100, Math.round(height * 100) / 100],
    orientation: printOrientation(o),
    title: o.plan.title,
    header: [TABLE_WORDS[c.lang].time, TABLE_WORDS[c.lang].teacherWith, ...groups],
    blocks: flow.blocks.map((b, i) => ({ label: b.label, minutes: b.minutes, own: own(i) })),
    signatures: [PRINT_LABELS[c.lang].prepared, PRINT_LABELS[c.lang].checked],
    note: flow.note ?? '',
    sentences,
    references: c.grades.map((g) => `DepEd Science G${g}: 2026 Three-Term BOW (2026-04-08), ${TABLE_WORDS[c.lang].page} 7`),
    draft: TABLE_WORDS[c.lang].draft,
    aiDraft: TABLE_WORDS[c.lang].aiDraft,
    edit: c.edit ? EDIT : null,
    longLessons: Boolean(c.length),
    bytes: { docx: docx.length, html: html.length },
  });
  console.log(`${c.name}: ${flow.blocks.length} blocks, ${groups.length} grades, ${c.paper} ${printOrientation(o)}`);
}
await browser.close();
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`${manifest.length} cases written to ${out}`);
