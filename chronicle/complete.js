/**
 * Siegel Complete Chronicle - Full audit trail with deduplication
 * 
 * Extends base Chronicle with:
 * - Content deduplication (system prompts, injected files)
 * - LLM turn tracking
 * - Session management
 * - Storage statistics
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { gzipSync, gunzipSync } from 'zlib';
import { Chronicle, Entry } from './index.js';
import { ActionTypes, DeduplicationConfig } from './schema.js';

const SIEGEL_DIR = join(homedir(), '.siegel');

/**
 * Content-addressed store for deduplication
 */
class ContentStore {
  constructor(dir) {
    this.dir = dir;
    this.indexPath = join(dir, 'content-index.json');
    this.blobsDir = join(dir, 'blobs');
    this.index = new Map(); // hash → { firstEntry, size, refs }
  }

  init() {
    if (!existsSync(this.blobsDir)) {
      mkdirSync(this.blobsDir, { recursive: true });
    }
    if (existsSync(this.indexPath)) {
      const data = JSON.parse(readFileSync(this.indexPath, 'utf8'));
      this.index = new Map(Object.entries(data));
    }
    return this;
  }

  /**
   * Store content, return hash. Deduplicates automatically.
   */
  store(content, entryId) {
    const hash = createHash('sha256').update(content).digest('hex');
    
    if (this.index.has(hash)) {
      // Already stored - just add reference
      const entry = this.index.get(hash);
      entry.refs++;
      this._saveIndex();
      return { hash, deduplicated: true, firstEntry: entry.firstEntry };
    }

    // New content - store blob
    const blobPath = join(this.blobsDir, hash);
    const compressed = gzipSync(Buffer.from(content));
    writeFileSync(blobPath, compressed);

    this.index.set(hash, {
      firstEntry: entryId,
      size: content.length,
      compressedSize: compressed.length,
      refs: 1,
      storedAt: new Date().toISOString()
    });
    this._saveIndex();

    return { hash, deduplicated: false, size: content.length };
  }

  /**
   * Retrieve content by hash
   */
  retrieve(hash) {
    const blobPath = join(this.blobsDir, hash);
    if (!existsSync(blobPath)) return null;
    const compressed = readFileSync(blobPath);
    return gunzipSync(compressed).toString('utf8');
  }

  /**
   * Get storage statistics
   */
  stats() {
    let totalOriginal = 0;
    let totalCompressed = 0;
    let totalRefs = 0;
    
    for (const [hash, entry] of this.index) {
      totalOriginal += entry.size * entry.refs;
      totalCompressed += entry.compressedSize;
      totalRefs += entry.refs;
    }

    return {
      uniqueBlobs: this.index.size,
      totalReferences: totalRefs,
      originalSize: totalOriginal,
      storedSize: totalCompressed,
      savedBytes: totalOriginal - totalCompressed,
      compressionRatio: totalOriginal > 0 ? (totalCompressed / totalOriginal).toFixed(3) : 0
    };
  }

  _saveIndex() {
    writeFileSync(this.indexPath, JSON.stringify(Object.fromEntries(this.index), null, 2));
  }
}

/**
 * Complete Chronicle with full logging and deduplication
 */
export class CompleteChronicle extends Chronicle {
  constructor(name = 'default', dir = join(SIEGEL_DIR, 'chronicles')) {
    super(name, dir);
    this.contentStore = new ContentStore(join(dir, name + '-content'));
    this.sessionId = null;
    this.turnCounter = 0;
  }

  init() {
    super.init();
    this.contentStore.init();
    return this;
  }

  /**
   * Start a new session
   */
  startSession(config, identity) {
    const { randomId } = require('../core/index.js');
    this.sessionId = randomId(8);
    this.turnCounter = 0;

    return this.append(ActionTypes.SESSION_START, {
      sessionId: this.sessionId,
      ...config
    }, identity);
  }

