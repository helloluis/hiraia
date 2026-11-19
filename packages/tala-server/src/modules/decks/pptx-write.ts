/**
 * A teacher's copy as an editable PowerPoint file.
 *
 * Input is the display list from `layoutDeck` (@hiraia/tala-core/decks), the same one the browser draws, so the
 * download looks like what the teacher saw. Output follows the decks the pack renderer builds, part for part
 * (./pptx-template holds the fixed parts taken from one), and keeps their promises to teachers:
 *   - every word is real text in a text box, a placeholder or a text-bearing shape (answer choices are one shape
 *     each); the slide title sits in the layout's title placeholder;
 *   - lists are native (auto-numbering and bullet characters with the teal marker), never typed "1." or "•";
 *   - only the deck's Office fonts (Cambria, Calibri);
 *   - pictures are only the drawings and the two brand marks, each with alt text; a drawing's bytes are embedded
 *     exactly as stored (the Hiraia-watermarked derivative), aspect kept, centred in its plate;
 *   - speaker notes on every slide.
 * Self-contained: nothing is read from the library at export time, so a copy still downloads after the library is
 * refreshed or its pack is withdrawn. The same input always gives the same bytes.
 */
import { DECK_FONTS, SLIDE_H, SLIDE_W } from '@hiraia/tala-core/decks';
import type {
  BoxShape,
  ImageItem,
  LayoutItem,
  Paragraph,
  ShapeItem,
  SlideLayout,
  TextItem,
} from '@hiraia/tala-core/decks';
import type { PackLang } from '@hiraia/tala-core/contracts';
import {
  DEFAULT_TEXT_STYLE_XML,
  FOOTER_TOKEN,
  GLYPH_PNG_BASE64,
  NOTES_MASTER_XML,
  PRES_PROPS_XML,
  SLIDE_LAYOUTS,
  SLIDE_MASTER_XML,
  TABLE_STYLES_XML,
  THEME_XML,
  VIEW_PROPS_XML,
  WORDMARK_PNG_BASE64,
} from './pptx-template';
import { sha256Hex } from './pptx-read';
import { writeZip, type ZipInput } from './zip';

export const PPTX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export interface DeckDrawingBytes {
  bytes: Uint8Array;
  width: number;
  height: number;
}

export interface DeckFileInput {
  /** Document title (file properties), e.g. the deck's name with its grade, term and week. */
  title: string;
  language: PackLang;
  slides: SlideLayout[];
  /** Drawing bytes by slug. A slide whose drawing is missing here is written without the picture (its plate stays). */
  drawings: ReadonlyMap<string, DeckDrawingBytes>;
  /** ISO date-times for the file properties. */
  createdAt: string;
  modifiedAt: string;
}

const EMU = 914400;
const PT = 12700;
const emu = (inches: number) => Math.round(inches * EMU);
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PML = 'application/vnd.openxmlformats-officedocument.presentationml';
const SLIDE_NUMBER_FIELD = '{F7021451-1387-4CA6-816F-3879F97B5CBC}';
/** layoutDeck's master → the layout part that carries it (slideLayout1 is pptxgenjs's unused DEFAULT). */
const LAYOUT_PART: Record<SlideLayout['master'], number> = { light: 2, lightSplit: 3, dark: 4 };

