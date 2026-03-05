/**
 * Abavus Daemon
 * 
 * Background service that:
 * 1. Watches OpenClaw sessions in real-time
 * 2. Imports new records immediately
 * 3. Generates embeddings for semantic search
 */

import { LiveWatcher } from './watcher.js';
import { SemanticChronicle } from '../chronicle/semantic.js';
import { Identity } from '../core/index.js';
import { ActionTypes } from '../chronicle/schema.js';

/**
 * Convert OpenClaw record to Abavus entries
 */
function recordToEntries(record, sessionId) {
  const entries = [];
  
  if (record.type !== 'message' || !record.message) {
    return entries;
  }

  const { message, timestamp, id } = record;
  const { role, content, usage, model, provider, stopReason } = message;

  // User message
  if (role === 'user') {
    const textContent = content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    entries.push({
      action: ActionTypes.MESSAGE_INBOUND,
      timestamp,
      payload: {
        messageId: id,
        sessionId,
        content: textContent,
        contentParts: content.length
      }
    });
  }

  // Assistant message
  if (role === 'assistant') {
    const thinking = content.find(c => c.type === 'thinking');
    const textParts = content.filter(c => c.type === 'text');
    const toolCalls = content.filter(c => c.type === 'toolCall');

    entries.push({
      action: ActionTypes.LLM_TURN,
      timestamp,
      payload: {
        turnId: id,
        sessionId,
        model: model ? `${provider}/${model}` : 'unknown',
        output: {
          content: textParts.map(t => t.text).join('\n'),
          thinking: thinking?.thinking || null,
          toolCalls: toolCalls.map(tc => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments
          })),
          stopReason
        },
        usage: usage ? {
          inputTokens: usage.input,
          outputTokens: usage.output,
          totalTokens: usage.totalTokens
        } : null,
        cost: usage?.cost ? {
          totalCost: usage.cost.total,
          currency: 'USD'
        } : null
      }
    });

    // Tool calls
    for (const tc of toolCalls) {
      entries.push({
        action: ActionTypes.TOOL_CALL,
        timestamp,
        payload: {
          turnId: id,
          sessionId,
          callId: tc.id,
          tool: tc.name,
          arguments: tc.arguments
        }
      });
    }
  }

  return entries;
}

/**
 * Abavus Daemon
 */
export class AbavusDaemon {
  constructor(options = {}) {
    this.chronicle = null;
    this.identity = null;
    this.watcher = null;
    this.options = {
      ollamaUrl: options.ollamaUrl || 'http://localhost:11434',
      embeddingModel: options.embeddingModel || 'nomic-embed-text',
      embedOnInsert: options.embedOnInsert ?? false, // Embed immediately (slower but real-time)
      verbose: options.verbose ?? true
    };
    this.stats = {
      entriesAdded: 0,
      entriesEmbedded: 0,
      startedAt: null
    };
  }

  /**
   * Start the daemon
   */
  async start() {
    this.log('Starting Abavus daemon...');

    // Load or create identity
    if (Identity.exists('default')) {
      this.identity = Identity.load('default');
      this.log(`Loaded identity: ${this.identity.id}`);
    } else {
      this.identity = Identity.create({ name: 'abavus-daemon' });
      this.identity.save('default');
      this.log(`Created identity: ${this.identity.id}`);
    }

    // Initialize semantic chronicle
    this.chronicle = new SemanticChronicle(undefined, {
      ollamaUrl: this.options.ollamaUrl,
      model: this.options.embeddingModel
    });
    await this.chronicle.init();
    this.log(`Chronicle ready: ${this.chronicle.dbPath}`);

    // Start watcher
    this.watcher = new LiveWatcher();
    
    this.watcher.on('record', async ({ sessionId, record }) => {
      await this._handleRecord(sessionId, record);
    });

    this.watcher.on('session:new', ({ sessionId }) => {
      this.log(`New session: ${sessionId.slice(0, 8)}...`);
    });

    this.watcher.on('session:updated', ({ sessionId, newRecords }) => {
      if (this.options.verbose) {
        this.log(`Session ${sessionId.slice(0, 8)}...: +${newRecords} records`);
      }
    });

    this.watcher.start();
    this.stats.startedAt = new Date();
    this.log('Watching for new records...\n');

    return this;
  }

  /**
   * Handle incoming record
   */
  async _handleRecord(sessionId, record) {
    const entries = recordToEntries(record, sessionId);

    for (const entry of entries) {
      try {
        const added = this.chronicle.append(entry.action, entry.payload, this.identity);
        this.stats.entriesAdded++;

        if (this.options.verbose) {
          const preview = this._getPreview(entry);
          console.log(`  + ${entry.action} ${preview}`);
        }

        // Optionally embed immediately
        if (this.options.embedOnInsert && 
            ['llm.turn', 'message.in'].includes(entry.action)) {
          try {
            await this.chronicle.embedEntry(added.id);
            this.stats.entriesEmbedded++;
          } catch (e) {
            // Embedding failed, continue anyway
          }
        }
      } catch (e) {
        // Entry might already exist or other error
      }
    }
  }

  /**
   * Get preview text for logging
   */
  _getPreview(entry) {
    const p = entry.payload;
    if (p.tool) return `[${p.tool}]`;
    if (p.output?.content) {
      const text = p.output.content.slice(0, 50).replace(/\n/g, ' ');
      return `"${text}${p.output.content.length > 50 ? '...' : ''}"`;
    }
    if (p.content) {
      const text = p.content.slice(0, 50).replace(/\n/g, ' ');
      return `"${text}${p.content.length > 50 ? '...' : ''}"`;
    }
    return '';
  }

  /**
   * Stop the daemon
   */
  stop() {
    if (this.watcher) {
      this.watcher.stop();
    }
    if (this.chronicle) {
      this.chronicle.close();
    }
    this.log('\nDaemon stopped.');
    this.log(`Stats: ${this.stats.entriesAdded} entries added, ${this.stats.entriesEmbedded} embedded`);
  }

  /**
   * Get current stats
   */
  getStats() {
    const chronicleStats = this.chronicle?.stats() || {};
    const embeddingStats = this.chronicle?.embeddingStats() || {};
    
    return {
      ...this.stats,
      uptime: this.stats.startedAt 
        ? Math.floor((Date.now() - this.stats.startedAt) / 1000) + 's'
        : null,
      chronicle: chronicleStats,
      embeddings: embeddingStats
    };
  }

  log(msg) {
    if (this.options.verbose) {
      console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
    }
  }
}

export default { AbavusDaemon };
