import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { grokEventToRecords, clipResult, RESULT_CLIP_CHARS } from '../lib/grok-events.js';
import { applyLineage, parentIdFor, updateSessionState, createSessionState } from '../lib/spool.js';

describe('grokEventToRecords kinds', () => {
  it('maps user prompt to commanded message.in', () => {
    const recs = grokEventToRecords({
      hookEventName: 'UserPromptSubmit',
      sessionId: 's1',
      prompt: 'Look at README',
    });
    assert.equal(recs.length, 1);
    assert.equal(recs[0].action, 'message.in');
    assert.equal(recs[0].payload.kind, 'commanded');
    assert.equal(recs[0].payload.content, 'Look at README');
    assert.equal(recs[0].payload.channel, 'user');
  });

  it('maps post tool use to done with tool/file action', () => {
    const recs = grokEventToRecords({
      hookEventName: 'PostToolUse',
      sessionId: 's1',
      toolName: 'read_file',
      toolInput: { path: '/tmp/a.txt' },
      toolOutput: 'hello',
    });
    assert.equal(recs.length, 1);
    assert.equal(recs[0].action, 'file.read');
    assert.equal(recs[0].payload.kind, 'done');
    assert.equal(recs[0].payload.path, '/tmp/a.txt');
    assert.equal(recs[0].payload.result, 'hello');
    assert.equal(recs[0].payload.success, true);
    assert.equal(recs[0].payload.resultClipped, undefined);
  });

  it('clips huge tool results', () => {
    const huge = 'x'.repeat(5000);
    const recs = grokEventToRecords({
      hookEventName: 'PostToolUse',
      sessionId: 's1',
      toolName: 'read_file',
      toolInput: { path: '/tmp/big.txt' },
      toolOutput: huge,
    });
    assert.equal(recs[0].payload.kind, 'done');
    assert.equal(recs[0].payload.resultClipped, true);
    assert.equal(recs[0].payload.result.length, RESULT_CLIP_CHARS);
    assert.ok(recs[0].payload.resultBytes > RESULT_CLIP_CHARS);
    assert.ok(!recs[0].payload.result.includes('x'.repeat(RESULT_CLIP_CHARS + 1)));
  });

  it('clips huge object results after JSON.stringify', () => {
    const recs = grokEventToRecords({
      hookEventName: 'PostToolUse',
      sessionId: 's1',
      toolName: 'web_search',
      toolInput: { query: 'abavus' },
      toolOutput: { data: 'y'.repeat(4000) },
    });
    assert.equal(recs[0].action, 'web.search');
    assert.equal(recs[0].payload.kind, 'done');
    assert.equal(recs[0].payload.resultClipped, true);
    assert.equal(typeof recs[0].payload.result, 'string');
    assert.ok(recs[0].payload.result.length <= RESULT_CLIP_CHARS);
  });

  it('keeps a failed tool as done, not inferred', () => {
    const recs = grokEventToRecords({
      hookEventName: 'PostToolUse',
      sessionId: 's1',
      toolName: 'bash',
      success: false,
      toolInput: { command: 'false' },
      toolOutput: 'exit 1',
    });
    assert.equal(recs[0].action, 'tool.call');
    assert.equal(recs[0].payload.kind, 'done');
    assert.equal(recs[0].payload.success, false);
    assert.equal(recs[0].payload.tool, 'bash');
  });

  it('maps session start and end to done', () => {
    const start = grokEventToRecords({
      hookEventName: 'SessionStart',
      sessionId: 's1',
      cwd: '/tmp',
    });
    assert.equal(start.length, 1);
    assert.equal(start[0].action, 'session.start');
    assert.equal(start[0].payload.kind, 'done');

    const end = grokEventToRecords({
      hookEventName: 'SessionEnd',
      sessionId: 's1',
    });
    assert.equal(end.length, 1);
    assert.equal(end[0].action, 'session.end');
    assert.equal(end[0].payload.kind, 'done');
  });

  it('Stop without speech emits only session.end, no fake said', () => {
    const recs = grokEventToRecords({
      hookEventName: 'Stop',
      sessionId: 's1',
      reason: 'user',
    });
    assert.equal(recs.length, 1);
    assert.equal(recs[0].action, 'session.end');
    assert.equal(recs[0].payload.kind, 'done');
    assert.ok(recs.every((r) => r.payload.kind !== 'said'));
  });

  it('Stop with lastAssistantMessage emits said then session.end', () => {
    const recs = grokEventToRecords({
      hookEventName: 'Stop',
      sessionId: 's1',
      lastAssistantMessage: 'Done looking.',
    });
    assert.equal(recs.length, 2);
    assert.equal(recs[0].action, 'message.out');
    assert.equal(recs[0].payload.kind, 'said');
    assert.equal(recs[0].payload.content, 'Done looking.');
    assert.equal(recs[1].action, 'session.end');
    assert.equal(recs[1].payload.kind, 'done');
  });

  it('Stop with thinking only is inferred, not said', () => {
    const recs = grokEventToRecords({
      hookEventName: 'Stop',
      sessionId: 's1',
      thinking: 'perhaps I should reread the file',
    });
    assert.equal(recs.length, 2);
    assert.equal(recs[0].payload.kind, 'inferred');
    assert.notEqual(recs[0].payload.kind, 'said');
    assert.equal(recs[1].action, 'session.end');
  });

  it('maps subagent start/stop to done', () => {
    const start = grokEventToRecords({
      hookEventName: 'subagent_start',
      sessionId: 's1',
      toolUseId: 't1',
      subagentType: 'explore',
    });
    assert.equal(start[0].action, 'tool.call');
    assert.equal(start[0].payload.kind, 'done');
    assert.equal(start[0].payload.tool, 'subagent');

    const stop = grokEventToRecords({
      hookEventName: 'subagent_stop',
      sessionId: 's1',
      toolUseId: 't1',
      result: 'ok',
    });
    assert.equal(stop[0].action, 'tool.result');
    assert.equal(stop[0].payload.kind, 'done');
  });
});

