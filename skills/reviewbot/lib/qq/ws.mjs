/**
 * QQ Bot WebSocket connection, heartbeat, event handling,
 * and review reply/passive sending.
 */
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';
import { parseAgentRoute } from '../core/routing.mjs';
import { formatQueueMsgText, formatDeadline } from '../feishu/cards.mjs';
import { buildReviewText, buildReviewKeyboard, buildArkPayload, REVIEW_DECORATIONS } from './builders.mjs';
import {
  getToken, apiCall,
  replyToGroupMessage, replyToC2CMessage,
  sendArkC2CMessage, sendArkGroupMessage,
  getGatewayUrl,
} from './api.mjs';
import { renderAndSendImage } from '../util/media.mjs';

// Needed at module level for token reference in identify
let accessToken = null;

/**
 * Connect QQ Bot WebSocket.
 * @param {object} s - shared state
 */
export function connectWs(s) {
  return new Promise(async (resolve, reject) => {
    try {
      const url = await getGatewayUrl();
      console.log(`🔌 连接 QQ Bot WebSocket: ${url}`);
      s.ws = new WebSocket(url);

      s.ws.on('open', () => console.log('→ WebSocket 已连接'));

      s.ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          handleWsMessage(s, msg, resolve);
        } catch (err) {
          console.error('WS 消息解析错误:', err.message);
        }
      });

      s.ws.on('close', (code) => {
        console.log(`⚠ WS 关闭: code=${code}`);
        s.connected = false;
        stopHeartbeat(s);
        if (!s.reconnecting) scheduleReconnect(s);
      });

      s.ws.on('error', (err) => {
        console.error(`WS 错误: ${err.message}`);
        if (!s.connected) reject(err);
      });

      setTimeout(() => { if (!s.connected) reject(new Error('WS 连接超时')); }, 30000);
    } catch (err) {
      reject(err);
    }
  });
}

function handleWsMessage(s, msg, onReady) {
  const { op, d, t } = msg;
  if (msg.s) s.wsSeqNo = msg.s;

  switch (op) {
    case 10:
      console.log(`→ Hello: heartbeat_interval=${d.heartbeat_interval}ms`);
      startHeartbeat(s, d.heartbeat_interval);
      sendIdentify(s);
      break;
    case 0:
      if (t === 'READY') {
        s.wsSessionId = d.session_id;
        s.connected = true;
        console.log(`✓ Ready: session_id=${s.wsSessionId}, user=${d.user?.username}`);
        onReady?.();
      } else if (t === 'RESUMED') {
        s.connected = true;
        console.log('✓ Resumed');
      } else {
        s._handleEvent?.(t, d);
      }
      break;
    case 11: break;
    case 7:
      console.log('⚠ 服务端要求重连');
      s.ws?.close();
      break;
    case 9:
      console.log('⚠ Session 无效, 重新鉴权');
      s.wsSessionId = null;
      setTimeout(() => sendIdentify(s), 2000);
      break;
  }
}

async function sendIdentify(s) {
  const tokenResult = await getToken();
  accessToken = tokenResult;
  if (!s.ws || s.ws.readyState !== 1) {
    console.log('⚠ WebSocket 未就绪，延迟发送 identify');
    await new Promise(r => { if (s.ws) s.ws.once('open', r); else setTimeout(r, 2000); });
  }
  const payload = {
    op: 2,
    d: { token: `QQBot ${accessToken}`, intents: (1 << 25), shard: [0, 1] },
  };
  if (s.wsSessionId) {
    s.ws.send(JSON.stringify({ op: 6, d: { token: `QQBot ${accessToken}`, session_id: s.wsSessionId, seq: s.wsSeqNo } }));
  } else {
    s.ws.send(JSON.stringify(payload));
  }
}

function startHeartbeat(s, intervalMs) {
  stopHeartbeat(s);
  s.heartbeatTimer = setInterval(() => {
    if (s.ws?.readyState === WebSocket.OPEN) {
      s.ws.send(JSON.stringify({ op: 1, d: s.wsSeqNo }));
    }
  }, intervalMs);
}

export function stopHeartbeat(s) {
  if (s.heartbeatTimer) { clearInterval(s.heartbeatTimer); s.heartbeatTimer = null; }
}

function scheduleReconnect(s) {
  s.reconnecting = true;
  const delay = 5000;
  console.log(`↻ ${delay / 1000}s 后重连...`);
  setTimeout(async () => {
    s.reconnecting = false;
    try { await connectWs(s); } catch (err) { console.error('重连失败:', err.message); scheduleReconnect(s); }
  }, delay);
}

// --- Event Handling ---

