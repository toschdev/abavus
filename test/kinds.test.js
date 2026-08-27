import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { kindOf, enrichEntries, summarizeEntry } from '../lib/kinds.js';

describe('kind mapping', () => {
  it('maps existing actions onto the four species', () => {
    assert.equal(kindOf({ action: 'tool.call', payload: {} }), 'done');
    assert.equal(kindOf({ action: 'file.read', payload: {} }), 'done');
    assert.equal(kindOf({ action: 'message.in', payload: {} }), 'commanded');
    assert.equal(kindOf({ action: 'message.out', payload: {} }), 'said');
    assert.equal(kindOf({ action: 'llm.turn', payload: { output: { content: 'hello' } } }), 'said');
    assert.equal(kindOf({ action: 'error', payload: {} }), 'inferred');
  });

  it('treats thinking-only llm.turn as inferred', () => {
    assert.equal(kindOf({
      action: 'llm.turn',
      payload: { output: { thinking: 'perhaps…' } },
    }), 'inferred');
  });

  it('lets payload.kind override the action map', () => {
    assert.equal(kindOf({ action: 'tool.call', payload: { kind: 'inferred' } }), 'inferred');
  });

  it('surfaces parent/cause instead of only prevHash', () => {
    const entries = [
      { id: 'a', action: 'message.in', payload: { content: 'Please look.' }, prevHash: null },
      { id: 'b', action: 'llm.turn', payload: { parentId: 'a', output: { content: 'I will.' } }, prevHash: 'hash-a' },
      { id: 'c', action: 'file.read', payload: { turnId: 'b', path: 'README.md', tool: 'read' }, prevHash: 'hash-b' },
    ];
    const enriched = enrichEntries(entries);
    assert.equal(enriched[1].cause.id, 'a');
    assert.equal(enriched[1].cause.relation, 'parent');
    assert.match(enriched[1].cause.summary, /Please look/);
    assert.equal(enriched[2].cause.id, 'b');
    assert.equal(enriched[2].cause.relation, 'turn');
    assert.equal(summarizeEntry(entries[2]), 'read: README.md');
  });
});
