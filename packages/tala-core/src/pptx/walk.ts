/**
 * Reading one slide: which pieces of text a teacher can change (and where they sit on the slide), and which
 * things are on the slide that this version only carries along (charts, diagrams, video, equations…).
 *
 * The same walk is used when a file is first read and again when edits are written back, so a text block has the
 * same id both times: `b<n>`, counted in the order the text bodies appear in the slide's XML. The uploaded file
 * never changes, so that order never does.
 */
import { NS, type PptxPackage } from './opc';
import { textBodyText } from './text';
import { attr, descendants, kid, kids, path, type XmlDoc, type XmlElement } from './xml';

export type BlockRole = 'title' | 'subtitle' | 'body' | 'text' | 'cell';

/** A rectangle in fractions of the slide (0–1), for pointing at a block on a picture of the slide. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SlideBlock {
  id: string;
  role: BlockRole;
  /** The object's name in the file ("Title 1", "TextBox 5"); a table cell is named by row and column. */
  name: string;
  paragraphs: string[];
  /** False when the text holds a field, maths or markup that is not rewritten: it is shown, not edited. */
  editable: boolean;
  box: Box | null;
}

/** Things kept exactly as they are in the file. */
export type KeptKind =
  | 'picture'
  | 'chart'
  | 'diagram'
  | 'table'
  | 'embedded'
  | 'video'
  | 'audio'
  | 'equation'
  | 'special'
  | 'ink'
  | 'graphic'
  | 'footer';

export interface SlideObject {
  kind: KeptKind;
  name: string;
  box: Box | null;
}

export interface WalkedBlock {
  info: SlideBlock;
  txBody: XmlElement;
}

export interface WalkedSlide {
  blocks: WalkedBlock[];
  objects: SlideObject[];
  hidden: boolean;
  animations: boolean;
  transition: boolean;
}

interface Affine {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}
const IDENTITY: Affine = { sx: 1, sy: 1, tx: 0, ty: 0 };

interface Rect {
  x: number;
  y: number;
  cx: number;
  cy: number;
}

const num = (el: XmlElement | null, name: string): number | null => {
  const v = attr(el, name);
  if (v === null || !/^-?\d{1,12}$/.test(v)) return null;
  return Number(v);
};

/** `a:xfrm` (or `p:xfrm` on a graphic frame) as a rectangle in EMU. */
function rectOf(xfrm: XmlElement | null): Rect | null {
  if (!xfrm) return null;
  const off = kid(xfrm, NS.A, 'off');
  const ext = kid(xfrm, NS.A, 'ext');
  const x = num(off, 'x');
  const y = num(off, 'y');
  const cx = num(ext, 'cx');
  const cy = num(ext, 'cy');
  return x === null || y === null || cx === null || cy === null ? null : { x, y, cx, cy };
}

function groupTransform(grp: XmlElement): Affine {
  const xfrm = path(grp, [NS.P, 'grpSpPr'], [NS.A, 'xfrm']);
  const outer = rectOf(xfrm);
  const chOff = kid(xfrm, NS.A, 'chOff');
  const chExt = kid(xfrm, NS.A, 'chExt');
  const cx = num(chExt, 'cx');
  const cy = num(chExt, 'cy');
  const ox = num(chOff, 'x');
  const oy = num(chOff, 'y');
  if (!outer || !cx || !cy || ox === null || oy === null) return IDENTITY;
  const sx = outer.cx / cx;
  const sy = outer.cy / cy;
  return { sx, sy, tx: outer.x - ox * sx, ty: outer.y - oy * sy };
}

const compose = (parent: Affine, child: Affine): Affine => ({
  sx: parent.sx * child.sx,
  sy: parent.sy * child.sy,
  tx: parent.sx * child.tx + parent.tx,
  ty: parent.sy * child.ty + parent.ty,
});

export interface SlideSize {
  cx: number;
  cy: number;
}

function toBox(r: Rect | null, xf: Affine, size: SlideSize): Box | null {
  if (!r || size.cx <= 0 || size.cy <= 0) return null;
  const round = (n: number) => Math.round(n * 10000) / 10000;
  const box = { x: round((xf.sx * r.x + xf.tx) / size.cx), y: round((xf.sy * r.y + xf.ty) / size.cy), w: round((xf.sx * r.cx) / size.cx), h: round((xf.sy * r.cy) / size.cy) };
  return [box.x, box.y, box.w, box.h].every((n) => Number.isFinite(n) && Math.abs(n) < 50) ? box : null;
}

interface Placeholder {
  type: string;
  idx: string | null;
}

const placeholderOf = (sp: XmlElement): Placeholder | null => {
  const nv = kids(sp, NS.P).find((c) => c.local === 'nvSpPr' || c.local === 'nvPicPr' || c.local === 'nvGraphicFramePr');
  const ph = path(nv, [NS.P, 'nvPr'], [NS.P, 'ph']);
  return ph ? { type: attr(ph, 'type') ?? 'obj', idx: attr(ph, 'idx') } : null;
};

