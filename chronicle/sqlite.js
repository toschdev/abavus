/**
 * Siegel Chronicle - SQLite Backend
 * 
 * Same API as JSONL Chronicle, but with SQLite for:
 * - Fast queries (by action, time range, session)
 * - Full-text search (FTS5)
 * - Better scalability
 * - ACID transactions
 * 
 * Uses sql.js (SQLite compiled to WASM) for cross-platform compatibility.
 */

import initSqlJs from 'sql.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { hash, randomId } from '../core/index.js';

const SIEGEL_DIR = join(homedir(), '.siegel');
const DEFAULT_DB_PATH = join(SIEGEL_DIR, 'chronicle.db');

let SQL = null;

/**
 * Initialize sql.js (must be called once)
 */
async function initSQL() {
  if (!SQL) {
    SQL = await initSqlJs();
  }
  return SQL;
}

/**
 * SQLite-backed Chronicle
 */
export class SQLiteChronicle {
  constructor(dbPath = DEFAULT_DB_PATH) {
    this.dbPath = dbPath;
    this.db = null;
    this.head = null;
    this._dirty = false;
  }

  /**
   * Initialize database (async!)
   */
  async init() {
    await initSQL();
    
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Load existing or create new
    if (existsSync(this.dbPath)) {
      const buffer = readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }

    this._createTables();
    this._loadHead();

    return this;
  }

  /**
   * Create tables and indexes
   */
  _createTables() {
    // Main entries table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        action TEXT NOT NULL,
        payload TEXT NOT NULL,
        prev_hash TEXT,
        signature TEXT,
        agent_id TEXT,
        entry_hash TEXT NOT NULL,
        
        -- Denormalized fields for fast queries
        session_id TEXT,
        turn_id TEXT,
        tool_name TEXT,
        channel TEXT,
        content_text TEXT,
        
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Indexes
    this.db.run('CREATE INDEX IF NOT EXISTS idx_entries_timestamp ON entries(timestamp)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_entries_action ON entries(action)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_entries_session ON entries(session_id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_entries_turn ON entries(turn_id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_entries_tool ON entries(tool_name)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_entries_agent ON entries(agent_id)');

    // Content blobs for deduplication
    this.db.run(`
      CREATE TABLE IF NOT EXISTS content_blobs (
        hash TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        original_size INTEGER NOT NULL,
        refs INTEGER DEFAULT 1,
        first_entry_id TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Sessions metadata
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        agent_id TEXT,
        started_at TEXT,
        ended_at TEXT,
        config TEXT,
        summary TEXT,
        turn_count INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        total_cost REAL DEFAULT 0
      )
    `);
  }

  /**
   * Load the head hash from last entry
   */
  _loadHead() {
    const result = this.db.exec('SELECT entry_hash FROM entries ORDER BY rowid DESC LIMIT 1');
    this.head = result.length > 0 && result[0].values.length > 0 
      ? result[0].values[0][0] 
      : null;
  }

  /**
   * Save database to disk
   */
  save() {
    if (this.db) {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      writeFileSync(this.dbPath, buffer);
      this._dirty = false;
    }
  }

  /**
   * Auto-save after each write (can be disabled for batch operations)
   */
  _maybeAutoSave() {
    if (this._dirty && this._autoSave !== false) {
      this.save();
    }
  }