/** Characters XML 1.0 cannot carry (and lone surrogates) are dropped; a deck must always open. */
// eslint-disable-next-line no-control-regex
const UNSAFE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export const xmlText = (s: string): string =>
  s.replace(UNSAFE, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xmlAttr = (s: string): string => xmlText(s.replace(/\s+/g, ' ')).replace(/"/g, '&quot;');
/** Text on a slide is one line per paragraph: a pasted line break or tab becomes a space. */
const oneLine = (s: string): string => s.replace(/[\t\r\n\u2028\u2029]+/g, ' ');

const langTag = (language: PackLang) => (language === 'fil' ? 'fil-PH' : 'en-US');

function geometry(shape: BoxShape | null, cx: number, cy: number): string {
  if (!shape) return '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
  if (shape.kind === 'ellipse') return '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>';
  const adj = Math.max(
    0,
    Math.min(50000, Math.round((shape.radius * EMU * 100000) / Math.max(1, Math.min(cx, cy))))
  );
  return `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${adj}"/></a:avLst></a:prstGeom>`;
}

function fillAndLine(shape: BoxShape | null): string {
  const fill = shape?.fill
    ? `<a:solidFill><a:srgbClr val="${shape.fill}"/></a:solidFill>`
    : '<a:noFill/>';
  const line = shape?.line
    ? `<a:ln w="${Math.round(shape.line.width * PT)}"><a:solidFill><a:srgbClr val="${shape.line.color}"/></a:solidFill><a:prstDash val="solid"/></a:ln>`
    : '<a:ln/>';
  return fill + line;
}

const xfrm = (b: { x: number; y: number; w: number; h: number }) =>
  `<a:xfrm><a:off x="${emu(b.x)}" y="${emu(b.y)}"/><a:ext cx="${Math.max(1, emu(b.w))}" cy="${Math.max(1, emu(b.h))}"/></a:xfrm>`;

function paragraphXml(p: Paragraph, item: TextItem, lang: string): string {
  const face = DECK_FONTS[item.font];
  const sz = Math.round(item.size * 100);
  const algn =
    item.align === 'center'
      ? ' algn="ctr"'
      : item.align === 'right'
        ? ' algn="r"'
        : item.titlePlaceholder
          ? ' algn="l"'
          : '';
  const after =
    p.spaceAfter > 0
      ? `<a:spcAft><a:spcPts val="${Math.round(p.spaceAfter * 100)}"/></a:spcAft>`
      : '';
  // Native lists: PowerPoint numbers and bullets the lines itself, so adding or moving a line stays right.
  const marker = '<a:buClr><a:schemeClr val="accent1"/></a:buClr><a:buSzPct val="100000"/>';
  const pPr =
    p.list === 'number'
      ? `<a:pPr${algn} marL="381000" indent="-381000">${after}${marker}<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/></a:pPr>`
      : p.list === 'bullet'
        ? `<a:pPr${algn} marL="330200" indent="-330200">${after}${marker}<a:buChar char="&#x2022;"/></a:pPr>`
        : `<a:pPr${algn} indent="0" marL="0">${after}<a:buNone/></a:pPr>`;
  const spacing = item.spacing ? ` spc="${Math.round(item.spacing * 100)}" kern="0"` : '';
  const runs = p.runs
    .filter((r) => r.text !== '')
    .map((r) => {
      const bold = (r.bold ?? item.bold) ? ' b="1"' : '';
      const fonts = `<a:latin typeface="${face}" pitchFamily="34" charset="0"/><a:ea typeface="${face}" pitchFamily="34" charset="-122"/><a:cs typeface="${face}" pitchFamily="34" charset="-120"/>`;
      return `<a:r><a:rPr lang="${lang}" sz="${sz}"${bold}${spacing} dirty="0"><a:solidFill><a:srgbClr val="${r.color ?? item.color}"/></a:solidFill>${fonts}</a:rPr><a:t>${xmlText(oneLine(r.text))}</a:t></a:r>`;
    })
    .join('');
  return `<a:p>${pPr}${runs}<a:endParaRPr lang="${lang}" sz="${sz}" dirty="0"/></a:p>`;
}

function textShapeXml(item: TextItem, id: number, lang: string): string {
  const cx = Math.max(1, emu(item.w));
  const cy = Math.max(1, emu(item.h));
  const [l, r, b, t] = item.margin;
  const nv = item.titlePlaceholder
    ? `<p:cNvSpPr/><p:nvPr><p:ph idx="101" type="title" hasCustomPrompt="1"/></p:nvPr>`
    : `<p:cNvSpPr${item.shape ? '' : ' txBox="1"'}/><p:nvPr/>`;
  // A text body always holds at least one paragraph.
  const paragraphs = item.paragraphs.length
    ? item.paragraphs
    : [{ runs: [], list: null, spaceAfter: 0 } satisfies Paragraph];
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xmlAttr(item.name)}"/>${nv}</p:nvSpPr>` +
    `<p:spPr>${xfrm(item)}${geometry(item.shape, cx, cy)}${fillAndLine(item.shape)}</p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square" lIns="${Math.round(l * PT)}" tIns="${Math.round(t * PT)}" rIns="${Math.round(r * PT)}" bIns="${Math.round(b * PT)}" rtlCol="0" anchor="${item.valign === 'middle' ? 'ctr' : 't'}"/><a:lstStyle/>` +
    paragraphs.map((p) => paragraphXml(p, item, lang)).join('') +
    `</p:txBody></p:sp>`
  );
}

