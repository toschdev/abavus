/**
 * Sigil Chronicle - Append-only signed action log
 * 
 * Every action is recorded with:
 * - Timestamp
 * - Action type & payload
 * - Hash of previous entry (chain)
 * - Signature from agent identity
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { hash, randomId } from '../core/index.js';

const SIGIL_DIR = join(homedir(), '.sigil');
const CHRONICLES_DIR = join(SIGIL_DIR, 'chronicles');

/**
 * A single entry in the chronicle
 */
export class Entry {
  constructor({ id, timestamp, action, payload, prevHash, signature, agentId }) {
    this.id = id || randomId(8);
    this.timestamp = timestamp || new Date().toISOString();
    this.action = action;
    this.payload = payload || {};
    this.prevHash = prevHash || null;
    this.signature = signature || null;
    this.agentId = agentId || null;
  }

  /**
   * Get the canonical string representation for hashing/signing
   */
  canonical() {
    return JSON.stringify({
      id: this.id,
      timestamp: this.timestamp,
      action: this.action,
      payload: this.payload,
      prevHash: this.prevHash,
      agentId: this.agentId
    });
  }

  /**
   * Compute hash of this entry
   */
  hash() {
    return hash(this.canonical());
  }

  /**
   * Sign this entry with an identity
   * @param {Identity} identity
   */
  sign(identity) {
    this.agentId = identity.id;
    this.signature = identity.sign(this.canonical()).toString('base64');
  }

  /**
   * Verify signature against a public key
   * @param {Identity} identity
   * @returns {boolean}
   */
  verify(identity) {
    if (!this.signature) return false;
    const sig = Buffer.from(this.signature, 'base64');
    return identity.verify(this.canonical(), sig);
  }

  /**
   * Serialize to JSON line
   */
  toJSON() {
    return JSON.stringify({
      id: this.id,
      timestamp: this.timestamp,
      action: this.action,
      payload: this.payload,
      prevHash: this.prevHash,
      signature: this.signature,
      agentId: this.agentId
    });
  }

  /**
   * Deserialize from JSON
   * @param {string|object} json
   * @returns {Entry}
   */
  static fromJSON(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    return new Entry(data);
  }
}

/**
 * Chronicle - the complete action log
 */
export class Chronicle {
  constructor(name = 'default', dir = CHRONICLES_DIR) {
    this.name = name;
    this.dir = dir;
    this.path = join(dir, `${name}.jsonl`);
    this.entries = [];
    this.head = null; // Hash of last entry
  }

  /**
   * Initialize (create or load)
   */
  init() {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }

    if (existsSync(this.path)) {
      this.load();
    }

    return this;
  }

  /**
   * Load chronicle from disk
   */
  load() {
    const content = readFileSync(this.path, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    
    this.entries = lines.map(line => Entry.fromJSON(line));
    
    if (this.entries.length > 0) {
      this.head = this.entries[this.entries.length - 1].hash();
    }

    return this;
  }

  /**
   * Append a new entry
   * @param {string} action - Action type
   * @param {object} payload - Action data
   * @param {Identity} identity - Signing identity
   * @returns {Entry}
   */
  append(action, payload, identity) {
    const entry = new Entry({
      action,
      payload,
      prevHash: this.head
    });

    entry.sign(identity);
    
    this.entries.push(entry);
    this.head = entry.hash();

    // Append to file
    appendFileSync(this.path, entry.toJSON() + '\n');

    return entry;
  }

  /**
   * Verify the entire chain
   * @param {Identity} identity - Identity to verify signatures against
   * @returns {{ valid: boolean, errors: string[] }}
   */
  verify(identity) {
    const errors = [];
    let prevHash = null;

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];

      // Check chain integrity
      if (entry.prevHash !== prevHash) {
        errors.push(`Entry ${i} (${entry.id}): chain broken - prevHash mismatch`);
      }

      // Check signature
      if (!entry.verify(identity)) {
        errors.push(`Entry ${i} (${entry.id}): invalid signature`);
      }

      prevHash = entry.hash();
    }

    return {
      valid: errors.length === 0,
      errors,
      entries: this.entries.length,
      head: this.head
    };
  }

  /**
   * Get entries by action type
   * @param {string} action
   * @returns {Entry[]}
   */
  filter(action) {
    return this.entries.filter(e => e.action === action);
  }

  /**
   * Get entries in time range
   * @param {Date|string} from
   * @param {Date|string} to
   * @returns {Entry[]}
   */
  range(from, to) {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    return this.entries.filter(e => {
      const date = new Date(e.timestamp);
      return date >= fromDate && date <= toDate;
    });
  }

  /**
   * Get summary stats
   */
  stats() {
    const actions = {};
    for (const entry of this.entries) {
      actions[entry.action] = (actions[entry.action] || 0) + 1;
    }

    return {
      name: this.name,
      entries: this.entries.length,
      head: this.head,
      actions,
      first: this.entries[0]?.timestamp,
      last: this.entries[this.entries.length - 1]?.timestamp
    };
  }
}

/**
 * Pre-defined action types for AI agents
 */
export const Actions = {
  // Tool usage
  TOOL_CALL: 'tool.call',
  TOOL_RESULT: 'tool.result',
  
  // File operations
  FILE_READ: 'file.read',
  FILE_WRITE: 'file.write',
  FILE_DELETE: 'file.delete',
  
  // External communication
  MESSAGE_SEND: 'message.send',
  MESSAGE_RECEIVE: 'message.receive',
  
  // Web
  WEB_FETCH: 'web.fetch',
  WEB_SEARCH: 'web.search',
  
  // System
  SESSION_START: 'session.start',
  SESSION_END: 'session.end',
  
  // Meta
  SNAPSHOT_CREATE: 'snapshot.create',
  FORK: 'fork',
  VOUCH: 'vouch'
};

export default {
  Entry,
  Chronicle,
  Actions
};
