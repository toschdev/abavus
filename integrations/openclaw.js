/**
 * Abavus OpenClaw Integration
 * 
 * Imports OpenClaw session logs into Abavus Chronicle.
 * Enables complete audit trail of all AI interactions.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { Identity } from '../core/index.js';
import { CompleteChronicle } from '../chronicle/complete.js';
import { ActionTypes } from '../chronicle/schema.js';

const OPENCLAW_DIR = join(homedir(), '.openclaw');
const SESSIONS_DIR = join(OPENCLAW_DIR, 'agents', 'main', 'sessions');
const IMPORT_STATE_PATH = join(homedir(), '.abavus', 'openclaw-import-state.json');

/**
 * Import state tracking - remember what we've already imported
 */
class ImportState {
  constructor() {
    this.state = {
      sessions: {},      // sessionId → { lastOffset, lastImport }
      totalImported: 0,
      lastRun: null
    };
    this.load();
  }

  load() {
    if (existsSync(IMPORT_STATE_PATH)) {
      this.state = JSON.parse(readFileSync(IMPORT_STATE_PATH, 'utf8'));
    }
  }

  save() {
    writeFileSync(IMPORT_STATE_PATH, JSON.stringify(this.state, null, 2));
  }

  getSessionOffset(sessionId) {
    return this.state.sessions[sessionId]?.lastOffset || 0;
  }

  updateSession(sessionId, offset, count) {
    this.state.sessions[sessionId] = {
      lastOffset: offset,
      lastImport: new Date().toISOString(),
      count: (this.state.sessions[sessionId]?.count || 0) + count
    };
    this.state.totalImported += count;
    this.state.lastRun = new Date().toISOString();
    this.save();
  }
}

/**
 * Parse OpenClaw session file
 */
function parseSessionFile(filepath) {
  const content = readFileSync(filepath, 'utf8');
  const lines = content.trim().split('\n').filter(Boolean);
  return lines.map(line => JSON.parse(line));
}

/**
 * Convert OpenClaw message to Abavus chronicle entries
 */
function messageToEntries(msg, sessionMeta) {
  const entries = [];
  
  if (msg.type !== 'message' || !msg.message) {
    return entries;
  }

  const { message, timestamp, id } = msg;
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
        channel: sessionMeta.channel || 'unknown',
        content: textContent,
        contentParts: content.length
      }
    });
  }

  // Assistant message
  if (role === 'assistant') {
    // Extract parts
    const thinking = content.find(c => c.type === 'thinking');
    const textParts = content.filter(c => c.type === 'text');
    const toolCalls = content.filter(c => c.type === 'toolCall');

    // Full LLM turn
    entries.push({
      action: ActionTypes.LLM_TURN,
      timestamp,
      payload: {
        turnId: id,
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
          cacheReadTokens: usage.cacheRead,
          cacheWriteTokens: usage.cacheWrite,
          totalTokens: usage.totalTokens
        } : null,
        
        cost: usage?.cost ? {
          inputCost: usage.cost.input,
          outputCost: usage.cost.output,
          cacheReadCost: usage.cost.cacheRead,
          cacheWriteCost: usage.cost.cacheWrite,
          totalCost: usage.cost.total,
          currency: 'USD'
        } : null
      }
    });

    // Individual tool calls (for easier filtering)
    for (const tc of toolCalls) {
      entries.push({
        action: ActionTypes.TOOL_CALL,
        timestamp,
        payload: {
          turnId: id,
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
 * Import a single session file
 */
export function importSession(sessionId, chronicle, identity, options = {}) {
  const { fromOffset = 0, verbose = false } = options;
  
  const filepath = join(SESSIONS_DIR, `${sessionId}.jsonl`);
  if (!existsSync(filepath)) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const records = parseSessionFile(filepath);
  
  // Find session metadata
  const sessionRecord = records.find(r => r.type === 'session');
  const sessionMeta = {
    sessionId,
    cwd: sessionRecord?.cwd,
    startedAt: sessionRecord?.timestamp
  };

  // Import messages from offset
  let imported = 0;
  for (let i = fromOffset; i < records.length; i++) {
    const record = records[i];
    const entries = messageToEntries(record, sessionMeta);
    
    for (const entry of entries) {
      chronicle.append(entry.action, {
        ...entry.payload,
        _sourceSession: sessionId,
        _sourceIndex: i
      }, identity);
      imported++;
      
      if (verbose) {
        console.log(`  [${i}] ${entry.action}`);
      }
    }
  }

  return {
    sessionId,
    recordsProcessed: records.length - fromOffset,
    entriesImported: imported,
    newOffset: records.length
  };
}

/**
 * Import all sessions (incremental)
 */
export function importAllSessions(chronicle, identity, options = {}) {
  const { verbose = false, force = false } = options;
  
  const state = new ImportState();
  const results = [];

  if (!existsSync(SESSIONS_DIR)) {
    throw new Error(`Sessions directory not found: ${SESSIONS_DIR}`);
  }

  const sessionFiles = readdirSync(SESSIONS_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => ({
      id: basename(f, '.jsonl'),
      path: join(SESSIONS_DIR, f),
      mtime: statSync(join(SESSIONS_DIR, f)).mtime
    }))
    .sort((a, b) => a.mtime - b.mtime);

  for (const session of sessionFiles) {
    const offset = force ? 0 : state.getSessionOffset(session.id);
    const fileSize = statSync(session.path).size;
    
    // Skip if no changes (rough check via file size would need more sophistication)
    // For now, always check
    
    try {
      const result = importSession(session.id, chronicle, identity, {
        fromOffset: offset,
        verbose
      });
      
      if (result.entriesImported > 0) {
        state.updateSession(session.id, result.newOffset, result.entriesImported);
        results.push(result);
        
        if (verbose) {
          console.log(`✓ ${session.id}: +${result.entriesImported} entries`);
        }
      }
    } catch (e) {
      console.error(`✗ ${session.id}: ${e.message}`);
    }
  }

  return {
    sessionsProcessed: sessionFiles.length,
    sessionsUpdated: results.length,
    totalEntriesImported: results.reduce((sum, r) => sum + r.entriesImported, 0),
    results
  };
}

/**
 * Watch for new session activity and import in real-time
 */
export function watchSessions(chronicle, identity, options = {}) {
  const { interval = 30000, verbose = false } = options;
  
  console.log(`Watching sessions (every ${interval/1000}s)...`);
  
  const tick = () => {
    const result = importAllSessions(chronicle, identity, { verbose: false });
    if (result.totalEntriesImported > 0) {
      console.log(`[${new Date().toISOString()}] Imported ${result.totalEntriesImported} entries from ${result.sessionsUpdated} sessions`);
    }
  };

  // Initial import
  tick();
  
  // Watch loop
  return setInterval(tick, interval);
}

/**
 * Get import statistics
 */
export function getImportStats() {
  const state = new ImportState();
  return {
    ...state.state,
    sessionsTracked: Object.keys(state.state.sessions).length
  };
}

export default {
  importSession,
  importAllSessions,
  watchSessions,
  getImportStats
};
