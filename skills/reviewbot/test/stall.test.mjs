import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateStallMessage } from '../lib/util/stall.mjs';

describe('generateStallMessage', () => {
  it('returns a non-empty string', () => {
    const msg = generateStallMessage(0);
    assert.ok(typeof msg === 'string');
    assert.ok(msg.length > 0);
  });

  it('produces different messages for different attempts', () => {
    const msgs = new Set();
    for (let i = 0; i < 7; i++) msgs.add(generateStallMessage(i));
    assert.ok(msgs.size > 1, 'Should produce varied messages');
  });

  it('message has three-part structure', () => {
    const msg = generateStallMessage(0);
    const parts = msg.split('，');
    assert.ok(parts.length >= 2, 'Should have comma-separated parts');
    assert.ok(msg.includes('。'), 'Should have a period');
  });
});
