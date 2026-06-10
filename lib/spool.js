/**
 * Fast append-only spool for Grok hook events.
 * Avoids loading the full SQLite DB on every PostToolUse.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Identity } from '../core/index.js';
import { SQLiteChronicle } from '../chronicle/sqlite.js';
import { Actions } from '../chronicle/index.js';

const SPOOL_DIR = join(homedir(), '.abavus', 'spool');
const SPOOL_PATH = join(SPOOL_DIR, 'grok.jsonl');

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

  let flushed = 0;
  for (const event of events) {
    chronicle.append(event.action, event.payload, identity);
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