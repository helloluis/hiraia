/**
 * Figure renderers.
 *
 * Converts high-level figure templates (atom, stick figure, cell, etc.)
 * into arrays of primitive elements that are then rendered by element renderers.
 */

import type {
  Element,
  AtomFigure,
  StickFigureFigure,
  CellFigure,
  SolarSystemFigure,
  FoodChainFigure,
  CycleFigure,
  SceneStyle,
} from '../types.js';
import { renderElement } from '../elements/render.js';

/** Convert a figure into primitive elements. */
function expandFigure(fig: Element): Element[] {
  switch (fig.type) {
    case 'figure:atom':
      return expandAtom(fig);
    case 'figure:stick':
      return expandStickFigure(fig);
    case 'figure:cell':
      return expandCell(fig);
    case 'figure:solar':
      return expandSolarSystem(fig);
    case 'figure:foodchain':
      return expandFoodChain(fig);
    case 'figure:cycle':
      return expandCycle(fig);
    default:
      return [];
  }
}

/** Expand an atom (Bohr model) figure into primitive elements. */
function expandAtom(fig: AtomFigure): Element[] {
  const { x, y, scale = 1, protons, neutrons, shells, label } = fig;
  const elements: Element[] = [];

  const nucleusRadius = 8 * scale;
  const shellSpacing = 25 * scale;
  const electronRadius = 3 * scale;

  elements.push({
    type: 'circle',
    cx: x,
    cy: y,
    r: nucleusRadius,
    style: { fill: '#f87171', stroke: '#991b1b' },
  });

  elements.push({
    type: 'text',
    x,
    y,
    content: `${protons}p ${neutrons}n`,
    anchor: 'middle',
    baseline: 'middle',
    style: { fontSize: 8 * scale, fontWeight: 'bold' },
  });

  shells.forEach((electronCount, shellIndex) => {
    const shellRadius = nucleusRadius + shellSpacing * (shellIndex + 1);

    elements.push({
      type: 'ellipse',
      cx: x,
      cy: y,
      rx: shellRadius,
      ry: shellRadius,
      style: { stroke: '#9ca3af', strokeStyle: 'dashed', fill: 'none' },
    });

    for (let i = 0; i < electronCount; i++) {
      const angle = (i / electronCount) * Math.PI * 2;
      const ex = x + shellRadius * Math.cos(angle);
      const ey = y + shellRadius * Math.sin(angle);

      elements.push({
        type: 'circle',
        cx: ex,
        cy: ey,
        r: electronRadius,
        style: { fill: '#60a5fa', stroke: '#1e40af' },
      });
    }
  });

  if (label) {
    elements.push({
      type: 'text',
      x,
      y: y + nucleusRadius + shellSpacing * shells.length + 15 * scale,
      content: label,
      anchor: 'middle',
      baseline: 'top',
      style: { fontSize: 12 * scale, fontWeight: 'bold' },
    });
  }

  return elements;
}

/** Expand a stick figure into primitive elements. */
function expandStickFigure(fig: StickFigureFigure): Element[] {
  const { x, y, scale = 1, pose = 'standing', label } = fig;
  const elements: Element[] = [];

  const headRadius = 8 * scale;
  const bodyLength = 30 * scale;
  const limbLength = 20 * scale;

  elements.push({
    type: 'circle',
    cx: x,
    cy: y,
    r: headRadius,
    style: { fill: '#fde047', stroke: '#a16207' },
  });

  const neckY = y + headRadius;
  const bodyEndY = neckY + bodyLength;

  elements.push({
    type: 'line',
    from: [x, neckY],
    to: [x, bodyEndY],
  });

  let leftArmEnd: [number, number] = [x - limbLength, neckY + limbLength * 0.6];
  let rightArmEnd: [number, number] = [x + limbLength, neckY + limbLength * 0.6];
  let leftLegEnd: [number, number] = [x - limbLength * 0.7, bodyEndY + limbLength];
  let rightLegEnd: [number, number] = [x + limbLength * 0.7, bodyEndY + limbLength];

  if (pose === 'waving') {
    rightArmEnd = [x + limbLength, neckY - limbLength * 0.5];
  } else if (pose === 'pointing') {
    rightArmEnd = [x + limbLength * 1.2, neckY];
  } else if (pose === 'sitting') {
    leftLegEnd = [x - limbLength, bodyEndY + limbLength * 0.3];
    rightLegEnd = [x + limbLength, bodyEndY + limbLength * 0.3];
  }

  elements.push({ type: 'line', from: [x, neckY + 5 * scale], to: leftArmEnd });
  elements.push({ type: 'line', from: [x, neckY + 5 * scale], to: rightArmEnd });
  elements.push({ type: 'line', from: [x, bodyEndY], to: leftLegEnd });
  elements.push({ type: 'line', from: [x, bodyEndY], to: rightLegEnd });

  if (label) {
    elements.push({
      type: 'text',
      x,
      y: bodyEndY + limbLength + 10 * scale,
      content: label,
      anchor: 'middle',
      baseline: 'top',
      style: { fontSize: 11 * scale },
    });
  }

  return elements;
}