  /**
   * Append a new entry
   */
  append(action, payload, identity) {
    const id = randomId(8);
    const timestamp = new Date().toISOString();
    const prevHash = this.head;

    const canonical = JSON.stringify({
      id,
      timestamp,
      action,
      payload,
      prevHash,
      agentId: identity.id
    });

    const signature = identity.sign(canonical).toString('base64');
    const entryHash = hash(canonical);

    // Extract denormalized fields
    const sessionId = payload.sessionId || payload._sourceSession || null;
    const turnId = payload.turnId || null;
    const toolName = payload.tool || null;
    const channel = payload.channel || null;
    
    // Extract searchable text content
    const contentText = this._extractText(payload);

    this.db.run(`
      INSERT INTO entries (
        id, timestamp, action, payload, prev_hash, signature, agent_id, entry_hash,
        session_id, turn_id, tool_name, channel, content_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, timestamp, action, JSON.stringify(payload), prevHash, signature, identity.id, entryHash,
        sessionId, turnId, toolName, channel, contentText]);

    this.head = entryHash;
    this._dirty = true;
    this._maybeAutoSave();

    return { id, timestamp, action, payload, prevHash, signature, agentId: identity.id, entryHash };
  }

  /**
   * Extract searchable text from payload
   */
  _extractText(payload) {
    const parts = [];
    
    if (payload.content) parts.push(payload.content);
    if (payload.output?.content) parts.push(payload.output.content);
    if (payload.output?.thinking) parts.push(payload.output.thinking);
    if (payload.message) parts.push(payload.message);
    if (payload.arguments) parts.push(JSON.stringify(payload.arguments));
    if (payload.result && typeof payload.result === 'string') parts.push(payload.result);
    
    return parts.join(' ').slice(0, 10000); // Limit size
  }

  /**
   * Get entry by ID
   */
  get(id) {
    const result = this.db.exec('SELECT * FROM entries WHERE id = ?', [id]);
    return result.length > 0 && result[0].values.length > 0
      ? this._rowToEntry(result[0].columns, result[0].values[0])
      : null;
  }

  /**
   * Get entries by action type
   */
  byAction(action, limit = 100) {
    const result = this.db.exec(
      'SELECT * FROM entries WHERE action = ? ORDER BY timestamp DESC LIMIT ?',
      [action, limit]
    );
    return this._resultToEntries(result);
  }

  /**
   * Get entries in time range
   */
  byTimeRange(from, to, limit = 1000) {
    const result = this.db.exec(
      'SELECT * FROM entries WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC LIMIT ?',
      [from, to, limit]
    );
    return this._resultToEntries(result);
  }

  /**
   * Get entries by session
   */
  bySession(sessionId, limit = 1000) {
    const result = this.db.exec(
      'SELECT * FROM entries WHERE session_id = ? ORDER BY timestamp ASC LIMIT ?',
      [sessionId, limit]
    );
    return this._resultToEntries(result);
  }

  /**
   * Full-text search (uses LIKE, not FTS - sql.js doesn't support FTS5 well)
   */
  search(query, limit = 50) {
    const pattern = `%${query}%`;
    const result = this.db.exec(
      'SELECT * FROM entries WHERE content_text LIKE ? ORDER BY timestamp DESC LIMIT ?',
      [pattern, limit]
    );
    return this._resultToEntries(result);
  }

  /**
   * Get recent entries
   */
  recent(limit = 50) {
    const result = this.db.exec(
      'SELECT * FROM entries ORDER BY timestamp DESC LIMIT ?',
      [limit]
    );
    return this._resultToEntries(result);
  }

  /**
   * Get tool usage stats
   */
  toolStats(since = null) {
    const query = since
      ? 'SELECT tool_name, COUNT(*) as count FROM entries WHERE action = ? AND tool_name IS NOT NULL AND timestamp >= ? GROUP BY tool_name ORDER BY count DESC'
      : 'SELECT tool_name, COUNT(*) as count FROM entries WHERE action = ? AND tool_name IS NOT NULL GROUP BY tool_name ORDER BY count DESC';
    
    const result = since
      ? this.db.exec(query, ['tool.call', since])
      : this.db.exec(query, ['tool.call']);

    if (result.length === 0) return [];
    return result[0].values.map(row => ({
      tool_name: row[0],
      count: row[1]
    }));
  }

  /**
   * Get session summaries
   */
  sessionStats(limit = 20) {
    const result = this.db.exec(`
      SELECT 
        session_id,
        MIN(timestamp) as started,
        MAX(timestamp) as ended,
        COUNT(*) as entries
      FROM entries
      WHERE session_id IS NOT NULL
      GROUP BY session_id
      ORDER BY started DESC
      LIMIT ?
    `, [limit]);

    if (result.length === 0) return [];
    return result[0].values.map(row => ({
      session_id: row[0],
      started: row[1],
      ended: row[2],
      entries: row[3]
    }));
  }

  /**
   * Verify chain integrity
   */
  verifyChain(identity) {
    const errors = [];
    let prevHash = null;

    const result = this.db.exec('SELECT * FROM entries ORDER BY rowid ASC');
    if (result.length === 0) return { valid: true, errors: [], entries: 0, head: null };

    const columns = result[0].columns;
    const rows = result[0].values;

    for (let i = 0; i < rows.length; i++) {
      const row = this._rowToEntry(columns, rows[i]);

      if (row.prevHash !== prevHash) {
        errors.push(`Entry ${i} (${row.id}): chain broken - prevHash mismatch`);
      }

      const canonical = JSON.stringify({
        id: row.id,
        timestamp: row.timestamp,
        action: row.action,
        payload: row.payload,
        prevHash: row.prevHash,
        agentId: row.agentId
      });

      if (row.signature) {
        const sig = Buffer.from(row.signature, 'base64');
        if (!identity.verify(canonical, sig)) {
          errors.push(`Entry ${i} (${row.id}): invalid signature`);
        }
      }

      prevHash = row.entryHash;
    }

    return { valid: errors.length === 0, errors, entries: rows.length, head: this.head };
  }

  /**
   * Get overall stats
   */
  stats() {
    const countResult = this.db.exec('SELECT action, COUNT(*) as count FROM entries GROUP BY action');
    const totalResult = this.db.exec('SELECT COUNT(*) FROM entries');
    const firstResult = this.db.exec('SELECT timestamp FROM entries ORDER BY rowid ASC LIMIT 1');
    const lastResult = this.db.exec('SELECT timestamp FROM entries ORDER BY rowid DESC LIMIT 1');

    const actions = {};
    if (countResult.length > 0) {
      for (const row of countResult[0].values) {
        actions[row[0]] = row[1];
      }
    }

    return {
      entries: totalResult[0]?.values[0]?.[0] || 0,
      head: this.head,
      actions,
      first: firstResult[0]?.values[0]?.[0] || null,
      last: lastResult[0]?.values[0]?.[0] || null,
      dbSize: this.db.export().length
    };
  }

  /**
   * Convert result to entries array
   */
  _resultToEntries(result) {
    if (result.length === 0) return [];
    return result[0].values.map(row => this._rowToEntry(result[0].columns, row));
  }

  /**
   * Convert row to entry object
   */
  _rowToEntry(columns, values) {
    const row = {};
    columns.forEach((col, i) => row[col] = values[i]);
    
    return {
      id: row.id,
      timestamp: row.timestamp,
      action: row.action,
      payload: JSON.parse(row.payload),
      prevHash: row.prev_hash,
      signature: row.signature,
      agentId: row.agent_id,
      entryHash: row.entry_hash
    };
  }

  /**
   * Close database
   */
  close() {
    if (this._dirty) {
      this.save();
    }
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Export to JSONL
   */
  exportJSONL() {
    const result = this.db.exec('SELECT * FROM entries ORDER BY rowid ASC');
    if (result.length === 0) return '';
    return result[0].values
      .map(row => JSON.stringify(this._rowToEntry(result[0].columns, row)))
      .join('\n');
  }

  /**
   * Import from JSONL
   */
  importJSONL(jsonlContent, identity) {
    const lines = jsonlContent.trim().split('\n').filter(Boolean);
    this._autoSave = false;

    let imported = 0;
    for (const line of lines) {
      const entry = JSON.parse(line);
      const payload = entry.payload || {};
      const entryHash = hash(JSON.stringify({
        id: entry.id,
        timestamp: entry.timestamp,
        action: entry.action,
        payload,
        prevHash: entry.prevHash,
        agentId: entry.agentId
      }));

      const contentText = this._extractText(payload);

      this.db.run(`
        INSERT OR IGNORE INTO entries (
          id, timestamp, action, payload, prev_hash, signature, agent_id, entry_hash,
          session_id, turn_id, tool_name, channel, content_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        entry.id,
        entry.timestamp,
        entry.action,
        JSON.stringify(payload),
        entry.prevHash,
        entry.signature,
        entry.agentId,
        entryHash,
        payload.sessionId || payload._sourceSession || null,
        payload.turnId || null,
        payload.tool || null,
        payload.channel || null,
        contentText
      ]);
      imported++;
    }

    this._autoSave = true;
    this._loadHead();
    this.save();

    return { imported };
  }

  /**
   * Batch operations (disables auto-save)
   */
  batch(fn) {
    this._autoSave = false;
    try {
      fn();
    } finally {
      this._autoSave = true;
      this.save();
    }
  }
}

export default { SQLiteChronicle, initSQL };
