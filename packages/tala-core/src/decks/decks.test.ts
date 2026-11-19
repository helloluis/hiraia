import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PackReview, WeeklyPackContent } from '../contracts/packs';
import type { Deck, DeckSlide } from '../contracts/decks';
import {
  changedSlideCount,
  cleanLine,
  DECK_COLORS,
  DECK_LABELS,
  deckChanges,
  deckSlidesFromPack,
  estimateHeight,
  layoutDeck,
  layoutInputFromDeck,
  layoutInputFromPack,
  pickSize,
  SLIDE_H,
  SLIDE_W,
  slideChanged,
  sourcesLineFromPack,
  stripDayPrefix,
} from './index';
import type { ImageItem, SlideLayout, TextItem } from './index';

const LIBRARY = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../tala-packs/library/science-bow-2026'
);
const samples = existsSync(LIBRARY)
  ? readdirSync(LIBRARY).flatMap((id) =>
      (['en', 'fil'] as const)
        .filter((lang) => existsSync(join(LIBRARY, id, lang, 'pack.json')))
        .map((lang) => ({ id, lang }))
    )
  : [];
const load = (id: string, lang: string) => ({
  content: WeeklyPackContent.parse(
    JSON.parse(readFileSync(join(LIBRARY, id, lang, 'pack.json'), 'utf8'))
  ),
  review: PackReview.parse(
    JSON.parse(readFileSync(join(LIBRARY, id, lang, 'review.json'), 'utf8'))
  ),
});
const texts = (s: SlideLayout) => s.items.filter((i): i is TextItem => i.type === 'text');
const drawings = (s: SlideLayout) =>
  s.items.filter((i): i is ImageItem => i.type === 'image' && i.source.kind === 'drawing');
const words = (t: TextItem) =>
  t.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n');

test('fitting: the estimate grows with the text and the size, and the largest size that fits is chosen', () => {
  const line = 'Bring two same ends together: they push apart. This is repel.';
  assert.ok(estimateHeight([line], 6, 32) > estimateHeight([line], 6, 24));
  assert.ok(estimateHeight([line, line], 6, 28) > estimateHeight([line], 6, 28));
  assert.ok(estimateHeight([line], 3, 28) > estimateHeight([line], 6, 28));
  assert.deepEqual(pickSize(['Short'], 6, 1, [40, 36, 32]), { size: 40, fits: true });
  assert.deepEqual(pickSize([line.repeat(30)], 6, 1, [40, 36, 32]), { size: 32, fits: false });
  assert.equal(cleanLine('  3. Touch the magnet '), 'Touch the magnet');
  assert.equal(cleanLine('• A bullet'), 'A bullet');
  assert.equal(cleanLine('Step 2: Write it'), 'Write it');
  assert.equal(cleanLine('2026 was a long year'), '2026 was a long year');
  assert.equal(stripDayPrefix('Day 2: Poles'), 'Poles');
  assert.equal(stripDayPrefix('Araw 3 — Hangin'), 'Hangin');
  assert.equal(stripDayPrefix('Daylight'), 'Daylight');
});

