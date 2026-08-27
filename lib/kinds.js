/**
 * Chronicle entry species.
 *
 * Four kinds of act, shown distinctly in the viewer:
 *   done       — the agent acted (tools, files, session lifecycle)
 *   said       — the agent spoke
 *   commanded  — a human (or system) instructed
 *   inferred   — a conclusion, thought, or recovery
 *
 * Explicit `payload.kind` (or `entry.kind`) wins when present.
 * Otherwise we map from existing action types. Unknown actions default to `done`.
 */

export const KINDS = {
  done: {
    id: 'done',
    verb: 'acted',
    label: 'Acted',
    icon: '•',
    hint: 'A deed: tool, file, session, or other work.',
  },
  said: {
    id: 'said',
    verb: 'said',
    label: 'Said',
    icon: '“',
    hint: 'Speech: a reply, message, or spoken turn.',
  },
  commanded: {
    id: 'commanded',
    verb: 'commanded',
    label: 'Commanded',
    icon: '›',
    hint: 'An instruction received: a prompt, config, or injected context.',
  },
  inferred: {
    id: 'inferred',
    verb: 'concluded',
    label: 'Concluded',
    icon: '∴',
    hint: 'A thought, conclusion, error, or recovery.',
  },
};

export const KIND_IDS = Object.keys(KINDS);

/** Action → kind. Keep this the single map; payload.kind overrides. */
export const ACTION_KIND = {
  'message.in': 'commanded',
  'message.receive': 'commanded',
  'session.config': 'commanded',
  'context.system': 'commanded',
  'context.inject': 'commanded',
  'context.tools': 'commanded',

  'llm.turn': 'said',
  'llm.stream.start': 'said',
  'llm.stream.end': 'said',
  'message.out': 'said',
  'message.send': 'said',

  'tool.call': 'done',
  'tool.result': 'done',
  'tool.error': 'done',
  'file.read': 'done',
  'file.write': 'done',
  'file.edit': 'done',
  'file.delete': 'done',
  'web.fetch': 'done',
  'web.search': 'done',
  'browser.action': 'done',
  'session.start': 'done',
  'session.end': 'done',
  'snapshot.create': 'done',
  'snapshot.restore': 'done',
  fork: 'done',
  merge: 'done',
  'vouch.give': 'done',
  'vouch.receive': 'done',
  vouch: 'done',

  error: 'inferred',
  recovery: 'inferred',
};

export function kindOf(entry) {
  const explicit = entry?.kind || entry?.payload?.kind;
  if (explicit && KINDS[explicit]) return explicit;

  const action = entry?.action;
  const payload = entry?.payload || {};

  if (action === 'llm.turn') {
    const thinking = payload.output?.thinking || payload.thinking || '';
    const content = payload.output?.content || payload.content || '';
    if (String(thinking).trim() && !String(content).trim()) return 'inferred';
  }

  return ACTION_KIND[action] || 'done';
}

export function kindMeta(kind) {
  return KINDS[kind] || KINDS.done;
}

