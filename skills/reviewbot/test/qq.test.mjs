import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildArkPayload, buildReviewKeyboard, buildReviewText, REVIEW_DECORATIONS } from '../lib/qq/builders.mjs';

describe('buildArkPayload', () => {
  it('returns valid ARK template structure', () => {
    const ark = buildArkPayload('My Title', ['line1', 'line2']);
    assert.equal(ark.template_id, 23);
    assert.equal(ark.kv.length, 3);
    assert.equal(ark.kv[0].value, 'My Title');
    assert.equal(ark.kv[2].obj.length, 2);
    assert.equal(ark.kv[2].obj[0].obj_kv[0].value, 'line1');
  });
});

describe('buildReviewKeyboard', () => {
  it('returns keyboard with approve and revise buttons', () => {
    const kb = buildReviewKeyboard('my-agent', '🔹');
    const buttons = kb.content.rows[0].buttons;
    assert.equal(buttons.length, 2);
    assert.ok(buttons[0].id.includes('approve'));
    assert.ok(buttons[1].id.includes('revise'));
  });

  it('includes agent id in button data', () => {
    const kb = buildReviewKeyboard('test-proj', '🔹');
    const approveBtn = kb.content.rows[0].buttons[0];
    assert.ok(approveBtn.action.data.includes('test-proj'));
    assert.ok(approveBtn.action.data.includes('任务完成'));
  });

  it('approve button enters, revise does not', () => {
    const kb = buildReviewKeyboard('x', '🔹');
    const [approve, revise] = kb.content.rows[0].buttons;
    assert.equal(approve.action.enter, true);
    assert.equal(revise.action.enter, false);
  });
});

describe('buildReviewText', () => {
  it('includes agent label when provided', () => {
    const text = buildReviewText('Test summary', 300, '[🔹my-agent]');
    assert.ok(text.includes('[🔹my-agent]'));
    assert.ok(text.includes('Review Request'));
    assert.ok(text.includes('Test summary'));
  });

  it('uses random decoration when no label', () => {
    const text = buildReviewText('Summary', 60);
    assert.ok(text.includes('Review Request'));
    const hasDeco = REVIEW_DECORATIONS.some(d => text.includes(d));
    assert.ok(hasDeco, 'Should include a decoration emoji');
  });

  it('includes deadline', () => {
    const text = buildReviewText('S', 300);
    assert.match(text, /截止 \d{2}:\d{2}/);
  });
});

describe('REVIEW_DECORATIONS', () => {
  it('is a non-empty array', () => {
    assert.ok(Array.isArray(REVIEW_DECORATIONS));
    assert.ok(REVIEW_DECORATIONS.length > 0);
  });
});