/** Placeholder kinds as a master names them. */
const family = (type: string): string => (type === 'ctrTitle' ? 'title' : type === 'subTitle' || type === 'obj' ? 'body' : type);

const AUTOMATIC = new Set(['dt', 'ftr', 'sldNum', 'hdr']);

interface Frame {
  ph: Placeholder;
  rect: Rect | null;
}

/** The placeholders of one layout or master, findable by index and by kind without looking through them all. */
interface FrameSet {
  /** The first placeholder with each `idx`. */
  byIdx: Map<string, Frame>;
  /** The first placeholder of each family (title, body, …). */
  byFamily: Map<string, Frame>;
}

/** Where a placeholder sits when the slide does not say: its layout's placeholder, then the master's. */
export interface PlaceholderFrames {
  layout: FrameSet;
  master: FrameSet;
}

const NO_FRAMES: FrameSet = { byIdx: new Map(), byFamily: new Map() };

/** For a walk that needs the words and not where they sit (writing edits back): no layout is read. */
export const NO_PLACEHOLDER_FRAMES: PlaceholderFrames = { layout: NO_FRAMES, master: NO_FRAMES };

function framesOf(doc: XmlDoc | null): FrameSet {
  const tree = path(doc?.root, [NS.P, 'cSld'], [NS.P, 'spTree']);
  if (!tree) return NO_FRAMES;
  const set: FrameSet = { byIdx: new Map(), byFamily: new Map() };
  for (const sp of tree.children) {
    if (sp.kind !== 'el' || sp.ns !== NS.P || (sp.local !== 'sp' && sp.local !== 'pic')) continue;
    const ph = placeholderOf(sp);
    if (!ph) continue;
    const frame = { ph, rect: rectOf(path(sp, [NS.P, 'spPr'], [NS.A, 'xfrm'])) };
    if (ph.idx !== null && !set.byIdx.has(ph.idx)) set.byIdx.set(ph.idx, frame);
    if (!set.byFamily.has(family(ph.type))) set.byFamily.set(family(ph.type), frame);
  }
  return set;
}

/** The layout and master a slide (or notes page) inherits from, read once per layout. */
export function placeholderFrames(pkg: PptxPackage, slidePart: string, cache: Map<string, PlaceholderFrames>): PlaceholderFrames {
  const layoutPart = pkg.sourceRels(slidePart).find((r) => r.kind === 'slideLayout' && r.target)?.target ?? null;
  const key = layoutPart ?? '';
  const hit = cache.get(key);
  if (hit) return hit;
  let frames: PlaceholderFrames = { layout: NO_FRAMES, master: NO_FRAMES };
  // The layout and master are read as uploaded: an edit never changes them.
  if (layoutPart && pkg.sourceHas(layoutPart)) {
    const masterPart = pkg.sourceRels(layoutPart).find((r) => r.kind === 'slideMaster' && r.target)?.target ?? null;
    frames = { layout: framesOf(pkg.sourceXml(layoutPart)), master: masterPart && pkg.sourceHas(masterPart) ? framesOf(pkg.sourceXml(masterPart)) : NO_FRAMES };
  }
  cache.set(key, frames);
  return frames;
}

function inheritedRect(ph: Placeholder, frames: PlaceholderFrames): Rect | null {
  const inLayout = (ph.idx !== null ? frames.layout.byIdx.get(ph.idx) : undefined) ?? frames.layout.byFamily.get(family(ph.type));
  if (inLayout?.rect) return inLayout.rect;
  const type = inLayout ? inLayout.ph.type : ph.type;
  return frames.master.byFamily.get(family(type))?.rect ?? null;
}

const nameOf = (el: XmlElement): string => {
  for (const nv of kids(el, NS.P)) {
    if (!nv.local.startsWith('nv')) continue;
    const c = kid(nv, NS.P, 'cNvPr');
    if (c) return (attr(c, 'name') ?? '').slice(0, 120);
  }
  return '';
};

const GRAPHIC_URI: Array<[needle: string, kind: KeptKind]> = [
  ['/chart', 'chart'],
  ['/diagram', 'diagram'],
  ['/table', 'table'],
  ['/ole', 'embedded'],
];