function clip(text, n = 140) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n).trimEnd()}…` : s;
}

export function summarizeEntry(entry) {
  const p = entry.payload || {};
  const action = entry.action;

  if (
    action === 'tool.call' ||
    action === 'tool.result' ||
    action === 'file.read' ||
    action === 'file.write' ||
    action === 'file.edit'
  ) {
    const tool = p.tool || action;
    if (p.path) return `${tool}: ${p.path}`;
    if (p.arguments?.command) {
      const cmd = String(p.arguments.command);
      return `bash: ${cmd.length > 80 ? `${cmd.slice(0, 80)}…` : cmd}`;
    }
    if (p.arguments?.pattern) return `${tool}: ${p.arguments.pattern}`;
    if (p.arguments?.query) return `${tool}: ${p.arguments.query}`;
    if (p.query) return `${tool}: ${p.query}`;
    return tool;
  }

  if (action === 'llm.turn') {
    const text = p.output?.content || p.content || p.output?.thinking || p.thinking || '';
    return clip(text, 160) || 'a turn without text';
  }

  if (
    action === 'message.in' ||
    action === 'message.out' ||
    action === 'message.send' ||
    action === 'message.receive'
  ) {
    return clip(p.content || p.message, 160) || action;
  }

  if (action === 'session.start') {
    return p.agent?.name ? `session began (${p.agent.name})` : 'session began';
  }
  if (action === 'session.end') {
    return p.reason ? `session ended — ${p.reason}` : 'session ended';
  }
  if (action === 'error') return clip(p.error || p.message || 'error', 160);
  if (action === 'recovery') return clip(p.message || 'recovered', 160);

  if (p.content) return clip(p.content, 160);
  if (p.path) return p.path;
  if (p.tool) return p.tool;
  return action;
}

export function detailFields(entry) {
  const p = entry.payload || {};
  const fields = [];
  const add = (label, value) => {
    if (value == null || value === '') return;
    if (typeof value === 'object') return;
    fields.push({ label, value: String(value) });
  };

  add('Path', p.path);
  add('Tool', p.tool);
  add('Command', p.arguments?.command);
  add('Query', p.arguments?.query || p.query);
  add('Pattern', p.arguments?.pattern);
  add('Channel', p.channel);
  add('Model', p.model);
  add('Stop', p.output?.stopReason);
  if (p.success === false) add('Success', 'no');
  add('Error', p.error);
  add('Reason', p.reason);
  add('From', typeof p.from === 'string' ? p.from : p.from?.name);

  const duration = p.durationMs ?? p.timing?.durationMs;
  if (duration != null) add('Duration', `${duration} ms`);

  const thinking = p.output?.thinking || p.thinking;
  const spoke = p.output?.content || (entry.action?.startsWith('message.') && entry.action !== 'message.in' ? (p.content || p.message) : null);
  const commanded = entry.action === 'message.in' || entry.action === 'message.receive'
    ? (p.content || p.message)
    : null;
  const result = typeof p.result === 'string' ? p.result : null;

  if (commanded) fields.push({ label: 'Instruction', value: String(commanded) });
  if (thinking) fields.push({ label: 'Thinking', value: String(thinking) });
  if (spoke) fields.push({ label: 'Spoke', value: String(spoke) });
  if (result) fields.push({ label: 'Result', value: String(result) });

  const usage = p.usage || p.output?.usage;
  if (usage && (usage.totalTokens || usage.inputTokens || usage.outputTokens)) {
    const parts = [];
    if (usage.inputTokens) parts.push(`${usage.inputTokens} in`);
    if (usage.outputTokens) parts.push(`${usage.outputTokens} out`);
    if (usage.totalTokens) parts.push(`${usage.totalTokens} total`);
    add('Tokens', parts.join(' · '));
  }

  return fields;
}

export function buildCatalog(entries) {
  const byId = Object.create(null);
  const byTurnId = Object.create(null);
  const bySession = Object.create(null);

  for (const e of entries) {
    byId[e.id] = e;
    const turnId = e.payload?.turnId;
    if (e.action === 'llm.turn') {
      byTurnId[e.id] = e;
      if (turnId && !byTurnId[turnId]) byTurnId[turnId] = e;
    }
    const sid = e.payload?.sessionId || e.payload?._sourceSession;
    if (sid && e.action === 'session.start') bySession[sid] = e;
  }

  return { byId, byTurnId, bySession };
}

export function findCause(entry, catalog) {
  if (!catalog) return null;
  const p = entry.payload || {};
  const { byId, byTurnId, bySession } = catalog;

  const parentId =
    p.parentId ||
    (typeof p.parent === 'string' ? p.parent : null) ||
    p.causeId ||
    (typeof p.cause === 'string' ? p.cause : null) ||
    p.replyTo ||
    null;

  let target = null;
  let relation = null;

  if (parentId && byId[parentId]) {
    target = byId[parentId];
    if (p.replyTo && parentId === p.replyTo) relation = 'reply';
    else if (p.causeId || typeof p.cause === 'string') relation = 'cause';
    else relation = 'parent';
  } else if (p.turnId && byTurnId[p.turnId] && byTurnId[p.turnId].id !== entry.id) {
    target = byTurnId[p.turnId];
    relation = 'turn';
  } else if (p.parentSession) {
    return {
      id: bySession?.[p.parentSession]?.id || null,
      sessionId: p.parentSession,
      action: 'session',
      kind: 'done',
      summary: `parent session ${String(p.parentSession).slice(0, 18)}`,
      relation: 'session',
    };
  } else if (p.forkedFrom) {
    return {
      id: p.forkedFrom,
      action: 'fork',
      kind: 'done',
      summary: `forked from ${p.forkedFrom}`,
      relation: 'session',
    };
  }

  if (!target) return null;

  return {
    id: target.id,
    action: target.action,
    kind: kindOf(target),
    summary: summarizeEntry(target),
    relation,
    sessionId: target.payload?.sessionId || target.payload?._sourceSession || null,
  };
}

export function enrichEntry(entry, catalog) {
  const kind = kindOf(entry);
  const meta = kindMeta(kind);
  const summary = summarizeEntry(entry);
  const cause = catalog ? findCause(entry, catalog) : null;
  const sessionId = entry.payload?.sessionId || entry.payload?._sourceSession || null;

  return {
    id: entry.id,
    timestamp: entry.timestamp,
    action: entry.action,
    kind,
    kindLabel: meta.label,
    kindVerb: meta.verb,
    summary,
    title: summary,
    icon: meta.icon,
    cause,
    fields: detailFields(entry),
    signed: Boolean(entry.signature),
    prevHash: entry.prevHash || null,
    entryHash: entry.entryHash || null,
    sessionId,
    tool: entry.payload?.tool || null,
    model: entry.payload?.model || null,
    payload: entry.payload || {},
  };
}

export function enrichEntries(entries) {
  const catalog = buildCatalog(entries);
  return entries.map((e) => enrichEntry(e, catalog));
}

export default {
  KINDS,
  KIND_IDS,
  ACTION_KIND,
  kindOf,
  kindMeta,
  summarizeEntry,
  detailFields,
  findCause,
  buildCatalog,
  enrichEntry,
  enrichEntries,
};
