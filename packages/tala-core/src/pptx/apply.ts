/**
 * Writing a teacher's changes back into the file she uploaded.
 *
 * The uploaded package is the source of truth and is never rebuilt: the changes are applied to it as small
 * splices. Words change inside the paragraphs that were edited; slides are reordered, copied or removed in the
 * presentation's slide list and its relationships. Every part that is not touched comes out byte for byte as it
 * went in, which is how charts, diagrams, animations, themes, fonts and anything this code has never heard of
 * survive an edit.
 *
 * `applyEdits` is a pure function of (uploaded file, edits): the same two always give the same result.
 *
 * It reads a slide only when an edit names it, from the package's view of the file as uploaded (so the order of
 * the work cannot change its result), and it counts what it writes against the package's limit before writing it.
 */
import { CONTENT_TYPE, NS, PptxError, PptxPackage, dirOf, nextPartName, relsNameOf, relativeTarget } from './opc';
import { indexDeck, notesBody, notesPartOf, PPTX_LIMITS, type DeckInspection } from './inspect';
import { textBodySplices, tidyParagraphText } from './text';
import { NO_PLACEHOLDER_FRAMES, walkSlide } from './walk';
import { applySplices, attr, attrNode, descendants, escapeXmlAttr, escapeXmlText, kid, kids, type Splice, type XmlDoc } from './xml';

export interface SlideEdit {
  /** Unique in the deck. An original slide keeps its id (`s256`); a copy has its own (`c` + letters and digits). */
  id: string;
  /** The uploaded slide this one is, or was copied from. */
  source: string;
  /** Changed words by block id: that block's paragraphs. A block not named reads as in the file. */
  text?: Record<string, string[]>;
  /** Changed speaker notes, one string per paragraph. Absent = as in the file. */
  notes?: string[];
}

export interface DeckEdits {
  slides: SlideEdit[];
}

export const SLIDE_EDIT_ID = /^(s\d{1,10}|c[a-z0-9]{4,16})$/;

/** The deck exactly as uploaded. */
export const noEdits = (inspection: Pick<DeckInspection, 'slides'>): DeckEdits => ({ slides: inspection.slides.map((s) => ({ id: s.id, source: s.id })) });

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The slides of an inspection by id, each with its blocks by id (looked up many times; never searched). */
function slidesById(inspection: Pick<DeckInspection, 'slides'>) {
  const blocks = new Map<string, Map<string, DeckInspection['slides'][number]['blocks'][number]>>();
  const base = new Map(inspection.slides.map((s) => [s.id, s]));
  const blocksOf = (slideId: string) => {
    let m = blocks.get(slideId);
    if (!m) {
      m = new Map((base.get(slideId)?.blocks ?? []).map((b) => [b.id, b]));
      blocks.set(slideId, m);
    }
    return m;
  };
  return { base, blocksOf };
}

/**
 * Drop everything from a set of edits that changes nothing (text equal to the file's), so a stored state says only
 * what really differs. Pure; uses the inspection, not the file.
 */
export function normaliseEdits(inspection: Pick<DeckInspection, 'slides'>, edits: DeckEdits): DeckEdits {
  const { base, blocksOf } = slidesById(inspection);
  return {
    slides: edits.slides.map((e) => {
      const src = base.get(e.source);
      const out: SlideEdit = { id: e.id, source: e.source };
      if (src && e.text) {
        const text: Record<string, string[]> = {};
        for (const [blockId, paragraphs] of Object.entries(e.text)) {
          const block = blocksOf(e.source).get(blockId);
          const tidy = (paragraphs.length ? paragraphs : ['']).map(tidyParagraphText);
          if (block && !sameList(tidy, block.paragraphs)) text[blockId] = tidy;
        }
        if (Object.keys(text).length) out.text = text;
      }
      if (src && e.notes) {
        const tidy = e.notes.map(tidyParagraphText);
        const was = src.notes.paragraphs.length ? src.notes.paragraphs : [''];
        if (!sameList(tidy.length ? tidy : [''], was)) out.notes = tidy;
      }
      return out;
    }),
  };
}

/** How many slides differ from the uploaded file: changed words or notes, copies, and a changed order counts as none. */
export function changedSlideCount(edits: DeckEdits): number {
  return edits.slides.filter((e) => e.id !== e.source || e.text !== undefined || e.notes !== undefined).length;
}