test(
  'every sample pack lays out: one layout per slide, every box on the slide, the pack renderer’s rules kept',
  { skip: samples.length === 0 },
  () => {
    for (const { id, lang } of samples) {
      const { content, review } = load(id, lang);
      const input = layoutInputFromPack(content, review);
      const out = layoutDeck(input);
      const where = (s: SlideLayout) => `${id} ${lang} ${s.id}`;
      assert.deepEqual(
        out.map((s) => s.id),
        content.slides.map((s) => s.id)
      );
      const L = DECK_LABELS[lang];
      let lastPicture: string | null = null;
      const shownPerDay = new Map<string, number>();
      for (const s of out) {
        assert.equal(s.index, out.indexOf(s));
        for (const item of s.items) {
          assert.ok(
            [item.x, item.y, item.w, item.h].every(Number.isFinite) && item.w > 0 && item.h > 0,
            `${where(s)} ${item.name}: a real box`
          );
          assert.ok(
            item.x >= 0 &&
              item.y >= 0 &&
              item.x + item.w <= SLIDE_W + 0.01 &&
              item.y + item.h <= SLIDE_H + 0.01,
            `${where(s)} ${item.name}: on the slide`
          );
        }
        const titles = texts(s).filter((t) => t.titlePlaceholder);
        assert.equal(titles.length, 1, `${where(s)}: one title placeholder`);
        assert.deepEqual(titles[0]!.field, { type: 'title' });
        assert.equal(
          s.footer.text,
          `Grade ${content.grade} Science · Term ${content.term} · Week ${content.week}`
        );
        const dark = s.kind === 'cover' || s.kind === 'day';
        assert.equal(s.master === 'dark', dark, where(s));
        assert.equal(s.background, dark ? DECK_COLORS.forest : DECK_COLORS.cream);
        assert.equal(
          s.items.filter((i) => i.type === 'image' && i.source.kind === 'brand').length,
          dark ? 2 : 0,
          `${where(s)}: brand marks only on dark slides`
        );
        // Pictures: the slide says which drawing it shows; never the same one twice in a row, at most twice a day.
        const shown = drawings(s);
        assert.ok(shown.length <= 1);
        assert.equal(s.picture, shown[0] ? (shown[0].source as { slug: string }).slug : null);
        assert.equal(s.master === 'lightSplit', !dark && shown.length === 1, where(s));
        if (s.picture) {
          assert.notEqual(
            s.picture,
            lastPicture,
            `${where(s)}: not the drawing of the slide before`
          );
          const key = `${s.day}:${s.picture}`;
          shownPerDay.set(key, (shownPerDay.get(key) ?? 0) + 1);
          assert.ok(shownPerDay.get(key)! <= 2, `${where(s)}: a drawing at most twice a day`);
          assert.ok(shown[0]!.alt.length > 0, `${where(s)}: alt text`);
        }
        lastPicture = s.picture;
        if (s.kind === 'day') {
          const label = texts(s).find((t) => t.name === 'day label')!;
          assert.equal(words(label), `${L.day} ${s.day}`);
          assert.equal(label.valign, 'middle');
        }
        if (s.kind === 'cover')
          assert.equal(
            texts(s).some((t) => words(t) === L.draftBadge),
            review.publication !== 'approved',
            `${where(s)}: the draft label is honest`
          );
        if (dark || s.kind === 'credits') assert.equal(s.label, null);
        else
          assert.ok(
            s.label &&
              texts(s).some((t) => t.name === 'kind label' && words(t) === s.label!.toUpperCase()),
            `${where(s)}: kind label`
          );
        // Quiz slides: one box and one letter badge per choice; an answer slide marks exactly the right one.
        const source = content.slides.find((x) => x.id === s.id)!;
        const question =
          s.kind === 'reveal' ? content.slides.find((x) => x.id === source.revealOf) : source;
        const choices =
          s.kind === 'check' || s.kind === 'question' || s.kind === 'reveal'
            ? (question?.choices ?? [])
            : [];
        const boxes = texts(s).filter((t) => /^choice [A-D]$/.test(t.name));
        if (choices.length && s.kind !== 'reveal') {
          assert.equal(boxes.length, choices.length, where(s));
          assert.deepEqual(
            boxes.map((b) => b.field),
            choices.map((_c, index) => ({ type: 'choice', index }))
          );
          assert.equal(
            texts(s).filter((t) => /^choice letter [A-D]$/.test(t.name)).length,
            choices.length
          );
        }
        if (choices.length && s.kind === 'reveal') {
          assert.ok(boxes.length === choices.length || boxes.length === 1, where(s));
          assert.equal(
            boxes.filter((b) => words(b).endsWith('✓')).length,
            source.correctChoice === null ? 0 : 1,
            `${where(s)}: one right answer`
          );
          assert.ok(
            boxes.every((b) => b.field === null),
            'choices are edited on the question slide, not on its answer'
          );
        }
        if (s.kind === 'credits') {
          const body = texts(s).find((t) => t.name === 'slide text')!;
          const lines = body.paragraphs.map((p) => p.runs.map((r) => r.text).join(''));
          assert.ok(
            lines.includes(L.creditsArt) &&
              lines.includes(
                review.publication === 'approved'
                  ? L.creditsReviewed(review.teacherReview?.reviewer ?? '—')
                  : L.creditsDraft
              )
          );
          assert.ok(!lines.includes(L.creditsEdited), 'the shared original is not an edited copy');
          assert.equal(
            body.editableParagraphs,
            lines.length - 2,
            'the fixed credit lines are not the teacher’s to type over'
          );
        }
        assert.equal(s.notes, source.notes);
      }
    }
  }
);

