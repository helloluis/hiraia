/**
 * Organic shape generators.
 *
 * Produce smooth, irregular closed shapes for leaves, planets, cells,
 * clouds, and other non-geometric forms. All shapes are generated as
 * SVG path d-strings using Catmull-Rom splines.
 */

/** Round to 2 decimal places. */
function r(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Generate a smooth closed blob shape using radial control points.
 *
 * Algorithm: place N points evenly around a circle, perturb each radius
 * by a factor based on irregularity, then connect with Catmull-Rom
 * splines for smooth curves.
 */
export function generateBlobPath(
  cx: number,
  cy: number,
  radius: number,
  nodeCount: number,
  irregularity: number,
  seedRng: () => number
): string {
  // Generate perturbed control points
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const angle = (i / nodeCount) * Math.PI * 2;
    const perturbation = 1 + (seedRng() - 0.5) * 2 * irregularity;
    const ri = radius * Math.max(0.5, perturbation);
    points.push({ x: cx + ri * Math.cos(angle), y: cy + ri * Math.sin(angle) });
  }

  // Build Catmull-Rom spline segments (closed loop)
  let d = '';
  for (let i = 0; i < nodeCount; i++) {
    const p0 = points[(i - 1 + nodeCount) % nodeCount]!;
    const p1 = points[i]!;
    const p2 = points[(i + 1) % nodeCount]!;
    const p3 = points[(i + 2) % nodeCount]!;

    if (i === 0) {
      d += `M${r(p1.x)},${r(p1.y)}`;
    }

    // Catmull-Rom → cubic Bezier
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += `C${r(cp1x)},${r(cp1y)},${r(cp2x)},${r(cp2y)},${r(p2.x)},${r(p2.y)}`;
  }

  d += 'Z';
  return d;
}

/**
 * Generate a leaf shape — tapered, wider in the middle, pointed at
 * both ends (tip and stem). Uses a modulated blob with 12 nodes.
 */
export function generateLeafPath(
  cx: number,
  cy: number,
  width: number,
  height: number,
  seedRng: () => number,
  irregularity = 0.15
): string {
  const nodeCount = 12;
  const points: { x: number; y: number }[] = [];

  for (let i = 0; i < nodeCount; i++) {
    const t = i / nodeCount;
    const angle = t * Math.PI * 2;

    // Width envelope: narrow at top/bottom, wide at middle
    const envelope = 0.1 + 0.9 * Math.sin(t * Math.PI);
    const baseWidth = (width / 2) * envelope;

    const perturbation = 1 + (seedRng() - 0.5) * 2 * irregularity;
    const wi = baseWidth * Math.max(0.6, perturbation);

    points.push({
      x: cx + wi * Math.cos(angle),
      y: cy + (height / 2) * Math.cos(angle),
    });
  }

  // Catmull-Rom spline
  let d = '';
  for (let i = 0; i < nodeCount; i++) {
    const p0 = points[(i - 1 + nodeCount) % nodeCount]!;
    const p1 = points[i]!;
    const p2 = points[(i + 1) % nodeCount]!;
    const p3 = points[(i + 2) % nodeCount]!;

    if (i === 0) d += `M${r(p1.x)},${r(p1.y)}`;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += `C${r(cp1x)},${r(cp1y)},${r(cp2x)},${r(cp2y)},${r(p2.x)},${r(p2.y)}`;
  }

  d += 'Z';
  return d;
}