function extractVoiceText(attachments) {
  if (!attachments?.length) return null;
  const voice = attachments.find(a => a.content_type === 'voice');
  if (!voice) return null;
  const text = voice.asr_refer_text?.trim();
  if (text) console.log(`   🎤 语音识别: "${text.substring(0, 60)}"`);
  return text || null;
}

/**
 * Register the QQ event handler on shared state.
 * @param {object} s - shared state
 * @param {object} deps - { handleBotCommand, receiveFeedback, sendAckToUser }
 */
export function registerQQEventHandler(s, deps) {
  const { handleBotCommand, receiveFeedback, sendAckToUser } = deps;

  s._handleEvent = (type, data) => {
    console.log(`📩 Event: ${type}`, JSON.stringify(data).substring(0, 300));

    let entry = null;

    if (type === 'GROUP_AT_MESSAGE_CREATE' || type === 'GROUP_MSG_RECEIVE') {
      const attachments = data.attachments || [];
      const voiceText = extractVoiceText(attachments);
      const textContent = data.content?.trim() || voiceText || '';
      const nonVoiceAttach = attachments.filter(a => a.content_type !== 'voice');
      const attachSummary = nonVoiceAttach.map(a => `[${a.content_type || 'file'}:${a.filename}]`).join(' ');
      entry = {
        source: 'group',
        targetId: data.group_openid || data.group_id,
        msgId: data.id,
        content: textContent + (attachSummary ? `\n附件: ${attachSummary}` : ''),
        authorId: data.author?.member_openid || data.author?.id || '',
        attachments: nonVoiceAttach,
        ts: Date.now(),
      };
      console.log(`   群消息: group=${entry.targetId} from=${entry.authorId} content="${entry.content.substring(0, 100)}"${attachments.length ? ` attachments=${attachments.length}` : ''}`);
    }

    if (type === 'C2C_MESSAGE_CREATE') {
      const attachments = data.attachments || [];
      const voiceText = extractVoiceText(attachments);
      const textContent = data.content?.trim() || voiceText || '';
      const nonVoiceAttach = attachments.filter(a => a.content_type !== 'voice');
      const attachSummary = nonVoiceAttach.map(a => `[${a.content_type || 'file'}:${a.filename}]`).join(' ');
      entry = {
        source: 'c2c',
        targetId: data.author?.user_openid || data.author?.id || '',
        msgId: data.id,
        content: textContent + (attachSummary ? `\n附件: ${attachSummary}` : ''),
        authorId: data.author?.user_openid || data.author?.id || '',
        attachments: nonVoiceAttach,
        ts: Date.now(),
      };
      console.log(`   私聊消息: from=${entry.authorId} content="${entry.content.substring(0, 100)}"${attachments.length ? ` attachments=${attachments.length}` : ''}`);
    }

    if (!entry) return;

    if (s.ALLOWED_REVIEWERS.size > 0 && !s.ALLOWED_REVIEWERS.has(entry.authorId)) {
      console.log(`   🚫 用户不在白名单: ${entry.authorId}`);
      return;
    }

    entry.platform = 'qqbot';
    s.recentMessages.push(entry);
    if (s.recentMessages.length > 50) s.recentMessages.shift();

    if (entry.source === 'c2c') {
      s.knownUsers.set(entry.authorId, { lastMsgTs: entry.ts });
      s.saveKnownContacts();
    } else if (entry.source === 'group') {
      s.knownGroups.set(entry.targetId, { lastMsgTs: entry.ts });
      s.saveKnownContacts();
    }

    const rawText = entry.content?.replace(/\n附件:.*$/s, '').trim() || '';
    if (handleBotCommand(rawText, entry, 'qqbot')) return;

    const unsent = [...s.pendingReviews.values()].find(r => !r.sent);
    if (unsent) {
      sendReviewReply(s, entry, unsent);
    }

    const sentReviews = [...s.pendingReviews.values()].filter(r => r.sent && !r.feedbackReceived);
    if (sentReviews.length > 0) {
      const { agentId, message } = parseAgentRoute(entry.content?.replace(/\n附件:.*$/s, '').trim() || '');
      if (agentId && s.pendingReviews.has(agentId)) {
        const review = s.pendingReviews.get(agentId);
        if (review.sent && !review.feedbackReceived) {
          entry.content = message + (entry.content?.match(/\n附件:.*$/s)?.[0] || '');
          receiveFeedback(entry, review);
        }
      } else if (!agentId && sentReviews.length === 1) {
        receiveFeedback(entry, sentReviews[0]);
      } else if (!agentId && sentReviews.length > 1) {
        const labels = sentReviews.map(r => `\`#${r.agentId}\` ${r.agentLabel}`).join('\n');
        const hint = `请指定回复目标 Agent（在消息前加 #agent_id）：\n${labels}`;
        const seq = s.nextMsgSeq(entry.msgId);
        const fn = entry.source === 'c2c'
          ? replyToC2CMessage(entry.authorId, entry.msgId, hint, seq)
          : replyToGroupMessage(entry.targetId, entry.msgId, hint, seq);
        fn.catch(() => {});
      }
    } else if (s.pendingReviews.size === 0) {
      const queueKey = s.enqueue({ ...entry, ts: Date.now() }, null);
      console.log(`📥 [QQ] 消息加入队列 [${queueKey}] (总计 ${s.totalQueueSize()} 条)`);
    }
  };
}

