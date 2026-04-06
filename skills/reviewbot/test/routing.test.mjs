import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseAgentRoute, createSymbolAssigner, SYMBOL_POOL } from '../lib/core/routing.mjs';

describe('parseAgentRoute', () => {
  it('parses #agent_id followed by message', () => {
    const result = parseAgentRoute('#my-project 任务完成');
    assert.equal(result.agentId, 'my-project');
    assert.equal(result.message, '任务完成');
  });

  it('handles agent id with dots', () => {
    const result = parseAgentRoute('#my-project.2 feedback here');
    assert.equal(result.agentId, 'my-project.2');
    assert.equal(result.message, 'feedback here');
  });

  it('handles agent id with colons and @', () => {
    const result = parseAgentRoute('#user@host:path continue');
    assert.equal(result.agentId, 'user@host:path');
    assert.equal(result.message, 'continue');
  });

  it('returns null agentId for plain text', () => {
    const result = parseAgentRoute('just some feedback');
    assert.equal(result.agentId, null);
    assert.equal(result.message, 'just some feedback');
  });

  it('handles empty message after agent id', () => {
    const result = parseAgentRoute('#agent ');
    assert.equal(result.agentId, 'agent');
    assert.equal(result.message, '');
  });

  it('handles multiline message', () => {
    const result = parseAgentRoute('#bot first line\nsecond line');
    assert.equal(result.agentId, 'bot');
    assert.equal(result.message, 'first line\nsecond line');
  });

  it('trims whitespace from result message', () => {
    const result = parseAgentRoute('  hello world  ');
    assert.equal(result.message, 'hello world');
  });
});

describe('createSymbolAssigner', () => {
  it('assigns unique symbols to different agents', () => {
    const assigner = createSymbolAssigner();
    const s1 = assigner.assign('agent-a');
    const s2 = assigner.assign('agent-b');
    assert.notEqual(s1, s2);
  });

  it('returns same symbol for same agent', () => {
    const assigner = createSymbolAssigner();
    const s1 = assigner.assign('agent-x');
    const s2 = assigner.assign('agent-x');
    assert.equal(s1, s2);
  });

  it('wraps around symbol pool', () => {
    const assigner = createSymbolAssigner();
    const symbols = [];
    for (let i = 0; i < SYMBOL_POOL.length + 3; i++) {
      symbols.push(assigner.assign(`agent-${i}`));
    }
    assert.equal(symbols[0], symbols[SYMBOL_POOL.length]);
  });

  it('get returns undefined for unknown agent', () => {
    const assigner = createSymbolAssigner();
    assert.equal(assigner.get('unknown'), undefined);
  });

  it('restore loads saved state', () => {
    const assigner = createSymbolAssigner();
    assigner.restore({ 'saved-agent': '🔖' }, 5);
    assert.equal(assigner.get('saved-agent'), '🔖');
    assert.equal(assigner.getNextIdx(), 5);
  });

  it('getMap returns the internal map', () => {
    const assigner = createSymbolAssigner();
    assigner.assign('test');
    const map = assigner.getMap();
    assert.ok(map instanceof Map);
    assert.ok(map.has('test'));
  });
});

describe('SYMBOL_POOL', () => {
  it('has 20 symbols', () => {
    assert.equal(SYMBOL_POOL.length, 20);
  });

  it('contains only strings', () => {
    assert.ok(SYMBOL_POOL.every(s => typeof s === 'string'));
  });
});
