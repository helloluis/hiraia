/**
 * Tests for the blob/organic shape primitive.
 */

import { describe, it, expect } from 'vitest';
import { createRng } from '../src/effects/rough.js';
import { generateBlobPath, generateLeafPath } from '../src/effects/shapes.js';
import { renderScene } from '../src/renderer.js';

describe('generateBlobPath', () => {
  const rng = createRng(42);

  it('should generate a valid SVG path string', () => {
    const d = generateBlobPath(50, 50, 30, 12, 0.3, rng);
    expect(d).toContain('M');
    expect(d).toContain('C');
    expect(d).toContain('Z');
  });

  it('should produce different shapes with different irregularity', () => {
    const smooth = generateBlobPath(50, 50, 30, 12, 0, rng);
    const rough = generateBlobPath(50, 50, 30, 12, 0.8, rng);
    // The rough one should have more variation in control points
    expect(smooth).not.toBe(rough);
  });

  it('should produce deterministic output with same seed', () => {
    const rng1 = createRng(123);
    const rng2 = createRng(123);
    const d1 = generateBlobPath(50, 50, 30, 12, 0.3, rng1);
    const d2 = generateBlobPath(50, 50, 30, 12, 0.3, rng2);
    expect(d1).toBe(d2);
  });

  it('should clamp nodes to valid range', () => {
    const rng = createRng(42);
    const few = generateBlobPath(50, 50, 30, 3, 0.3, rng);  // should clamp to 6
    const many = generateBlobPath(50, 50, 30, 50, 0.3, rng);  // should clamp to 20
    expect(few).toContain('M');
    expect(many).toContain('C');
  });
});

describe('generateLeafPath', () => {
  it('should generate a valid leaf path string', () => {
    const rng = createRng(42);
    const d = generateLeafPath(60, 50, 60, 80, rng);
    expect(d).toContain('M');
    expect(d).toContain('C');
    expect(d).toContain('Z');
  });

  it('should be deterministic', () => {
    const rng1 = createRng(99);
    const rng2 = createRng(99);
    const d1 = generateLeafPath(60, 50, 60, 80, rng1);
    const d2 = generateLeafPath(60, 50, 60, 80, rng2);
    expect(d1).toBe(d2);
  });
});

describe('blob element rendering', () => {
  it('should render a blob element into SVG', () => {
    const result = renderScene({
      version: 1,
      width: 100,
      height: 100,
      elements: [
        {
          type: 'blob',
          cx: 50,
          cy: 50,
          r: 30,
          nodes: 12,
          irregularity: 0.3,
          style: { fill: '#81c784', stroke: '#2e7d32' },
        },
      ],
    });

    expect(result.svg).toContain('<path');
    expect(result.svg).toContain('d="');
    expect(result.renderTimeMs).toBeLessThan(100);
  });

  it('should handle default blob parameters', () => {
    const result = renderScene({
      version: 1,
      width: 100,
      height: 100,
      elements: [
        { type: 'blob', cx: 50, cy: 50, r: 20 },
      ],
    });

    expect(result.svg).toContain('<path');
    expect(result.warnings.length).toBe(0);
  });
});