/** Expand a cell figure into primitive elements. */
function expandCell(fig: CellFigure): Element[] {
  const { x, y, scale = 1, kind = 'animal', parts = [] } = fig;
  const elements: Element[] = [];

  const cellWidth = 100 * scale;
  const cellHeight = 80 * scale;

  if (kind === 'plant') {
    elements.push({
      type: 'rect',
      x: x - cellWidth / 2 - 3,
      y: y - cellHeight / 2 - 3,
      w: cellWidth + 6,
      h: cellHeight + 6,
      rx: 5,
      style: { fill: '#d1fae5', stroke: '#065f46', strokeWidth: 2 },
    });
  }

  elements.push({
    type: 'ellipse',
    cx: x,
    cy: y,
    rx: cellWidth / 2,
    ry: cellHeight / 2,
    style: { fill: '#fef3c7', stroke: '#92400e' },
  });

  if (parts.includes('nucleus')) {
    elements.push({
      type: 'circle',
      cx: x,
      cy: y,
      r: 15 * scale,
      style: { fill: '#c084fc', stroke: '#6b21a8' },
    });
    elements.push({
      type: 'text',
      x,
      y,
      content: 'nucleus',
      anchor: 'middle',
      baseline: 'middle',
      style: { fontSize: 9 * scale },
    });
  }

  if (parts.includes('mitochondria')) {
    elements.push({
      type: 'ellipse',
      cx: x - 25 * scale,
      cy: y - 15 * scale,
      rx: 10 * scale,
      ry: 5 * scale,
      style: { fill: '#fb923c', stroke: '#c2410c' },
    });
  }

  if (kind === 'plant' && parts.includes('chloroplast')) {
    elements.push({
      type: 'ellipse',
      cx: x + 25 * scale,
      cy: y - 15 * scale,
      rx: 10 * scale,
      ry: 5 * scale,
      style: { fill: '#4ade80', stroke: '#166534' },
    });
  }

  if (parts.includes('vacuole')) {
    elements.push({
      type: 'ellipse',
      cx: x + 20 * scale,
      cy: y + 15 * scale,
      rx: 12 * scale,
      ry: 8 * scale,
      style: { fill: '#bae6fd', stroke: '#075985' },
    });
  }

  if (kind === 'plant') {
    elements.push({
      type: 'text',
      x,
      y: y - cellHeight / 2 - 15 * scale,
      content: 'Plant Cell',
      anchor: 'middle',
      baseline: 'bottom',
      style: { fontSize: 12 * scale, fontWeight: 'bold' },
    });
  } else {
    elements.push({
      type: 'text',
      x,
      y: y - cellHeight / 2 - 15 * scale,
      content: 'Animal Cell',
      anchor: 'middle',
      baseline: 'bottom',
      style: { fontSize: 12 * scale, fontWeight: 'bold' },
    });
  }

  return elements;
}

/** Expand a solar system figure into primitive elements. */
function expandSolarSystem(fig: SolarSystemFigure): Element[] {
  const { x, y, scale = 1, bodies = ['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'] } = fig;
  const elements: Element[] = [];

  const sunRadius = 15 * scale;
  const orbitSpacing = 20 * scale;

  elements.push({
    type: 'circle',
    cx: x,
    cy: y,
    r: sunRadius,
    style: { fill: '#fbbf24', stroke: '#b45309' },
  });

  bodies.slice(1).forEach((body, i) => {
    const orbitRadius = sunRadius + orbitSpacing * (i + 1);
    const planetRadius = 3 * scale;

    elements.push({
      type: 'ellipse',
      cx: x,
      cy: y,
      rx: orbitRadius,
      ry: orbitRadius,
      style: { stroke: '#9ca3af', strokeStyle: 'dashed', fill: 'none' },
    });

    const angle = (i * Math.PI) / 3;
    const px = x + orbitRadius * Math.cos(angle);
    const py = y + orbitRadius * Math.sin(angle);

    elements.push({
      type: 'circle',
      cx: px,
      cy: py,
      r: planetRadius,
      style: { fill: '#3b82f6', stroke: '#1e40af' },
    });

    elements.push({
      type: 'text',
      x: px,
      y: py + planetRadius + 8 * scale,
      content: body,
      anchor: 'middle',
      baseline: 'top',
      style: { fontSize: 8 * scale },
    });
  });

  return elements;
}