/** Why a set of edits cannot be applied to this deck, or null when it can. Pure; uses the inspection only. */
export function invalidEdits(inspection: Pick<DeckInspection, 'slides'>, edits: DeckEdits): string | null {
  const { base, blocksOf } = slidesById(inspection);
  if (!edits.slides.length) return 'no_slides';
  if (edits.slides.length > PPTX_LIMITS.slides) return 'too_many_slides';
  const ids = new Set<string>();
  for (const e of edits.slides) {
    if (!SLIDE_EDIT_ID.test(e.id)) return 'bad_slide_id';
    if (ids.has(e.id)) return 'duplicate_slide_id';
    ids.add(e.id);
    const src = base.get(e.source);
    if (!src) return 'unknown_slide';
    if (e.id.startsWith('s') && e.id !== e.source) return 'bad_slide_id';
    if (e.id !== e.source && src.duplicateBlockers.length) return 'slide_cannot_be_copied';
    for (const [blockId, paragraphs] of Object.entries(e.text ?? {})) {
      const block = blocksOf(e.source).get(blockId);
      if (!block) return 'unknown_block';
      if (!block.editable) return 'block_not_editable';
      if (paragraphs.length > PPTX_LIMITS.paragraphsPerBlock || paragraphs.some((p) => p.length > PPTX_LIMITS.paragraphChars)) return 'text_too_long';
    }
    if (e.notes) {
      if (!src.notes.editable) return 'notes_not_editable';
      if (e.notes.length > PPTX_LIMITS.notesParagraphs || e.notes.some((p) => p.length > PPTX_LIMITS.paragraphChars)) return 'text_too_long';
    }
  }
  return null;
}

const REL = {
  slide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
  notesSlide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide',
  notesMaster: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster',
};

export interface ApplyReport {
  /** Parts written or added (everything else is the uploaded bytes). */
  partsChanged: string[];
  partsRemoved: string[];
  /** Links to a removed slide that were taken off other slides, as slide ids. */
  linksRemoved: string[];
  slides: number;
}

function notesParagraphsXml(paragraphs: string[]): string {
  return (paragraphs.length ? paragraphs : [''])
    .map((raw) => {
      const text = tidyParagraphText(raw);
      if (!text) return '<a:p><a:endParaRPr lang="en-US"/></a:p>';
      const runs = text
        .split('\n')
        .map((seg, i) => `${i > 0 ? '<a:br><a:rPr lang="en-US"/></a:br>' : ''}${seg ? `<a:r><a:rPr lang="en-US"/><a:t>${escapeXmlText(seg)}</a:t></a:r>` : ''}`)
        .join('');
      return `<a:p>${runs}</a:p>`;
    })
    .join('');
}

/** A notes page for a slide that had none, hung on the deck's own notes master. */
function newNotesXml(paragraphs: string[]): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<p:notes xmlns:a="${NS.A}" xmlns:r="${NS.R}" xmlns:p="${NS.P}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/>${notesParagraphsXml(paragraphs)}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`
  );
}

/** A small stable number from a string (not a security hash): for ids that must differ between copies. */
function mix(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}

function fail(message: string): never {
  throw new PptxError('invalid_edit', message);
}

/** Relationship kinds a copy of a slide may simply point at too. Anything else (a chart, a diagram) stops a copy. */
const COPYABLE = new Set(['slideLayout', 'image', 'hyperlink', 'slide', 'audio', 'video', 'media', 'tags', 'notesSlide']);

/**
 * Apply edits to an opened package (the uploaded file). The package is changed in place; write it out from
 * `pkg.entries()`. Throws PptxError('invalid_edit') for edits that do not fit this file, and
 * PptxError('too_large') for edits that would write more than the package's limit.
 */
