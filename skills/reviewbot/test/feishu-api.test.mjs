import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  initFeishuApi, getClient,
  sendCard, sendCardToChat, sendText,
  patchCard, replyToMessage,
  urgentMessage, pushFollowUp,
  addReaction, getMessageResource,
} from '../lib/feishu/api.mjs';

function mockClient() {
  const calls = [];
  return {
    calls,
    im: {
      message: {
        create: async (opts) => { calls.push({ method: 'create', opts }); return { data: { message_id: 'msg_mock_123' } }; },
        patch: async (opts) => { calls.push({ method: 'patch', opts }); },
        reply: async (opts) => { calls.push({ method: 'reply', opts }); return { data: { message_id: 'reply_mock' } }; },
        urgentApp: async (opts) => { calls.push({ method: 'urgentApp', opts }); },
        pushFollowUp: async (opts) => { calls.push({ method: 'pushFollowUp', opts }); },
      },
      messageReaction: {
        create: async (opts) => { calls.push({ method: 'reactionCreate', opts }); },
      },
      messageResource: {
        get: async (opts) => { calls.push({ method: 'resourceGet', opts }); return { writeFile: async () => {} }; },
      },
    },
  };
}

function mockFailClient() {
  return {
    im: {
      message: {
        create: async () => { throw new Error('API error'); },
        patch: async () => { throw new Error('patch error'); },
        reply: async () => { throw new Error('reply error'); },
        urgentApp: async () => { throw new Error('urgent error'); },
        pushFollowUp: async () => { throw new Error('followup error'); },
      },
      messageReaction: {
        create: async () => { throw new Error('reaction error'); },
      },
      messageResource: {
        get: async () => { throw new Error('resource error'); },
      },
    },
  };
}

describe('feishu-api: no client initialized', () => {
  beforeEach(() => { initFeishuApi(null); });

  it('getClient returns null', () => {
    assert.equal(getClient(), null);
  });

  it('sendCard returns null without client', async () => {
    assert.equal(await sendCard('user1', { header: {}, elements: [] }), null);
  });

  it('sendCardToChat returns null without client', async () => {
    assert.equal(await sendCardToChat('chat1', {}), null);
  });

  it('sendText returns null without client', async () => {
    assert.equal(await sendText('user1', 'hello'), null);
  });

  it('patchCard returns without error when no client', async () => {
    await patchCard('msg1', { header: {}, elements: [] });
  });

  it('replyToMessage returns null without client', async () => {
    assert.equal(await replyToMessage('msg1', 'text'), null);
  });

  it('urgentMessage returns false without client', async () => {
    assert.equal(await urgentMessage('msg1', ['u1']), false);
  });

  it('addReaction returns false without client', async () => {
    assert.equal(await addReaction('msg1', 'THUMBSUP'), false);
  });

  it('getMessageResource returns null without client', async () => {
    assert.equal(await getMessageResource('msg1', 'fk1', 'image'), null);
  });
});

