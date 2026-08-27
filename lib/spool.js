/**
 * Fast append-only spool for Grok hook events.
 * Avoids loading the full SQLite DB on every PostToolUse.
 *
 * Flush walks the spool in order and stamps a named parentId (cause)
 * per session before each chronicle.append. Hook timestamps are preserved.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Identity } from '../core/index.js';
import { SQLiteChronicle } from '../chronicle/sqlite.js';
import { Actions } from '../chronicle/index.js';
import { kindOf } from './kinds.js';

const SPOOL_DIR = join(homedir(), '.abavus', 'spool');
const SPOOL_PATH = join(SPOOL_DIR, 'grok.jsonl');

const TOOL_ACTIONS = new Set([
  'tool.call',
  'tool.result',
  'tool.error',
  'file.read',
  'file.write',
  'file.edit',
  'file.delete',
  'web.fetch',
  'web.search',
  'browser.action',
]);

export function spoolPath() {
  return SPOOL_PATH;
}

export function ensureSpoolDir() {
  if (!existsSync(SPOOL_DIR)) {
    mkdirSync(SPOOL_DIR, { recursive: true });
  }
}

/**
 * Append a pending chronicle event to the spool.
 */
export function spoolAppend({ action, payload, sessionId, timestamp = new Date().toISOString() }) {
  ensureSpoolDir();
  const line = JSON.stringify({
    action,
    payload: {
      ...payload,
      sessionId: sessionId || payload.sessionId || null,
      source: 'grok',
    },
    sessionId: sessionId || payload.sessionId || null,
    timestamp,
  });
  appendFileSync(SPOOL_PATH, line + '\n', 'utf8');
}

/**
 * Read all spooled events.
 */
export function spoolRead() {
  if (!existsSync(SPOOL_PATH)) return [];
  const content = readFileSync(SPOOL_PATH, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function sessionKey(record) {
  return record.sessionId || record.payload?.sessionId || '__none__';
}

export function createSessionState() {
  return {
    sessionStartId: null,
    lastCommandId: null,
    lastSaidId: null,
    lastToolId: null,
    toolUseIds: Object.create(null),
  };
}

/**
 * Named cause for a record given already-appended ids in this session.
 * Does not invent parents across sessions. Honours an existing payload.parentId.
 */
export function parentIdFor(record, sessionState = createSessionState()) {
  const payload = record.payload || {};
  if (payload.parentId) return payload.parentId;

  const action = record.action;

  if (action === 'session.start') return null;

  if (action === 'session.end') {
    return sessionState.sessionStartId || null;
  }

  if (action === 'message.in' || payload.kind === 'commanded') {
    return sessionState.sessionStartId || null;
  }

  if (TOOL_ACTIONS.has(action)) {
    const toolUseId = payload.toolUseId;
    if (toolUseId && sessionState.toolUseIds[toolUseId]) {
      return sessionState.toolUseIds[toolUseId];
    }
    return sessionState.lastCommandId || sessionState.sessionStartId || null;
  }

  // said / inferred / remaining done acts (including message.out, llm.turn)
  return sessionState.lastCommandId || sessionState.sessionStartId || null;
}

/**
 * Update per-session pointers from the chronicle id just assigned.
 */
export function updateSessionState(sessionState, record, appendedId) {
  const action = record.action;
  const payload = record.payload || {};
  const kind = payload.kind;

  if (action === 'session.start') {
    sessionState.sessionStartId = appendedId;
  }

  if (action === 'message.in' || kind === 'commanded') {
    sessionState.lastCommandId = appendedId;
  }

  if (action === 'message.out' || action === 'llm.turn' || kind === 'said' || kind === 'inferred') {
    sessionState.lastSaidId = appendedId;
  }

  if (TOOL_ACTIONS.has(action)) {
    sessionState.lastToolId = appendedId;
    const toolUseId = payload.toolUseId;
    if (toolUseId) {
      sessionState.toolUseIds[toolUseId] = appendedId;
    }
  }

  return sessionState;
}

function preparePayload(record, sessionState) {
  const payload = { ...(record.payload || {}) };
  if (!payload.kind) {
    payload.kind = kindOf({ action: record.action, payload });
  }
  if (!payload.parentId) {
    const parentId = parentIdFor({ ...record, payload }, sessionState);
    if (parentId) payload.parentId = parentId;
  }
  return payload;
}

/**
 * Stamp parentId on a list of spool-shaped records using synthetic ids.
 * Used by tests; spoolFlush uses the same parentIdFor / updateSessionState
 * with real chronicle ids.
 *
 * @param {object[]} records
 * @param {() => string} [assignId]
 * @returns {object[]} records with `id` and payload.parentId filled
 */
export function applyLineage(records, assignId) {
  let n = 0;
  const alloc = typeof assignId === 'function' ? assignId : () => `id${++n}`;
  const sessions = new Map();
  const out = [];

  for (const record of records) {
    const sid = sessionKey(record);
    if (!sessions.has(sid)) sessions.set(sid, createSessionState());
    const state = sessions.get(sid);
    const payload = preparePayload(record, state);
    const id = payload._localId || alloc(record);
    const next = { ...record, id, payload };
    updateSessionState(state, next, id);
    out.push(next);
  }

  return out;
}

/**
 * Flush spool into the signed SQLite chronicle.
 */
export async function spoolFlush({ identityName = 'default', clear = true } = {}) {
  const events = spoolRead();
  if (events.length === 0) {
    return { flushed: 0, remaining: 0 };
  }

  if (!Identity.exists(identityName)) {
    throw new Error(`Identity '${identityName}' not found. Run: abavus init`);
  }

  const identity = Identity.load(identityName);
  const chronicle = new SQLiteChronicle();
  await chronicle.init();

  const sessions = new Map();
  let flushed = 0;
  for (const event of events) {
    const sid = sessionKey(event);
    if (!sessions.has(sid)) sessions.set(sid, createSessionState());
    const state = sessions.get(sid);
    const payload = preparePayload(event, state);
    const entry = chronicle.append(event.action, payload, identity, {
      timestamp: event.timestamp,
    });
    updateSessionState(state, { action: event.action, payload }, entry.id);
    flushed++;
  }

  chronicle.rebuildSessions();
  chronicle.close();

  if (clear) {
    spoolClear();
  }

  return { flushed, remaining: clear ? 0 : spoolRead().length };
}

export function spoolClear() {
  if (existsSync(SPOOL_PATH)) {
    const backup = `${SPOOL_PATH}.${Date.now()}.bak`;
    renameSync(SPOOL_PATH, backup);
  }
}

export function spoolStats() {
  const events = spoolRead();
  const sessions = new Set(events.map((e) => e.sessionId).filter(Boolean));
  return {
    pending: events.length,
    sessions: sessions.size,
    path: SPOOL_PATH,
    oldest: events[0]?.timestamp || null,
    newest: events[events.length - 1]?.timestamp || null,
  };
}

export { Actions };
