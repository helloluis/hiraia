/**
 * Renderer tests.
 *
 * Verifies that the SVG renderer produces valid output for various scene
 * configurations and meets performance requirements.
 */

import { describe, it, expect } from 'vitest';
import { renderScene, type Scene } from '../src/index.js';

describe('renderScene', () => {
  it('should render a minimal scene with one circle', () => {
    const scene: Scene = {
      version: 1,
      width: 300,
      height: 200,
      elements: [
        {
          type: 'circle',
          cx: 150,
          cy: 100,
          r: 40,
          style: { fill: '#ff0000', stroke: '#000000' },
        },
      ],
    };

    const result = renderScene(scene);

    expect(result.svg).toContain('<svg');
    expect(result.svg).toContain('</svg>');
    expect(result.svg).toContain('viewBox="0 0 300 200"');
    expect(result.renderTimeMs).toBeLessThan(100);
    expect(result.elementCount).toBe(1);
    expect(result.warnings).toHaveLength(0);
  });

  it('should render a rectangle', () => {
    const scene: Scene = {
      version: 1,
      width: 300,
      height: 200,
      elements: [
        {
          type: 'rect',
          x: 50,
          y: 50,
          w: 200,
          h: 100,
          style: { fill: '#00ff00' },
        },
      ],
    };

    const result = renderScene(scene);

    expect(result.svg).toContain('<rect');
    expect(result.elementCount).toBe(1);
  });

  it('should render an ellipse', () => {
    const scene: Scene = {
      version: 1,
      width: 300,
      height: 200,
      elements: [
        {
          type: 'ellipse',
          cx: 150,
          cy: 100,
          rx: 80,
          ry: 50,
          style: { fill: '#0000ff' },
        },
      ],
    };

    const result = renderScene(scene);

    expect(result.svg).toContain('<ellipse');
    expect(result.elementCount).toBe(1);
  });

  it('should render a line', () => {
    const scene: Scene = {
      version: 1,
      width: 300,
      height: 200,
      elements: [
        {
          type: 'line',
          from: [50, 50],
          to: [250, 150],
        },
      ],
    };

    const result = renderScene(scene);

    expect(result.svg).toContain('path');
    expect(result.svg).toContain('fill="none"');
  });

  it('should render an arrow', () => {
    const scene: Scene = {
      version: 1,
      width: 300,
      height: 200,
      elements: [
        {
          type: 'arrow',
          from: [50, 100],
          to: [250, 100],
        },
      ],
    };

    const result = renderScene(scene);

    expect(result.svg).toContain('path');
  });

  it('should render a double-headed arrow', () => {
    const scene: Scene = {
      version: 1,
      width: 300,
      height: 200,
      elements: [
        {
          type: 'arrow',
          from: [50, 100],
          to: [250, 100],
          double: true,
        },
      ],
    };

    const result = renderScene(scene);

    expect(result.svg).toContain('path');
  });

  it('should render text', () => {
    const scene: Scene = {
      version: 1,
      width: 300,
      height: 200,
      elements: [
        {
          type: 'text',
          x: 150,
          y: 100,
          content: 'Hello World',
          anchor: 'middle',
        },
      ],
    };

    const result = renderScene(scene);

    expect(result.svg).toContain('<text');
    expect(result.svg).toContain('Hello World');
  });

  it('should escape XML special characters in text', () => {
    const scene: Scene = {
      version: 1,
      width: 300,
      height: 200,
      elements: [
        {
          type: 'text',
          x: 150,
          y: 100,
          content: '<test>&"\'',
        },
      ],
    };

    const result = renderScene(scene);

    expect(result.svg).toContain('&lt;test&gt;&amp;&quot;&#39;');
  });

  it('should render an arc', () => {
    const scene: Scene = {
      version: 1,
      width: 300,
      height: 200,
      elements: [
        {
          type: 'arc',
          cx: 150,
          cy: 100,
          r: 50,
          startAngle: 0,
          endAngle: Math.PI,
        },
      ],
    };

    const result = renderScene(scene);

    expect(result.svg).toContain('path');
  });

  it('should render a path element', () => {
    const scene: Scene = {
      version: 1,
      width: 300,
      height: 200,
      elements: [
        {
          type: 'path',
          d: 'M10,10 L100,10 L100,100 Z',
          style: { fill: '#ffff00' },
        },
      ],
    };

    const result = renderScene(scene);

    expect(result.svg).toContain('path');
  });

  it('should render a group of elements', () => {
    const scene: Scene = {
      version: 1,
      width: 300,
      height: 200,
      elements: [
        {
          type: 'group',
          children: [
            { type: 'circle', cx: 100, cy: 100, r: 30 },
            { type: 'circle', cx: 200, cy: 100, r: 30 },
          ],
        },
      ],
    };

    const result = renderScene(scene);

    expect(result.svg).toContain('<g>');
    expect(result.elementCount).toBe(3);
  });

  it('should render an atom figure', () => {
    const scene: Scene = {
      version: 1,
      width: 300,
      height: 300,
      elements: [
        {
          type: 'figure:atom',
          x: 150,
          y: 150,
          protons: 6,
          neutrons: 6,
          shells: [2, 4],
          label: 'Carbon',
        },
      ],
    };

    const result = renderScene(scene);

    expect(result.svg).toContain('<circle');
    expect(result.svg).toContain('6p 6n');
    expect(result.svg).toContain('Carbon');
  });

  it('should render a stick figure', () => {
    const scene: Scene = {
      version: 1,
      width: 200,
      height: 300,
      elements: [
        {
          type: 'figure:stick',
          x: 100,
          y: 100,
          pose: 'waving',
          label: 'Student',
        },
      ],
    };

    const result = renderScene(scene);

    expect(result.svg).toContain('path');
    expect(result.svg).toContain('Student');
  });

  it('should render a cell figure', () => {
    const scene: Scene = {
      version: 1,
      width: 300,
      height: 300,
      elements: [
        {
          type: 'figure:cell',
          x: 150,
          y: 150,
          kind: 'plant',
          parts: ['nucleus', 'chloroplast', 'vacuole'],
        },
      ],
    };

    const result = renderScene(scene);

    expect(result.svg).toContain('Plant Cell');
    expect(result.svg).toContain('nucleus');
  });

  it('should render a food chain', () => {
    const scene: Scene = {
      version: 1,
      width: 400,
      height: 200,
      elements: [
        {
          type: 'figure:foodchain',
          x: 50,
          y: 100,
          links: [
            { from: 'Grass', to: 'Rabbit' },
            { from: 'Rabbit', to: 'Fox' },
          ],
        },
      ],
    };

    const result = renderScene(scene);

    expect(result.svg).toContain('Grass');
    expect(result.svg).toContain('Rabbit');
    expect(result.svg).toContain('Fox');
  });

  it('should render a cycle', () => {
    const scene: Scene = {
      version: 1,
      width: 300,
      height: 300,
      elements: [
        {
          type: 'figure:cycle',
          x: 150,
          y: 150,
          stages: ['Evaporation', 'Condensation', 'Precipitation'],
        },
      ],
    };

    const result = renderScene(scene);

    expect(result.svg).toContain('Evaporation');
    expect(result.svg).toContain('Condensation');
    expect(result.svg).toContain('Precipitation');
  });

  it('should render a scene with title and caption', () => {
    const scene: Scene = {
      version: 1,
      width: 300,
      height: 200,
      title: 'Water Cycle',
      caption: 'Figure 1: The Water Cycle',
      elements: [{ type: 'circle', cx: 150, cy: 100, r: 30 }],
    };

    const result = renderScene(scene);

    expect(result.svg).toContain('Water Cycle');
    expect(result.svg).toContain('Figure 1: The Water Cycle');
  });

  it('should be deterministic with the same seed', () => {
    const scene: Scene = {
      version: 1,
      width: 300,
      height: 200,
      elements: [
        { type: 'circle', cx: 150, cy: 100, r: 40 },
        { type: 'line', from: [50, 50], to: [250, 150] },
      ],
    };

    const result1 = renderScene(scene, 123);
    const result2 = renderScene(scene, 123);

    expect(result1.svg).toBe(result2.svg);
  });

  it('should produce different output with different seeds', () => {
    const scene: Scene = {
      version: 1,
      width: 300,
      height: 200,
      elements: [{ type: 'circle', cx: 150, cy: 100, r: 40 }],
    };

    const result1 = renderScene(scene, 1);
    const result2 = renderScene(scene, 2);

    expect(result1.svg).not.toBe(result2.svg);
  });

  it('should throw on invalid version', () => {
    const scene = {
      version: 2,
      width: 300,
      height: 200,
      elements: [],
    } as Scene;

    expect(() => renderScene(scene)).toThrow('Unsupported version');
  });

  it('should throw on invalid width', () => {
    const scene: Scene = {
      version: 1,
      width: -1,
      height: 200,
      elements: [],
    };

    expect(() => renderScene(scene)).toThrow('Invalid width');
  });

  it('should throw on invalid height', () => {
    const scene: Scene = {
      version: 1,
      width: 300,
      height: 0,
      elements: [],
    };

    expect(() => renderScene(scene)).toThrow('Invalid height');
  });

  it('should warn on unknown element types', () => {
    const scene = {
      version: 1,
      width: 300,
      height: 200,
      elements: [{ type: 'unknown' as any }],
    } as Scene;

    const result = renderScene(scene);

    expect(result.warnings).toContain('Unknown element type: unknown');
  });

  it('should render complex scenes under 100ms', () => {
    const scene: Scene = {
      version: 1,
      width: 800,
      height: 600,
      elements: [
        { type: 'figure:atom', x: 200, y: 200, protons: 8, neutrons: 8, shells: [2, 6] },
        { type: 'figure:stick', x: 500, y: 200, pose: 'pointing' },
        { type: 'figure:cell', x: 200, y: 450, kind: 'animal', parts: ['nucleus', 'mitochondria'] },
        { type: 'figure:cycle', x: 600, y: 450, stages: ['A', 'B', 'C', 'D'] },
        { type: 'rect', x: 10, y: 10, w: 780, h: 580, style: { stroke: '#999' } },
      ],
    };

    const result = renderScene(scene);

    expect(result.renderTimeMs).toBeLessThan(100);
    expect(result.elementCount).toBe(5);
  });

  it('should apply scene-level style defaults', () => {
    const scene: Scene = {
      version: 1,
      width: 300,
      height: 200,
      style: {
        background: '#f0f0f0',
        stroke: '#333333',
        roughness: 2,
      },
      elements: [{ type: 'circle', cx: 150, cy: 100, r: 40 }],
    };

    const result = renderScene(scene);

    expect(result.svg).toContain('fill="#f0f0f0"');
    expect(result.svg).toContain('stroke="#333333"');
  });

  it('should allow element-level style overrides', () => {
    const scene: Scene = {
      version: 1,
      width: 300,
      height: 200,
      style: { stroke: '#000000' },
      elements: [
        {
          type: 'circle',
          cx: 150,
          cy: 100,
          r: 40,
          style: { stroke: '#ff0000', fill: '#ffff00' },
        },
      ],
    };

    const result = renderScene(scene);

    expect(result.svg).toContain('stroke="#ff0000"');
    expect(result.svg).toContain('fill="#ffff00"');
  });

  it('should render dashed and dotted lines', () => {
    const scene: Scene = {
      version: 1,
      width: 300,
      height: 200,
      elements: [
        {
          type: 'line',
          from: [50, 50],
          to: [250, 50],
          style: { strokeStyle: 'dashed' },
        },
        {
          type: 'line',
          from: [50, 100],
          to: [250, 100],
          style: { strokeStyle: 'dotted' },
        },
      ],
    };

    const result = renderScene(scene);

    expect(result.svg).toContain('stroke-dasharray="6,3"');
    expect(result.svg).toContain('stroke-dasharray="2,2"');
  });

  it('should handle empty scenes', () => {
    const scene: Scene = {
      version: 1,
      width: 300,
      height: 200,
      elements: [],
    };

    const result = renderScene(scene);

    expect(result.svg).toContain('<svg');
    expect(result.svg).toContain('</svg>');
    expect(result.elementCount).toBe(0);
  });
});