export function applyEdits(pkg: PptxPackage, edits: DeckEdits): ApplyReport {
  const deck = indexDeck(pkg);
  const sources = new Map(deck.slides.map((s) => [s.id, s]));
  if (!edits.slides.length) fail('A deck needs at least one slide.');
  if (edits.slides.length > PPTX_LIMITS.slides) fail('A deck cannot have this many slides.');
  const ids = new Set<string>();
  for (const e of edits.slides) {
    if (!SLIDE_EDIT_ID.test(e.id) || ids.has(e.id) || !sources.has(e.source)) fail('The edits name a slide this file does not have.');
    ids.add(e.id);
  }

  // The uploaded slide keeps its own part for the edit that still carries its id (else for its first use).
  const primary = new Map<string, SlideEdit>();
  for (const e of edits.slides) if (e.id === e.source) primary.set(e.source, e);
  for (const e of edits.slides) if (!primary.has(e.source)) primary.set(e.source, e);

  const mainRelsBefore = new Set(pkg.rels(deck.mainPart).map((r) => r.id));
  // What the file referred to as uploaded: after slides are removed, only parts that were referred to and no
  // longer are go with them. A part nothing ever pointed at is not ours to judge; it stays.
  const reachableBefore = deck.slides.some((s) => !primary.has(s.id)) ? pkg.reachable() : null;

  const report: ApplyReport = { partsChanged: [], partsRemoved: [], linksRemoved: [], slides: edits.slides.length };
  const newTypes: Array<{ part: string; type: string }> = [];
  const taken = new Set<string>();
  const spend = (chars: number) => pkg.spend(chars);

  /** The splices that put an edit's words into its slide, against the slide's text as uploaded. */
  const textSplices = (doc: XmlDoc, e: SlideEdit): Splice[] => {
    if (!e.text || !Object.keys(e.text).length) return [];
    // Only the words matter here, not where they sit: no layout is read.
    const blocks = new Map(walkSlide(doc, deck.size, NO_PLACEHOLDER_FRAMES).blocks.map((b) => [b.info.id, b]));
    const splices: Splice[] = [];
    for (const [blockId, paragraphs] of Object.entries(e.text)) {
      const block = blocks.get(blockId);
      if (!block || !block.info.editable) fail('The edits change text this file does not let Tala change.');
      for (const s of textBodySplices(doc, block.txBody, paragraphs.length ? paragraphs : [''], spend)) splices.push(s);
    }
    return splices;
  };
  /** The notes page of a slide after the edit, or null when the slide had none. */
  const notesText = (notesPart: string | null, e: SlideEdit): string | null => {
    if (!notesPart) return null;
    if (!e.notes) return pkg.sourceText(notesPart);
    const doc = pkg.sourceXml(notesPart);
    const body = notesBody(doc);
    if (!body) fail('The notes page of a slide has no notes box.');
    return applySplices(doc.source, textBodySplices(doc, body, e.notes.length ? e.notes : [''], spend));
  };
  const addNotesPage = (slidePart: string, paragraphs: string[]) => {
    if (!deck.notesMaster) fail('This deck has no notes pages to add notes to.');
    const part = nextPartName(pkg, 'ppt/notesSlides/notesSlide', '.xml', taken);
    taken.add(part);
    pkg.write(part, newNotesXml(paragraphs));
    pkg.editRels(part, [
      { type: REL.notesMaster, target: deck.notesMaster },
      { type: REL.slide, target: slidePart },
    ]);
    pkg.editRels(slidePart, [{ type: REL.notesSlide, target: part }]);
    newTypes.push({ part, type: CONTENT_TYPE.notesSlide });
  };

  // 1. Slides: the uploaded ones in place, copies as new parts.
  const partOf = new Map<string, string>();
  const copies: Array<{ edit: SlideEdit; part: string; relId: string; number: number }> = [];
  let nextNumber = Math.max(255, ...deck.slides.map((s) => Number(s.id.slice(1)))) + 1;
  for (const e of edits.slides) {
    const src = sources.get(e.source)!;
    const notesPart = notesPartOf(pkg, src.part);
    if (primary.get(e.source) === e) {
      partOf.set(e.id, src.part);
      if (e.text && Object.keys(e.text).length) {
        const splices = textSplices(pkg.sourceXml(src.part), e);
        if (splices.length) pkg.patch(src.part, splices);
      }
      if (e.notes) {
        if (notesPart) pkg.write(notesPart, notesText(notesPart, e)!);
        else addNotesPage(src.part, e.notes);
      }
      continue;
    }
    // A copy of the slide: its own slide part (and notes page), pointing at the same layout, pictures and media.
    const srcRels = pkg.sourceRels(src.part);
    if (srcRels.some((r) => !r.external && !COPYABLE.has(r.kind) && !/comment/i.test(r.kind))) fail('A slide with a chart, diagram or embedded file cannot be copied here yet.');
    const part = nextPartName(pkg, `${dirOf(src.part)}/slide`, '.xml', taken);
    taken.add(part);
    partOf.set(e.id, part);
    const doc = pkg.sourceXml(src.part);
    const splices = textSplices(doc, e);
    // PowerPoint gives every slide its own creation id; a copy must not share its original's.
    for (const ext of kids(kid(doc.root, NS.P, 'extLst') ?? doc.root, NS.P, 'ext')) {
      for (const d of kids(ext, NS.P14, 'creationId')) {
        const val = attrNode(d, 'val');
        if (val) splices.push({ start: val.valueStart, end: val.valueEnd, text: String((mix(`${val.value}:${e.id}`) % 4294967000) + 1) });
      }
    }
    pkg.write(part, applySplices(doc.source, splices));
    newTypes.push({ part, type: CONTENT_TYPE.slide });

    // Its relationships: the original's, without comments, and with its own notes page.
    let notesCopy: string | null = null;
    const copiedNotes = notesText(notesPart, e);
    if (copiedNotes !== null && notesPart) {
      notesCopy = nextPartName(pkg, `${dirOf(notesPart)}/notesSlide`, '.xml', taken);
      taken.add(notesCopy);
      pkg.write(notesCopy, copiedNotes);
      newTypes.push({ part: notesCopy, type: CONTENT_TYPE.notesSlide });
      const notesRelsName = relsNameOf(notesPart);
      if (pkg.sourceHas(notesRelsName)) {
        const relSplices: Splice[] = [];
        for (const r of pkg.sourceRels(notesPart)) {
          if (r.kind !== 'slide' || r.external) continue;
          relSplices.push({ start: r.at.targetStart, end: r.at.targetEnd, text: escapeXmlAttr(relativeTarget(notesCopy, part)) });
        }
        pkg.write(relsNameOf(notesCopy), applySplices(pkg.sourceText(notesRelsName), relSplices));
      }
    }
    const relsName = relsNameOf(src.part);
    if (pkg.sourceHas(relsName)) {
      const relSplices: Splice[] = [];
      for (const r of srcRels) {
        if (/comment/i.test(r.kind)) relSplices.push({ start: r.at.start, end: r.at.end, text: '' });
        else if (r.kind === 'notesSlide' && !r.external) {
          if (notesCopy) relSplices.push({ start: r.at.targetStart, end: r.at.targetEnd, text: escapeXmlAttr(relativeTarget(part, notesCopy)) });
          else relSplices.push({ start: r.at.start, end: r.at.end, text: '' });
        }
      }
      pkg.write(relsNameOf(part), applySplices(pkg.sourceText(relsName), relSplices));
    }
    if (e.notes && !notesPart) addNotesPage(part, e.notes);
    copies.push({ edit: e, part, relId: '', number: nextNumber++ });
  }

  // 2. Slides that are gone.
  const removed = deck.slides.filter((s) => !primary.has(s.id));
  const removedParts = new Set(removed.map((s) => s.part));
  const removedNumbers = new Set(removed.map((s) => s.id.slice(1)));
  const removedRelIds = new Set(removed.map((s) => s.relId));

  // The presentation's relationships, once: the copies in, the removed slides out.
  if (copies.length || removed.length) {
    const relIds = pkg.editRels(
      deck.mainPart,
      copies.map((c) => ({ type: REL.slide, target: c.part })),
      [...removedRelIds].filter((id) => mainRelsBefore.has(id))
    );
    copies.forEach((c, i) => (c.relId = relIds[i]!));
  }

  // 3. The presentation's own lists: slide order, sections, custom shows.
  const sameOrder = !copies.length && !removed.length && edits.slides.every((e, i) => deck.slides[i]?.id === e.id);
  if (!sameOrder) {
    const root = deck.presentation.root;
    const list = kid(root, NS.P, 'sldIdLst')!;
    const first = deck.slides[0]!.sldId;
    const relAttr = first.attrs.find((a) => a.ns === NS.R && a.local === 'id')!.name;
    const source = deck.presentation.source;
    const copyByEdit = new Map(copies.map((c) => [c.edit, c]));
    const copiesOf = new Map<string, typeof copies>();
    for (const c of copies) copiesOf.set(c.edit.source, [...(copiesOf.get(c.edit.source) ?? []), c]);
    const children = edits.slides
      .map((e) => {
        const copy = copyByEdit.get(e);
        if (copy) return `<${first.name} id="${copy.number}" ${relAttr}="${escapeXmlAttr(copy.relId)}"/>`;
        const s = sources.get(e.source)!;
        return source.slice(s.sldId.start, s.sldId.end);
      })
      .join('');
    const splices: Splice[] = [{ start: list.openEnd, end: list.closeStart, text: children }];
    for (const d of descendants(root)) {
      if (d.ns === NS.P14 && d.local === 'sldId' && d.parent?.local === 'sldIdLst' && d.parent.ns === NS.P14) {
        // Sections name their slides by number: a removed slide leaves its section, a copy joins its original's.
        const number = attr(d, 'id') ?? '';
        if (removedNumbers.has(number)) splices.push({ start: d.start, end: d.end, text: '' });
        else {
          const here = (copiesOf.get(`s${number}`) ?? []).map((c) => `<${d.name} id="${c.number}"/>`).join('');
          if (here) splices.push({ start: d.end, end: d.end, text: here });
        }
      } else if (d.ns === NS.P && d.local === 'sld' && d.parent?.local === 'sldLst' && removedRelIds.has(attr(d, 'id', NS.R) ?? '')) {
        splices.push({ start: d.start, end: d.end, text: '' });
      }
    }
    pkg.patch(deck.mainPart, splices);
  }
  if (removed.length) {
    for (const s of removed) {
      const notesPart = notesPartOf(pkg, s.part);
      for (const part of [s.part, relsNameOf(s.part), ...(notesPart ? [notesPart, relsNameOf(notesPart)] : [])]) pkg.remove(part);
    }
    // A link on another slide that jumped to a removed slide would dangle: the link goes, its words stay.
    for (const e of edits.slides) {
      const part = partOf.get(e.id)!;
      const dangling = pkg.rels(part).filter((r) => !r.external && r.target && removedParts.has(r.target) && r.kind === 'slide');
      if (!dangling.length) continue;
      const gone = new Set(dangling.map((r) => r.id));
      const doc = pkg.xml(part);
      const splices: Splice[] = [];
      for (const d of descendants(doc.root)) if (d.ns === NS.A && (d.local === 'hlinkClick' || d.local === 'hlinkHover') && gone.has(attr(d, 'id', NS.R) ?? '')) splices.push({ start: d.start, end: d.end, text: '' });
      pkg.patch(part, splices);
      pkg.editRels(part, [], [...gone]);
      report.linksRemoved.push(e.id);
    }
  }

  // 4. Content types: new parts in, a template or a show becomes an ordinary presentation that opens for editing.
  const before = new Set(pkg.names());
  let dropTypes: string[] = [];
  if (removed.length) {
    // Leave nothing behind that the file no longer refers to (the removed slides' own pictures, charts, media).
    const keep = pkg.reachable();
    for (const part of [...newTypes.map((t) => t.part)]) keep.add(part);
    for (const name of pkg.names()) if (!keep.has(name) && reachableBefore?.has(name)) pkg.remove(name);
    dropTypes = [...before].filter((n) => !pkg.has(n));
  }
  for (const s of removed) {
    dropTypes.push(s.part);
    const notesPart = notesPartOf(pkg, s.part);
    if (notesPart) dropTypes.push(notesPart);
  }
  if (deck.kind !== 'presentation') newTypes.push({ part: deck.mainPart, type: CONTENT_TYPE.presentation });
  if (newTypes.length || dropTypes.length) pkg.editContentTypes(newTypes, dropTypes);

  for (const name of pkg.names()) if (pkg.isChanged(name)) report.partsChanged.push(name);
  report.partsRemoved = [...new Set([...removedParts, ...dropTypes])].filter((n) => !pkg.has(n)).sort();
  return report;
}

/** Tiny convenience for callers that hold raw parts: open, apply, and list what the new file holds. */
export function editedEntries(pkg: PptxPackage, edits: DeckEdits): { entries: ReturnType<PptxPackage['entries']>; report: ApplyReport } {
  const report = applyEdits(pkg, edits);
  return { entries: pkg.entries(), report };
}
