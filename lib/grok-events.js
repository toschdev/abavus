/**
 * Map Grok / Cursor hook events to Abavus chronicle actions.
 *
 * Every record payload carries an explicit `kind`:
 *   done       — tools, files, session lifecycle
 *   said       — assistant speech
 *   commanded  — a human (or system) instructed
 *   inferred   — thinking, conclusion, error, recovery
 *
 * A failed tool is still a deed (kind=done, success:false).
 * Speech is only recorded when the payload actually contains it.
 */

import { Actions } from '../chronicle/index.js';

const FILE_READ_TOOLS = new Set([
  'read_file', 'read', 'beforeReadFile',
]);

const FILE_WRITE_TOOLS = new Set([
  'search_replace', 'write', 'edit', 'multiedit',
  'afterFileEdit',
]);

const SHELL_TOOLS = new Set([
  'run_terminal_command', 'bash', 'shell',
  'beforeShellExecution', 'afterShellExecution',
]);

export const RESULT_CLIP_CHARS = 2000;

function normalizeEventName(event) {
  const raw = (
    event.hookEventName ||
    event.event ||
    process.env.GROK_HOOK_EVENT ||
    ''
  ).toLowerCase().replace(/-/g, '_');

  const aliases = {
    session_start: 'session_start',
    sessionstart: 'session_start',
    session_end: 'session_end',
    sessionend: 'session_end',
    post_tool_use: 'post_tool_use',
    posttooluse: 'post_tool_use',
    pretooluse: 'pre_tool_use',
    user_prompt_submit: 'user_prompt_submit',
    userpromptsubmit: 'user_prompt_submit',
    beforesubmitprompt: 'user_prompt_submit',
    stop: 'stop',
    subagent_start: 'subagent_start',
    subagentstart: 'subagent_start',
    subagentstop: 'subagent_stop',
    subagent_start_alias: 'subagent_start',
  };

  return aliases[raw] || raw;
}

function normalizeToolName(event) {
  return (
    event.toolName ||
    event.tool_name ||
    event.tool ||
    ''
  );
}

function sessionIdFrom(event) {
  return (
    event.sessionId ||
    event.session_id ||
    process.env.GROK_SESSION_ID ||
    null
  );
}

function workspaceFrom(event) {
  return (
    event.workspaceRoot ||
    event.cwd ||
    process.env.GROK_WORKSPACE_ROOT ||
    process.env.CLAUDE_PROJECT_DIR ||
    null
  );
}

function asText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if (typeof value.content === 'string') return value.content;
    if (typeof value.text === 'string') return value.text;
    if (typeof value.message === 'string') return value.message;
  }
  return '';
}

/**
 * Pull assistant speech from a Stop/SessionEnd payload.
 * Returns null when there is nothing to quote — never invent speech.
 */
function extractAssistantSpeech(event) {
  const nested = event.output && typeof event.output === 'object' ? event.output : null;
  const candidates = [
    event.lastAssistantMessage,
    event.last_assistant_message,
    event.completion,
    event.response,
    nested?.content,
    event.content,
    event.message,
    event.text,
    event.prompt,
  ];
  for (const candidate of candidates) {
    const text = asText(candidate).trim();
    if (text) return asText(candidate);
  }
  return null;
}

function extractThinking(event) {
  const nested = event.output && typeof event.output === 'object' ? event.output : null;
  const candidates = [
    event.thinking,
    event.thought,
    event.reasoning,
    nested?.thinking,
  ];
  for (const candidate of candidates) {
    const text = asText(candidate).trim();
    if (text) return asText(candidate);
  }
  return null;
}

/**
 * Clip huge tool results so the chronicle is not a dump of whole files.
 * Strings longer than RESULT_CLIP_CHARS (and objects whose JSON is) become
 * a clipped string plus resultBytes / resultClipped flags.
 */
export function clipResult(result) {
  if (result == null) return { result: null };

  const serialized = typeof result === 'string' ? result : JSON.stringify(result);
  const resultBytes = Buffer.byteLength(serialized, 'utf8');

  if (serialized.length <= RESULT_CLIP_CHARS) {
    return { result };
  }

  return {
    result: serialized.slice(0, RESULT_CLIP_CHARS),
    resultBytes,
    resultClipped: true,
  };
}

