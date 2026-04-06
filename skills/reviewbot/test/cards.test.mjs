import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatQueueMsgText, formatProjectPath, toFeishuMarkdown, formatDeadline,
  buildFeishuReviewCard, buildFeishuFeedbackSelectedCard, buildFeishuCompletedCard,
  buildFeishuNotificationCard, buildFeishuSystemCard,
} from '../lib/feishu/cards.mjs';

describe('formatQueueMsgText', () => {
  it('returns content truncated to maxLen', () => {
    assert.equal(formatQueueMsgText({ content: 'Hello World' }, 5), 'Hello');
  });

  it('returns [消息] for empty message', () => {
    assert.equal(formatQueueMsgText({}), '[消息]');
    assert.equal(formatQueueMsgText({ content: '' }), '[消息]');
  });

  it('shows image count when no content', () => {
    const m = { content: '', attachments: [{ content_type: 'image' }, { content_type: 'image' }] };
    assert.equal(formatQueueMsgText(m), '[图片×2]');
  });

  it('shows file count when no content', () => {
    const m = { content: '', attachments: [{ content_type: 'file' }] };
    assert.equal(formatQueueMsgText(m), '[文件×1]');
  });

  it('shows mixed attachments when no content', () => {
    const m = { content: '', attachments: [{ content_type: 'image' }, { content_type: 'file' }] };
    assert.equal(formatQueueMsgText(m), '[图片×1] [文件×1]');
  });

  it('appends paperclip count when content + attachments', () => {
    const m = { content: 'text', attachments: [{ content_type: 'file' }, { content_type: 'file' }] };
    assert.equal(formatQueueMsgText(m), 'text 📎2');
  });
});

describe('formatProjectPath', () => {
  it('returns null for falsy input', () => {
    assert.equal(formatProjectPath(null), null);
    assert.equal(formatProjectPath(''), null);
  });

  it('keeps short paths', () => {
    assert.equal(formatProjectPath('/a/b'), '📁 …/a/b');
  });

  it('truncates long paths to last 3 segments', () => {
    assert.equal(formatProjectPath('/home/user/projects/myapp'), '📁 …/user/projects/myapp');
    assert.match(formatProjectPath('/a/b/c/d/e'), /…\/c\/d\/e$/);
  });

  it('normalizes backslashes', () => {
    assert.equal(formatProjectPath('C:\\Users\\code'), '📁 …/C:/Users/code');
  });
});

describe('toFeishuMarkdown', () => {
  it('converts \\n escape to real newline', () => {
    assert.equal(toFeishuMarkdown('a\\nb'), 'a\nb');
  });

  it('converts headings to bold', () => {
    assert.equal(toFeishuMarkdown('## Title'), '**Title**');
    assert.equal(toFeishuMarkdown('# H1'), '**H1**');
  });

  it('replaces table pipes with fullwidth pipes', () => {
    const result = toFeishuMarkdown('| a | b |');
    assert.ok(result.includes('｜'));
    assert.ok(!result.includes('|'));
  });

  it('removes table separator lines', () => {
    const result = toFeishuMarkdown('| --- | --- |');
    assert.equal(result.trim(), '');
  });

  it('collapses triple newlines', () => {
    assert.equal(toFeishuMarkdown('a\n\n\n\nb'), 'a\n\nb');
  });

  it('handles null/undefined gracefully', () => {
    assert.equal(toFeishuMarkdown(null), '');
    assert.equal(toFeishuMarkdown(undefined), '');
  });
});

describe('formatDeadline', () => {
  it('returns HH:MM format', () => {
    const result = formatDeadline(300, Date.now());
    assert.match(result, /^\d{2}:\d{2}$/);
  });

  it('uses current time when createdTs is null', () => {
    const r1 = formatDeadline(0, Date.now());
    const r2 = formatDeadline(0);
    assert.equal(r1, r2);
  });
});