function plainShapeXml(item: ShapeItem, id: number): string {
  const cx = Math.max(1, emu(item.w));
  const cy = Math.max(1, emu(item.h));
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xmlAttr(item.name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(item)}${geometry(item.shape, cx, cy)}${fillAndLine(item.shape)}</p:spPr></p:sp>`;
}

function pictureXml(
  item: ImageItem,
  id: number,
  relId: string,
  box: { x: number; y: number; w: number; h: number }
): string {
  return (
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${xmlAttr(item.name)}" descr="${xmlAttr(item.alt || item.name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr>${xfrm(box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
  );
}

/** A drawing keeps its proportions and sits centred in the area the layout gave it. */
export function fitInside(
  area: { x: number; y: number; w: number; h: number },
  px: { width: number; height: number }
) {
  const scale = Math.min(area.w / px.width, area.h / px.height);
  const w = px.width * scale;
  const h = px.height * scale;
  return { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h };
}

const GROUP =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

function slideNumberXml(id: number, n: number, color: string, lang: string): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Slide Number Placeholder 0"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldNum" sz="quarter" idx="4294967295"/></p:nvPr></p:nvSpPr>` +
    `<p:spPr>${xfrm({ x: SLIDE_W - 0.6 - 0.8, y: SLIDE_H - 0.48, w: 0.8, h: 0.3 })}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr><a:defRPr sz="1200"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${DECK_FONTS.body}"/><a:ea typeface="${DECK_FONTS.body}"/><a:cs typeface="${DECK_FONTS.body}"/></a:defRPr></a:lvl1pPr></a:lstStyle>` +
    `<a:p><a:pPr algn="r"/><a:fld id="${SLIDE_NUMBER_FIELD}" type="slidenum"><a:rPr b="0" lang="${lang}"/><a:t>${n}</a:t></a:fld><a:endParaRPr lang="${lang}"/></a:p></p:txBody></p:sp>`
  );
}

function notesXml(notes: string, n: number, lang: string): string {
  const lines = notes
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\t/g, ' ').trimEnd());
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const paragraphs = lines
    .map((l) =>
      l
        ? `<a:p><a:r><a:rPr lang="${lang}" dirty="0"/><a:t>${xmlText(l)}</a:t></a:r><a:endParaRPr lang="${lang}" dirty="0"/></a:p>`
        : `<a:p><a:endParaRPr lang="${lang}" dirty="0"/></a:p>`
    )
    .join('');
  return (
    `${XML_HEAD}<p:notes ${NS}><p:cSld><p:spTree>${GROUP}` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="4" name="Slide Number Placeholder 3"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldNum" sz="quarter" idx="10"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:fld id="${SLIDE_NUMBER_FIELD}" type="slidenum"><a:rPr lang="${lang}"/><a:t>${n}</a:t></a:fld><a:endParaRPr lang="${lang}"/></a:p></p:txBody></p:sp>` +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`
  );
}