function record(action, payload, sessionId, timestamp) {
  return { action, payload, sessionId, timestamp };
}

/**
 * Convert a hook stdin payload into zero or more spool records.
 */
export function grokEventToRecords(event) {
  const eventName = normalizeEventName(event);
  const sessionId = sessionIdFrom(event);
  const workspace = workspaceFrom(event);
  const timestamp = event.timestamp || new Date().toISOString();
  const base = {
    sessionId,
    timestamp,
    workspace,
    hookEvent: eventName,
    toolUseId: event.toolUseId || event.tool_use_id || null,
  };

  switch (eventName) {
    case 'session_start':
      return [record(Actions.SESSION_START, {
        ...base,
        kind: 'done',
        cwd: event.cwd || workspace,
      }, sessionId, timestamp)];

    case 'session_end':
    case 'stop': {
      const records = [];
      const speech = extractAssistantSpeech(event);
      const thinking = extractThinking(event);

      if (speech) {
        records.push(record('message.out', {
          ...base,
          kind: 'said',
          content: speech,
          channel: 'assistant',
          ...(thinking ? { thinking } : {}),
        }, sessionId, timestamp));
      } else if (thinking) {
        records.push(record('llm.turn', {
          ...base,
          kind: 'inferred',
          thinking,
          output: { thinking },
        }, sessionId, timestamp));
      }

      records.push(record(Actions.SESSION_END, {
        ...base,
        kind: 'done',
        reason: event.reason || event.stopReason || null,
      }, sessionId, timestamp));

      return records;
    }

    case 'user_prompt_submit':
      return [record('message.in', {
        ...base,
        kind: 'commanded',
        content: event.prompt || event.message || event.content || '',
        channel: 'user',
      }, sessionId, timestamp)];

    case 'post_tool_use': {
      const tool = normalizeToolName(event);
      const input = event.toolInput || event.tool_input || event.input || {};
      const output = event.toolOutput || event.tool_output || event.output || null;

      let action = Actions.TOOL_CALL;
      if (FILE_READ_TOOLS.has(tool)) action = Actions.FILE_READ;
      else if (FILE_WRITE_TOOLS.has(tool)) action = Actions.FILE_WRITE;
      else if (tool === 'web_search' || tool === 'web_fetch') action = Actions.WEB_SEARCH;

      const clipped = clipResult(output);
      const payload = {
        ...base,
        kind: 'done',
        tool,
        arguments: input,
        result: clipped.result,
        success: event.success !== false,
      };
      if (clipped.resultClipped) {
        payload.resultClipped = true;
        payload.resultBytes = clipped.resultBytes;
      }

      if (SHELL_TOOLS.has(tool) && input.command) {
        payload.tool = 'bash';
        payload.arguments = { command: input.command };
      }

      if (FILE_READ_TOOLS.has(tool) && input.path) {
        payload.path = input.path;
      }

      if (FILE_WRITE_TOOLS.has(tool) && (input.path || input.file_path)) {
        payload.path = input.path || input.file_path;
      }

      return [record(action, payload, sessionId, timestamp)];
    }

    case 'subagent_start':
      return [record(Actions.TOOL_CALL, {
        ...base,
        kind: 'done',
        tool: 'subagent',
        arguments: {
          type: event.subagentType || event.subagent_type || 'unknown',
          description: event.description || null,
        },
      }, sessionId, timestamp)];

    case 'subagent_stop': {
      const clipped = clipResult(event.result || event.output || null);
      const payload = {
        ...base,
        kind: 'done',
        tool: 'subagent',
        result: clipped.result,
        success: event.success !== false,
      };
      if (clipped.resultClipped) {
        payload.resultClipped = true;
        payload.resultBytes = clipped.resultBytes;
      }
      return [record(Actions.TOOL_RESULT, payload, sessionId, timestamp)];
    }

    default:
      return [];
  }
}

export function shouldFlushSpool(event) {
  const eventName = normalizeEventName(event);
  return eventName === 'session_end' || eventName === 'stop';
}
