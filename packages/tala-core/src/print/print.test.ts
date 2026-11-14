import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  renderPlanHtml,
  renderPlanText,
  printPageSize,
  printOrientation,
  frauncesBase64,
} from './index';
import { printFixture } from './fixtures';
for (const kind of ['dlp', 'dll', 'multigrade'] as const)
  test(`${kind} deterministic HTML and text snapshots`, () => {
    const fixture = printFixture(kind);
    const html = renderPlanHtml(fixture);
    assert.equal(html, renderPlanHtml(fixture));
    assert.equal(
      html.replace(frauncesBase64, '[BUNDLED_FRAUNCES]'),
      readFileSync(new URL(`./snapshots/${kind}.html`, import.meta.url), 'utf8')
    );
    assert.equal(
      renderPlanText(fixture),
      readFileSync(new URL(`./snapshots/${kind}.txt`, import.meta.url), 'utf8')
    );
    assert.ok(!/<script|<iframe|<link|<img|url\(https?:/i.test(html));
    assert.ok(html.includes('DRAFT'));
    assert.ok(html.includes('Prepared by'));
    assert.ok(html.includes('Checked by'));
    assert.ok(html.includes('ñ, á, é, í, ó, ú'));
    assert.ok(html.includes('data:font/ttf;base64,'));
  });
test('print orientation, long bond size, locked footer and attribution', () => {
  const o = printFixture('multigrade');
  assert.equal(printOrientation(o), 'landscape');
  assert.deepEqual(printPageSize({ ...o, paper: 'long' }), [936, 612]);
  const html = renderPlanHtml({
    ...o,
    plan: {
      ...o.plan,
      state: 'locked',
      lock: {
        lockedBy: 'Guro Peña',
        lockedAt: '2026-11-13T00:00:00Z',
        revisionCode: 'ABC123',
        revision: 4,
      },
      lineage: {
        artifactId: 'artifact1',
        versionId: 'version1',
        title: 'Source',
        authorDisplayName: 'Author',
      },
    },
  });
  assert.ok(!html.includes('aria-hidden="true">DRAFT'));
  assert.ok(html.includes('ABC123'));
  assert.ok(html.includes('Source'));
  assert.ok(html.includes('artifact1/version1'));
});
test('user text is escaped everywhere and images=false needs no network', () => {
  const o = printFixture('dlp');
  o.plan.title = '<script>alert(1)</script>';
  o.teacherName = '" onload="bad';
  const html = renderPlanHtml({ ...o, includeImages: false });
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.equal(html, renderPlanHtml({ ...o, includeImages: true }));
});

test('print query parses images=false as false', async () => {
  const { API } = await import('../contracts/api');
  assert.equal(API['print.planPdf'].query.parse({ images: 'false' }).images, false);
});

for (const withClass of [true, false])
  test(`Filipino exports use grade names and localized activity labels (class=${withClass})`, () => {
    const o = printFixture('multigrade');
    if (!withClass) o.class = undefined;
    const flow = o.sections[0]!;
    assert.equal(flow.content.type, 'multigrade');
    if (flow.content.type !== 'multigrade') return;
    const base = flow.content.blocks[0]!;
    base.groups[o.plan.gradeGroupIds[0]!]!.mode = 'shared';
    base.groups[o.plan.gradeGroupIds[1]!]!.mode = 'direct';
    base.groups[o.plan.gradeGroupIds[2]!]!.mode = 'independent';
    flow.content.blocks = ['all', o.plan.gradeGroupIds[0]!, 'none'].map((teacherWith, i) => ({
      ...base,
      id: `block-${i}`,
      teacherWith,
      pairedGroupIds: o.plan.gradeGroupIds.slice(0, 2),
    }));
    o.sections.push({
      ...flow,
      id: 'pergroup-section',
      key: 'assessment',
      content: {
        type: 'pergroup',
        groups: Object.fromEntries(
          o.plan.gradeGroupIds.map((id) => [id, [{ t: 'p', spans: [{ text: 'Gawain' }] }]])
        ),
      },
    });
    for (const output of [renderPlanText(o), renderPlanHtml(o)]) {
      for (const id of o.plan.gradeGroupIds) assert.ok(!output.includes(id), id);
      const visibleText = output.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]*>/g, ' ');
      assert.doesNotMatch(
        visibleText,
        /\b(shared|direct|independent|transition|Teacher|all|none)\b/
      );
      for (const label of [
        'Baitang 3',
        'Baitang 4',
        'Baitang 5',
        'Guro',
        'Lahat ng pangkat',
        'Sama-sama',
        'Kasama ang guro',
        'Mag-isa',
        'min',
      ])
        assert.ok(output.includes(label), label);
    }
    assert.ok(renderPlanText(o).includes('Guro: Baitang 3'));
  });

test('class grade mapping takes precedence over plan order and unknown groups never expose IDs', () => {
  const o = printFixture('multigrade');
  o.class!.gradeGroups[0]!.grade = '6';
  assert.ok(renderPlanText(o).includes('Guro: Baitang 6'));
  o.lang = 'en';
  assert.ok(renderPlanText(o).includes('Teacher: Grade 6'));
  o.sections.push({
    ...o.sections[0]!,
    id: 'unknown-section',
    key: 'assessment',
    content: { type: 'pergroup', groups: { 'private-unknown-id': [] } },
  });
  assert.ok(!renderPlanText(o).includes('private-unknown-id'));
  assert.ok(!renderPlanHtml(o).includes('private-unknown-id'));
});

for (const kind of ['dlp', 'dll', 'multigrade'] as const) {
  test(`${kind} prints missing and empty post-class sections with writing space`, () => {
    const o = printFixture(kind);
    o.plan.state = 'locked';
    const html = renderPlanHtml(o),
      text = renderPlanText(o);
    assert.equal((text.match(/Pagkatapos ng klase/g) ?? []).length, 1);
    assert.ok(html.includes('class="writing-space"'));
    assert.ok(text.includes('______________________________'));
    assert.ok(text.indexOf('Resulta ng Pagtataya') < text.indexOf('Pagninilay'));
    assert.ok(renderPlanText({ ...o, lang: 'en' }).includes('After class'));
    o.sections.push({
      ...o.sections[0]!,
      id: 'results',
      key: 'results',
      content: { type: 'text', blocks: [{ t: 'p', spans: [{ text: 'Natutuhan ng mga bata.' }] }] },
    });
    assert.ok(renderPlanHtml(o).includes('Natutuhan ng mga bata.'));
    assert.ok(renderPlanText(o).includes('Natutuhan ng mga bata.'));
  });
}
test('multi-grade flow is stacked, includes the session note, and never prints transition time', () => {
  const o = printFixture('multigrade');
  const c = o.sections[0]!.content;
  if (c.type !== 'multigrade') throw new Error('fixture');
  c.note = 'Maghanda ng magkakahiwalay na gawain. <paalala>';
  const html = renderPlanHtml(o),
    text = renderPlanText(o);
  assert.ok(html.includes('Maghanda ng magkakahiwalay na gawain. &lt;paalala&gt;'));
  assert.ok(text.indexOf(c.note) < text.indexOf('Pagmamasid'));
  assert.ok(!html.includes('<table'));
  for (const output of [html, text]) {
    assert.doesNotMatch(output, /transition|paglipat/i);
    for (const grade of o.plan.grades) assert.ok(output.includes(`Baitang ${grade}`));
  }
  assert.equal(c.blocks[0]!.transitionMinutes, 2);
});
