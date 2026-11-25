/**
 * A small, invented PowerPoint package for tests: just enough real structure to exercise everything the uploaded
 * deck engine does. Three slides on one layout and master; a title and a bulleted body with mixed formatting; a
 * text box inside a group; a table; a slide-number field; a chart (which stops a slide being copied); notes on the
 * first slide and a notes master; sections; a link from slide 3 to slide 2; a custom show.
 *
 * Parts are plain strings keyed by part name. The server tests zip them; the core tests read them directly.
 */
import { encodeUtf8, type PartSource } from './opc';

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NSDECL = `xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"`;
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const rels = (items: Array<[id: string, kind: string, target: string, external?: boolean]>) =>
  `${HEAD}<Relationships xmlns="${REL}">${items
    .map(([id, kind, target, external]) => `<Relationship Id="${id}" Type="${kind.startsWith('http') ? kind : `${OD}/${kind}`}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`)
    .join('')}</Relationships>`;

const group = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

const placeholder = (id: number, name: string, type: string, idx: string | null, body: string, xfrm = '') =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="${type}"${idx ? ` idx="${idx}"` : ''}/></p:nvPr></p:nvSpPr><p:spPr>${xfrm}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${body}</p:txBody></p:sp>`;

const xfrm = (x: number, y: number, cx: number, cy: number) => `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`;

const slide = (shapes: string, extra = '') => `${HEAD}<p:sld ${NSDECL}><p:cSld><p:spTree>${group}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${extra}</p:sld>`;

export const SYNTHETIC = {
  /** Slide 1 body, as its paragraphs read. */
  body1: ['Plants need sunlight and water.', 'Second point', ''],
  title1: 'Parts of a plant',
  notes1: ['Ask the class what plants need.', 'Wait for three answers.'],
};

