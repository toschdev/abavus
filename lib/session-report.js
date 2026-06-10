/**
 * Build a structured session report from chronicle entries.
 */

import { Identity } from '../core/index.js';

function summarizePayload(entry) {
  const p = entry.payload || {};

  if (entry.action === 'tool.call' || entry.action === 'file.read' || entry.action === 'file.write') {
    const tool = p.tool || entry.action;
    if (p.path) return `${tool}: ${p.path}`;
    if (p.arguments?.command) {
      const cmd = p.arguments.command;
      return `bash: ${cmd.length > 80 ? cmd.slice(0, 80) + '…' : cmd}`;
    }
    if (p.arguments?.pattern) return `${tool}: ${p.arguments.pattern}`;
    return tool;
  }

  if (entry.action === 'llm.turn') {
    const text = p.output?.content || p.content || '';
    return text.slice(0, 120).replace(/\s+/g, ' ') + (text.length > 120 ? '…' : '');
  }

  if (entry.action === 'message.in') {
    const text = p.content || p.message || '';
    return text.slice(0, 120).replace(/\s+/g, ' ') + (text.length > 120 ? '…' : '');
  }

  if (p.content) {
    return String(p.content).slice(0, 120);
  }

  return entry.action;
}

function iconFor(entry) {
  switch (entry.action) {
    case 'tool.call': return '⚙️';
    case 'file.read': return '📖';
    case 'file.write': return '✏️';
    case 'llm.turn': return '🤖';
    case 'message.in': return '💬';
    case 'session.start': return '▶️';
    case 'session.end': return '⏹️';
    default: return '•';
  }
}

export function buildSessionReport(chronicle, sessionId, { identityName = 'default' } = {}) {
  const entries = chronicle.bySession(sessionId, 5000);
  if (entries.length === 0) return null;

  const counts = {
    tools: 0,
    reads: 0,
    writes: 0,
    turns: 0,
    messages: 0,
  };

  const tools = {};
  const filesTouched = new Set();
  const timeline = [];

  for (const entry of entries) {
    const summary = summarizePayload(entry);
    timeline.push({
      id: entry.id,
      timestamp: entry.timestamp,
      action: entry.action,
      icon: iconFor(entry),
      summary,
      tool: entry.payload?.tool || null,
      signed: Boolean(entry.signature),
    });

    switch (entry.action) {
      case 'tool.call':
        counts.tools++;
        if (entry.payload?.tool) {
          tools[entry.payload.tool] = (tools[entry.payload.tool] || 0) + 1;
        }
        break;
      case 'file.read':
        counts.reads++;
        if (entry.payload?.path) filesTouched.add(entry.payload.path);
        break;
      case 'file.write':
        counts.writes++;
        if (entry.payload?.path) filesTouched.add(entry.payload.path);
        break;
      case 'llm.turn':
        counts.turns++;
        break;
      case 'message.in':
        counts.messages++;
        break;
    }
  }

  let verification = { valid: null, entries: entries.length, errors: [] };
  if (Identity.exists(identityName)) {
    const identity = Identity.load(identityName);
    verification = chronicle.verifyChain(identity);
  }

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
    filesTouched: [...filesTouched],
    timeline,
    verification: {
      valid: verification.valid,
      chainEntries: verification.entries,
      errorCount: verification.errors?.length || 0,
    },
    source: entries.some((e) => e.payload?.source === 'grok') ? 'grok' : 'openclaw',
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

function formatDuration(ms) {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}