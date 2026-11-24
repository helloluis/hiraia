import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { UploadSlideEdit } from '@hiraia/tala-core/contracts';
import { inspectDeck, invalidEdits, normaliseEdits } from '@hiraia/tala-core/pptx';
import { syntheticDeck, SYNTHETIC } from '@hiraia/tala-core/pptx/testing';
import { en } from '@/i18n/en';
import {
  bringBack,
  canMove,
  canRemove,
  clearUploadDraft,
  copyBlocker,
  copySlide,
  keptFeatures,
  megabytes,
  moveSlide,
  newCopyId,
  notesToText,
  readUploadDraft,
  refusalKey,
  removedSlides,
  removeSlide,
  restoreSlide,
  setBlockText,
  setNotes,
  slidesView,
  textToNotes,
  writeUploadDraft,
  KEPT_ORDER,
  type UploadBase,
} from './upload-model';

const deck = inspectDeck(syntheticDeck());
const base: UploadBase = { slides: deck.slides, features: deck.features, totals: deck.totals };
const identity = (): UploadSlideEdit[] => base.slides.map((s) => ({ id: s.id, source: s.id }));
/** Whatever the screen builds must be something the server will take and the file can carry. */
const valid = (edits: UploadSlideEdit[]) => assert.equal(invalidEdits(base, { slides: edits }), null);

test('the view is the uploaded file plus the teacher’s differences, and says what changed', () => {
  const plain = slidesView(base, identity());
  assert.deepEqual(plain.map((s) => [s.id, s.title, s.changed, s.isCopy]), [
    ['s256', 'Parts of a plant', false, false],
    ['s257', 'Roots & shoots', false, false],
    ['s258', 'Back to roots', false, false],
  ]);
  let edits = setBlockText(base, identity(), 's256', 'b1', ['One', 'Two']);
  edits = setNotes(base, edits, 's256', ['My note']);
  const view = slidesView(base, edits);
  assert.deepEqual(view[0]!.blocks.map((b) => [b.id, b.changed, b.paragraphs.join('|')]), [
    ['b0', false, 'Parts of a plant'],
    ['b1', true, 'One|Two'],
    ['b2', false, 'Line one\nline two'],
  ]);
  assert.deepEqual(view[0]!.notes, { paragraphs: ['My note'], editable: true, changed: true });
  assert.equal(view[0]!.changed, true);
  assert.equal(view[1]!.changed, false);
  valid(edits);
  // Typing the file's own words back removes the difference instead of storing a copy of them.
  edits = setBlockText(base, edits, 's256', 'b1', SYNTHETIC.body1);
  edits = setNotes(base, edits, 's256', SYNTHETIC.notes1);
  assert.deepEqual(edits, identity());
  // A new title shows as the slide's title in the list.
  assert.equal(slidesView(base, setBlockText(base, identity(), 's257', 'b0', ['Mga ugat']))[1]!.title, 'Mga ugat');
});

test('text that Tala only shows cannot be changed from the screen', () => {
  // b5 on slide 2 is the "Page 2" box with a slide-number field.
  assert.deepEqual(setBlockText(base, identity(), 's257', 'b5', ['Page 9']), identity());
  assert.deepEqual(setBlockText(base, identity(), 's257', 'b99', ['x']), identity());
  assert.equal(slidesView(base, identity())[1]!.blocks[5]!.editable, false);
});