test(
  'a copy starts equal to its original; changes are counted the way a teacher would count them',
  { skip: samples.length === 0 },
  () => {
    const { content } = load(samples[0]!.id, samples[0]!.lang);
    const base = deckSlidesFromPack(content);
    assert.deepEqual(deckSlidesFromPack(content), base, 'deterministic');
    assert.ok(
      base.every(
        (s) => s.sourceId === s.id && s.lines.every((l) => l === cleanLine(l) && l.length > 0)
      )
    );
    assert.ok(
      base.filter((s) => s.kind === 'day').every((s) => !/^(Day|Araw)\s*\d/.test(s.title)),
      'day slides keep only their own title'
    );
    assert.deepEqual(deckChanges(base, base), {
      changed: 0,
      added: 0,
      removed: 0,
      reordered: false,
    });
    assert.equal(changedSlideCount(base, base), 0);

    const mine = structuredClone(base);
    mine[4]!.lines = [...mine[4]!.lines, 'A line of my own'];
    assert.equal(slideChanged(mine[4]!, base[4]), true);
    assert.equal(slideChanged(mine[5]!, base[5]), false);
    const added: DeckSlide = { ...structuredClone(base[6]!), id: 'nabc12345', sourceId: null };
    mine.splice(7, 0, added);
    mine.splice(12, 1);
    const [moved] = mine.splice(20, 1);
    mine.splice(22, 0, moved!);
    assert.deepEqual(deckChanges(mine, base), {
      changed: 1,
      added: 1,
      removed: 1,
      reordered: true,
    });
    assert.equal(changedSlideCount(mine, base), 2);
    // A slide whose notes, picture or answer changed counts as changed; moving it alone does not.
    for (const change of [
      (s: DeckSlide) => void (s.notes = `${s.notes} More.`),
      (s: DeckSlide) => void (s.title = `${s.title}!`),
      (s: DeckSlide) => void (s.image = s.image ? null : { slug: 'x', alt: 'y' }),
    ]) {
      const one = structuredClone(base);
      change(one[9]!);
      assert.equal(changedSlideCount(one, base), 1);
    }
    const swapped = structuredClone(base);
    [swapped[9], swapped[10]] = [swapped[10]!, swapped[9]!];
    assert.deepEqual(deckChanges(swapped, base), {
      changed: 0,
      added: 0,
      removed: 0,
      reordered: true,
    });
  }
);

test(
  'a teacher’s copy lays out like the original, says it was edited, and gives the editor somewhere to type',
  { skip: samples.length === 0 },
  () => {
    for (const { id, lang } of samples.slice(0, 2)) {
      const { content, review } = load(id, lang);
      const original = layoutDeck(layoutInputFromPack(content, review));
      const deck: Pick<
        Deck,
        'language' | 'grade' | 'term' | 'week' | 'sourceApproved' | 'credits' | 'slides'
      > = {
        language: content.language,
        grade: content.grade,
        term: content.term,
        week: content.week,
        sourceApproved: false,
        credits: { reviewer: null, sourcesLine: sourcesLineFromPack(content) },
        slides: deckSlidesFromPack(content),
      };
      const copy = layoutDeck(layoutInputFromDeck(deck));
      const L = DECK_LABELS[lang];
      // With the slides as first copied in hand, an untouched copy is not called edited; a changed one is.
      const creditLines = (slides: typeof deck.slides) =>
        texts(layoutDeck(layoutInputFromDeck({ ...deck, slides }, { baseSlides: deck.slides })).find((x) => x.kind === 'credits')!)
          .find((t) => t.name === 'slide text')!
          .paragraphs.map((p) => p.runs[0]!.text);
      assert.ok(!creditLines(deck.slides).includes(L.creditsEdited), 'untouched copy');
      const changed = structuredClone(deck.slides);
      changed[1]!.title = `${changed[1]!.title} x`;
      assert.ok(creditLines(changed).includes(L.creditsEdited), 'edited copy');
      assert.ok(creditLines(deck.slides.filter((x, i) => i !== 3)).includes(L.creditsEdited), 'a copy with a slide removed');
      // Identical display lists, apart from the credits slide, which says the copy was edited.
      for (const [i, s] of copy.entries()) {
        if (s.kind === 'credits') {
          const lines = texts(s)
            .find((t) => t.name === 'slide text')!
            .paragraphs.map((p) => p.runs[0]!.text);
          assert.ok(
            lines.includes(L.creditsEdited) &&
              lines.includes(L.creditsArt) &&
              lines.includes(L.creditsDraft)
          );
          continue;
        }
        assert.deepEqual(
          { ...s, section: '' },
          { ...original[i]!, section: '' },
          `${id} ${lang} ${s.id}`
        );
      }
      assert.ok(
        sourcesLineFromPack(content).startsWith(`${L.sourcesIntro}: `) &&
          sourcesLineFromPack(content).length <= 400
      );

      // Approved source: no draft label on the cover, the reviewer named in the credits.
      const approved = layoutDeck(
        layoutInputFromDeck({
          ...deck,
          sourceApproved: true,
          credits: { ...deck.credits, reviewer: 'Gng. Reyes' },
        })
      );
      assert.ok(!texts(approved[0]!).some((t) => words(t) === L.draftBadge));
      assert.ok(
        texts(approved[approved.length - 1]!).some((t) =>
          words(t).includes(L.creditsReviewed('Gng. Reyes'))
        )
      );

      // Editing view: a slide with no lines still has its (empty) text box; the viewing layout has none.
      const blank = structuredClone(deck.slides);
      const k = blank.findIndex((s) => s.kind === 'concept');
      blank[k]!.lines = [];
      blank[k]!.title = '';
      const viewing = layoutDeck(layoutInputFromDeck({ ...deck, slides: blank }))[k]!;
      const editing = layoutDeck(
        layoutInputFromDeck({ ...deck, slides: blank }, { editing: true })
      )[k]!;
      assert.equal(texts(viewing).filter((t) => t.field?.type === 'lines').length, 0);
      const box = texts(editing).filter((t) => t.field?.type === 'lines');
      assert.equal(box.length, 1);
      assert.deepEqual(box[0]!.paragraphs, []);
      assert.equal(
        texts(editing).filter((t) => t.field?.type === 'title').length,
        1,
        'an empty title keeps its placeholder'
      );

      // An answer slide whose question was deleted, and a question with a blank choice, still lay out.
      const odd = structuredClone(deck.slides);
      const reveal = odd.findIndex((s) => s.kind === 'reveal' && s.revealOf);
      const question = odd.findIndex((s) => s.id === odd[reveal]!.revealOf);
      odd[question]!.choices = odd[question]!.choices.map((c, i) => (i === 1 ? '' : c));
      assert.equal(layoutDeck(layoutInputFromDeck({ ...deck, slides: odd })).length, odd.length);
      odd.splice(question, 1);
      assert.equal(layoutDeck(layoutInputFromDeck({ ...deck, slides: odd })).length, odd.length);
    }
  }
);

