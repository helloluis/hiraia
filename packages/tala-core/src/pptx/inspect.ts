/**
 * Reading an uploaded .pptx as a whole: is it a file this version can safely take, what are its slides and the
 * words a teacher can change on each, and what does it hold that is only carried along.
 *
 * The result is plain data (it is stored and sent to the browser). It never claims more than is true: anything
 * the editor cannot change is counted and named, so the teacher is told "your chart stays exactly as it is"
 * instead of finding it flattened or gone.
 */
import { CONTENT_TYPE, NS, PptxError, PptxPackage, ownerOfRels, type PartSource } from './opc';
import { textBodyText } from './text';
import { placeholderFrames, walkSlide, type KeptKind, type PlaceholderFrames, type SlideBlock, type SlideObject, type SlideSize } from './walk';
import { attr, descendants, kid, kids, path, textOf, XmlError, type XmlDoc, type XmlElement } from './xml';

export const PPTX_LIMITS = {
  slides: 400,
  /** Text blocks on one slide (a big table has many). */
  blocksPerSlide: 600,
  paragraphsPerBlock: 400,
  paragraphChars: 8000,
  notesParagraphs: 400,
} as const;

/** Things in the file that the editor does not change. Each is counted with the slides it is on (0 = the deck). */
export type Feature =
  | KeptKind
  | 'animation'
  | 'transition'
  | 'comments'
  | 'hiddenSlide'
  | 'sections'
  | 'customShow'
  | 'embeddedFont'
  | 'externalLink'
  | 'linkedFile'
  | 'readOnlyText'
  | 'customXml'
  | 'noNotesPage';

export interface FeatureCount {
  feature: Feature;
  count: number;
  /** 1-based slide numbers in the uploaded file, at most 40. */
  slides: number[];
}

export interface InspectedNotes {
  /** The notes page exists in the file. */
  exists: boolean;
  paragraphs: string[];
  /** Notes can be changed (or written, when the deck has a notes master to hang a new notes page on). */
  editable: boolean;
}

export interface InspectedSlide {
  /** `s<id>` from the presentation's own slide list: stable for this file. */
  id: string;
  /** 1-based position in the uploaded file. */
  number: number;
  title: string;
  hidden: boolean;
  layoutName: string;
  blocks: SlideBlock[];
  objects: SlideObject[];
  notes: InspectedNotes;
  /** Empty when the slide can be duplicated; otherwise why not (kinds of linked content this version cannot copy). */
  duplicateBlockers: string[];
  animations: boolean;
  transition: boolean;
}

export interface DeckInspection {
  kind: 'presentation' | 'template' | 'slideshow';
  /** Slide size in EMU (914400 per inch). */
  size: SlideSize;
  title: string;
  slides: InspectedSlide[];
  features: FeatureCount[];
  /** Counts for a one-line summary. */
  totals: { slides: number; textBlocks: number; editableBlocks: number; slidesWithEditableText: number; parts: number };
}

/** Relationship kinds a copied slide may simply point at too (the target is not changed by either slide). */
const SHAREABLE = new Set(['slideLayout', 'image', 'hyperlink', 'slide', 'audio', 'video', 'media', 'tags', 'notesSlide', 'comments']);

const MACRO_TYPES = /macroEnabled/i;

/** Parts of the package a slide deck is found through. */
export interface DeckIndex {
  mainPart: string;
  presentation: XmlDoc;
  size: SlideSize;
  /** Slides in presentation order. */
  slides: Array<{ id: string; sldId: XmlElement; relId: string; part: string }>;
  notesMaster: string | null;
}

function fail(code: ConstructorParameters<typeof PptxError>[0], message: string): never {
  throw new PptxError(code, message);
}