// --- Review sending helpers ---

export async function sendReviewPassive(s, entry, content, format, arkPayload = null, keyboard = null) {
  const targetId = entry.source === 'c2c' ? entry.authorId : entry.targetId;
  const isGroup = entry.source === 'group';
  const seq = s.nextMsgSeq(entry.msgId);
  const path = isGroup ? `/v2/groups/${targetId}/messages` : `/v2/users/${targetId}/messages`;

  if (format === 'image') {
    const imgResult = await renderAndSendImage(targetId, content, entry.msgId, seq, isGroup, s.SESSIONS_DIR);
    if (imgResult.ok) return true;
    console.log(`⚠ 图片发送失败，回退到 Markdown`);
    const fallSeq = s.nextMsgSeq(entry.msgId);
    const body = { msg_type: 2, markdown: { content }, msg_id: entry.msgId, msg_seq: fallSeq };
    if (keyboard) body.keyboard = keyboard;
    await apiCall('POST', path, body);
    return true;
  }

  if (format === 'ark' && arkPayload) {
    if (isGroup) await sendArkGroupMessage(targetId, arkPayload, entry.msgId, seq);
    else await sendArkC2CMessage(targetId, arkPayload, entry.msgId, seq);
    return true;
  }

  const body = { msg_type: 2, markdown: { content }, msg_id: entry.msgId, msg_seq: seq };
  if (keyboard) body.keyboard = keyboard;
  const result = await apiCall('POST', path, body);
  if (result.code || result.message) {
    console.log(`⚠ 被动回复 API 响应: code=${result.code} msg=${result.message}`);
    if (keyboard) {
      console.log(`↻ 尝试不带 keyboard 重发...`);
      delete body.keyboard;
      const retry = await apiCall('POST', path, body);
      if (retry.code || retry.message) console.log(`⚠ 重发仍失败: code=${retry.code} msg=${retry.message}`);
    }
  }
  return true;
}

export async function sendReviewReply(s, entry, review) {
  if (!review) return;

  const agentQueue = s.messageQueues.get(review.agentId) || [];
  const generalQueue = s.messageQueues.get('_general') || [];
  const combined = [...agentQueue, ...generalQueue].sort((a, b) => a.ts - b.ts);
  if (combined.length > 0) {
    review.queuedMessages = combined;
    s.messageQueues.delete(review.agentId);
    s.messageQueues.delete('_general');
  }

  const reviewText = buildReviewText(review.summary, review.timeoutSec || s.config.reviewDefaultTimeout, review.agentLabel);
  const targetId = entry.source === 'c2c' ? entry.authorId : entry.targetId;
  const keyboard = review.agentId ? buildReviewKeyboard(review.agentId, review.agentSymbol) : null;

  try {
    let arkPayload = null;
    if (review.format === 'ark') {
      const lines = review.summary.split('\n').filter(l => l.trim());
      const arkDeco = REVIEW_DECORATIONS[Math.floor(Math.random() * REVIEW_DECORATIONS.length)];
      arkPayload = buildArkPayload(`${review.agentLabel} | ${arkDeco} Review Request`, [...lines, `---`, `请回复您的审查意见，截止 ${formatDeadline(review.timeoutSec || s.config.reviewDefaultTimeout, review.createdTs)}`]);
    }
    await sendReviewPassive(s, entry, reviewText, review.format, arkPayload, keyboard);
    console.log(`✓ Review 已发送 [${review.agentId}] (${entry.source} ${review.format} 被动回复)`);
    review.sent = true;
    review.sentTs = Date.now();
    review.replySource = entry.source;
    review.replyTargetId = targetId;

    if (review.sessionDir) {
      appendFileSync(join(review.sessionDir, 'log.txt'),
        `[${new Date().toISOString()}] Review sent via ${entry.source} ${review.format} passive reply to ${targetId}\n`);
    }
  } catch (err) {
    console.error(`发送 review 失败 [${review.agentId}]:`, err.message);
  }
}
