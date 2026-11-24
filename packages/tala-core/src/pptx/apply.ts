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
 */
import { CONTENT_TYPE, NS, PptxError, PptxPackage, dirOf, nextPartName, relsNameOf, relativeTarget, type Relationship } from './opc';
import { indexDeck, notesBody, notesPartOf, PPTX_LIMITS, type DeckInspection } from './inspect';
import { textBodySplices, tidyParagraphText } from './text';
import { placeholderFrames, walkSlide, type PlaceholderFrames } from './walk';
import { applySplices, attr, attrNode, descendants, escapeXmlAttr, escapeXmlText, kid, parseXml, type Splice, type XmlDoc } from './xml';

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

/**
 * Drop everything from a set of edits that changes nothing (text equal to the file's), so a stored state says only
 * what really differs. Pure; uses the inspection, not the file.
 */
export function normaliseEdits(inspection: Pick<DeckInspection, 'slides'>, edits: DeckEdits): DeckEdits {
  const base = new Map(inspection.slides.map((s) => [s.id, s]));
  return {
    slides: edits.slides.map((e) => {
      const src = base.get(e.source);
      const out: SlideEdit = { id: e.id, source: e.source };
      if (src && e.text) {
        const text: Record<string, string[]> = {};
        for (const [blockId, paragraphs] of Object.entries(e.text)) {
          const block = src.blocks.find((b) => b.id === blockId);
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
  const base = new Map(inspection.slides.map((s) => [s.id, s]));
  if (!edits.slides.length) return 'no_slides';
  if (edits.slides.length > PPTX_LIMITS.slides) return 'too_many_slides';
  const ids = new Set<string>();
  const primary = new Set<string>();
  for (const e of edits.slides) {
    if (!SLIDE_EDIT_ID.test(e.id)) return 'bad_slide_id';
    if (ids.has(e.id)) return 'duplicate_slide_id';
    ids.add(e.id);
    const src = base.get(e.source);
    if (!src) return 'unknown_slide';
    if (e.id.startsWith('s') && e.id !== e.source) return 'bad_slide_id';
    if (e.id === e.source) primary.add(e.source);
    else if (src.duplicateBlockers.length) return 'slide_cannot_be_copied';
    for (const [blockId, paragraphs] of Object.entries(e.text ?? {})) {
      const block = src.blocks.find((b) => b.id === blockId);
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

/**
 * Apply edits to an opened package (the uploaded file). The package is changed in place; write it out from
 * `pkg.entries()`. Throws PptxError('invalid_edit') for edits that do not fit this file.
 */
export function applyEdits(pkg: PptxPackage, edits: DeckEdits): ApplyReport {
  const deck = indexDeck(pkg);
  const sources = new Map(deck.slides.map((s) => [s.id, s]));
  if (!edits.slides.length) fail('A deck needs at least one slide.');
  const ids = new Set<string>();
  for (const e of edits.slides) {
    if (!SLIDE_EDIT_ID.test(e.id) || ids.has(e.id) || !sources.has(e.source)) fail('The edits name a slide this file does not have.');
    ids.add(e.id);
  }

  // The uploaded slide keeps its own part for the edit that still carries its id (else for its first use).
  const primary = new Map<string, SlideEdit>();
  for (const e of edits.slides) if (e.id === e.source) primary.set(e.source, e);
  for (const e of edits.slides) if (!primary.has(e.source)) primary.set(e.source, e);

  // Everything is read from the file as uploaded, before anything is written.
  const frameCache = new Map<string, PlaceholderFrames>();
  const original = new Map<
    string,
    { part: string; doc: XmlDoc; frames: PlaceholderFrames; rels: Relationship[]; relsText: string | null; notesPart: string | null; notesDoc: XmlDoc | null; notesRelsText: string | null; notesRels: Relationship[] }
  >();
  for (const s of deck.slides) {
    const relsName = relsNameOf(s.part);
    const notesPart = notesPartOf(pkg, s.part);
    original.set(s.id, {
      part: s.part,
      doc: pkg.xml(s.part),
      frames: placeholderFrames(pkg, s.part, frameCache),
      rels: pkg.rels(s.part),
      relsText: pkg.has(relsName) ? pkg.text(relsName) : null,
      notesPart,
      notesDoc: notesPart ? pkg.xml(notesPart) : null,
      notesRelsText: notesPart && pkg.has(relsNameOf(notesPart)) ? pkg.text(relsNameOf(notesPart)) : null,
      notesRels: notesPart ? pkg.rels(notesPart) : [],
    });
  }
  const mainRelsBefore = new Set(pkg.rels(deck.mainPart).map((r) => r.id));
  // What the file referred to as uploaded: after slides are removed, only parts that were referred to and no
  // longer are go with them. A part nothing ever pointed at is not ours to judge; it stays.
  const reachableBefore = deck.slides.some((s) => !primary.has(s.id)) ? pkg.reachable() : null;

  const report: ApplyReport = { partsChanged: [], partsRemoved: [], linksRemoved: [], slides: edits.slides.length };
  const newTypes: Array<{ part: string; type: string }> = [];
  const taken = new Set<string>();

  const textSplices = (src: NonNullable<ReturnType<typeof original.get>>, e: SlideEdit): Splice[] => {
    if (!e.text || !Object.keys(e.text).length) return [];
    const walked = walkSlide(src.doc, deck.size, src.frames);
    const splices: Splice[] = [];
    for (const [blockId, paragraphs] of Object.entries(e.text)) {
      const block = walked.blocks.find((b) => b.info.id === blockId);
      if (!block || !block.info.editable) fail('The edits change text this file does not let Tala change.');
      splices.push(...textBodySplices(src.doc, block.txBody, paragraphs.length ? paragraphs : ['']));
    }
    return splices;
  };
  const notesText = (src: NonNullable<ReturnType<typeof original.get>>, e: SlideEdit): string | null => {
    // The notes page of this slide after the edit, or null when it stays (or there is none to write).
    if (!src.notesDoc) return null;
    if (!e.notes) return src.notesDoc.source;
    const body = notesBody(src.notesDoc);
    if (!body) fail('The notes page of a slide has no notes box.');
    return applySplices(src.notesDoc.source, textBodySplices(src.notesDoc, body, e.notes.length ? e.notes : ['']));
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
    const src = original.get(e.source)!;
    if (primary.get(e.source) === e) {
      partOf.set(e.id, src.part);
      const splices = textSplices(src, e);
      if (splices.length) pkg.patch(src.part, splices);
      if (e.notes) {
        if (src.notesPart) pkg.write(src.notesPart, notesText(src, e)!);
        else addNotesPage(src.part, e.notes);
      }
      continue;
    }
    // A copy of the slide: its own slide part (and notes page), pointing at the same layout, pictures and media.
    const blocked = src.rels.filter((r) => !r.external && !['slideLayout', 'image', 'hyperlink', 'slide', 'audio', 'video', 'media', 'tags', 'notesSlide'].includes(r.kind) && !/comment/i.test(r.kind));
    if (blocked.length) fail('A slide with a chart, diagram or embedded file cannot be copied here yet.');
    const part = nextPartName(pkg, `${dirOf(src.part)}/slide`, '.xml', taken);
    taken.add(part);
    partOf.set(e.id, part);
    let xml = applySplices(src.doc.source, textSplices(src, e));
    // PowerPoint gives every slide its own creation id; a copy must not share its original's.
    const copyDoc = parseXml(xml, pkg.limits.xml);
    const idSplices: Splice[] = [];
    for (const d of descendants(copyDoc.root)) {
      if (d.ns !== NS.P14 || d.local !== 'creationId' || d.parent?.parent?.parent !== copyDoc.root) continue;
      const val = attrNode(d, 'val');
      if (val) idSplices.push({ start: val.valueStart, end: val.valueEnd, text: String((mix(`${val.value}:${e.id}`) % 4294967000) + 1) });
    }
    xml = applySplices(xml, idSplices);
    pkg.write(part, xml);
    newTypes.push({ part, type: CONTENT_TYPE.slide });

    // Its relationships: the original's, without comments, and with its own notes page.
    let notesCopy: string | null = null;
    const copiedNotes = notesText(src, e);
    if (copiedNotes !== null && src.notesPart) {
      notesCopy = nextPartName(pkg, `${dirOf(src.notesPart)}/notesSlide`, '.xml', taken);
      taken.add(notesCopy);
      pkg.write(notesCopy, copiedNotes);
      newTypes.push({ part: notesCopy, type: CONTENT_TYPE.notesSlide });
      if (src.notesRelsText !== null) {
        const relSplices: Splice[] = [];
        for (const r of src.notesRels) {
          if (r.kind !== 'slide' || r.external) continue;
          const t = attrNode(r.el, 'Target')!;
          relSplices.push({ start: t.valueStart, end: t.valueEnd, text: escapeXmlAttr(relativeTarget(notesCopy, part)) });
        }
        pkg.write(relsNameOf(notesCopy), applySplices(src.notesRelsText, relSplices));
      }
    }
    if (src.relsText !== null) {
      const relSplices: Splice[] = [];
      for (const r of src.rels) {
        if (/comment/i.test(r.kind)) relSplices.push({ start: r.el.start, end: r.el.end, text: '' });
        else if (r.kind === 'notesSlide' && !r.external) {
          if (notesCopy) {
            const t = attrNode(r.el, 'Target')!;
            relSplices.push({ start: t.valueStart, end: t.valueEnd, text: escapeXmlAttr(relativeTarget(part, notesCopy)) });
          } else relSplices.push({ start: r.el.start, end: r.el.end, text: '' });
        }
      }
      pkg.write(relsNameOf(part), applySplices(src.relsText, relSplices));
    }
    if (e.notes && !src.notesPart) addNotesPage(part, e.notes);
    const [relId] = pkg.editRels(deck.mainPart, [{ type: REL.slide, target: part }]);
    copies.push({ edit: e, part, relId: relId!, number: nextNumber++ });
  }

  // 2. Slides that are gone.
  const removed = deck.slides.filter((s) => !primary.has(s.id));
  const removedParts = new Set(removed.map((s) => s.part));
  const removedNumbers = new Set(removed.map((s) => s.id.slice(1)));
  const removedRelIds = new Set(removed.map((s) => s.relId));

  // 3. The presentation's own lists: slide order, sections, custom shows.
  const sameOrder = !copies.length && !removed.length && edits.slides.every((e, i) => deck.slides[i]?.id === e.id);
  if (!sameOrder) {
    const root = deck.presentation.root;
    const list = kid(root, NS.P, 'sldIdLst')!;
    const first = deck.slides[0]!.sldId;
    const relAttr = first.attrs.find((a) => a.ns === NS.R && a.local === 'id')!.name;
    const source = deck.presentation.source;
    const copyByEdit = new Map(copies.map((c) => [c.edit, c]));
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
          const here = copies.filter((c) => c.edit.source === `s${number}`).map((c) => `<${d.name} id="${c.number}"/>`).join('');
          if (here) splices.push({ start: d.end, end: d.end, text: here });
        }
      } else if (d.ns === NS.P && d.local === 'sld' && d.parent?.local === 'sldLst' && removedRelIds.has(attr(d, 'id', NS.R) ?? '')) {
        splices.push({ start: d.start, end: d.end, text: '' });
      }
    }
    pkg.patch(deck.mainPart, splices);
  }
  if (removed.length) {
    pkg.editRels(deck.mainPart, [], [...removedRelIds].filter((id) => mainRelsBefore.has(id)));
    for (const s of removed) {
      const src = original.get(s.id)!;
      for (const part of [s.part, relsNameOf(s.part), ...(src.notesPart ? [src.notesPart, relsNameOf(src.notesPart)] : [])]) pkg.remove(part);
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
  dropTypes.push(...removed.flatMap((s) => [s.part, ...(original.get(s.id)!.notesPart ? [original.get(s.id)!.notesPart!] : [])]));
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