  /**
   * Log system context (with deduplication)
   */
  logContext(type, source, content, identity) {
    const entryId = require('../core/index.js').randomId(8);
    
    if (content.length >= DeduplicationConfig.minSize) {
      const { hash, deduplicated, firstEntry } = this.contentStore.store(content, entryId);
      
      return this.append(ActionTypes.CONTEXT_INJECT, {
        type,
        source,
        contentHash: hash,
        size: content.length,
        deduplicated,
        ...(deduplicated ? { referencesEntry: firstEntry } : {})
      }, identity);
    }

    // Small content - store inline
    return this.append(ActionTypes.CONTEXT_INJECT, {
      type,
      source,
      content,
      size: content.length
    }, identity);
  }

  /**
   * Log a complete LLM turn
   */
  logTurn(turnData, identity) {
    this.turnCounter++;
    const turnId = `${this.sessionId}-turn-${this.turnCounter}`;

    // Dedup system prompt if large
    if (turnData.input?.system && turnData.input.system.length >= DeduplicationConfig.minSize) {
      const { hash, deduplicated, firstEntry } = this.contentStore.store(
        turnData.input.system, 
        turnId
      );
      turnData.input.systemHash = hash;
      if (deduplicated) {
        turnData.input.systemRef = firstEntry;
        delete turnData.input.system; // Don't store inline
      }
    }

    return this.append(ActionTypes.LLM_TURN, {
      turnId,
      sequence: this.turnCounter,
      ...turnData
    }, identity);
  }

  /**
   * Log tool call
   */
  logToolCall(turnId, callId, tool, args, identity) {
    return this.append(ActionTypes.TOOL_CALL, {
      turnId,
      callId,
      tool,
      arguments: args
    }, identity);
  }

  /**
   * Log tool result (with optional truncation for huge results)
   */
  logToolResult(turnId, callId, tool, result, durationMs, identity, maxSize = 100000) {
    let resultData = result;
    let truncated = false;
    const originalSize = JSON.stringify(result).length;

    if (originalSize > maxSize) {
      // Store full result in content store, truncate inline
      const { hash } = this.contentStore.store(JSON.stringify(result), `${turnId}-${callId}`);
      resultData = `[TRUNCATED - see blob ${hash}]`;
      truncated = true;
    }

    return this.append(ActionTypes.TOOL_RESULT, {
      turnId,
      callId,
      tool,
      result: resultData,
      resultTruncated: truncated,
      resultSize: originalSize,
      success: true,
      durationMs
    }, identity);
  }

  /**
   * Log inbound message
   */
  logMessageIn(channel, from, content, metadata, identity) {
    return this.append(ActionTypes.MESSAGE_INBOUND, {
      channel,
      from,
      content,
      ...metadata
    }, identity);
  }

  /**
   * Log outbound message
   */
  logMessageOut(channel, to, content, metadata, identity) {
    return this.append(ActionTypes.MESSAGE_OUTBOUND, {
      channel,
      to,
      content,
      ...metadata
    }, identity);
  }

  /**
   * End session
   */
  endSession(summary, identity) {
    return this.append(ActionTypes.SESSION_END, {
      sessionId: this.sessionId,
      turns: this.turnCounter,
      ...summary
    }, identity);
  }

  /**
   * Get comprehensive storage stats
   */
  storageStats() {
    const chronicleSize = existsSync(this.path) ? statSync(this.path).size : 0;
    const contentStats = this.contentStore.stats();
    
    const baseStats = this.stats();

    return {
      ...baseStats,
      storage: {
        chronicleFile: chronicleSize,
        contentStore: contentStats,
        totalBytes: chronicleSize + contentStats.storedSize,
        totalBytesHuman: formatBytes(chronicleSize + contentStats.storedSize)
      }
    };
  }

  /**
   * Export chronicle with all content resolved
   */
  exportFull() {
    return this.entries.map(entry => {
      const data = { ...entry };
      
      // Resolve content references
      if (data.payload?.contentHash && !data.payload?.content) {
        data.payload.content = this.contentStore.retrieve(data.payload.contentHash);
      }
      if (data.payload?.input?.systemHash && !data.payload?.input?.system) {
        data.payload.input.system = this.contentStore.retrieve(data.payload.input.systemHash);
      }
      
      return data;
    });
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

export default { CompleteChronicle, ContentStore };