describe('buildFeishuReviewCard', () => {
  it('returns a valid card structure', () => {
    const card = buildFeishuReviewCard('Test summary', 'test-agent', '[🔹test-agent]', 300, [], null, Date.now());
    assert.equal(card.header.template, 'blue');
    assert.ok(card.header.title.content.includes('test-agent'));
    assert.ok(card.elements.length >= 3);
  });

  it('includes project path when provided', () => {
    const card = buildFeishuReviewCard('Summary', 'a', '[a]', 60, [], '/home/user/proj');
    const pathEl = card.elements.find(e => e.content?.includes('…'));
    assert.ok(pathEl);
  });

  it('includes queued messages section', () => {
    const msgs = [{ ts: Date.now(), content: 'msg1' }];
    const card = buildFeishuReviewCard('Summary', 'a', '[a]', 60, msgs, null);
    const queueEl = card.elements.find(e => e.content?.includes('等待队列'));
    assert.ok(queueEl);
  });

  it('has approve and feedback buttons', () => {
    const card = buildFeishuReviewCard('S', 'x', '[x]', 60, [], null);
    const actionEl = card.elements.find(e => e.tag === 'action');
    assert.ok(actionEl);
    assert.equal(actionEl.actions.length, 2);
    assert.deepEqual(actionEl.actions[0].value, { action: 'approve', agent_id: 'x' });
    assert.deepEqual(actionEl.actions[1].value, { action: 'feedback', agent_id: 'x' });
  });
});

describe('buildFeishuFeedbackSelectedCard', () => {
  it('returns orange-themed card', () => {
    const card = buildFeishuFeedbackSelectedCard('Sum', 'a', '[a]', '14:30', null);
    assert.equal(card.header.template, 'orange');
    assert.ok(card.header.title.content.includes('Selected'));
  });

  it('includes deadline text when provided', () => {
    const card = buildFeishuFeedbackSelectedCard('S', 'a', '[a]', '14:30', null);
    const deadlineEl = card.elements.find(e => e.content?.includes('14:30'));
    assert.ok(deadlineEl);
  });

  it('omits deadline text when empty', () => {
    const card = buildFeishuFeedbackSelectedCard('S', 'a', '[a]', '', null);
    const deadlineEl = card.elements.find(e => e.content?.includes('截止'));
    assert.ok(!deadlineEl);
  });
});

describe('buildFeishuCompletedCard', () => {
  it('defaults to green Completed', () => {
    const card = buildFeishuCompletedCard('[a]', 'sum', 'feedback', []);
    assert.equal(card.header.template, 'green');
    assert.ok(card.header.title.content.includes('Completed'));
  });

  it('uses orange for timeout', () => {
    const card = buildFeishuCompletedCard('[a]', 's', 'f', [], { isAutoTimeout: true });
    assert.equal(card.header.template, 'orange');
    assert.ok(card.header.title.content.includes('Timeout'));
  });

  it('respects statusOverride', () => {
    const card = buildFeishuCompletedCard('[a]', 's', 'f', [], { statusOverride: '🔄 Custom' });
    assert.equal(card.header.template, 'blue');
    assert.ok(card.header.title.content.includes('Custom'));
  });

  it('includes queued messages in feedback', () => {
    const msgs = [{ ts: Date.now(), content: 'queued msg' }];
    const card = buildFeishuCompletedCard('[a]', 's', 'f', msgs);
    const feedEl = card.elements.find(e => e.content?.includes('等待队列'));
    assert.ok(feedEl);
  });
});

describe('buildFeishuNotificationCard', () => {
  it('returns turquoise notification card', () => {
    const card = buildFeishuNotificationCard('Hello', '[bot]', null);
    assert.equal(card.header.template, 'turquoise');
    assert.ok(card.header.title.content.includes('Notification'));
  });
});

describe('buildFeishuSystemCard', () => {
  it('uses default indigo template', () => {
    const card = buildFeishuSystemCard('Title', 'Content');
    assert.equal(card.header.template, 'indigo');
    assert.equal(card.elements.length, 1);
  });

  it('respects custom template', () => {
    const card = buildFeishuSystemCard('T', 'C', 'red');
    assert.equal(card.header.template, 'red');
  });
});
