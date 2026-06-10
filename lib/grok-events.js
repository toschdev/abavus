/**
 * Map Grok / Cursor hook events to Abavus chronicle actions.
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
    beforesubmitprompt: 'user_prompt_submit',
    stop: 'stop',
    subagent_start: 'subagent_start',
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
      return [{
        action: Actions.SESSION_START,
        payload: {
          ...base,
          cwd: event.cwd || workspace,
        },
        sessionId,
        timestamp,
      }];

    case 'session_end':
    case 'stop':
      return [{
        action: Actions.SESSION_END,
        payload: {
          ...base,
          reason: event.reason || event.stopReason || null,
        },
        sessionId,
        timestamp,
      }];

    case 'user_prompt_submit':
      return [{
        action: 'message.in',
        payload: {
          ...base,
          content: event.prompt || event.message || event.content || '',
          channel: 'user',
        },
        sessionId,
        timestamp,
      }];

    case 'post_tool_use': {
      const tool = normalizeToolName(event);
      const input = event.toolInput || event.tool_input || event.input || {};
      const output = event.toolOutput || event.tool_output || event.output || null;

      let action = Actions.TOOL_CALL;
      if (FILE_READ_TOOLS.has(tool)) action = Actions.FILE_READ;
      else if (FILE_WRITE_TOOLS.has(tool)) action = Actions.FILE_WRITE;
      else if (tool === 'web_search' || tool === 'web_fetch') action = Actions.WEB_SEARCH;

      const payload = {
        ...base,
        tool,
        arguments: input,
        result: output,
        success: event.success !== false,
      };

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

      return [{
        action,
        payload,
        sessionId,
        timestamp,
      }];
    }

    case 'subagent_start':
      return [{
        action: Actions.TOOL_CALL,
        payload: {
          ...base,
          tool: 'subagent',
          arguments: {
            type: event.subagentType || event.subagent_type || 'unknown',
            description: event.description || null,
          },
        },
        sessionId,
        timestamp,
      }];

    case 'subagent_stop':
      return [{
        action: Actions.TOOL_RESULT,
        payload: {
          ...base,
          tool: 'subagent',
          result: event.result || event.output || null,
          success: event.success !== false,
        },
        sessionId,
        timestamp,
      }];

    default:
      return [];
  }
}

export function shouldFlushSpool(event) {
  const eventName = normalizeEventName(event);
  return eventName === 'session_end' || eventName === 'stop';
}