/** The parts of the invented deck. `extra` adds or replaces parts; a null value removes one. */
export function syntheticDeckParts(extra: Record<string, string | Uint8Array | null> = {}): Record<string, string | Uint8Array> {
  const parts: Record<string, string | Uint8Array> = {
    '[Content_Types].xml':
      `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
      '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
      '<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>' +
      [1, 2, 3].map((n) => `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('') +
      '<Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>' +
      '<Override PartName="/ppt/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>' +
      '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
    '_rels/.rels': rels([
      ['rId1', 'officeDocument', 'ppt/presentation.xml'],
      ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
    ]),
    'docProps/core.xml': `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Plants — Grade 4</dc:title><dc:creator>A Teacher</dc:creator></cp:coreProperties>`,
    'ppt/presentation.xml':
      `${HEAD}<p:presentation ${NSDECL} xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
      '<p:notesMasterIdLst><p:notesMasterId r:id="rId5"/></p:notesMasterIdLst>' +
      '<p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/><p:sldId id="258" r:id="rId4"/></p:sldIdLst>' +
      '<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>' +
      '<p:custShowLst><p:custShow name="Short" id="0"><p:sldLst><p:sld r:id="rId2"/><p:sld r:id="rId4"/></p:sldLst></p:custShow></p:custShowLst>' +
      '<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst><p14:section name="Start" id="{11111111-1111-1111-1111-111111111111}"><p14:sldIdLst><p14:sldId id="256"/></p14:sldIdLst></p14:section>' +
      '<p14:section name="Rest" id="{22222222-2222-2222-2222-222222222222}"><p14:sldIdLst><p14:sldId id="257"/><p14:sldId id="258"/></p14:sldIdLst></p14:section></p14:sectionLst></p:ext></p:extLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': rels([
      ['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'],
      ['rId2', 'slide', 'slides/slide1.xml'],
      ['rId3', 'slide', 'slides/slide2.xml'],
      ['rId4', 'slide', 'slides/slide3.xml'],
      ['rId5', 'notesMaster', 'notesMasters/notesMaster1.xml'],
      ['rId6', 'theme', 'theme/theme1.xml'],
    ]),
    'ppt/theme/theme1.xml': `${HEAD}<a:theme xmlns:a="${A}" name="Test"><a:themeElements/></a:theme>`,
    'ppt/slideMasters/slideMaster1.xml':
      `${HEAD}<p:sldMaster ${NSDECL}><p:cSld><p:spTree>${group}` +
      placeholder(2, 'Title Placeholder 1', 'title', null, '<a:p><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master title style</a:t></a:r></a:p>', xfrm(838200, 365125, 10515600, 1325563)) +
      placeholder(3, 'Text Placeholder 2', 'body', '1', '<a:p><a:r><a:rPr lang="en-US"/><a:t>Master text</a:t></a:r></a:p>', xfrm(838200, 1825625, 10515600, 4351338)) +
      '</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>',
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': rels([
      ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
      ['rId2', 'theme', '../theme/theme1.xml'],
    ]),
    'ppt/slideLayouts/slideLayout1.xml':
      `${HEAD}<p:sldLayout ${NSDECL} type="obj"><p:cSld name="Title and Content"><p:spTree>${group}` +
      placeholder(2, 'Title 1', 'title', null, '<a:p><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master title style</a:t></a:r></a:p>') +
      placeholder(3, 'Content Placeholder 2', 'body', '1', '<a:p><a:r><a:rPr lang="en-US"/><a:t>Layout text</a:t></a:r></a:p>', xfrm(1000000, 2000000, 6096000, 3429000)) +
      '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>',
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]),
    'ppt/notesMasters/notesMaster1.xml': `${HEAD}<p:notesMaster ${NSDECL}><p:cSld><p:spTree>${group}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:notesMaster>`,
    'ppt/notesMasters/_rels/notesMaster1.xml.rels': rels([['rId1', 'theme', '../theme/theme1.xml']]),

    // Slide 1: title (inherits its place from the master), a body with mixed formatting, and a text box in a group.
    'ppt/slides/slide1.xml': slide(
      placeholder(2, 'Title 1', 'title', null, `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${SYNTHETIC.title1}</a:t></a:r></a:p>`) +
        placeholder(
          3,
          'Content Placeholder 2',
          'body',
          '1',
          '<a:p><a:pPr marL="342900" indent="-342900"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>' +
            '<a:r><a:rPr lang="en-US" dirty="0"/><a:t>Plants need </a:t></a:r><a:r><a:rPr lang="en-US" b="1" dirty="0"><a:solidFill><a:srgbClr val="2F6360"/></a:solidFill></a:rPr><a:t>sunlight</a:t></a:r><a:r><a:rPr lang="en-US" dirty="0"/><a:t> and water.</a:t></a:r></a:p>' +
            '<a:p><a:pPr marL="342900" indent="-342900"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="en-US" i="1"/><a:t>Second point</a:t></a:r></a:p>' +
            '<a:p><a:endParaRPr lang="en-US" sz="2000"/></a:p>'
        ) +
        `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="10" name="Group 9"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="6096000" y="3429000"/><a:ext cx="3048000" cy="1714500"/><a:chOff x="0" y="0"/><a:chExt cx="6096000" cy="3429000"/></a:xfrm></p:grpSpPr>` +
        `<p:sp><p:nvSpPr><p:cNvPr id="11" name="TextBox 10"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(0, 0, 3048000, 1714500)}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Line one</a:t></a:r><a:br><a:rPr lang="en-US"/></a:br><a:r><a:rPr lang="en-US"/><a:t>line two</a:t></a:r></a:p></p:txBody></p:sp></p:grpSp>`,
      '<p:extLst><p:ext uri="{BB962C8B-B14F-4D97-AF65-F5344CB8AC3E}"><p14:creationId xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" val="1234567890"/></p:ext></p:extLst>'
    ),
    'ppt/slides/_rels/slide1.xml.rels': rels([
      ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
      ['rId2', 'notesSlide', '../notesSlides/notesSlide1.xml'],
      ['rId3', 'image', '../media/image1.png'],
    ]),
    'ppt/media/image1.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]),
    'ppt/notesSlides/notesSlide1.xml':
      `${HEAD}<p:notes ${NSDECL}><p:cSld><p:spTree>${group}` +
      placeholder(3, 'Notes Placeholder 2', 'body', '1', SYNTHETIC.notes1.map((t) => `<a:p><a:r><a:rPr lang="en-US"/><a:t>${t}</a:t></a:r></a:p>`).join('')) +
      '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>',
    'ppt/notesSlides/_rels/notesSlide1.xml.rels': rels([
      ['rId1', 'notesMaster', '../notesMasters/notesMaster1.xml'],
      ['rId2', 'slide', '../slides/slide1.xml'],
    ]),

    // Slide 2: a table, a slide-number field in a text box (shown, not edited), and a chart.
    'ppt/slides/slide2.xml': slide(
      placeholder(2, 'Title 1', 'title', null, '<a:p><a:r><a:rPr lang="en-US"/><a:t>Roots &amp; shoots</a:t></a:r></a:p>') +
        `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Table 3"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="1000000" y="2000000"/><a:ext cx="4000000" cy="800000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/><a:tblGrid><a:gridCol w="2000000"/><a:gridCol w="2000000"/></a:tblGrid>` +
        ['Part', 'Job', 'Root', 'Takes in water'].reduce((acc, text, i) => `${acc}${i % 2 === 0 ? '<a:tr h="400000">' : ''}<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${text}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>${i % 2 === 1 ? '</a:tr>' : ''}`, '') +
        '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>' +
        `<p:sp><p:nvSpPr><p:cNvPr id="5" name="TextBox 4"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(9000000, 6000000, 2000000, 400000)}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Page </a:t></a:r><a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum"><a:rPr lang="en-US"/><a:t>2</a:t></a:fld></a:p></p:txBody></p:sp>` +
        `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="Chart 5"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="6000000" y="2000000"/><a:ext cx="4000000" cy="3000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId2"/></a:graphicData></a:graphic></p:graphicFrame>`,
      '<p:transition spd="slow"><p:fade/></p:transition><p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"/></p:par></p:tnLst></p:timing>'
    ),
    'ppt/slides/_rels/slide2.xml.rels': rels([
      ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
      ['rId2', 'chart', '../charts/chart1.xml'],
      ['rId3', 'hyperlink', 'https://example.invalid/more', true],
    ]),
    'ppt/charts/chart1.xml': `${HEAD}<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart/></c:chartSpace>`,

    // Slide 3: hidden, with a link that jumps to slide 2, and no notes page.
    'ppt/slides/slide3.xml': `${HEAD}<p:sld ${NSDECL} show="0"><p:cSld><p:spTree>${group}${placeholder(
      2,
      'Title 1',
      'title',
      null,
      '<a:p><a:r><a:rPr lang="en-US"><a:hlinkClick r:id="rId2" action="ppaction://hlinksldjump"/></a:rPr><a:t>Back to roots</a:t></a:r></a:p>'
    )}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
    'ppt/slides/_rels/slide3.xml.rels': rels([
      ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
      ['rId2', 'slide', 'slide2.xml'],
    ]),
  };
  for (const [name, value] of Object.entries(extra)) {
    if (value === null) delete parts[name];
    else parts[name] = value;
  }
  return parts;
}

/** The invented deck as a package source (no ZIP involved). */
export function syntheticDeck(extra: Record<string, string | Uint8Array | null> = {}): PartSource {
  const parts = syntheticDeckParts(extra);
  return { names: Object.keys(parts), read: (name) => (typeof parts[name] === 'string' ? encodeUtf8(parts[name] as string) : (parts[name] as Uint8Array)) };
}
