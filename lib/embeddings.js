/**
 * Abavus Embeddings
 * 
 * Generate and search embeddings for semantic memory.
 * Supports Ollama (local) and OpenAI (cloud).
 */

/**
 * Embedding provider interface
 */
export class EmbeddingProvider {
  async embed(text) { throw new Error('Not implemented'); }
  async embedBatch(texts) { throw new Error('Not implemented'); }
  get dimensions() { throw new Error('Not implemented'); }
}

/**
 * Ollama embeddings (local, free)
 */
export class OllamaEmbeddings extends EmbeddingProvider {
  constructor(options = {}) {
    super();
    this.baseUrl = options.baseUrl || 'http://localhost:11434';
    this.model = options.model || 'nomic-embed-text';
    this._dimensions = options.dimensions || 768; // nomic-embed-text default
  }

  get dimensions() {
    return this._dimensions;
  }

  async embed(text) {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: text
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    return data.embedding;
  }

  async embedBatch(texts) {
    // Ollama doesn't have native batch, so we do sequential
    const embeddings = [];
    for (const text of texts) {
      embeddings.push(await this.embed(text));
    }
    return embeddings;
  }
}

/**
 * OpenAI embeddings (cloud, paid)
 */
export class OpenAIEmbeddings extends EmbeddingProvider {
  constructor(options = {}) {
    super();
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY;
    this.model = options.model || 'text-embedding-3-small';
    this._dimensions = options.dimensions || 1536;
    
    if (!this.apiKey) {
      throw new Error('OpenAI API key required');
    }
  }

  get dimensions() {
    return this._dimensions;
  }

  async embed(text) {
    const embeddings = await this.embedBatch([text]);
    return embeddings[0];
  }

  async embedBatch(texts) {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        input: texts
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI error: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    return data.data.map(d => d.embedding);
  }
}

/**
 * Cosine similarity between two vectors
 */
export function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (normA * normB);
}

/**
 * Find top-k most similar vectors
 */
export function findSimilar(queryEmbedding, candidates, k = 10) {
  const scored = candidates.map((candidate, index) => ({
    index,
    score: cosineSimilarity(queryEmbedding, candidate.embedding),
    ...candidate
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

/**
 * Compress embedding to Float16 for storage (50% size reduction)
 */
export function compressEmbedding(embedding) {
  const buffer = new ArrayBuffer(embedding.length * 2);
  const view = new DataView(buffer);
  
  for (let i = 0; i < embedding.length; i++) {
    // Convert float32 to float16 (rough approximation)
    const float32 = embedding[i];
    const float16 = float32ToFloat16(float32);
    view.setUint16(i * 2, float16, true);
  }
  
  return Buffer.from(buffer).toString('base64');
}

/**
 * Decompress embedding from Float16
 */
export function decompressEmbedding(compressed) {
  const buffer = Buffer.from(compressed, 'base64');
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);
  const embedding = new Array(buffer.length / 2);
  
  for (let i = 0; i < embedding.length; i++) {
    const float16 = view.getUint16(i * 2, true);
    embedding[i] = float16ToFloat32(float16);
  }
  
  return embedding;
}

// Float32 <-> Float16 conversion helpers
function float32ToFloat16(val) {
  const floatView = new Float32Array(1);
  const int32View = new Int32Array(floatView.buffer);
  floatView[0] = val;
  const x = int32View[0];

  let bits = (x >> 16) & 0x8000;
  let m = (x >> 12) & 0x07ff;
  const e = (x >> 23) & 0xff;

  if (e < 103) return bits;
  if (e > 142) {
    bits |= 0x7c00;
    bits |= ((e === 255) ? 0 : 1) && (x & 0x007fffff);
    return bits;
  }
  if (e < 113) {
    m |= 0x0800;
    bits |= (m >> (114 - e)) + ((m >> (113 - e)) & 1);
    return bits;
  }
  bits |= ((e - 112) << 10) | (m >> 1);
  bits += m & 1;
  return bits;
}

function float16ToFloat32(val) {
  const s = (val & 0x8000) >> 15;
  const e = (val & 0x7c00) >> 10;
  const f = val & 0x03ff;

  if (e === 0) {
    return (s ? -1 : 1) * Math.pow(2, -14) * (f / Math.pow(2, 10));
  } else if (e === 0x1f) {
    return f ? NaN : ((s ? -1 : 1) * Infinity);
  }
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / Math.pow(2, 10));
}

export default {
  OllamaEmbeddings,
  OpenAIEmbeddings,
  cosineSimilarity,
  findSimilar,
  compressEmbedding,
  decompressEmbedding
};