const relsXml = (rels: Array<{ id: string; type: string; target: string }>) =>
  `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${xmlAttr(r.target)}"/>`).join('')}</Relationships>`;

/** A stable GUID from text (PowerPoint wants one per section). */
const guid = (seed: string) => {
  const h = sha256Hex(Buffer.from(seed, 'utf8'));
  return `{${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}}`;
};

/** `2026-11-19T07:57:58.123Z` → `2026-11-19T07:57:58Z` (the form Office writes); anything unreadable → a fixed date. */
const w3cdtf = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t)
    ? '2026-01-01T00:00:00Z'
    : new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
};

export function writeDeckPptx(input: DeckFileInput): Uint8Array {
  const lang = langTag(input.language);
  const n = input.slides.length;
  if (n < 1) throw new Error('A deck needs at least one slide.');
  const footer = xmlText(oneLine(input.slides[0]!.footer.text));

  // Media: one part per distinct picture, in first-use order.
  const media: Array<{ part: string; bytes: Uint8Array }> = [];
  const mediaBySha = new Map<string, string>();
  const partFor = (bytes: Uint8Array) => {
    const key = sha256Hex(bytes);
    let part = mediaBySha.get(key);
    if (!part) {
      part = `ppt/media/image${media.length + 1}.png`;
      mediaBySha.set(key, part);
      media.push({ part, bytes });
    }
    return part;
  };
  const brand = {
    glyph: { bytes: new Uint8Array(Buffer.from(GLYPH_PNG_BASE64, 'base64')) },
    wordmark: { bytes: new Uint8Array(Buffer.from(WORDMARK_PNG_BASE64, 'base64')) },
  };

  const slideFiles: ZipInput[] = [];
  const notesFiles: ZipInput[] = [];
  input.slides.forEach((slide, i) => {
    const num = i + 1;
    const rels: Array<{ id: string; type: string; target: string }> = [];
    const relFor = (part: string) => {
      const target = `../media/${part.slice('ppt/media/'.length)}`;
      let rel = rels.find((r) => r.target === target);
      if (!rel) {
        rel = { id: `rId${rels.length + 1}`, type: `${REL}/image`, target };
        rels.push(rel);
      }
      return rel.id;
    };
    let id = 1;
    const shapes = slide.items
      .map((item: LayoutItem) => {
        if (item.type === 'text') return textShapeXml(item, ++id, lang);
        if (item.type === 'shape') return plainShapeXml(item, ++id);
        if (item.source.kind === 'brand')
          return pictureXml(item, ++id, relFor(partFor(brand[item.source.mark].bytes)), item);
        const drawing = input.drawings.get(item.source.slug);
        // No bytes for this drawing: the slide is written without it rather than with a broken picture.
        return drawing
          ? pictureXml(item, ++id, relFor(partFor(drawing.bytes)), fitInside(item, drawing))
          : '';
      })
      .join('');
    const xml =
      `${XML_HEAD}<p:sld ${NS}><p:cSld name="Slide ${num}"><p:spTree>${GROUP}${shapes}${slideNumberXml(++id, num, slide.numberColor, lang)}</p:spTree></p:cSld>` +
      `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
    rels.push({
      id: `rId${rels.length + 1}`,
      type: `${REL}/slideLayout`,
      target: `../slideLayouts/slideLayout${LAYOUT_PART[slide.master]}.xml`,
    });
    rels.push({
      id: `rId${rels.length + 1}`,
      type: `${REL}/notesSlide`,
      target: `../notesSlides/notesSlide${num}.xml`,
    });
    slideFiles.push(
      { name: `ppt/slides/slide${num}.xml`, data: xml },
      { name: `ppt/slides/_rels/slide${num}.xml.rels`, data: relsXml(rels) }
    );
    notesFiles.push(
      { name: `ppt/notesSlides/notesSlide${num}.xml`, data: notesXml(slide.notes, num, lang) },
      {
        name: `ppt/notesSlides/_rels/notesSlide${num}.xml.rels`,
        data: relsXml([
          { id: 'rId1', type: `${REL}/notesMaster`, target: '../notesMasters/notesMaster1.xml' },
          { id: 'rId2', type: `${REL}/slide`, target: `../slides/slide${num}.xml` },
        ]),
      }
    );
  });

  // Sections: one per run of slides that share a section name (a day, the introduction, the credits).
  const sections: Array<{ name: string; ids: number[] }> = [];
  input.slides.forEach((s, i) => {
    const last = sections[sections.length - 1];
    if (last && last.name === s.section) last.ids.push(256 + i);
    else sections.push({ name: s.section, ids: [256 + i] });
  });
  const sectionXml = sections
    .map(
      (s, k) =>
        `<p14:section name="${xmlAttr(s.name || 'Slides')}" id="${guid(`${k}:${s.name}`)}"><p14:sldIdLst>${s.ids.map((x) => `<p14:sldId id="${x}"/>`).join('')}</p14:sldIdLst></p14:section>`
    )
    .join('');

  const presRels = [
    { id: 'rId1', type: `${REL}/slideMaster`, target: 'slideMasters/slideMaster1.xml' },
    ...input.slides.map((_s, i) => ({
      id: `rId${i + 2}`,
      type: `${REL}/slide`,
      target: `slides/slide${i + 1}.xml`,
    })),
    { id: `rId${n + 2}`, type: `${REL}/notesMaster`, target: 'notesMasters/notesMaster1.xml' },
    { id: `rId${n + 3}`, type: `${REL}/presProps`, target: 'presProps.xml' },
    { id: `rId${n + 4}`, type: `${REL}/viewProps`, target: 'viewProps.xml' },
    { id: `rId${n + 5}`, type: `${REL}/theme`, target: 'theme/theme1.xml' },
    { id: `rId${n + 6}`, type: `${REL}/tableStyles`, target: 'tableStyles.xml' },
  ];
  const presentation =
    // Children in the order the schema gives them (the notes master list comes before the slide list).
    `${XML_HEAD}<p:presentation ${NS} saveSubsetFonts="1" autoCompressPictures="0"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
    `<p:notesMasterIdLst><p:notesMasterId r:id="rId${n + 2}"/></p:notesMasterIdLst>` +
    `<p:sldIdLst>${input.slides.map((_s, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst>` +
    `<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="12192000"/>${DEFAULT_TEXT_STYLE_XML}` +
    `<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">${sectionXml}</p14:sectionLst></p:ext>` +
    `<p:ext uri="{EFAFB233-063F-42B5-8137-9DF3F51BA10A}"><p15:sldGuideLst xmlns:p15="http://schemas.microsoft.com/office/powerpoint/2012/main"/></p:ext></p:extLst></p:presentation>`;

  const override = (part: string, type: string) =>
    `<Override PartName="/${part}" ContentType="${type}"/>`;
  const contentTypes =
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/>` +
    override('ppt/presentation.xml', `${PML}.presentation.main+xml`) +
    override('ppt/slideMasters/slideMaster1.xml', `${PML}.slideMaster+xml`) +
    SLIDE_LAYOUTS.map((_l, i) =>
      override(`ppt/slideLayouts/slideLayout${i + 1}.xml`, `${PML}.slideLayout+xml`)
    ).join('') +
    input.slides
      .map((_s, i) => override(`ppt/slides/slide${i + 1}.xml`, `${PML}.slide+xml`))
      .join('') +
    override('ppt/notesMasters/notesMaster1.xml', `${PML}.notesMaster+xml`) +
    input.slides
      .map((_s, i) => override(`ppt/notesSlides/notesSlide${i + 1}.xml`, `${PML}.notesSlide+xml`))
      .join('') +
    override('ppt/presProps.xml', `${PML}.presProps+xml`) +
    override('ppt/viewProps.xml', `${PML}.viewProps+xml`) +
    override('ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml') +
    override('ppt/tableStyles.xml', `${PML}.tableStyles+xml`) +
    override('docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml') +
    override(
      'docProps/app.xml',
      'application/vnd.openxmlformats-officedocument.extended-properties+xml'
    ) +
    `</Types>`;

  const app =
    `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
    `<TotalTime>0</TotalTime><Words>0</Words><Application>Microsoft Office PowerPoint</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat><Paragraphs>0</Paragraphs>` +
    `<Slides>${n}</Slides><Notes>${n}</Notes><HiddenSlides>0</HiddenSlides><MMClips>0</MMClips><ScaleCrop>false</ScaleCrop>` +
    `<HeadingPairs><vt:vector size="6" baseType="variant"><vt:variant><vt:lpstr>Fonts Used</vt:lpstr></vt:variant><vt:variant><vt:i4>2</vt:i4></vt:variant><vt:variant><vt:lpstr>Theme</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant><vt:variant><vt:lpstr>Slide Titles</vt:lpstr></vt:variant><vt:variant><vt:i4>${n}</vt:i4></vt:variant></vt:vector></HeadingPairs>` +
    `<TitlesOfParts><vt:vector size="${n + 3}" baseType="lpstr"><vt:lpstr>${DECK_FONTS.head}</vt:lpstr><vt:lpstr>${DECK_FONTS.body}</vt:lpstr><vt:lpstr>Tala Hiraia</vt:lpstr>${input.slides.map((_s, i) => `<vt:lpstr>Slide ${i + 1}</vt:lpstr>`).join('')}</vt:vector></TitlesOfParts>` +
    `<Company>Hiraia</Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion></Properties>`;
  const core =
    `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${xmlText(oneLine(input.title))}</dc:title><dc:subject>Philippine Science lesson slides</dc:subject><dc:creator>Hiraia (Tala teaching packs)</dc:creator><cp:lastModifiedBy>Tala (a teacher's own copy)</cp:lastModifiedBy><cp:revision>1</cp:revision>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${w3cdtf(input.createdAt)}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${w3cdtf(input.modifiedAt)}</dcterms:modified></cp:coreProperties>`;

  const layoutRels = relsXml([
    { id: 'rId1', type: `${REL}/slideMaster`, target: '../slideMasters/slideMaster1.xml' },
  ]);
  const files: ZipInput[] = [
    { name: '[Content_Types].xml', data: contentTypes },
    {
      name: '_rels/.rels',
      data: relsXml([
        { id: 'rId1', type: `${REL}/extended-properties`, target: 'docProps/app.xml' },
        {
          id: 'rId2',
          type: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
          target: 'docProps/core.xml',
        },
        { id: 'rId3', type: `${REL}/officeDocument`, target: 'ppt/presentation.xml' },
      ]),
    },
    { name: 'docProps/app.xml', data: app },
    { name: 'docProps/core.xml', data: core },
    { name: 'ppt/_rels/presentation.xml.rels', data: relsXml(presRels) },
    { name: 'ppt/theme/theme1.xml', data: THEME_XML },
    { name: 'ppt/presentation.xml', data: presentation },
    { name: 'ppt/presProps.xml', data: PRES_PROPS_XML },
    { name: 'ppt/tableStyles.xml', data: TABLE_STYLES_XML },
    { name: 'ppt/viewProps.xml', data: VIEW_PROPS_XML },
    ...SLIDE_LAYOUTS.flatMap((l, i) => [
      {
        name: `ppt/slideLayouts/slideLayout${i + 1}.xml`,
        data: l.xml.split(FOOTER_TOKEN).join(footer),
      },
      { name: `ppt/slideLayouts/_rels/slideLayout${i + 1}.xml.rels`, data: layoutRels },
    ]),
    { name: 'ppt/slideMasters/slideMaster1.xml', data: SLIDE_MASTER_XML },
    {
      name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      data: relsXml([
        ...SLIDE_LAYOUTS.map((_l, i) => ({
          id: `rId${i + 1}`,
          type: `${REL}/slideLayout`,
          target: `../slideLayouts/slideLayout${i + 1}.xml`,
        })),
        {
          id: `rId${SLIDE_LAYOUTS.length + 1}`,
          type: `${REL}/theme`,
          target: '../theme/theme1.xml',
        },
      ]),
    },
    { name: 'ppt/notesMasters/notesMaster1.xml', data: NOTES_MASTER_XML },
    {
      name: 'ppt/notesMasters/_rels/notesMaster1.xml.rels',
      data: relsXml([{ id: 'rId1', type: `${REL}/theme`, target: '../theme/theme1.xml' }]),
    },
    ...slideFiles,
    ...notesFiles,
    ...media.map((m) => ({ name: m.part, data: m.bytes })),
  ];
  return writeZip(files);
}
