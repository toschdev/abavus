/**
 * Abavus Semantic Chronicle
 * 
 * Extends SQLite Chronicle with embedding-based semantic search.
 */

import { SQLiteChronicle } from './sqlite.js';
import { 
  OllamaEmbeddings, 
  cosineSimilarity, 
  findSimilar,
  compressEmbedding,
  decompressEmbedding 
} from '../lib/embeddings.js';

/**
 * Chronicle with semantic search capabilities
 */
export class SemanticChronicle extends SQLiteChronicle {
  constructor(dbPath, options = {}) {
    super(dbPath);
    this.embedder = options.embedder || null;
    this.embeddingModel = options.model || 'nomic-embed-text';
    this.ollamaUrl = options.ollamaUrl || 'http://localhost:11434';
  }

  /**
   * Initialize with embedding support
   */
  async init() {
    await super.init();
    this._createEmbeddingTables();
    
    // Initialize embedder if not provided
    if (!this.embedder) {
      this.embedder = new OllamaEmbeddings({
        baseUrl: this.ollamaUrl,
        model: this.embeddingModel
      });
    }
    
    return this;
  }

  /**
   * Create embedding storage tables
   */
  _createEmbeddingTables() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS embeddings (
        entry_id TEXT PRIMARY KEY,
        embedding TEXT NOT NULL,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (entry_id) REFERENCES entries(id)
      )
    `);

    this.db.run('CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings(model)');
  }

  /**
   * Generate and store embedding for an entry
   */
  async embedEntry(entryId) {
    const entry = this.get(entryId);
    if (!entry) throw new Error(`Entry not found: ${entryId}`);

    // Extract text to embed
    const text = this._entryToText(entry);
    if (!text) return null;

    // Generate embedding
    const embedding = await this.embedder.embed(text);
    const compressed = compressEmbedding(embedding);

    // Store
    this.db.run(`
      INSERT OR REPLACE INTO embeddings (entry_id, embedding, model, dimensions)
      VALUES (?, ?, ?, ?)
    `, [entryId, compressed, this.embeddingModel, embedding.length]);

    this.save();
    return { entryId, dimensions: embedding.length };
  }

  /**
   * Batch embed multiple entries
   */
  async embedEntries(entryIds, options = {}) {
    const { batchSize = 10, onProgress } = options;
    const results = [];
    let processed = 0;

    for (let i = 0; i < entryIds.length; i += batchSize) {
      const batch = entryIds.slice(i, i + batchSize);
      
      for (const entryId of batch) {
        try {
          // Skip if already embedded
          const existing = this.db.exec(
            'SELECT 1 FROM embeddings WHERE entry_id = ?', [entryId]
          );
          if (existing.length > 0 && existing[0].values.length > 0) {
            continue;
          }

          const result = await this.embedEntry(entryId);
          if (result) results.push(result);
        } catch (e) {
          // Skip failed entries
        }
        
        processed++;
        if (onProgress) onProgress(processed, entryIds.length);
      }
    }

    return results;
  }

  /**
   * Embed all entries that don't have embeddings yet
   */
  async embedAll(options = {}) {
    const { actions = ['llm.turn', 'message.in'], onProgress } = options;

    // Get entries without embeddings
    const actionPlaceholders = actions.map(() => '?').join(',');
    const result = this.db.exec(`
      SELECT e.id FROM entries e
      LEFT JOIN embeddings emb ON e.id = emb.entry_id
      WHERE emb.entry_id IS NULL
      AND e.action IN (${actionPlaceholders})
      ORDER BY e.timestamp ASC
    `, actions);

    if (result.length === 0) return { embedded: 0 };

    const entryIds = result[0].values.map(row => row[0]);
    const embedded = await this.embedEntries(entryIds, { onProgress });

    return { embedded: embedded.length, total: entryIds.length };
  }

  /**
   * Semantic search
   */
  async semanticSearch(query, options = {}) {
    const { limit = 10, threshold = 0.5, actions = null } = options;

    // Generate query embedding
    const queryEmbedding = await this.embedder.embed(query);

    // Get all embeddings
    let sql = `
      SELECT e.*, emb.embedding 
      FROM entries e
      JOIN embeddings emb ON e.id = emb.entry_id
    `;
    const params = [];

    if (actions && actions.length > 0) {
      sql += ` WHERE e.action IN (${actions.map(() => '?').join(',')})`;
      params.push(...actions);
    }

    const result = this.db.exec(sql, params);
    if (result.length === 0) return [];

    // Calculate similarities
    const columns = result[0].columns;
    const embeddingIdx = columns.indexOf('embedding');
    
    const candidates = result[0].values.map(row => {
      const entry = this._rowToEntry(columns.filter(c => c !== 'embedding'), 
        row.filter((_, i) => i !== embeddingIdx));
      const embedding = decompressEmbedding(row[embeddingIdx]);
      return { ...entry, embedding };
    });

    // Find similar
    const similar = findSimilar(queryEmbedding, candidates, limit)
      .filter(r => r.score >= threshold);

    // Clean up result (remove embedding from output)
    return similar.map(({ embedding, ...rest }) => rest);
  }

  /**
   * Find entries similar to a given entry
   */
  async findSimilarEntries(entryId, options = {}) {
    const { limit = 10, threshold = 0.5 } = options;

    // Get entry's embedding
    const result = this.db.exec(
      'SELECT embedding FROM embeddings WHERE entry_id = ?', [entryId]
    );
    if (result.length === 0 || result[0].values.length === 0) {
      throw new Error(`No embedding found for entry: ${entryId}`);
    }

    const embedding = decompressEmbedding(result[0].values[0][0]);

    // Search using the embedding directly
    const allResult = this.db.exec(`
      SELECT e.*, emb.embedding 
      FROM entries e
      JOIN embeddings emb ON e.id = emb.entry_id
      WHERE e.id != ?
    `, [entryId]);

    if (allResult.length === 0) return [];

    const columns = allResult[0].columns;
    const embeddingIdx = columns.indexOf('embedding');

    const candidates = allResult[0].values.map(row => {
      const entry = this._rowToEntry(
        columns.filter(c => c !== 'embedding'),
        row.filter((_, i) => i !== embeddingIdx)
      );
      const emb = decompressEmbedding(row[embeddingIdx]);
      return { ...entry, embedding: emb };
    });

    const similar = findSimilar(embedding, candidates, limit)
      .filter(r => r.score >= threshold);

    return similar.map(({ embedding, ...rest }) => rest);
  }

  /**
   * Extract searchable text from entry
   */
  _entryToText(entry) {
    const parts = [];
    const p = entry.payload;

    // Action context
    parts.push(`[${entry.action}]`);

    // Content based on action type
    if (p.content) parts.push(p.content);
    if (p.output?.content) parts.push(p.output.content);
    if (p.output?.thinking) parts.push(p.output.thinking);
    if (p.message) parts.push(p.message);
    
    // Tool info
    if (p.tool) {
      parts.push(`Tool: ${p.tool}`);
      if (p.arguments) {
        const args = JSON.stringify(p.arguments);
        if (args.length < 500) parts.push(args);
      }
    }

    const text = parts.join('\n').trim();
    return text.length > 0 ? text : null;
  }

  /**
   * Get embedding stats
   */
  embeddingStats() {
    const total = this.db.exec('SELECT COUNT(*) FROM entries')[0]?.values[0]?.[0] || 0;
    const embedded = this.db.exec('SELECT COUNT(*) FROM embeddings')[0]?.values[0]?.[0] || 0;
    const models = this.db.exec('SELECT model, COUNT(*) FROM embeddings GROUP BY model');
    
    return {
      totalEntries: total,
      embeddedEntries: embedded,
      coverage: total > 0 ? (embedded / total * 100).toFixed(1) + '%' : '0%',
      models: models.length > 0 
        ? Object.fromEntries(models[0].values.map(r => [r[0], r[1]]))
        : {}
    };
  }
}

export default { SemanticChronicle };