/** Expand a food chain figure into primitive elements. */
function expandFoodChain(fig: FoodChainFigure): Element[] {
  const { x, y, scale = 1, links } = fig;
  const elements: Element[] = [];

  const boxWidth = 70 * scale;
  const boxHeight = 40 * scale;
  const spacing = 30 * scale;

  const nodes = new Set<string>();
  links.forEach((link) => {
    nodes.add(link.from);
    nodes.add(link.to);
  });

  const nodeArray = Array.from(nodes);
  const nodePositions = new Map<string, { x: number; y: number }>();

  nodeArray.forEach((node, i) => {
    const nx = x + i * (boxWidth + spacing);
    const ny = y;

    nodePositions.set(node, { x: nx, y: ny });

    elements.push({
      type: 'rect',
      x: nx - boxWidth / 2,
      y: ny - boxHeight / 2,
      w: boxWidth,
      h: boxHeight,
      rx: 5,
      style: { fill: '#e0e7ff', stroke: '#3730a3' },
    });

    elements.push({
      type: 'text',
      x: nx,
      y: ny,
      content: node,
      anchor: 'middle',
      baseline: 'middle',
      style: { fontSize: 10 * scale, fontWeight: 'bold' },
    });
  });

  links.forEach((link) => {
    const fromPos = nodePositions.get(link.from);
    const toPos = nodePositions.get(link.to);
    if (fromPos && toPos) {
      elements.push({
        type: 'arrow',
        from: [fromPos.x + boxWidth / 2, fromPos.y],
        to: [toPos.x - boxWidth / 2, toPos.y],
      });
    }
  });

  return elements;
}

/** Expand a cycle figure into primitive elements. */
function expandCycle(fig: CycleFigure): Element[] {
  const { x, y, scale = 1, stages } = fig;
  const elements: Element[] = [];

  const radius = 60 * scale;
  const boxWidth = 60 * scale;
  const boxHeight = 35 * scale;

  const positions: { x: number; y: number }[] = [];

  stages.forEach((stage, i) => {
    const angle = (i / stages.length) * Math.PI * 2 - Math.PI / 2;
    const sx = x + radius * Math.cos(angle);
    const sy = y + radius * Math.sin(angle);

    positions.push({ x: sx, y: sy });

    elements.push({
      type: 'rect',
      x: sx - boxWidth / 2,
      y: sy - boxHeight / 2,
      w: boxWidth,
      h: boxHeight,
      rx: 5,
      style: { fill: '#fef3c7', stroke: '#92400e' },
    });

    elements.push({
      type: 'text',
      x: sx,
      y: sy,
      content: stage,
      anchor: 'middle',
      baseline: 'middle',
      style: { fontSize: 9 * scale },
    });
  });

  for (let i = 0; i < positions.length; i++) {
    const from = positions[i]!;
    const to = positions[(i + 1) % positions.length]!;

    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const offset = 20 * scale;

    elements.push({
      type: 'arrow',
      from: [from.x + offset * Math.cos(angle), from.y + offset * Math.sin(angle)],
      to: [to.x - offset * Math.cos(angle), to.y - offset * Math.sin(angle)],
    });
  }

  return elements;
}

/** Check if an element is a figure type. */
export function isFigure(el: Element): boolean {
  return el.type.startsWith('figure:');
}

/** Render a figure by expanding it into primitives and rendering them. */
export function renderFigure(
  fig: Element,
  sceneStyle: SceneStyle,
  rng: () => number,
  warnings: string[]
): string {
  const primitives = expandFigure(fig);
  return primitives
    .map((p) => renderElement(p, sceneStyle, rng, warnings))
    .join('\n');
}