describe('clipResult', () => {
  it('leaves short values alone', () => {
    assert.deepEqual(clipResult('hi'), { result: 'hi' });
    assert.deepEqual(clipResult({ ok: true }), { result: { ok: true } });
    assert.deepEqual(clipResult(null), { result: null });
  });
});

describe('lineage linking', () => {
  function link(records) {
    let n = 0;
    return applyLineage(records, () => `id${++n}`);
  }

  it('tools parent to the preceding user prompt in that session', () => {
    const linked = link([
      { action: 'session.start', sessionId: 's1', payload: { kind: 'done', sessionId: 's1' } },
      { action: 'message.in', sessionId: 's1', payload: { kind: 'commanded', sessionId: 's1', content: 'go' } },
      { action: 'tool.call', sessionId: 's1', payload: { kind: 'done', sessionId: 's1', tool: 'bash' } },
      { action: 'file.read', sessionId: 's1', payload: { kind: 'done', sessionId: 's1', path: 'README.md' } },
    ]);
    assert.equal(linked[0].payload.parentId, undefined);
    assert.equal(linked[1].payload.parentId, 'id1');
    assert.equal(linked[2].payload.parentId, 'id2');
    assert.equal(linked[3].payload.parentId, 'id2');
  });

  it('session.end parents to session.start', () => {
    const linked = link([
      { action: 'session.start', sessionId: 's1', payload: { kind: 'done', sessionId: 's1' } },
      { action: 'message.in', sessionId: 's1', payload: { kind: 'commanded', sessionId: 's1' } },
      { action: 'session.end', sessionId: 's1', payload: { kind: 'done', sessionId: 's1' } },
    ]);
    assert.equal(linked[2].payload.parentId, 'id1');
  });

  it('two sessions do not cross-parent', () => {
    const linked = link([
      { action: 'session.start', sessionId: 'a', payload: { kind: 'done', sessionId: 'a' } },
      { action: 'message.in', sessionId: 'a', payload: { kind: 'commanded', sessionId: 'a' } },
      { action: 'session.start', sessionId: 'b', payload: { kind: 'done', sessionId: 'b' } },
      { action: 'message.in', sessionId: 'b', payload: { kind: 'commanded', sessionId: 'b' } },
      { action: 'tool.call', sessionId: 'b', payload: { kind: 'done', sessionId: 'b', tool: 'bash' } },
      { action: 'session.end', sessionId: 'a', payload: { kind: 'done', sessionId: 'a' } },
    ]);
    assert.equal(linked[0].id, 'id1');
    assert.equal(linked[1].payload.parentId, 'id1');
    assert.equal(linked[2].id, 'id3');
    assert.equal(linked[3].payload.parentId, 'id3');
    assert.equal(linked[4].payload.parentId, 'id4');
    assert.notEqual(linked[4].payload.parentId, 'id2');
    assert.equal(linked[5].payload.parentId, 'id1');
    assert.notEqual(linked[5].payload.parentId, 'id3');
  });

  it('said parents to the command', () => {
    const linked = link([
      { action: 'session.start', sessionId: 's1', payload: { kind: 'done', sessionId: 's1' } },
      { action: 'message.in', sessionId: 's1', payload: { kind: 'commanded', sessionId: 's1', content: 'hi' } },
      { action: 'tool.call', sessionId: 's1', payload: { kind: 'done', sessionId: 's1', tool: 'read' } },
      { action: 'message.out', sessionId: 's1', payload: { kind: 'said', sessionId: 's1', content: 'looked' } },
    ]);
    assert.equal(linked[3].payload.parentId, 'id2');
  });

  it('tool result with the same toolUseId parents to the prior call', () => {
    const linked = link([
      { action: 'session.start', sessionId: 's1', payload: { kind: 'done', sessionId: 's1' } },
      { action: 'message.in', sessionId: 's1', payload: { kind: 'commanded', sessionId: 's1' } },
      { action: 'tool.call', sessionId: 's1', payload: { kind: 'done', sessionId: 's1', tool: 'subagent', toolUseId: 't1' } },
      { action: 'tool.result', sessionId: 's1', payload: { kind: 'done', sessionId: 's1', tool: 'subagent', toolUseId: 't1' } },
    ]);
    assert.equal(linked[2].payload.parentId, 'id2');
    assert.equal(linked[3].payload.parentId, 'id3');
  });

  it('does not overwrite an existing parentId', () => {
    const linked = link([
      { action: 'session.start', sessionId: 's1', payload: { kind: 'done', sessionId: 's1' } },
      { action: 'message.in', sessionId: 's1', payload: { kind: 'commanded', sessionId: 's1' } },
      { action: 'tool.call', sessionId: 's1', payload: { kind: 'done', sessionId: 's1', parentId: 'already' } },
    ]);
    assert.equal(linked[2].payload.parentId, 'already');
  });

  it('parentIdFor and updateSessionState stay in sync with applyLineage', () => {
    const state = createSessionState();
    const start = { action: 'session.start', payload: { kind: 'done' } };
    assert.equal(parentIdFor(start, state), null);
    updateSessionState(state, start, 'S');
    const cmd = { action: 'message.in', payload: { kind: 'commanded' } };
    assert.equal(parentIdFor(cmd, state), 'S');
    updateSessionState(state, cmd, 'C');
    const tool = { action: 'file.read', payload: { kind: 'done' } };
    assert.equal(parentIdFor(tool, state), 'C');
  });
});
