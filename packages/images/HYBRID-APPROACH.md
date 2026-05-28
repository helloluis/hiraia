# Hiraia Images — Hybrid Asset Library & RAG Integration

This document describes the hybrid approach for incorporating curated science diagrams into the Hiraia Images renderer. The system combines a local asset library with retrieval-augmented generation (RAG) to help the LLM compose educational diagrams from pre-made components.

## Overview

The hybrid approach has three phases:

1. **Asset Library** (implemented) — Curated SVG components with rich metadata
2. **RAG Integration** (implemented) — Semantic search and retrieval
3. **Composition Training** (future) — Fine-tuning the LLM to compose assets effectively

## Phase 1: Asset Library

### Directory Structure

```
packages/images/assets/
├── biology/
│   ├── cell-animal.svg
│   ├── cell-animal.json
│   ├── cell-plant.svg
│   ├── cell-plant.json
│   ├── leaf.svg
│   ├── leaf.json
│   ├── sun.svg
│   └── sun.json
├── physics/
│   ├── battery.svg
│   ├── battery.json
│   ├── lightbulb.svg
│   ├── lightbulb.json
│   ├── switch.svg
│   ├── switch.json
│   └── earth.svg
│   └── earth.json
└── chemistry/
    ├── water-molecule.svg
    ├── water-molecule.json
    ├── co2-molecule.svg
    └── co2-molecule.json
```

### Asset Metadata Schema

Each asset has a JSON metadata file with the following structure:

```typescript
interface AssetMetadata {
  id: string;              // Unique identifier (matches filename)
  name: string;            // Human-readable name
  description: string;     // Short description for retrieval
  subject: Subject;        // 'biology' | 'chemistry' | 'physics' | 'earth-science' | 'general'
  grades: GradeBand[];     // ['K-3', '4-6', '7-9', '10-12']
  tags: string[];          // Keywords for search
  curriculum?: string[];   // DepEd curriculum codes
  source: string;          // 'hiraia' | 'bioicons' | 'wikimedia' | 'depEd'
  license: string;         // 'CC-BY-4.0' | 'CC0' | etc.
  viewBox: [number, number]; // SVG dimensions
}
```

### Using the AssetLibrary

```typescript
import { AssetLibrary } from '@hiraia/images';

// Load from filesystem
const library = new AssetLibrary();
await library.load('./assets');

// Or load from pre-fetched data (browser/embedded)
library.loadFromData([
  {
    meta: { id: 'cell-animal', name: 'Animal Cell', ... },
    svg: '<svg>...</svg>'
  }
]);

// Search assets
const results = library.search({
  text: 'cell biology',
  subject: 'biology',
  grade: '7-9',
  limit: 5
});

// Get a specific asset
const asset = library.get('cell-animal');

// Find best match
const best = library.findBest('photosynthesis plant leaf');
```

## Phase 2: RAG Integration

### SimpleRetriever

The `SimpleRetriever` provides lightweight semantic search using TF-IDF scoring:

```typescript
import { SimpleRetriever } from '@hiraia/images';

const retriever = new SimpleRetriever();
retriever.index(library.all());

// Retrieve relevant assets for a query
const results = retriever.retrieve('solar system planets', library.all(), 5);

// Find the best single match
const best = retriever.findBest('electrical circuit', library.all());
```

### Integration with TutorEngine

The retrieval system can be integrated into the `TutorEngine.generateVisual()` flow:

```typescript
async generateVisual(prompt: string): Promise<ImageResult> {
  // 1. Retrieve relevant assets
  const relevantAssets = retriever.retrieve(prompt, library.all(), 3);
  
  // 2. Inject asset suggestions into LLM context
  const context = buildPromptWithAssets(prompt, relevantAssets);
  
  // 3. LLM generates scene JSON using suggested assets
  const sceneJson = await llm.generate(context);
  
  // 4. Render the scene
  const result = renderScene(sceneJson);
  
  return {
    svg: result.svg,
    renderTimeMs: result.renderTimeMs
  };
}
```

## DSL Extensions

### Asset Element

Embed a single curated asset:

```json
{
  "type": "asset",
  "assetId": "cell-animal",
  "x": 100,
  "y": 100,
  "scale": 1.5
}
```

### Compose Element

Combine multiple assets with overlays (labels, arrows, annotations):

