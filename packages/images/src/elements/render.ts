/**
 * Element renderers.
 *
 * Converts primitive DSL elements (circle, rect, line, arrow, text, etc.)
 * into SVG markup with hand-drawn effects applied.
 */

import type {
  Element,
  ElementStyle,
  CircleElement,
  RectElement,
  EllipseElement,
  LineElement,
  ArrowElement,
  TextElement,
  PathElement,
  ArcElement,
  BlobElement,
  GroupElement,
  SceneStyle,
  Point,
} from '../types.js';
import {
  roughCircle,
  roughEllipse,
  roughRect,
  roughLine,
  roughArc,
} from '../effects/rough.js';
import { generateBlobPath, generateLeafPath } from '../effects/shapes.js';

/** Round to 2 decimal places for compact SVG. */
function r(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Escape special characters for SVG text content. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Build SVG style attributes from ElementStyle, falling back to scene defaults. */
function buildStyleAttrs(
  style: ElementStyle | undefined,
  sceneStyle: SceneStyle,
  defaultFill = 'none'
): string {
  const stroke = style?.stroke ?? sceneStyle.stroke ?? '#000';
  const strokeWidth = style?.strokeWidth ?? sceneStyle.strokeWidth ?? 1.5;
  const fill = style?.fill ?? (defaultFill === 'none' ? 'none' : defaultFill);
  const opacity = style?.opacity ?? 1;
  const strokeStyle = style?.strokeStyle ?? 'solid';

  let dasharray = '';
  if (strokeStyle === 'dashed') dasharray = 'stroke-dasharray="6,3"';
  else if (strokeStyle === 'dotted') dasharray = 'stroke-dasharray="2,2"';

  return `stroke="${stroke}" stroke-width="${strokeWidth}" fill="${fill}" opacity="${opacity}" ${dasharray}`;
}

/** Render a circle element. */
export function renderCircle(
  el: CircleElement,
  sceneStyle: SceneStyle,
  rng: () => number
): string {
  const roughness = sceneStyle.roughness ?? 1;
  const styleAttrs = buildStyleAttrs(el.style, sceneStyle);
  const id = el.id ? ` id="${el.id}"` : '';

  if (roughness > 0) {
    const d = roughCircle(el.cx, el.cy, el.r, roughness, rng);
    return `<path${id} d="${d}" ${styleAttrs}/>`;
  }

  return `<circle${id} cx="${el.cx}" cy="${el.cy}" r="${el.r}" ${styleAttrs}/>`;
}

/** Render a rectangle element. */
export function renderRect(
  el: RectElement,
  sceneStyle: SceneStyle,
  rng: () => number
): string {
  const roughness = sceneStyle.roughness ?? 1;
  const styleAttrs = buildStyleAttrs(el.style, sceneStyle);
  const id = el.id ? ` id="${el.id}"` : '';

  if (roughness > 0) {
    const d = roughRect(el.x, el.y, el.w, el.h, roughness, rng);
    return `<path${id} d="${d}" ${styleAttrs}/>`;
  }

  return `<rect${id} x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="${el.rx ?? 0}" ${styleAttrs}/>`;
}

/** Render an ellipse element. */
export function renderEllipse(
  el: EllipseElement,
  sceneStyle: SceneStyle,
  rng: () => number
): string {
  const roughness = sceneStyle.roughness ?? 1;
  const styleAttrs = buildStyleAttrs(el.style, sceneStyle);
  const id = el.id ? ` id="${el.id}"` : '';

  if (roughness > 0) {
    const d = roughEllipse(el.cx, el.cy, el.rx, el.ry, roughness, rng);
    return `<path${id} d="${d}" ${styleAttrs}/>`;
  }

  return `<ellipse${id} cx="${el.cx}" cy="${el.cy}" rx="${el.rx}" ry="${el.ry}" ${styleAttrs}/>`;
}

/** Render a line element. */
export function renderLine(
  el: LineElement,
  sceneStyle: SceneStyle,
  rng: () => number
): string {
  const roughness = sceneStyle.roughness ?? 1;
  const styleAttrs = buildStyleAttrs(el.style, sceneStyle, 'none');
  const id = el.id ? ` id="${el.id}"` : '';

  const d = roughLine(el.from[0], el.from[1], el.to[0], el.to[1], roughness, rng);
  return `<path${id} d="${d}" ${styleAttrs}/>`;
}

/** Render an arrow element with arrowhead. */
export function renderArrow(
  el: ArrowElement,
  sceneStyle: SceneStyle,
  rng: () => number
): string {
  const roughness = sceneStyle.roughness ?? 1;
  const styleAttrs = buildStyleAttrs(el.style, sceneStyle, 'none');
  const id = el.id ? ` id="${el.id}"` : '';

  const [x1, y1] = el.from;
  const [x2, y2] = el.to;

  const linePath = roughLine(x1, y1, x2, y2, roughness, rng);

  const angle = Math.atan2(y2 - y1, x2 - x1);
  const arrowLen = 10;
  const arrowAngle = Math.PI / 7;

  const leftX = x2 - arrowLen * Math.cos(angle - arrowAngle);
  const leftY = y2 - arrowLen * Math.sin(angle - arrowAngle);
  const rightX = x2 - arrowLen * Math.cos(angle + arrowAngle);
  const rightY = y2 - arrowLen * Math.sin(angle + arrowAngle);

  const arrowHead = roughLine(leftX, leftY, x2, y2, roughness, rng) +
    roughLine(x2, y2, rightX, rightY, roughness, rng);

  let paths = `<path${id} d="${linePath}" ${styleAttrs}/>
    <path d="${arrowHead}" ${styleAttrs}/>`;

  if (el.double) {
    const angle2 = angle + Math.PI;
    const leftX2 = x1 - arrowLen * Math.cos(angle2 - arrowAngle);
    const leftY2 = y1 - arrowLen * Math.sin(angle2 - arrowAngle);
    const rightX2 = x1 - arrowLen * Math.cos(angle2 + arrowAngle);
    const rightY2 = y1 - arrowLen * Math.sin(angle2 + arrowAngle);

    const arrowHead2 = roughLine(leftX2, leftY2, x1, y1, roughness, rng) +
      roughLine(x1, y1, rightX2, rightY2, roughness, rng);

    paths += `<path d="${arrowHead2}" ${styleAttrs}/>`;
  }

  return paths;
}

/** Render a text element. */
export function renderText(
  el: TextElement,
  sceneStyle: SceneStyle
): string {
  const fontSize = el.style?.fontSize ?? sceneStyle.fontSize ?? 14;
  const fontFamily = el.style?.fontFamily ?? sceneStyle.fontFamily ?? 'Comic Sans MS, cursive';
  const fontWeight = el.style?.fontWeight ?? 'normal';
  const fill = el.style?.stroke ?? sceneStyle.stroke ?? '#000';
  const opacity = el.style?.opacity ?? 1;
  const id = el.id ? ` id="${el.id}"` : '';

  const anchor = el.anchor ?? 'start';
  const baseline = el.baseline ?? 'middle';

  return `<text${id} x="${el.x}" y="${el.y}" font-size="${fontSize}" font-family="${fontFamily}" font-weight="${fontWeight}" fill="${fill}" opacity="${opacity}" text-anchor="${anchor}" dominant-baseline="${baseline}">${escapeXml(el.content)}</text>`;
}

/** Render a path element (SVG path d-string with roughness applied). */
export function renderPath(
  el: PathElement,
  sceneStyle: SceneStyle,
  rng: () => number
): string {
  const roughness = sceneStyle.roughness ?? 1;
  const styleAttrs = buildStyleAttrs(el.style, sceneStyle);
  const id = el.id ? ` id="${el.id}"` : '';

  if (roughness > 0) {
    const j = roughness * 0.3;
    const d = el.d.replace(/-?\d+(\.\d+)?/g, (match) => {
      const n = parseFloat(match);
      return String(r(n + (rng() - 0.5) * 2 * j));
    });
    return `<path${id} d="${d}" ${styleAttrs}/>`;
  }

  return `<path${id} d="${el.d}" ${styleAttrs}/>`;
}

/** Render an arc element. */
export function renderArc(
  el: ArcElement,
  sceneStyle: SceneStyle,
  rng: () => number
): string {
  const roughness = sceneStyle.roughness ?? 1;
  const styleAttrs = buildStyleAttrs(el.style, sceneStyle, 'none');
  const id = el.id ? ` id="${el.id}"` : '';

  const d = roughArc(el.cx, el.cy, el.r, el.startAngle, el.endAngle, roughness, rng);
  return `<path${id} d="${d}" ${styleAttrs}/>`;
}

/** Render a blob element (organic/irregular shape). */
export function renderBlob(
  el: BlobElement,
  sceneStyle: SceneStyle,
  rng: () => number
): string {
  const styleAttrs = buildStyleAttrs(el.style, sceneStyle);
  const id = el.id ? ` id="${el.id}"` : '';
  const nodes = Math.max(6, Math.min(20, el.nodes ?? 12));
  const irregularity = Math.max(0, Math.min(1, el.irregularity ?? 0.3));
  const d = generateBlobPath(el.cx, el.cy, el.r, nodes, irregularity, rng);
  return `<path${id} d="${d}" ${styleAttrs}/>`;
}

/** Render a group element by rendering all children. */
export function renderGroup(
  el: GroupElement,
  sceneStyle: SceneStyle,
  rng: () => number,
  warnings: string[]
): string {
  const id = el.id ? ` id="${el.id}"` : '';
  const children = el.children
    .map((child) => renderElement(child, sceneStyle, rng, warnings))
    .join('\n');
  return `<g${id}>${children}</g>`;
}

/** Render any primitive element. */
export function renderElement(
  el: Element,
  sceneStyle: SceneStyle,
  rng: () => number,
  warnings: string[]
): string {
  switch (el.type) {
    case 'circle':
      return renderCircle(el, sceneStyle, rng);
    case 'rect':
      return renderRect(el, sceneStyle, rng);
    case 'ellipse':
      return renderEllipse(el, sceneStyle, rng);
    case 'line':
      return renderLine(el, sceneStyle, rng);
    case 'arrow':
      return renderArrow(el, sceneStyle, rng);
    case 'text':
      return renderText(el, sceneStyle);
    case 'path':
      return renderPath(el, sceneStyle, rng);
    case 'arc':
      return renderArc(el, sceneStyle, rng);
    case 'blob':
      return renderBlob(el, sceneStyle, rng);
    case 'group':
      return renderGroup(el, sceneStyle, rng, warnings);
    case 'asset':
    case 'compose':
    case 'figure:atom':
    case 'figure:stick':
    case 'figure:cell':
    case 'figure:solar':
    case 'figure:foodchain':
    case 'figure:cycle':
      warnings.push(`Element type '${el.type}' should not reach renderElement — use isFigure/isAsset checks first`);
      return '';
    default:
      warnings.push(`Unknown element type: ${(el as Element).type}`);
      return '';
  }
}