test('a teacher’s long title never sits on top of the text under it', () => {
  const slide = (over: Partial<DeckSlide>): DeckSlide => ({
    id: 'd1s2', day: 1, kind: 'concept', title: 'Short title', lines: ['First point.', 'Second point.'], choices: [],
    revealOf: null, correctChoice: null, image: null, notes: '', sourceId: 'd1s2', ...over,
  });
  const lay = (s: DeckSlide) =>
    layoutDeck({ language: 'en', grade: '4', term: 2, week: 10, approved: false, reviewer: null, sourcesLine: '', personalCopy: true, slides: [s] })[0]!;
  const parts = (l: SlideLayout) => ({ title: texts(l).find((t) => t.name === 'title')!, body: texts(l).find((t) => t.name === 'slide text' || t.name === 'vocabulary') });
  const long = 'A very long title that a teacher typed to say everything about magnets, poles, attraction and repulsion in one go, and then some more words';
  assert.ok(long.length > 130);

  // A title of ordinary length is laid out exactly as before.
  const plain = parts(lay(slide({})));
  assert.equal(plain.title.size, 40);
  assert.equal(plain.body!.y, 2.35);

  for (const s of [
    slide({ title: long }),
    slide({ title: long, image: { slug: 'some-drawing', alt: 'A drawing' } }),
    slide({ title: long, kind: 'vocabulary', lines: ['pole — an end of a magnet'] }),
    slide({ title: long, kind: 'check', lines: ['Which one?'], choices: ['One', 'Two', 'Three', 'Four'] }),
    slide({ title: long, kind: 'day', id: 'd1s1' }),
  ]) {
    const l = lay(s);
    const { title } = parts(l);
    assert.equal(l.crowded, true, 'a long title is flagged');
    assert.ok(title.size <= 32, `${s.kind}: a smaller size is used (${title.size})`);
    const need = estimateHeight([long], title.w, title.size, { serif: true, bold: true });
    assert.ok(title.h + 1e-9 >= need, `${s.kind}: the title box is as tall as the title`);
    const bottom = title.y + title.h;
    for (const item of l.items) {
      if (item === title || item.name === 'kind label' || item.name === 'day label' || item.type !== 'text') continue;
      if (item.name.startsWith('illustration') || item.x > title.x + title.w) continue;
      assert.ok(item.y + 1e-9 >= bottom, `${s.kind}: "${item.name}" starts below the title (${item.y.toFixed(2)} ≥ ${bottom.toFixed(2)})`);
      assert.ok(item.y + item.h <= SLIDE_H + 1e-9 && item.h > 0, `${s.kind}: "${item.name}" stays on the slide`);
    }
  }
});