```json
{
  "type": "compose",
  "assets": [
    { "assetId": "sun", "x": 50, "y": 50, "scale": 1.5 },
    { "assetId": "leaf", "x": 200, "y": 100, "scale": 2.0 },
    { "assetId": "water-molecule", "x": 50, "y": 280, "scale": 1.2 }
  ],
  "overlays": [
    {
      "type": "arrow",
      "from": [150, 100],
      "to": [200, 150],
      "style": { "stroke": "#fbbf24", "strokeWidth": 4 }
    },
    {
      "type": "text",
      "x": 180,
      "y": 90,
      "text": "Sunlight"
    }
  ]
}
```

## Sample Scenes

Three hybrid sample scenes demonstrate the approach:

1. **hybrid-cell-diagram.json** — Animal cell with labeled organelles
2. **hybrid-circuit.json** — Electrical circuit using battery, switch, and lightbulb assets
3. **hybrid-photosynthesis.json** — Photosynthesis process with sun, leaf, and molecules

### Rendering a Hybrid Scene

```typescript
import { renderScene, AssetLibrary, setAssetLibrary } from '@hiraia/images';
import sceneJson from './samples/hybrid-photosynthesis.json';

// Initialize asset library
const library = new AssetLibrary();
await library.load('./assets');
setAssetLibrary(library);

// Render the scene
const result = renderScene(sceneJson);
console.log(result.svg);
console.log(`Rendered in ${result.renderTimeMs}ms`);
```

## Performance

All hybrid scenes render well under the 10-second target:

- **hybrid-cell-diagram**: ~5ms
- **hybrid-circuit**: ~8ms
- **hybrid-photosynthesis**: ~10ms

The asset embedding adds minimal overhead since SVG content is pre-loaded and cached.

## Adding New Assets

To add a new asset:

1. Create an SVG file: `assets/biology/mitochondria.svg`
2. Create matching metadata: `assets/biology/mitochondria.json`
3. Restart or reload the AssetLibrary

### SVG Guidelines

- Use a consistent `viewBox` (e.g., `0 0 100 100`)
- Keep SVG simple and educational (XKCD-style preferred)
- Avoid embedded fonts or external resources
- Use semantic colors (e.g., green for plants, blue for water)

### Metadata Guidelines

- Include 5-10 relevant tags
- Add DepEd curriculum codes when applicable
- Write a clear, descriptive name and description
- Specify appropriate grade bands

## Future Work: Phase 3 (Composition Training)

For production use, we recommend fine-tuning the LLM with composition examples:

1. **Curate 500+ examples** of good diagram compositions
2. **Format as JSONL** training data:
   ```json
   {"prompt": "Show photosynthesis", "scene": {...}}
   ```
3. **Train a LoRA adapter** that learns to:
   - Select appropriate assets from the library
   - Arrange assets spatially
   - Add labels, arrows, and annotations
   - Follow DepEd curriculum standards

4. **Evaluate** on held-out test set with metrics:
   - Asset relevance score
   - Layout quality (overlap, readability)
   - Curriculum alignment

## Testing

Run all tests:

```bash
pnpm --filter @hiraia/images test
```

The test suite includes:

- **AssetLibrary tests** — loading, searching, filtering
- **SimpleRetriever tests** — semantic search and ranking
- **Renderer tests** — primitive elements, figures, assets, compose

## API Reference

### AssetLibrary

- `load(rootDir: string): Promise<void>` — Load assets from filesystem
- `loadFromData(data: {meta, svg}[]): void` — Load from pre-fetched data
- `get(id: string): LoadedAsset | undefined` — Get asset by ID
- `search(query: AssetQuery): AssetSearchResult[]` — Search assets
- `findBest(text: string): LoadedAsset | undefined` — Find best match
- `list(): string[]` — List all asset IDs
- `all(): LoadedAsset[]` — Get all loaded assets
- `size: number` — Number of loaded assets

### SimpleRetriever

- `index(assets: LoadedAsset[]): void` — Index assets for retrieval
- `retrieve(query: string, assets: LoadedAsset[], limit?: number): AssetSearchResult[]` — Retrieve relevant assets
- `findBest(query: string, assets: LoadedAsset[]): LoadedAsset | undefined` — Find best match

### setAssetLibrary

```typescript
import { setAssetLibrary } from '@hiraia/images';

// Must be called before rendering asset elements
setAssetLibrary(library);
```

## License

Asset library and metadata schema: MIT (Hiraia project)

Individual assets: See `license` field in each JSON metadata file.