/** Read a slide (or a notes page) part. `size` is the slide size in EMU. */
export function walkSlide(doc: XmlDoc, size: SlideSize, frames: PlaceholderFrames): WalkedSlide {
  const out: WalkedSlide = { blocks: [], objects: [], hidden: attr(doc.root, 'show') === '0', animations: false, transition: false };
  for (const c of kids(doc.root)) {
    if (c.ns === NS.P && c.local === 'timing') out.animations = true;
    if (c.local === 'transition') out.transition = true;
    // A transition newer than PowerPoint 2007 is wrapped in an AlternateContent.
    if (c.ns === NS.MC && c.local === 'AlternateContent') for (const d of descendants(c)) if (d.local === 'transition') out.transition = true;
  }
  const tree = path(doc.root, [NS.P, 'cSld'], [NS.P, 'spTree']);
  if (!tree) return out;
  let n = 0;
  const addBlock = (txBody: XmlElement, role: BlockRole, name: string, box: Box | null) => {
    const { paragraphs, editable } = textBodyText(txBody);
    if (!paragraphs.length) return;
    out.blocks.push({ info: { id: `b${n++}`, role, name, paragraphs, editable, box }, txBody });
  };

  const walk = (group: XmlElement, xf: Affine, depth: number) => {
    if (depth > 24) return;
    for (const el of kids(group)) {
      if (el.ns === NS.MC && el.local === 'AlternateContent') {
        // Two renderings of one object (an equation and its picture, a new shape and its fallback). Changing the
        // words of one would leave the other saying something else, so both are left alone.
        let maths = false;
        for (const d of descendants(el)) if (d.ns === NS.MATH) maths = true;
        out.objects.push({ kind: maths ? 'equation' : 'special', name: '', box: null });
        continue;
      }
      if (el.ns !== NS.P) continue;
      if (el.local === 'grpSp') walk(el, compose(xf, groupTransform(el)), depth + 1);
      else if (el.local === 'sp') {
        const ph = placeholderOf(el);
        const name = nameOf(el);
        const rect = rectOf(path(el, [NS.P, 'spPr'], [NS.A, 'xfrm'])) ?? (ph ? inheritedRect(ph, frames) : null);
        const box = toBox(rect, xf, size);
        const txBody = kid(el, NS.P, 'txBody');
        if (ph && AUTOMATIC.has(ph.type)) {
          out.objects.push({ kind: 'footer', name, box });
          continue;
        }
        if (!txBody) continue;
        const role: BlockRole = !ph ? 'text' : ph.type === 'title' || ph.type === 'ctrTitle' ? 'title' : ph.type === 'subTitle' ? 'subtitle' : 'body';
        addBlock(txBody, role, name, box);
      } else if (el.local === 'pic') {
        const nvPr = path(el, [NS.P, 'nvPicPr'], [NS.P, 'nvPr']);
        const kind: KeptKind = kid(nvPr, NS.A, 'videoFile') ? 'video' : kid(nvPr, NS.A, 'audioFile') ? 'audio' : 'picture';
        const ph = placeholderOf(el);
        const rect = rectOf(path(el, [NS.P, 'spPr'], [NS.A, 'xfrm'])) ?? (ph ? inheritedRect(ph, frames) : null);
        out.objects.push({ kind, name: nameOf(el), box: toBox(rect, xf, size) });
      } else if (el.local === 'graphicFrame') {
        const rect = rectOf(kid(el, NS.P, 'xfrm'));
        const data = path(el, [NS.A, 'graphic'], [NS.A, 'graphicData']);
        const uri = attr(data, 'uri') ?? '';
        const kind = GRAPHIC_URI.find(([needle]) => uri.includes(needle))?.[1] ?? 'graphic';
        const name = nameOf(el);
        out.objects.push({ kind, name, box: toBox(rect, xf, size) });
        const tbl = kind === 'table' ? kid(data, NS.A, 'tbl') : null;
        if (!tbl) continue;
        // A table's cells are ordinary text bodies: their words can change, the grid stays as it is.
        const widths = kids(kid(tbl, NS.A, 'tblGrid') ?? tbl, NS.A, 'gridCol').map((g) => num(g, 'w') ?? 0);
        let y = rect?.y ?? 0;
        kids(tbl, NS.A, 'tr').forEach((tr, r) => {
          const h = num(tr, 'h') ?? 0;
          let x = rect?.x ?? 0;
          kids(tr, NS.A, 'tc').forEach((tc, c) => {
            // A cell cannot span past the grid, whatever number the file gives (it may give any).
            const last = Math.min(widths.length, c + Math.max(1, num(tc, 'gridSpan') ?? 1));
            let w = 0;
            for (let k = c; k < last; k++) w += widths[k]!;
            const merged = attr(tc, 'hMerge') === '1' || attr(tc, 'vMerge') === '1';
            const txBody = kid(tc, NS.A, 'txBody');
            if (txBody && !merged) addBlock(txBody, 'cell', `${name || 'Table'} R${r + 1}C${c + 1}`.slice(0, 120), rect ? toBox({ x, y, cx: w, cy: h }, xf, size) : null);
            x += widths[c] ?? 0;
          });
          y += h;
        });
      } else if (el.local === 'contentPart') out.objects.push({ kind: 'ink', name: '', box: null });
    }
  };
  walk(tree, IDENTITY, 0);
  return out;
}
