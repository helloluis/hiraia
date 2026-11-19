import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import JSZip from 'jszip';
import { WeeklyPackContent, PackReview } from '@hiraia/tala-core/contracts';
import { LIBRARY, REFERENCE_ROOT } from '../paths';
import { renderDeck } from './pptx';
import { watermark } from './watermark';
import { checkEditability } from './editability';
import { guideHtml, lessonPlansHtml } from './docs';

const ids = existsSync(LIBRARY)
  ? readdirSync(LIBRARY).flatMap((d) => (['en', 'fil'] as const).filter((l) => existsSync(resolve(LIBRARY, d, l, 'pack.json'))).map((l) => `${d}/${l}`))
  : [];
const haveArt = existsSync(resolve(REFERENCE_ROOT, 'packages/images'));
const text = (xml: string) => (xml.match(/<a:t>([^<]*)<\/a:t>/g) ?? []).map((m) => m.slice(5, -6)).join(' ');
const unescape = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const squash = (s: string) => unescape(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

test('each committed pack renders to a deck whose slides, notes and pictures match the pack exactly', { skip: !ids.length || !haveArt }, async () => {
  for (const id of ids) {
    const pack = WeeklyPackContent.parse(JSON.parse(readFileSync(resolve(LIBRARY, id, 'pack.json'), 'utf8')));
    const review = PackReview.parse(JSON.parse(readFileSync(resolve(LIBRARY, id, 'review.json'), 'utf8')));
    const out = join(mkdtempSync(join(tmpdir(), 'tala-deck-')), `${id.replace('/', '-')}.pptx`);
    const report = await renderDeck(pack, review, out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    // No folder entries (cloud drives have refused decks with them); content types first.
    assert.deepEqual(Object.values(zip.files).filter((f) => f.dir).map((f) => f.name), [], `${id}: no folder entries in the zip`);
    assert.equal(Object.keys(zip.files)[0], '[Content_Types].xml', `${id}: [Content_Types].xml is the first entry`);
    const slideFiles = Object.keys(zip.files)
      .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    assert.equal(slideFiles.length, pack.slides.length, `${id}: one slide per pack slide`);
    for (const [i, f] of slideFiles.entries()) {
      const s = pack.slides[i]!;
      const xml = await zip.file(f)!.async('string');
      const shown = squash(text(xml));
      // The heading is on the slide (day slides drop their "Day N:" prefix into the DAY label).
      assert.ok(shown.includes(squash(s.title.replace(/^(Day|Araw)\s*\d+\s*[:—-]\s*/i, ''))), `${id} ${s.id}: title`);
      // Speaker notes: same text as the plan's slide notes, on that slide only.
      const rels = await zip.file(f.replace('slides/', 'slides/_rels/') + '.rels')!.async('string');
      const notesTarget = rels.match(/Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/)?.[1];
      assert.ok(notesTarget, `${id} ${s.id}: has a notes page`);
      const notes = squash(text(await zip.file(`ppt/notesSlides/${notesTarget}`)!.async('string')));
      assert.ok(notes.includes(squash(s.notes).slice(0, 60)), `${id} ${s.id}: notes match the plan`);
      // Answers: a check slide never shows the tick; its reveal does.
      if (s.kind === 'check') assert.ok(!text(xml).includes('✓'), `${id} ${s.id}: check shows no answer`);
      if (s.kind === 'reveal' && pack.slides.find((x) => x.id === s.revealOf)?.choices.length)
        assert.ok(text(xml).includes('✓'), `${id} ${s.id}: reveal marks the answer`);
      // Notes never leak onto the slide.
      if (s.notes.length > 80) assert.ok(!shown.includes(squash(s.notes).slice(0, 80)), `${id} ${s.id}: notes not on slide`);
    }
    // Every illustration embedded is the Hiraia-watermarked derivative of the checked library file.
    const media = await Promise.all(
      Object.keys(zip.files)
        .filter((f) => f.startsWith('ppt/media/') && !f.endsWith('/'))
        .map(async (f) => createHash('sha256').update(await zip.file(f)!.async('nodebuffer')).digest('hex'))
    );
    for (const img of report.images) {
      const rec = pack.illustrations.find((x) => x.slug === img.slug)!;
      const source = readFileSync(resolve(REFERENCE_ROOT, rec.file));
      assert.equal(createHash('sha256').update(source).digest('hex'), rec.sha256, `${id}: ${img.slug} source is the checked file`);
      assert.equal((await watermark(source)).sha256, img.embeddedSha256, `${id}: ${img.slug} derivative is reproducible`);
      assert.ok(media.includes(img.embeddedSha256), `${id}: ${img.slug} embedded as its watermarked derivative`);
      assert.ok(!media.includes(img.sha256), `${id}: ${img.slug} is not embedded without the watermark`);
    }
    // Teachers can edit it: every learner-facing word is text, lists are native, no flattened slides.
    const edit = await checkEditability(out, pack);
    assert.equal(edit.state, 'pass', `${id}: editability — ${edit.findings.slice(0, 3).join('; ')}`);
    assert.ok(edit.metrics.nativeListParagraphs > 0 && edit.metrics.largestPictureShareOfSlide < 0.5);
    const used = new Set(pack.slides.filter((s) => s.image).map((s) => s.image!.slug));
    for (const slug of used) assert.ok(report.images.some((i) => i.slug === slug), `${id}: ${slug} rendered`);
    // Brand palette in the theme; one section per day plus introduction and credits.
    const theme = await zip.file('ppt/theme/theme1.xml')!.async('string');
    for (const c of ['1C3B2E', 'F5ECD6', '2F6360']) assert.ok(theme.includes(c), `${id}: theme has ${c}`);
    const presentation = await zip.file('ppt/presentation.xml')!.async('string');
    assert.equal((presentation.match(/<p14:section /g) ?? []).length, 7, `${id}: sections`);
  }
});

test('the printable documents carry the plan, the answers and the slide notes', () => {
  for (const id of ids) {
    const pack = WeeklyPackContent.parse(JSON.parse(readFileSync(resolve(LIBRARY, id, 'pack.json'), 'utf8')));
    const review = PackReview.parse(JSON.parse(readFileSync(resolve(LIBRARY, id, 'review.json'), 'utf8')));
    const plans = squash(lessonPlansHtml(pack, review));
    const guide = squash(guideHtml(pack, review));
    for (const c of pack.competencies) assert.ok(plans.includes(squash(c.text)), `${id}: competency verbatim in plans`);
    for (const d of pack.days) {
      assert.ok(plans.includes(squash(d.objective)), `${id}: day ${d.day} objective`);
      assert.ok(plans.includes(squash(d.check.answer)), `${id}: day ${d.day} exit-ticket answer`);
      for (const f of d.flow) assert.ok(plans.includes(squash(f.teacher).slice(0, 80)), `${id}: day ${d.day} step`);
    }
    for (const q of pack.assessment) assert.ok(guide.includes(squash(q.explanation).slice(0, 80)), `${id}: ${q.id} worked answer`);
    for (const s of pack.slides) assert.ok(guide.includes(squash(s.notes).slice(0, 80)), `${id}: ${s.id} notes in guide`);
    if (review.publication !== 'approved') assert.ok(guide.includes(pack.language === 'fil' ? 'drafthindipanareview' : 'draftnotyetreviewed'), `${id}: draft label`);
  }
});

test('a downloaded deck and its PDFs need nothing from the internet', { skip: !ids.length || !haveArt }, async () => {
  const { ARTIFACTS } = await import('../paths');
  for (const id of ids) {
    const dir = resolve(ARTIFACTS, id);
    if (!existsSync(resolve(dir, 'manifest.json'))) continue;
    const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')) as { files: Array<{ kind: string; name: string; sha256: string }> };
    for (const f of manifest.files) {
      const bytes = readFileSync(resolve(dir, f.name));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), f.sha256, `${id}: ${f.name} matches its manifest`);
      if (f.kind === 'slides') {
        const zip = await JSZip.loadAsync(bytes);
        for (const name of Object.keys(zip.files).filter((n) => n.endsWith('.rels'))) {
          const rels = await zip.file(name)!.async('string');
          assert.ok(!/TargetMode="External"/.test(rels), `${id}: ${name} links outside the file`);
        }
        for (const name of Object.keys(zip.files).filter((n) => /^ppt\/(slides|slideLayouts|slideMasters)\/[^/]+\.xml$/.test(n))) {
          const xml = await zip.file(name)!.async('string');
          assert.ok(!/r:link=/.test(xml), `${id}: ${name} has a linked (not embedded) picture`);
        }
      } else {
        // Every font a PDF uses is embedded (FontFile2/FontFile3 present for each font descriptor).
        const text = bytes.toString('latin1');
        const descriptors = (text.match(/\/Type\s*\/FontDescriptor/g) ?? []).length;
        const embedded = (text.match(/\/FontFile[23]?\s/g) ?? []).length;
        assert.ok(descriptors > 0 && embedded >= descriptors, `${id}: ${f.name} embeds its fonts (${embedded}/${descriptors})`);
      }
    }
  }
});

test('the watermark adds a strip with the Hiraia name below the drawing and leaves the drawing untouched', { skip: !haveArt }, async () => {
  const catalog = JSON.parse(readFileSync(resolve(LIBRARY, '..', '..', 'data', 'art', 'competency-candidates.json'), 'utf8'));
  const first = Object.values(catalog.competencies as Record<string, { candidates: Array<{ file: string }> }>)[0]!.candidates[0]!;
  const source = readFileSync(resolve(REFERENCE_ROOT, first.file));
  const wm = await watermark(source);
  const sharp = (await import('sharp')).default;
  const a = await sharp(source).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(wm.png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(b.info.width, a.info.width);
  assert.ok(b.info.height > a.info.height, 'a strip is added below');
  assert.ok(b.data.subarray(0, a.data.length).equals(a.data), 'the drawing itself is pixel-identical');
  const strip = b.data.subarray(a.data.length);
  const inked = [...strip].filter((v) => v < 200).length;
  assert.ok(inked > 50, 'the strip carries the wordmark');
});

