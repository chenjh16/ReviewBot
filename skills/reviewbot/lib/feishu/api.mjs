/**
 * Feishu (Lark) API wrappers — low-level SDK calls.
 * Requires a feishuClient instance (from @larksuiteoapi/node-sdk).
 */

let client = null;

export function initFeishuApi(feishuClient) {
  client = feishuClient;
}

export function getClient() {
  return client;
}

export async function sendCard(openId, card) {
  if (!client) return null;
  try {
    return await client.im.message.create({
      params: { receive_id_type: 'open_id' },
      data: {
        receive_id: openId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      },
    });
  } catch (err) {
    console.error(`[飞书] 发送卡片失败: ${err.message}`);
    return null;
  }
}

export async function sendCardToChat(chatId, card) {
  if (!client) return null;
  try {
    return await client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      },
    });
  } catch (err) {
    console.error(`[飞书] 发送卡片到会话失败: ${err.message}`);
    return null;
  }
}

export async function sendText(openId, text, richText = false) {
  if (!client) return null;
  try {
    let result;
    if (richText) {
      const post = {
        zh_cn: {
          title: '',
          content: text.split('\n').map(line => [{ tag: 'text', text: line }]),
        },
      };
      result = await client.im.message.create({
        params: { receive_id_type: 'open_id' },
        data: { receive_id: openId, msg_type: 'post', content: JSON.stringify(post) },
      });
    } else {
      result = await client.im.message.create({
        params: { receive_id_type: 'open_id' },
        data: { receive_id: openId, msg_type: 'text', content: JSON.stringify({ text }) },
      });
    }
    return result;
  } catch (err) {
    console.error(`[飞书] 发送文本失败: ${err.message}`);
    return null;
  }
}

export async function patchCard(messageId, card) {
  if (!client || !messageId) return;
  try {
    await client.im.message.patch({
      path: { message_id: messageId },
      data: { content: JSON.stringify({ config: { update_multi: true }, header: card.header, elements: card.elements }) },
    });
  } catch (err) {
    console.error(`[飞书] 更新卡片失败: ${err.message}`);
  }
}

export async function replyToMessage(messageId, text) {
  if (!client || !messageId) return null;
  try {
    return await client.im.message.reply({
      path: { message_id: messageId },
      data: { msg_type: 'text', content: JSON.stringify({ text }) },
    });
  } catch (err) {
    console.error(`[飞书] 回复消息失败: ${err.message}`);
    return null;
  }
}

export async function urgentMessage(messageId, userIds) {
  if (!client || !messageId) return false;
  try {
    await client.im.message.urgentApp({
      path: { message_id: messageId },
      data: { user_id_list: userIds, user_id_type: 'open_id' },
    });
    console.log(`🔔 [飞书] 消息加急成功: msg=${messageId}`);
    return true;
  } catch (err) {
    console.error(`[飞书] 消息加急失败: ${err.message}`);
    return false;
  }
}

export async function pushFollowUp(messageId, followUps) {
  if (!client || !messageId) return;
  try {
    await client.im.message.pushFollowUp({
      path: { message_id: messageId },
      data: { follow_ups: followUps },
    });
  } catch (err) {
    // Silently handle — follow-ups may not be supported in all environments
  }
}

export async function addReaction(messageId, emojiType) {
  if (!client || !messageId) return false;
  try {
    await client.im.messageReaction.create({
      path: { message_id: messageId },
      data: { reaction_type: { emoji_type: emojiType } },
    });
    return true;
  } catch (err) {
    if (!err.message?.includes('already')) {
      console.error(`[飞书] 添加 Reaction 失败: ${err.message}`);
    }
    return false;
  }
}

export async function getMessageResource(messageId, fileKey, type) {
  if (!client || !messageId) return null;
  try {
    return await client.im.messageResource.get({
      path: { message_id: messageId, file_key: fileKey },
      params: { type },
    });
  } catch (err) {
    console.error(`[飞书] 获取资源失败: ${err.message}`);
    return null;
  }
}
