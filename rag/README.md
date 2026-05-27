# Hiraia RAG Pipeline

This directory contains the Retrieval-Augmented Generation (RAG) infrastructure for grounding the Hiraia AI tutor in the Philippine DepEd K-12 Science curriculum.

## Overview

RAG ensures the tutor provides accurate, curriculum-aligned responses by:
1. **Ingesting** DepEd Science curriculum documents and Self-Learning Modules
2. **Chunking** content into semantic segments
3. **Embedding** chunks using QVAC's GTE embedding model
4. **Indexing** embeddings for fast similarity search
5. **Retrieving** relevant context during tutoring conversations

## Architecture

```
DepEd PDFs → Text Extraction → Chunking → Embedding → Vector Index
                                                         ↓
User Query → Embed Query → Similarity Search → Top-K Chunks → Inject into Prompt
```

## Directory Structure

```
rag/
├── sources/               # Processed curriculum content (gitignored)
│   ├── curriculum-guides/
│   ├── learning-modules/
│   └── index.json         # Vector index metadata
├── scripts/
│   ├── download.js        # Download DepEd materials
│   ├── extract.js         # Extract text from PDFs
│   ├── chunk.js           # Chunk text into semantic segments
│   ├── embed.js           # Generate embeddings using QVAC
│   ├── build-index.js     # Build searchable vector index
│   └── query.js           # Test RAG queries
├── config.js              # RAG configuration
├── package.json
└── README.md
```

## Prerequisites

- **Node.js** 18+ with ES modules support
- **QVAC SDK** ^0.11.0 installed
- **GTE embedding model** loaded via QVAC (~150MB)
- **PDF parsing library** (pdf-parse)

## Setup

```bash
cd rag
pnpm install
```

## Pipeline Steps

### 1. Download Curriculum Materials

```bash
node scripts/download.js
```

Downloads:
- MATATAG Science Curriculum Guide (Grades 4, 7)
- K-12 Science Curriculum Guide (Grades 3-10)
- Self-Learning Modules from DepEd LRMDS Portal

Files saved to `sources/` (gitignored, ~200MB total).

### 2. Extract Text from PDFs

```bash
node scripts/extract.js
```

Converts PDFs to plain text, preserving structure:
- Grade level
- Quarter
- Domain (Matter, Living Things, Force/Motion/Energy, Earth/Space)
- Learning competencies
- Lesson content

### 3. Chunk Content

```bash
node scripts/chunk.js
```

Splits text into semantic chunks:
- **Size:** 512 tokens (optimal for context window)
- **Overlap:** 64 tokens (preserve context across boundaries)
- **Strategy:** Paragraph-aware, respect competency boundaries

Output: `sources/chunks.json`

### 4. Generate Embeddings

```bash
node scripts/embed.js
```

Uses QVAC's GTE model to embed each chunk:
- **Model:** GTE-base (~150MB)
- **Dimension:** 768
- **Batch size:** 32

Output: `sources/embeddings.json`

### 5. Build Vector Index

```bash
node scripts/build-index.js
```

Creates a searchable index using HNSW (Hierarchical Navigable Small World):
- **Library:** hnswlib-node
- **Metric:** Cosine similarity
- **Top-K:** 5 (retrieve 5 most relevant chunks)

Output: `sources/index.json` (vector index) + `sources/metadata.json` (chunk metadata)

### 6. Test Queries

```bash
node scripts/query.js "What is photosynthesis?"
```

Retrieves and displays relevant curriculum content for a query.

## Configuration

Edit `config.js` to customize:

```javascript
export const RAG_CONFIG = {
  chunkSize: 512,        // Tokens per chunk
  chunkOverlap: 64,      // Overlap between chunks
  topK: 5,               // Number of chunks to retrieve
  similarityThreshold: 0.7,  // Minimum similarity score
  embeddingModel: 'gte-base',
  indexAlgorithm: 'hnsw',
};
```

## Integration with Tutor

The `TutorEngine.ragSearch()` method uses this index:

```typescript
const results = await engine.ragSearch(
  "Ano ang photosynthesis?",
  5  // top-K
);

// Inject into system prompt
const context = results.map(r => r.content).join('\n\n');
const systemPrompt = `
You are Hiraia, a science tutor.

Relevant curriculum content:
${context}

Answer the student's question using this context.
`;
```

## Data Sources

All materials are publicly available from DepEd:

| Source | URL | Content |
|--------|-----|---------|
| MATATAG Science CG | [deped.gov.ph](https://www.deped.gov.ph/matatagcurriculumk147/) | Grades 4 & 7 curriculum standards |
| K-12 Science CG | [deped.gov.ph PDF](https://www.deped.gov.ph/wp-content/uploads/2019/01/Science-CG_with-tagged-sci-equipment_revised.pdf) | Grades 3-10 competency lists |
| DepEd LRMDS Portal | [lrmds.deped.gov.ph](https://lrmds.deped.gov.ph/k_to_12) | Self-Learning Modules (PDFs) |

## Expected Index Size

For Grades 3-10 Science:
- **Curriculum guides:** ~50 pages → ~200 chunks
- **Self-Learning Modules:** ~200 modules → ~2,000 chunks
- **Total chunks:** ~2,200
- **Index size:** ~200MB (including embeddings)

## Performance

On midrange Android phones (6GB RAM):
- **Embedding query:** ~50ms
- **Similarity search:** ~100ms
- **Total retrieval time:** ~150ms

## Tips

- Start with curriculum guides only (smaller, faster iteration)
- Add Self-Learning Modules incrementally
- Test queries in Tagalog and Cebuano (embeddings are multilingual)
- Monitor retrieval quality: are results relevant to the query?
- Adjust `topK` and `similarityThreshold` based on testing

## License

Scripts: Apache 2.0
Curriculum content: DepEd Philippines (freely available for educational use)
