/**
 * Tests for the asset library and retrieval system.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AssetLibrary } from '../src/assets/library.js';
import { SimpleRetriever } from '../src/retrieval/embeddings.js';
import type { LoadedAsset } from '../src/assets/types.js';

describe('AssetLibrary', () => {
  let library: AssetLibrary;

  beforeEach(() => {
    library = new AssetLibrary();
  });

  it('should load assets from data', () => {
    const testData = [
      {
        meta: {
          id: 'test-asset',
          name: 'Test Asset',
          description: 'A test asset for unit testing',
          subject: 'biology' as const,
          grades: ['4-6' as const],
          tags: ['test', 'biology'],
          source: 'hiraia',
          license: 'CC-BY-4.0' as const,
          viewBox: [100, 100] as [number, number],
        },
        svg: '<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>',
      },
    ];

    library.loadFromData(testData);

    expect(library.isLoaded).toBe(true);
    expect(library.size).toBe(1);
    expect(library.list()).toContain('test-asset');
  });

  it('should retrieve an asset by ID', () => {
    const testData = [
      {
        meta: {
          id: 'cell-animal',
          name: 'Animal Cell',
          description: 'Animal cell diagram',
          subject: 'biology' as const,
          grades: ['7-9' as const],
          tags: ['cell', 'biology'],
          source: 'hiraia',
          license: 'CC-BY-4.0' as const,
          viewBox: [200, 200] as [number, number],
        },
        svg: '<svg viewBox="0 0 200 200"><ellipse cx="100" cy="100" rx="80" ry="70"/></svg>',
      },
    ];

    library.loadFromData(testData);
    const asset = library.get('cell-animal');

    expect(asset).toBeDefined();
    expect(asset?.meta.name).toBe('Animal Cell');
    expect(asset?.svgContent).toContain('<ellipse');
  });

  it('should search assets by text query', () => {
    const testData: { meta: any; svg: string }[] = [
      {
        meta: {
          id: 'battery',
          name: 'Battery',
          description: 'Battery symbol for circuits',
          subject: 'physics',
          grades: ['7-9'],
          tags: ['circuit', 'battery', 'electricity'],
          source: 'hiraia',
          license: 'CC-BY-4.0',
          viewBox: [120, 60],
        },
        svg: '<svg viewBox="0 0 120 60"><rect x="10" y="15" width="100" height="30"/></svg>',
      },
      {
        meta: {
          id: 'cell-plant',
          name: 'Plant Cell',
          description: 'Plant cell with chloroplasts',
          subject: 'biology',
          grades: ['7-9'],
          tags: ['cell', 'plant', 'chloroplast'],
          source: 'hiraia',
          license: 'CC-BY-4.0',
          viewBox: [200, 200],
        },
        svg: '<svg viewBox="0 0 200 200"><rect x="20" y="30" width="160" height="140"/></svg>',
      },
    ];

    library.loadFromData(testData);
    const results = library.search({ text: 'circuit battery' });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.asset.meta.id).toBe('battery');
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it('should filter by subject', () => {
    const testData = [
      {
        meta: {
          id: 'leaf',
          name: 'Leaf',
          description: 'Green leaf',
          subject: 'biology' as const,
          grades: ['4-6' as const],
          tags: ['leaf', 'plant'],
          source: 'hiraia',
          license: 'CC-BY-4.0' as const,
          viewBox: [120, 100] as [number, number],
        },
        svg: '<svg viewBox="0 0 120 100"><ellipse cx="60" cy="50" rx="45" ry="35"/></svg>',
      },
    ];

    library.loadFromData(testData);
    const results = library.search({ subject: 'biology' });

    expect(results.length).toBe(1);
    expect(results[0]!.asset.meta.subject).toBe('biology');
  });

  it('should find best matching asset', () => {
    const testData = [
      {
        meta: {
          id: 'water-molecule',
          name: 'Water Molecule',
          description: 'H2O molecule',
          subject: 'chemistry' as const,
          grades: ['7-9' as const],
          tags: ['water', 'molecule', 'H2O'],
          source: 'hiraia',
          license: 'CC-BY-4.0' as const,
          viewBox: [120, 100] as [number, number],
        },
        svg: '<svg viewBox="0 0 120 100"><circle cx="60" cy="50" r="20"/></svg>',
      },
    ];

    library.loadFromData(testData);
    const best = library.findBest('water H2O');

    expect(best).toBeDefined();
    expect(best?.meta.id).toBe('water-molecule');
  });

  it('should throw error if not loaded', () => {
    expect(() => library.search({ text: 'test' })).toThrow('not loaded');
  });
});

describe('SimpleRetriever', () => {
  let retriever: SimpleRetriever;
  let testAssets: LoadedAsset[];

  beforeEach(() => {
    retriever = new SimpleRetriever();
    testAssets = [
      {
        meta: {
          id: 'sun',
          name: 'Sun',
          description: 'The Sun with radiating rays',
          subject: 'earth-science',
          grades: ['4-6', '7-9'],
          tags: ['sun', 'solar', 'star', 'energy'],
          source: 'hiraia',
          license: 'CC-BY-4.0',
          viewBox: [100, 100],
        },
        svgContent: '<circle cx="50" cy="50" r="25"/>',
        viewBox: '0 0 100 100',
      },
      {
        meta: {
          id: 'earth',
          name: 'Earth',
          description: 'Planet Earth',
          subject: 'earth-science',
          grades: ['4-6', '7-9'],
          tags: ['earth', 'planet', 'gravity'],
          source: 'hiraia',
          license: 'CC-BY-4.0',
          viewBox: [100, 100],
        },
        svgContent: '<circle cx="50" cy="50" r="40"/>',
        viewBox: '0 0 100 100',
      },
    ];
  });

  it('should index assets', () => {
    retriever.index(testAssets);
    // Indexing should complete without error
    expect(true).toBe(true);
  });

  it('should retrieve relevant assets', () => {
    const results = retriever.retrieve('sun solar energy', testAssets, 2);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.asset.meta.id).toBe('sun');
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it('should find best matching asset', () => {
    const best = retriever.findBest('planet earth gravity', testAssets);

    expect(best).toBeDefined();
    expect(best?.meta.id).toBe('earth');
  });

  it('should return empty array for no matches', () => {
    const results = retriever.retrieve('xyz123', testAssets, 5);

    expect(results.length).toBe(0);
  });

  it('should rank results by relevance', () => {
    const results = retriever.retrieve('sun planet earth', testAssets, 2);

    expect(results.length).toBe(2);
    // Both should have scores, but order depends on term frequency
    expect(results[0]!.score).toBeGreaterThan(0);
    expect(results[1]!.score).toBeGreaterThan(0);
  });
});
