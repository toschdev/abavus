/**
 * Build a structured session (or day) report from chronicle entries.
 */

import { Identity } from '../core/index.js';
import { enrichEntries, KINDS } from './kinds.js';

export { KINDS };

function formatDuration(ms) {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function countKinds(timeline) {
  const counts = { done: 0, said: 0, commanded: 0, inferred: 0, tools: 0, reads: 0, writes: 0, turns: 0, messages: 0 };
  const tools = {};
  const filesTouched = new Set();

  for (const item of timeline) {
    if (counts[item.kind] != null) counts[item.kind]++;
    switch (item.action) {
      case 'tool.call':
        counts.tools++;
        if (item.tool) tools[item.tool] = (tools[item.tool] || 0) + 1;
        break;
      case 'file.read':
        counts.reads++;
        if (item.payload?.path) filesTouched.add(item.payload.path);
        break;
      case 'file.write':
      case 'file.edit':
        counts.writes++;
        if (item.payload?.path) filesTouched.add(item.payload.path);
        break;
      case 'llm.turn':
        counts.turns++;
        break;
      case 'message.in':
        counts.messages++;
        break;
    }
  }

  return { counts, tools, filesTouched: [...filesTouched] };
}

function attachVerification(chronicle, identityName = 'default') {
  let verification = { valid: null, entries: 0, errors: [], brokeAt: null };
  if (Identity.exists(identityName)) {
    const identity = Identity.load(identityName);
    verification = chronicle.verifyChain(identity);
  }
  return {
    valid: verification.valid,
    chainEntries: verification.entries,
    errorCount: verification.errors?.length || 0,
    errors: (verification.errors || []).slice(0, 8),
    brokeAt: verification.brokeAt || null,
  };
}

export function buildSessionReport(chronicle, sessionId, { identityName = 'default' } = {}) {
  const entries = chronicle.bySession(sessionId, 5000);
  if (entries.length === 0) return null;

  const timeline = enrichEntries(entries);
  const { counts, tools, filesTouched } = countKinds(timeline);

  const meta = chronicle.getSessionRow?.(sessionId) || null;
  const started = meta?.started_at || entries[0]?.timestamp;
  const ended = meta?.ended_at || entries[entries.length - 1]?.timestamp;
  const durationMs = started && ended ? new Date(ended) - new Date(started) : null;

  return {
    sessionId,
    meta,
    started,
    ended,
    durationMs,
    durationHuman: durationMs != null ? formatDuration(durationMs) : null,
    entryCount: entries.length,
    counts,
    tools: Object.entries(tools).sort((a, b) => b[1] - a[1]),
    filesTouched,
    timeline,
    verification: attachVerification(chronicle, identityName),
    source: entries.some((e) => e.payload?.source === 'grok') ? 'grok' : 'openclaw',
  };
}

export function buildDayReport(chronicle, day, { identityName = 'default' } = {}) {
  const from = `${day}T00:00:00.000Z`;
  const to = `${day}T23:59:59.999Z`;
  const entries = chronicle.byTimeRange(from, to, 5000);
  const timeline = enrichEntries(entries);
  const { counts, tools, filesTouched } = countKinds(timeline);

  const sessions = [];
  const seen = new Set();
  for (const item of timeline) {
    if (!item.sessionId || seen.has(item.sessionId)) continue;
    seen.add(item.sessionId);
    sessions.push(item.sessionId);
  }

  return {
    day,
    started: entries[0]?.timestamp || `${day}T00:00:00.000Z`,
    ended: entries[entries.length - 1]?.timestamp || `${day}T23:59:59.999Z`,
    entryCount: entries.length,
    sessions,
    counts,
    tools: Object.entries(tools).sort((a, b) => b[1] - a[1]),
    filesTouched,
    timeline,
    verification: attachVerification(chronicle, identityName),
  };
}

export function resolveSessionQuery(chronicle, query) {
  if (!query) return { error: 'missing_id' };

  const exact = chronicle.bySession(query, 1);
  if (exact.length > 0) return { sessionId: query };

  const matches = chronicle.findSessions(query, 10);
  if (matches.length === 1) return { sessionId: matches[0].session_id };
  if (matches.length > 1) return { ambiguous: matches };
  return { error: 'not_found', query };
}

