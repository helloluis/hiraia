import type { AssessmentDiagram } from './types';

const relations = new Set(['above', 'below', 'left', 'right', 'inside', 'on']);

/** Unknown or corrupt scenes cannot be silently dropped from a saved question. */
export function isAssessmentDiagram(value: unknown): value is AssessmentDiagram {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const scene = value as Record<string, unknown>;
  return Object.keys(scene).length === 2 && scene.kind === 'ball_box' &&
    typeof scene.relation === 'string' && relations.has(scene.relation);
}

// Fixed geometry makes position independent of screen size and text direction.
export function ballBoxGeometry(relation: AssessmentDiagram['relation']) {
  const scenes = {
    above: { ball: { x: 160, y: 38, r: 22 }, box: { x: 104, y: 102, width: 112, height: 66 } },
    on: { ball: { x: 160, y: 80, r: 22 }, box: { x: 104, y: 102, width: 112, height: 66 } },
    below: { ball: { x: 160, y: 152, r: 22 }, box: { x: 104, y: 24, width: 112, height: 66 } },
    left: { ball: { x: 64, y: 104, r: 22 }, box: { x: 132, y: 71, width: 112, height: 66 } },
    right: { ball: { x: 256, y: 104, r: 22 }, box: { x: 76, y: 71, width: 112, height: 66 } },
    inside: { ball: { x: 160, y: 108, r: 22 }, box: { x: 92, y: 56, width: 136, height: 116 } },
  };
  return { ...scenes[relation], frontWallTop: relation === 'inside' ? 120 : null };
}