describe('feishu-api: with mock client', () => {
  let mc;
  beforeEach(() => { mc = mockClient(); initFeishuApi(mc); });

  it('sendCard calls create with open_id', async () => {
    const card = { header: { title: 'Test' }, elements: [] };
    const result = await sendCard('user_open_id', card);
    assert.equal(result.data.message_id, 'msg_mock_123');
    assert.equal(mc.calls.length, 1);
    assert.equal(mc.calls[0].method, 'create');
    assert.equal(mc.calls[0].opts.params.receive_id_type, 'open_id');
    assert.equal(mc.calls[0].opts.data.receive_id, 'user_open_id');
    assert.equal(mc.calls[0].opts.data.msg_type, 'interactive');
  });

  it('sendCardToChat calls create with chat_id', async () => {
    await sendCardToChat('chat_123', { header: {} });
    assert.equal(mc.calls[0].opts.params.receive_id_type, 'chat_id');
    assert.equal(mc.calls[0].opts.data.receive_id, 'chat_123');
  });

  it('sendText sends plain text by default', async () => {
    const result = await sendText('u1', 'hello world');
    assert.ok(result);
    assert.equal(mc.calls[0].opts.data.msg_type, 'text');
    const content = JSON.parse(mc.calls[0].opts.data.content);
    assert.equal(content.text, 'hello world');
  });

  it('sendText sends rich text (post) when flag set', async () => {
    await sendText('u1', 'line1\nline2', true);
    assert.equal(mc.calls[0].opts.data.msg_type, 'post');
    const content = JSON.parse(mc.calls[0].opts.data.content);
    assert.ok(content.zh_cn);
    assert.equal(content.zh_cn.content.length, 2);
  });

  it('patchCard calls message.patch', async () => {
    const card = { header: { title: 'Updated' }, elements: [{ tag: 'hr' }] };
    await patchCard('msg_abc', card);
    assert.equal(mc.calls[0].method, 'patch');
    assert.equal(mc.calls[0].opts.path.message_id, 'msg_abc');
  });

  it('patchCard skips when messageId is null', async () => {
    await patchCard(null, {});
    assert.equal(mc.calls.length, 0);
  });

  it('replyToMessage calls message.reply', async () => {
    const result = await replyToMessage('msg_orig', 'reply text');
    assert.ok(result);
    assert.equal(mc.calls[0].method, 'reply');
    assert.equal(mc.calls[0].opts.path.message_id, 'msg_orig');
  });

  it('urgentMessage calls urgentApp and returns true', async () => {
    const ok = await urgentMessage('msg_1', ['u1', 'u2']);
    assert.equal(ok, true);
    assert.equal(mc.calls[0].method, 'urgentApp');
    assert.deepEqual(mc.calls[0].opts.data.user_id_list, ['u1', 'u2']);
  });

  it('pushFollowUp sends follow-up bubbles', async () => {
    const followUps = [{ content: 'Done' }];
    await pushFollowUp('msg_x', followUps);
    assert.equal(mc.calls[0].method, 'pushFollowUp');
    assert.deepEqual(mc.calls[0].opts.data.follow_ups, followUps);
  });

  it('pushFollowUp is no-op when messageId is null', async () => {
    await pushFollowUp(null, []);
    assert.equal(mc.calls.length, 0);
  });

  it('addReaction calls messageReaction.create', async () => {
    const ok = await addReaction('msg_r', 'THUMBSUP');
    assert.equal(ok, true);
    assert.equal(mc.calls[0].method, 'reactionCreate');
    assert.equal(mc.calls[0].opts.data.reaction_type.emoji_type, 'THUMBSUP');
  });

  it('getMessageResource calls messageResource.get', async () => {
    const result = await getMessageResource('msg_res', 'fk_123', 'image');
    assert.ok(result);
    assert.equal(mc.calls[0].method, 'resourceGet');
    assert.equal(mc.calls[0].opts.path.message_id, 'msg_res');
    assert.equal(mc.calls[0].opts.path.file_key, 'fk_123');
  });
});

describe('feishu-api: error handling', () => {
  beforeEach(() => { initFeishuApi(mockFailClient()); });

  it('sendCard returns null on API error', async () => {
    assert.equal(await sendCard('u1', {}), null);
  });

  it('sendText returns null on error', async () => {
    assert.equal(await sendText('u1', 'test'), null);
  });

  it('replyToMessage returns null on error', async () => {
    assert.equal(await replyToMessage('m1', 'text'), null);
  });

  it('urgentMessage returns false on error', async () => {
    assert.equal(await urgentMessage('m1', ['u1']), false);
  });

  it('addReaction returns false on error', async () => {
    assert.equal(await addReaction('m1', 'THUMBSUP'), false);
  });

  it('getMessageResource returns null on error', async () => {
    assert.equal(await getMessageResource('m1', 'fk1', 'image'), null);
  });

  it('patchCard handles error gracefully', async () => {
    await patchCard('m1', { header: {}, elements: [] });
  });

  it('pushFollowUp handles error silently', async () => {
    await pushFollowUp('m1', []);
  });
});