test('slides can be moved, copied, removed and brought back; every result is one the server accepts', () => {
  let edits = identity();
  assert.deepEqual([canMove(edits, 's256', -1), canMove(edits, 's256', 1), canMove(edits, 's258', 1)], [false, true, false]);
  edits = moveSlide(edits, 's256', 1)!.edits;
  assert.deepEqual(edits.map((e) => e.id), ['s257', 's256', 's258']);
  valid(edits);

  // A copy carries the words the slide has now, and is its own slide from then on.
  edits = setBlockText(base, edits, 's256', 'b0', ['Edited title']);
  const id = newCopyId(edits.map((e) => e.id), () => 0.42);
  assert.match(id, /^c[a-z0-9]{8}$/);
  const copied = copySlide(base, edits, 's256', id)!;
  assert.deepEqual(copied.edits.map((e) => e.id), ['s257', 's256', id, 's258']);
  assert.equal(copied.index, 2);
  let next = setBlockText(base, copied.edits, id, 'b0', ['The copy']);
  const view = slidesView(base, next);
  assert.deepEqual([view[1]!.title, view[2]!.title, view[2]!.isCopy, view[2]!.changed], ['Edited title', 'The copy', true, true]);
  valid(next);
  // The slide with the chart cannot be copied, and the screen knows why before asking the server.
  assert.equal(copyBlocker(base, next, 's257'), 'linked_content');
  assert.equal(copySlide(base, next, 's257', 'cxxxxxxxx'), null);
  assert.equal(copyBlocker(base, next, 's256'), null);

  // Removing a slide of the file lists it as removed; it can come back. The last slide cannot be removed.
  next = removeSlide(next, 's258')!.edits;
  assert.deepEqual(removedSlides(base, next).map((s) => s.id), ['s258']);
  valid(next);
  next = bringBack(next, removedSlides(base, next)[0]!);
  assert.deepEqual(removedSlides(base, next), []);
  assert.equal(next[next.length - 1]!.id, 's258');
  assert.equal(canRemove([identity()[0]!]), false);
  assert.equal(removeSlide([identity()[0]!], 's256'), null);
  // A slide of the file that only survives as a copy is not "removed": its words are still in the deck.
  assert.deepEqual(removedSlides(base, [{ id: 'cabcdefgh', source: 's256' }]).map((s) => s.id), ['s257', 's258']);
  assert.deepEqual(restoreSlide(setBlockText(base, identity(), 's256', 'b0', ['x']), 's256'), identity());
  // What the screen sends is already in the form the server stores.
  assert.deepEqual(normaliseEdits(base, { slides: next }).slides, next);
});

test('notes are one line per paragraph', () => {
  assert.equal(notesToText(['a', '', 'b']), 'a\n\nb');
  assert.deepEqual(textToNotes('a\r\n\r\nb\n\n'), ['a', '', 'b']);
  assert.deepEqual(textToNotes(''), ['']);
});

test('what is only kept is named in words a teacher knows, for everything the reader can report', () => {
  assert.deepEqual(keptFeatures(base).map((k) => [k.feature, k.slides]), [
    ['chart', [2]],
    ['animation', [2]],
    ['transition', [2]],
    ['readOnlyText', [2]],
    ['hiddenSlide', [3]],
    ['customShow', []],
  ]);
  const strings = en as Record<string, string>;
  for (const feature of [...KEPT_ORDER, 'picture', 'table']) assert.ok(strings[`up.kept.${feature}`], feature);
  for (const role of ['title', 'subtitle', 'body', 'text', 'cell']) assert.ok(strings[`up.ed.role.${role}`], role);
  assert.equal(megabytes(3_500_000), '3.3');
  assert.equal(megabytes(31_457_280), '30');
  assert.equal(megabytes(10), '0.1');
});

test('every reason a file is refused has its own plain words', () => {
  const strings = en as Record<string, string>;
  for (const reason of ['not_a_zip', 'old_powerpoint', 'password_protected', 'pdf', 'empty', 'zip_bomb', 'not_a_presentation', 'wrong_office_file', 'macros', 'active_content', 'strict_ooxml', 'signed', 'unsafe_part_name', 'damaged', 'too_many_parts', 'too_many_slides', 'too_large', 'no_slides', 'unreadable_text', 'wrong_extension', 'checksum_mismatch', 'quota', 'email_not_verified', 'rate_limited']) {
    assert.equal(refusalKey(reason), `up.no.${reason}`);
    assert.ok(strings[`up.no.${reason}`]!.length > 15, reason);
  }
  assert.equal(refusalKey('something_new'), 'up.no.other');
  assert.equal(refusalKey(null), 'up.no.other');
});

test('unsaved work is kept on the device, and a device that refuses is not trusted', () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  const draft = { v: 1 as const, uploadId: 'u1', baseRev: 3, at: '2026-11-21T00:00:00.000Z', title: 'T', slides: identity() };
  assert.equal(writeUploadDraft(storage, draft), true);
  assert.deepEqual(readUploadDraft(storage, 'u1'), draft);
  assert.equal(readUploadDraft(storage, 'u2'), null);
  clearUploadDraft(storage, 'u1');
  assert.equal(readUploadDraft(storage, 'u1'), null);
  const full = { ...storage, setItem: () => { throw new Error('QuotaExceededError'); } };
  assert.equal(writeUploadDraft(full, draft), false);
  assert.equal(writeUploadDraft(null, draft), false);
  store.set('tala.upload-draft.u3', '{broken');
  assert.equal(readUploadDraft(storage, 'u3'), null);
});