/** Open a package as a presentation, refusing what must not be taken at all. */
export function indexDeck(pkg: PptxPackage): DeckIndex & { kind: DeckInspection['kind'] } {
  const { part: mainPart, contentType } = pkg.mainPart();
  if (/wordprocessingml|spreadsheetml/.test(contentType)) fail('wrong_office_file', 'This is a Word or Excel file, not a PowerPoint file.');
  if (MACRO_TYPES.test(contentType)) fail('macros', 'This file contains macros.');
  const kind: DeckInspection['kind'] =
    contentType === CONTENT_TYPE.template ? 'template' : contentType === CONTENT_TYPE.slideshow ? 'slideshow' : contentType === CONTENT_TYPE.presentation ? 'presentation' : fail('not_a_presentation', 'This is not a PowerPoint file.');
  for (const name of pkg.names()) {
    const lower = name.toLowerCase();
    if (lower.endsWith('vbaproject.bin') || lower.endsWith('.vba')) fail('macros', 'This file contains macros.');
    if (lower.startsWith('ppt/activex/') || lower.includes('/activex/')) fail('active_content', 'This file contains ActiveX controls.');
    if (lower.startsWith('_xmlsignatures/')) fail('signed', 'This file is digitally signed.');
    const ct = pkg.contentType(name) ?? '';
    if (MACRO_TYPES.test(ct) || /vbaProject|activeX/i.test(ct)) fail(/activeX/i.test(ct) ? 'active_content' : 'macros', 'This file contains macros or controls.');
  }
  const presentation = pkg.xml(mainPart);
  const root = presentation.root;
  if (root.ns === NS.P_STRICT) fail('strict_ooxml', 'This file was saved as "Strict Open XML".');
  if (root.ns !== NS.P || root.local !== 'presentation') fail('not_a_presentation', 'This is not a PowerPoint file.');
  const sz = kid(root, NS.P, 'sldSz');
  const cx = Number(attr(sz, 'cx') ?? 9144000);
  const cy = Number(attr(sz, 'cy') ?? 6858000);
  const size: SlideSize = { cx: Number.isFinite(cx) && cx > 0 ? cx : 9144000, cy: Number.isFinite(cy) && cy > 0 ? cy : 6858000 };
  const slides: DeckIndex['slides'] = [];
  const seen = new Set<string>();
  const seenParts = new Set<string>();
  for (const sldId of kids(kid(root, NS.P, 'sldIdLst') ?? root, NS.P, 'sldId')) {
    const id = attr(sldId, 'id');
    const relId = attr(sldId, 'id', NS.R);
    const rel = pkg.rel(mainPart, relId);
    if (!id || !/^\d{1,10}$/.test(id) || !relId || !rel?.target || rel.external || !pkg.has(rel.target)) fail('damaged', 'This file lists a slide that is missing.');
    if (seen.has(id) || seenParts.has(rel.target)) fail('damaged', 'This file lists the same slide twice.');
    seen.add(id);
    seenParts.add(rel.target);
    slides.push({ id: `s${id}`, sldId, relId, part: rel.target });
  }
  if (!slides.length) fail('no_slides', 'This file has no slides.');
  if (slides.length > PPTX_LIMITS.slides) fail('too_many_slides', 'This file has too many slides.');
  const notesMaster = pkg.rels(mainPart).find((r) => r.kind === 'notesMaster' && r.target && pkg.has(r.target))?.target ?? null;
  return { mainPart, presentation, size, slides, notesMaster, kind };
}

/** The notes body of a notes page part: the placeholder of type `body`. */
export function notesBody(doc: XmlDoc): XmlElement | null {
  const tree = path(doc.root, [NS.P, 'cSld'], [NS.P, 'spTree']);
  if (!tree) return null;
  for (const sp of kids(tree, NS.P, 'sp')) {
    const ph = path(sp, [NS.P, 'nvSpPr'], [NS.P, 'nvPr'], [NS.P, 'ph']);
    if (ph && attr(ph, 'type') === 'body') return kid(sp, NS.P, 'txBody');
  }
  return null;
}

export const notesPartOf = (pkg: PptxPackage, slidePart: string): string | null =>
  pkg.rels(slidePart).find((r) => r.kind === 'notesSlide' && r.target && pkg.has(r.target))?.target ?? null;

