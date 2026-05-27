/**
 * RAG Pipeline Configuration
 * Customize these settings based on your needs
 */

export const RAG_CONFIG = {
  // Chunking configuration
  chunkSize: 512,        // Tokens per chunk (optimal for context window)
  chunkOverlap: 64,      // Overlap between chunks (preserve context)
  
  // Retrieval configuration
  topK: 5,               // Number of chunks to retrieve per query
  similarityThreshold: 0.7,  // Minimum cosine similarity (0-1)
  
  // Embedding configuration
  embeddingModel: 'gte-base',  // QVAC embedding model
  embeddingDimension: 768,     // GTE-base dimension
  
  // Index configuration
  indexAlgorithm: 'hnsw',      // Hierarchical Navigable Small World
  hnswConfig: {
    efConstruction: 200,  // Index construction quality (higher = better but slower)
    M: 16,                // Number of connections per layer
    efSearch: 50,         // Search quality (higher = better but slower)
  },
  
  // File paths
  paths: {
    sources: './sources',
    curriculumGuides: './sources/curriculum-guides',
    learningModules: './sources/learning-modules',
    chunks: './sources/chunks.json',
    embeddings: './sources/embeddings.json',
    index: './sources/index.json',
    metadata: './sources/metadata.json',
  },
  
  // Processing configuration
  processing: {
    batchSize: 32,        // Embedding batch size
    maxConcurrency: 4,    // Parallel PDF processing
  },
};

/**
 * DepEd curriculum domains for Science
 */
export const SCIENCE_DOMAINS = {
  MATTER: 'Matter',
  LIVING_THINGS: 'Living Things and Their Environment',
  FORCE_MOTION_ENERGY: 'Force, Motion and Energy',
  EARTH_SPACE: 'Earth and Space',
};

/**
 * Grade level mappings
 */
export const GRADE_LEVELS = {
  3: 'Grade 3',
  4: 'Grade 4',
  5: 'Grade 5',
  6: 'Grade 6',
  7: 'Grade 7',
  8: 'Grade 8',
  9: 'Grade 9',
  10: 'Grade 10',
};

/**
 * Download sources for curriculum materials
 */
export const DOWNLOAD_SOURCES = [
  {
    name: 'MATATAG Science CG Grade 4',
    url: 'https://www.deped.gov.ph/matatagcurriculumk147/',
    type: 'curriculum-guide',
    grades: [4],
  },
  {
    name: 'MATATAG Science CG Grade 7',
    url: 'https://www.deped.gov.ph/matatagcurriculumk147/',
    type: 'curriculum-guide',
    grades: [7],
  },
  {
    name: 'K-12 Science CG (Grades 3-10)',
    url: 'https://www.deped.gov.ph/wp-content/uploads/2019/01/Science-CG_with-tagged-sci-equipment_revised.pdf',
    type: 'curriculum-guide',
    grades: [3, 4, 5, 6, 7, 8, 9, 10],
  },
  {
    name: 'DepEd LRMDS Portal',
    url: 'https://lrmds.deped.gov.ph/k_to_12',
    type: 'learning-modules',
    grades: [3, 4, 5, 6, 7, 8, 9, 10],
    note: 'Manual download required - select Science subject for each grade',
  },
];
