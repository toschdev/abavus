/**
 * Siegel Chronicle Schema - Complete Logging
 * 
 * Defines the structure for full audit trail:
 * - Every LLM turn (prompt, response, thinking)
 * - Every tool call with results
 * - Context injections (system prompts, files)
 * - Session metadata
 */

/**
 * Action types for complete logging
 */
export const ActionTypes = {
  // === Session Lifecycle ===
  SESSION_START: 'session.start',
  SESSION_END: 'session.end',
  SESSION_CONFIG: 'session.config',
  
  // === LLM Interactions ===
  LLM_TURN: 'llm.turn',           // Complete turn: input → thinking → output
  LLM_STREAM_START: 'llm.stream.start',
  LLM_STREAM_END: 'llm.stream.end',
  
  // === Context ===
  CONTEXT_SYSTEM: 'context.system',     // System prompt
  CONTEXT_INJECT: 'context.inject',     // File/memory injection
  CONTEXT_TOOL_DEF: 'context.tools',    // Available tools
  
  // === Tool Usage ===
  TOOL_CALL: 'tool.call',
  TOOL_RESULT: 'tool.result',
  TOOL_ERROR: 'tool.error',
  
  // === External Communication ===
  MESSAGE_INBOUND: 'message.in',
  MESSAGE_OUTBOUND: 'message.out',
  
  // === File Operations ===
  FILE_READ: 'file.read',
  FILE_WRITE: 'file.write',
  FILE_EDIT: 'file.edit',
  FILE_DELETE: 'file.delete',
  
  // === Web ===
  WEB_FETCH: 'web.fetch',
  WEB_SEARCH: 'web.search',
  BROWSER_ACTION: 'browser.action',
  
  // === Agent Lifecycle ===
  SNAPSHOT_CREATE: 'snapshot.create',
  SNAPSHOT_RESTORE: 'snapshot.restore',
  FORK: 'fork',
  MERGE: 'merge',
  
  // === Reputation ===
  VOUCH_GIVE: 'vouch.give',
  VOUCH_RECEIVE: 'vouch.receive',
  
  // === Errors & Recovery ===
  ERROR: 'error',
  RECOVERY: 'recovery'
};

/**
 * Schema for LLM_TURN payload - the big one
 */
export const LLMTurnSchema = {
  // Model identification
  model: 'string',           // e.g. "anthropic/claude-sonnet-4-20250514"
  modelVersion: 'string?',   // Specific version if known
  
  // Input
  input: {
    system: 'string?',       // System prompt (may reference context.system entry)
    systemRef: 'string?',    // Reference to context.system entry ID (dedup)
    messages: [{
      role: 'string',        // user | assistant | system
      content: 'string',     
      // For assistant messages with tool use:
      toolCalls: [{
        id: 'string',
        name: 'string',
        arguments: 'object'
      }]
    }],
    tools: 'string?',        // Reference to context.tools entry (dedup)
    temperature: 'number?',
    maxTokens: 'number?'
  },
  
  // Output  
  output: {
    content: 'string',       // The response text
    thinking: 'string?',     // Reasoning/thinking block if available
    thinkingTokens: 'number?',
    toolCalls: [{
      id: 'string',
      name: 'string', 
      arguments: 'object'
    }],
    stopReason: 'string?',   // end_turn | tool_use | max_tokens | etc
    
    // Usage stats
    usage: {
      inputTokens: 'number',
      outputTokens: 'number',
      cacheReadTokens: 'number?',
      cacheWriteTokens: 'number?'
    }
  },
  
  // Timing
  timing: {
    startedAt: 'string',     // ISO timestamp
    firstTokenAt: 'string?', // Time to first token
    finishedAt: 'string',
    durationMs: 'number',
    tokensPerSecond: 'number?'
  },
  
  // Cost (if calculable)
  cost: {
    inputCost: 'number?',
    outputCost: 'number?',
    totalCost: 'number?',
    currency: 'string?'      // USD
  }
};

/**
 * Schema for TOOL_CALL payload
 */
export const ToolCallSchema = {
  turnId: 'string',          // Reference to parent LLM_TURN
  callId: 'string',          // Tool call ID
  tool: 'string',            // Tool name
  arguments: 'object',       // Full arguments
  
  // For tracking
  sequence: 'number?'        // Order in multi-tool calls
};

/**
 * Schema for TOOL_RESULT payload
 */
export const ToolResultSchema = {
  turnId: 'string',
  callId: 'string',
  tool: 'string',
  
  result: 'any',             // The actual result
  resultTruncated: 'boolean?', // If we had to truncate
  resultSize: 'number?',     // Original size in bytes
  
  success: 'boolean',
  error: 'string?',
  
  durationMs: 'number'
};

/**
 * Schema for CONTEXT_INJECT payload
 */
export const ContextInjectSchema = {
  type: 'string',            // file | memory | skill | user
  source: 'string',          // Path or identifier
  content: 'string',         // The injected content
  contentHash: 'string',     // SHA-256 for dedup
  size: 'number',
  
  // For dedup - if content matches previous inject, just reference it
  referencesEntry: 'string?' // Entry ID with same contentHash
};

/**
 * Schema for MESSAGE payloads
 */
export const MessageSchema = {
  channel: 'string',         // telegram | discord | signal | webchat | etc
  direction: 'string',       // in | out
  
  from: {
    id: 'string?',
    name: 'string?',
    isAgent: 'boolean'
  },
  to: {
    id: 'string?', 
    name: 'string?',
    isAgent: 'boolean'
  },
  
  content: 'string',
  contentType: 'string?',    // text | image | voice | etc
  replyTo: 'string?',        // Message ID being replied to
  
  // Media
  attachments: [{
    type: 'string',
    url: 'string?',
    hash: 'string?',
    size: 'number?'
  }]
};

/**
 * Schema for SESSION_START payload
 */
export const SessionStartSchema = {
  sessionId: 'string',
  sessionKey: 'string?',
  
  agent: {
    id: 'string',            // Siegel agent ID
    name: 'string',
    publicKey: 'string'      // Base64
  },
  
  runtime: {
    host: 'string',
    os: 'string',
    nodeVersion: 'string',
    openclawVersion: 'string?'
  },
  
  config: {
    model: 'string',
    defaultModel: 'string',
    channel: 'string',
    thinkingLevel: 'string?'
  },
  
  // Lineage
  parentSession: 'string?',  // If this is a sub-agent
  forkedFrom: 'string?'      // If this is a fork, snapshot ID
};

/**
 * Deduplication strategy for large content
 * 
 * To avoid storing the same system prompt 1000x:
 * 1. First occurrence: store full content with contentHash
 * 2. Subsequent: store only contentHash + reference to first entry
 * 
 * This should reduce storage by ~70% for repetitive context
 */
export const DeduplicationConfig = {
  enabled: true,
  minSize: 1024,             // Only dedup content > 1KB
  hashAlgorithm: 'sha256',
  
  // Content types to dedup
  dedup: [
    'context.system',
    'context.inject', 
    'context.tools'
  ]
};

/**
 * Compression settings for export/archive
 */
export const CompressionConfig = {
  algorithm: 'gzip',         // gzip | zstd | none
  level: 6,                  // 1-9
  
  // Estimated compression ratios
  estimates: {
    jsonl: 0.15,             // JSON compresses well
    withDedup: 0.10          // Even better with dedup
  }
};

export default {
  ActionTypes,
  LLMTurnSchema,
  ToolCallSchema,
  ToolResultSchema,
  ContextInjectSchema,
  MessageSchema,
  SessionStartSchema,
  DeduplicationConfig,
  CompressionConfig
};