/** Turn any reader failure into the one error type callers handle. */
export function asPptxError(err: unknown): PptxError {
  if (err instanceof PptxError) return err;
  if (err instanceof XmlError) return new PptxError('damaged', 'A part of this file is not valid XML.');
  return new PptxError('damaged', 'This file could not be read.');
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** Read a whole deck. Throws PptxError (with a reason code) for a file that cannot be taken. */
export function inspectDeck(source: PartSource | PptxPackage): DeckInspection {
  try {
    const pkg = source instanceof PptxPackage ? source : new PptxPackage(source);
    const deck = indexDeck(pkg);
    const features = new Map<Feature, { count: number; slides: number[] }>();
    const note = (feature: Feature, slide: number, count = 1) => {
      const f = features.get(feature) ?? { count: 0, slides: [] };
      f.count += count;
      if (!f.slides.includes(slide) && f.slides.length < 40) f.slides.push(slide);
      features.set(feature, f);
    };
    const frameCache = new Map<string, PlaceholderFrames>();
    const layoutNames = new Map<string, string>();
    const slides: InspectedSlide[] = [];
    let textBlocks = 0;
    let editableBlocks = 0;

    deck.slides.forEach((s, index) => {
      const number = index + 1;
      const doc = pkg.xml(s.part);
      if (doc.root.ns !== NS.P || doc.root.local !== 'sld') fail('damaged', 'A slide of this file is damaged.');
      const frames = placeholderFrames(pkg, s.part, frameCache);
      const walked = walkSlide(doc, deck.size, frames);
      if (walked.blocks.length > PPTX_LIMITS.blocksPerSlide) fail('too_large', 'A slide of this file has too much text to edit here.');
      const blocks = walked.blocks.map((b) => {
        const tooLong = b.info.paragraphs.length > PPTX_LIMITS.paragraphsPerBlock || b.info.paragraphs.some((p) => p.length > PPTX_LIMITS.paragraphChars);
        return tooLong ? { ...b.info, editable: false } : b.info;
      });
      for (const o of walked.objects) if (o.kind !== 'picture' && o.kind !== 'footer' && o.kind !== 'table') note(o.kind, number);
      const readOnly = blocks.filter((b) => !b.editable).length;
      if (readOnly) note('readOnlyText', number, readOnly);
      if (walked.animations) note('animation', number);
      if (walked.transition) note('transition', number);
      if (walked.hidden) note('hiddenSlide', number);
      textBlocks += blocks.length;
      editableBlocks += blocks.length - readOnly;

      const rels = pkg.rels(s.part);
      if (rels.some((r) => r.kind === 'comments' || /comment/i.test(r.kind))) note('comments', number);
      for (const r of rels) if (r.external) note(r.kind === 'hyperlink' ? 'externalLink' : 'linkedFile', number);
      const blockers = [...new Set(rels.filter((r) => !r.external && !SHAREABLE.has(r.kind) && !/comment/i.test(r.kind)).map((r) => r.kind))];

      const layoutPart = rels.find((r) => r.kind === 'slideLayout' && r.target)?.target ?? null;
      let layoutName = '';
      if (layoutPart && pkg.has(layoutPart)) {
        layoutName = layoutNames.get(layoutPart) ?? clip(attr(kid(pkg.xml(layoutPart).root, NS.P, 'cSld'), 'name') ?? '', 80);
        layoutNames.set(layoutPart, layoutName);
      }

      const notesPart = notesPartOf(pkg, s.part);
      let notes: InspectedNotes = { exists: false, paragraphs: [], editable: deck.notesMaster !== null };
      if (notesPart) {
        const body = notesBody(pkg.xml(notesPart));
        if (body) {
          const t = textBodyText(body);
          const fits = t.paragraphs.length <= PPTX_LIMITS.notesParagraphs && t.paragraphs.every((p) => p.length <= PPTX_LIMITS.paragraphChars);
          notes = { exists: true, paragraphs: t.paragraphs, editable: t.editable && fits };
        } else notes = { exists: true, paragraphs: [], editable: false };
      }
      if (!notes.editable && !notes.exists) note('noNotesPage', number);

      const titleBlock = blocks.find((b) => b.role === 'title') ?? blocks.find((b) => b.paragraphs.some((p) => p.trim()));
      slides.push({
        id: s.id,
        number,
        title: clip((titleBlock?.paragraphs.join(' ') ?? '').replace(/\s+/g, ' ').trim(), 160),
        hidden: walked.hidden,
        layoutName,
        blocks,
        objects: walked.objects.filter((o) => o.kind !== 'footer'),
        notes,
        duplicateBlockers: blockers,
        animations: walked.animations,
        transition: walked.transition,
      });
    });

    // Deck-wide things, found in the presentation part and across the package's relationships.
    const root = deck.presentation.root;
    if (kid(root, NS.P, 'custShowLst')) note('customShow', 0);
    if (kid(root, NS.P, 'embeddedFontLst')) note('embeddedFont', 0, kids(kid(root, NS.P, 'embeddedFontLst')!).length || 1);
    for (const d of descendants(root)) if (d.ns === NS.P14 && d.local === 'sectionLst') note('sections', 0, kids(d).length || 1);
    const slideParts = new Set(deck.slides.map((s) => s.part));
    for (const name of pkg.names()) {
      const owner = ownerOfRels(name);
      if (owner === null) {
        if (name.startsWith('customXml/') && !name.includes('/_rels/')) note('customXml', 0);
        continue;
      }
      if (slideParts.has(owner)) continue; // counted per slide above
      for (const r of pkg.rels(owner)) if (r.external && r.kind !== 'hyperlink') note('linkedFile', 0);
    }

    // The deck's own title: what its properties say, else the first slide's title.
    let title = '';
    const core = pkg.rels('').find((r) => r.kind === 'core-properties' && r.target && pkg.has(r.target))?.target;
    if (core) {
      try {
        const t = kids(pkg.xml(core).root).find((c) => c.local === 'title');
        if (t) title = textOf(t).replace(/\s+/g, ' ').trim();
      } catch {
        /* a deck without readable properties still has slides */
      }
    }
    if (!title || /^(powerpoint presentation|slide 1|presentation\d*)$/i.test(title)) title = slides[0]?.title ?? '';

    return {
      kind: deck.kind,
      size: deck.size,
      title: clip(title, 160),
      slides,
      features: [...features.entries()].map(([feature, f]) => ({ feature, count: f.count, slides: f.slides.sort((a, b) => a - b) })).sort((a, b) => a.feature.localeCompare(b.feature)),
      totals: {
        slides: slides.length,
        textBlocks,
        editableBlocks,
        slidesWithEditableText: slides.filter((s) => s.blocks.some((b) => b.editable)).length,
        parts: pkg.names().length,
      },
    };
  } catch (err) {
    throw asPptxError(err);
  }
}
