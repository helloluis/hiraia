# @hiraia/images

XKCD-style hand-drawn SVG renderer for the Hiraia AI tutor.

## Overview

This package provides a drawing DSL that the LLM can output as JSON, which is then rendered to SVG with a sketchy, hand-drawn aesthetic. It's designed to be:

- **LLM-friendly**: Simple JSON contract that a 1.7B parameter model can generate reliably
- **Fast**: Renders in <100ms on low-end phones
- **Expressive**: Supports science diagrams, atoms, cells, food chains, cycles, and more
- **Deterministic**: Same scene + seed = identical output

## Architecture

```
Scene (JSON DSL)
  ↓
Validation
  ↓
Element Renderers (circles, lines, arrows, text, etc.)
  ↓
Hand-Drawn Effects (path jitter, rough lines)
  ↓
SVG Output
```

## Usage

```typescript
import { renderScene, type Scene } from '@hiraia/images';

const scene: Scene = {
  version: 1,
  width: 300,
  height: 200,
  title: 'Water Molecule',
  elements: [
    {
      type: 'circle',
      cx: 150,
      cy: 100,
      r: 40,
      style: { fill: '#60a5fa', stroke: '#1e40af' }
    },
    {
      type: 'text',
      x: 150,
      y: 100,
      content: 'H₂O',
      anchor: 'middle',
      style: { fontSize: 16, fontWeight: 'bold' }
    }
  ]
};

const result = renderScene(scene);
console.log(result.svg);
console.log(`Rendered in ${result.renderTimeMs}ms`);
```

## DSL Elements

### Primitives

- `circle` - Circle with center (cx, cy) and radius
- `rect` - Rectangle with position (x, y) and size (w, h)
- `ellipse` - Ellipse with center and radii
- `line` - Straight line from point to point
- `arrow` - Line with arrowhead(s)
- `text` - Text label at position
- `path` - SVG path d-string
- `arc` - Circular arc
- `group` - Container for multiple elements

### Figures (High-Level Templates)

- `figure:atom` - Bohr model atom with nucleus, electron shells
- `figure:stick` - Stick figure with poses (standing, waving, pointing, sitting)
- `figure:cell` - Animal or plant cell with organelles
- `figure:solar` - Solar system with orbits
- `figure:foodchain` - Food chain with arrows
- `figure:cycle` - Circular cycle diagram (water cycle, etc.)

## Styles

Scene-level defaults:
```typescript
{
  background: '#ffffff',
  stroke: '#000000',
  fill: 'none',
  strokeWidth: 1.5,
  fontSize: 14,
  fontFamily: 'Comic Sans MS, cursive',
  roughness: 1.2  // 0 = clean, 2 = very sketchy
}
```

Element-level overrides:
```typescript
{
  stroke: '#ff0000',
  fill: '#ffff00',
  strokeWidth: 2,
  strokeStyle: 'dashed',  // 'solid' | 'dashed' | 'dotted'
  opacity: 0.8
}
```

## Performance

Tested on complex scenes with 50+ elements:
- **Render time**: <100ms (target <10s, actual <0.1s)
- **SVG size**: 2-10KB typical, <50KB complex
- **Memory**: Negligible (no rasterization)

The bottleneck is always the LLM generating the JSON, not the renderer.

## Testing

```bash
pnpm --filter @hiraia/images test
```

28 tests covering:
- All primitive elements
- All figure types
- Style inheritance and overrides
- Deterministic output with seeds
- Performance benchmarks
- Validation and error handling

## Integration with Hiraia

The existing `TutorEngine.generateVisual()` interface is already defined in `@hiraia/shared`. To integrate:

1. LLM generates JSON scene based on `generateVisualPrompt()`
2. Parse JSON and validate with `renderScene()`
3. Embed SVG in chat UI (React Native WebView or web `<img>`)

The `enableVisuals` flag in `TutorConfig` controls whether this feature is active.

## Future Enhancements

- **Template library**: Pre-designed scenes for common DepEd topics
- **Animation**: Optional CSS animations for cycles and processes
- **Interactivity**: Tap/click elements for more information
- **Export**: PNG/PDF export for offline viewing
