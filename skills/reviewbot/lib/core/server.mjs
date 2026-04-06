/**
 * HTTP server route handler factory.
 */
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatQueueMsgText, formatDeadline } from '../feishu/cards.mjs';
import { buildReviewText, buildReviewKeyboard, buildArkPayload, REVIEW_DECORATIONS } from '../qq/builders.mjs';
import { markdownToStyledHtml } from '../util/render.mjs';
import { parseBody, jsonResp } from '../util/http.mjs';
import { generateStallMessage } from '../util/stall.mjs';
import {
  apiCall,
  replyToGroupMessage, replyToC2CMessage,
  sendActiveC2CMessage, sendWakeupC2CMessage, sendActiveGroupMessage,
  sendArkC2CMessage,
} from '../qq/api.mjs';
import { renderAndSendImage } from '../util/media.mjs';
import { sendReviewReply } from '../qq/ws.mjs';

/**
 * Create HTTP server.
 * @param {object} s - shared state
 * @param {object} feishu - Feishu helpers
 * @param {Function} receiveFeedback
 * @param {boolean} USE_FEISHU
 * @param {boolean} USE_QQ
 */
export function createHttpServer(s, feishu, receiveFeedback, USE_FEISHU, USE_QQ) {
  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost`);
    const path = url.pathname;

    try {
      if (req.method === 'GET' && path === '/status') {
        const reviews = [...s.pendingReviews.values()].map(r => ({
          agentId: r.agentId, label: r.agentLabel, sent: r.sent,
          summary: r.summary?.substring(0, 100), waiting_since: r.createdTs,
        }));
        return jsonResp(res, 200, {
          connected: s.connected || s.feishuConnected,
          platform: USE_FEISHU && s.feishuConnected ? 'feishu' : (s.connected ? 'qq' : 'disconnected'),
          feishuConnected: s.feishuConnected,
          qqConnected: s.connected,
          hasPendingReview: s.pendingReviews.size > 0,
          pendingReviewSent: reviews.some(r => r.sent),
          pendingReviews: reviews,
          lastFeedback: s.lastFeedbacks.size > 0 ? Object.fromEntries(
            [...s.lastFeedbacks.entries()].map(([k, v]) => [k, { feedback: v.feedback, ts: v.feedbackTs }])
          ) : null,
          recentMessages: s.recentMessages.length,
          messageQueue: s.totalQueueSize(),
          messageQueues: Object.fromEntries([...s.messageQueues.entries()].map(([k, v]) => [k, v.length])),
        });
      }

      if (req.method === 'GET' && path === '/history') {
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), s.HISTORY_MAX);
        const entries = s.reviewHistory.slice(-limit).reverse().map(h => ({
          agentId: h.agentId, agentLabel: h.agentLabel,
          summary: h.summary?.substring(0, 200),
          feedback: h.feedback?.substring(0, 200),
          createdAt: new Date(h.createdTs).toISOString(),
          completedAt: new Date(h.feedbackTs).toISOString(),
          durationSec: Math.round((h.feedbackTs - h.createdTs) / 1000),
          autoCompleted: h.autoCompleted,
          attachmentCount: h.attachmentCount || 0,
        }));
        return jsonResp(res, 200, { total: s.reviewHistory.length, entries });
      }

      // --- POST /review ---
      if (req.method === 'POST' && path === '/review') {
        return handleReview(req, res, s, feishu, USE_FEISHU, USE_QQ);
      }

      // --- POST /send ---
      if (req.method === 'POST' && path === '/send') {
        return handleSend(req, res, s, feishu, USE_FEISHU, USE_QQ);
      }

      // --- POST /wait-feedback ---
      if (req.method === 'POST' && path === '/wait-feedback') {
        return handleWaitFeedback(req, res, s, feishu, receiveFeedback, USE_FEISHU, USE_QQ);
      }

      // --- POST /send-html ---
      if (req.method === 'POST' && path === '/send-html') {
        return handleSendHtml(req, res, s);
      }

      jsonResp(res, 404, { error: 'Not found' });
    } catch (err) {
      console.error('HTTP 错误:', err.message);
      jsonResp(res, 500, { error: err.message });
    }
  });

  return httpServer;
}

// --- Route handlers ---

async function handleReview(req, res, s, feishu, USE_FEISHU, USE_QQ) {
  const body = await parseBody(req);
  if (!body.summary) return jsonResp(res, 400, { error: '需要 summary' });
  if (!body.agent_id) return jsonResp(res, 400, { error: '需要 agent_id' });

  const rawAgentId = body.agent_id;
  const clientUUID = body.client_uuid || null;
  const prevReview = s.pendingReviews.get(rawAgentId);

  const agentId = s.resolveAgentId(rawAgentId, clientUUID);
  const symbol = s.assignSymbol(agentId);
  const agentLabel = `${symbol} ${agentId}`;

  const ts = new Date().toISOString().replace(/[-:T]/g, '').replace(/\..+/, '').substring(0, 15);
  const sessionDir = join(s.SESSIONS_DIR, `${ts.replace(/(\d{8})(\d{6})/, '$1_$2')}_${agentId}`);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'request.md'), `# Review Request\n\nAgent: ${agentId} (${agentLabel})\n\n${body.summary}\n`);
  appendFileSync(join(sessionDir, 'log.txt'), `[${new Date().toISOString()}] Review submitted by ${agentId}\n`);

  const format = body.format || (body.as_image ? 'image' : 'markdown');
  const timeoutSec = s.config.reviewDefaultTimeout;
  s.lastFeedbacks.delete(agentId);
  const projectPath = body.project_path || null;
  const inheritedTimeouts = (prevReview && prevReview.agentId === agentId) ? (prevReview.consecutiveTimeouts || 0) : 0;

  const review = {
    agentId, agentLabel, agentSymbol: symbol, projectPath, clientUUID,
    summary: body.summary, sent: false, feedbackReceived: false, sessionDir,
    createdTs: Date.now(), format, asImage: format === 'image', timeoutSec,
    arkData: body.ark_data || null, feedbackBuffer: [], feedbackSilenceTimer: null,
    feedbackCallbacks: [], consecutiveTimeouts: inheritedTimeouts,
  };

  if (prevReview && agentId === rawAgentId && prevReview.feishuCardMsgId && USE_FEISHU) {
    prevReview.feedbackReceived = true;
    const prevFeedback = prevReview.lastStallMsg || prevReview.feedbackDisplay || prevReview.feedback || '';
    const replacedNote = '⏹ 被新 Review 替换';
    const combinedFeedback = prevFeedback ? `${prevFeedback}\n${replacedNote}` : replacedNote;
    prevReview.feedback = combinedFeedback;
    prevReview.feedbackDisplay = combinedFeedback;
    feishu.feishuUpdateCardToCompleted(prevReview, combinedFeedback, { isAutoTimeout: true })
      .catch(err => console.log(`⚠ [${agentId}] 旧卡片更新失败: ${err.message}`));
    console.log(`♻ [${agentId}] 旧 Review 卡片已标记为替换 (继承超时计数: ${inheritedTimeouts})`);
  }
  s.pendingReviews.set(agentId, review);
  console.log(`📋 [${agentId}] 新 Review 请求已提交`);

  let sent = false;
  const now = Date.now();
  const requestedPlatform = body.platform || null;

  // Feishu path
  if (USE_FEISHU && s.feishuConnected && requestedPlatform !== 'qq') {
    const [userId] = [...s.feishuKnownUsers.keys()].slice(-1);
    if (userId) {
      for (let attempt = 1; attempt <= 3 && !sent; attempt++) {
        try {
          await feishu.sendFeishuReviewCard(userId, review);
          sent = review.sent;
        } catch (err) {
          console.log(`⚠ [${agentId}] 飞书发送尝试 ${attempt}/3 失败: ${err.message}`);
          if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }
    }
    if (!sent) console.log(`⏳ [${agentId}] 飞书无已知用户，等待用户在飞书发消息...`);
  }

  // QQ path
  if (!sent && USE_QQ && (requestedPlatform === 'qq' || !USE_FEISHU || !s.feishuConnected)) {
    sent = await trySendQQReview(s, review, agentId, agentLabel, sessionDir, now);
  }

  if (!sent) console.log(`⏳ [${agentId}] 所有发送方式均不可用，等待用户发消息...`);

  return jsonResp(res, 200, { ok: true, agentId, agentLabel, sessionDir, sent: review.sent, assigned_agent_id: agentId });
}

async function trySendQQReview(s, review, agentId, agentLabel, sessionDir, now) {
  const kbd = buildReviewKeyboard(agentId, review.agentSymbol);
  let sent = false;

  const recentPassive = s.recentMessages.filter(m => {
    if (m.platform === 'feishu') return false;
    const window = m.source === 'c2c' ? 60 * 60 * 1000 : 5 * 60 * 1000;
    return now - m.ts < window;
  }).pop();
  if (recentPassive) {
    await sendReviewReply(s, recentPassive, review);
    sent = review.sent;
  }

  if (!sent) {
    const reviewText = buildReviewText(review.summary, review.timeoutSec, review.agentLabel);
    const [userId] = [...s.knownUsers.keys()].slice(-1);
    if (userId) {
      try {
        let result;
        if (review.format === 'image') {
          try {
            const imgResult = await renderAndSendImage(userId, reviewText, null, null, false, s.SESSIONS_DIR);
            result = imgResult.ok ? { id: 'image_sent' } : {};
          } catch (imgErr) {
            console.log(`⚠ [${agentId}] 图片渲染失败(${imgErr.message})，回退到 Markdown`);
            result = await sendActiveC2CMessage(userId, reviewText, kbd);
          }
        } else if (review.format === 'ark') {
          const lines = review.summary.split('\n').filter(l => l.trim());
          const arkDeco = REVIEW_DECORATIONS[Math.floor(Math.random() * REVIEW_DECORATIONS.length)];
          const ark = buildArkPayload(`${agentLabel} | ${arkDeco} Review`, [...lines, '---', `截止 ${formatDeadline(review.timeoutSec, review.createdTs)}`]);
          result = await sendArkC2CMessage(userId, ark, null, null);
        } else {
          result = await sendActiveC2CMessage(userId, reviewText, kbd);
        }
        if (result.id) {
          console.log(`✓ [${agentId}] Review 已发送 (C2C 主动消息 → ${userId})`);
          review.sent = true; review.sentTs = Date.now(); review.replySource = 'c2c'; review.replyTargetId = userId;
          appendFileSync(join(sessionDir, 'log.txt'), `[${new Date().toISOString()}] Review sent via active C2C to ${userId}\n`);
          sent = true;
        }
      } catch (err) {
        console.log(`⚠ [${agentId}] C2C 主动消息异常: ${err.message}`);
      }
    }
    if (!sent) {
      const [groupId] = [...s.knownGroups.keys()].slice(-1);
      if (groupId) {
        try {
          const reviewTextGroup = buildReviewText(review.summary, review.timeoutSec, review.agentLabel);
          const result = await sendActiveGroupMessage(groupId, reviewTextGroup, kbd);
          if (result.id) {
            console.log(`✓ [${agentId}] Review 已发送 (群主动消息 → ${groupId})`);
            review.sent = true; review.sentTs = Date.now(); review.replySource = 'group'; review.replyTargetId = groupId;
            appendFileSync(join(sessionDir, 'log.txt'), `[${new Date().toISOString()}] Review sent via active group msg to ${groupId}\n`);
            sent = true;
          }
        } catch (err) {
          console.log(`⚠ [${agentId}] 群主动消息异常: ${err.message}`);
        }
      }
    }
  }

  if (!sent) {
    const [userId] = [...s.knownUsers.keys()].slice(-1);
    if (userId) {
      try {
        const wakeupText = buildReviewText(review.summary, review.timeoutSec, review.agentLabel);
        const result = await sendWakeupC2CMessage(userId, wakeupText, kbd);
        if (result.id) {
          console.log(`✓ [${agentId}] Review 已发送 (C2C 互动召回 → ${userId})`);
          review.sent = true; review.sentTs = Date.now(); review.replySource = 'c2c'; review.replyTargetId = userId;
          appendFileSync(join(sessionDir, 'log.txt'), `[${new Date().toISOString()}] Review sent via wakeup C2C to ${userId}\n`);
          sent = true;
        }
      } catch (err) {
        console.log(`⚠ [${agentId}] 互动召回异常: ${err.message}`);
      }
    }
  }
  return sent;
}

async function handleSend(req, res, s, feishu, USE_FEISHU, USE_QQ) {
  const body = await parseBody(req);
  if (!body.message) return jsonResp(res, 400, { error: 'message required' });
  const content = body.message;
  const format = body.format || 'markdown';
  const agentId = body.agent_id || null;
  const projectPath = body.project_path || null;
  let sent = false;
  const requestedPlatform = body.platform || null;

  if (USE_FEISHU && s.feishuConnected && requestedPlatform !== 'qq') {
    const [userId] = [...s.feishuKnownUsers.keys()].slice(-1);
    if (userId) {
      for (let attempt = 1; attempt <= 3 && !sent; attempt++) {
        try {
          if (agentId) await feishu.feishuSendNotificationCard(userId, content, agentId, projectPath);
          else await feishu.feishuSendSystemCard(userId, '📢 通知', content, 'blue');
          sent = true;
        } catch (err) {
          console.log(`⚠ /send 飞书发送尝试 ${attempt}/3 失败: ${err.message}`);
          if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }
    }
  }

  if (!sent && USE_QQ && (requestedPlatform === 'qq' || !USE_FEISHU || !s.feishuConnected)) {
    const recent = s.recentMessages.filter(m => {
      if (m.platform === 'feishu') return false;
      const w = m.source === 'c2c' ? 60 * 60 * 1000 : 5 * 60 * 1000;
      return Date.now() - m.ts < w;
    }).pop();

    if (recent) {
      const tid = recent.source === 'c2c' ? recent.authorId : recent.targetId;
      const seq = s.nextMsgSeq(recent.msgId);
      if (format === 'image') {
        try { const r = await renderAndSendImage(tid, content, recent.msgId, seq, recent.source === 'group', s.SESSIONS_DIR); sent = r.ok; } catch {}
      }
      if (!sent) {
        const { replyToGroupMessage, replyToC2CMessage } = await import('../qq/api.mjs');
        const fn = recent.source === 'group' ? replyToGroupMessage : replyToC2CMessage;
        const r = await fn(tid, recent.msgId, content, seq);
        sent = !!r.id;
      }
    }
    if (!sent) {
      const [userId] = [...s.knownUsers.keys()].slice(-1);
      if (userId) {
        const r = await sendActiveC2CMessage(userId, content);
        sent = !!r.id;
      }
    }
  }
  return jsonResp(res, 200, { ok: sent });
}

async function handleWaitFeedback(req, res, s, feishu, receiveFeedback, USE_FEISHU, USE_QQ) {
  const body = await parseBody(req).catch(() => ({}));
  const timeoutMs = ((body.timeout || s.config.reviewDefaultTimeout) * 1000);
  const agentId = body.agent_id;

  if (!agentId) return jsonResp(res, 400, { error: '需要 agent_id' });

  const cached = s.lastFeedbacks.get(agentId);
  if (cached && !s.pendingReviews.has(agentId)) {
    const cachedAttach = (cached.attachments || [])
      .filter(a => a.localPath)
      .map(a => ({ type: a.content_type, name: a.localName, path: a.localPath }));
    return jsonResp(res, 200, { status: 'replied', feedback: cached.feedback, sessionDir: cached.sessionDir, attachments: cachedAttach });
  }

  const review = s.pendingReviews.get(agentId);
  if (!review) return jsonResp(res, 404, { error: `No pending review for agent ${agentId}` });

  if (review.feedbackReceived) {
    s.lastFeedbacks.set(agentId, { ...review });
    s.pendingReviews.delete(agentId);
    return jsonResp(res, 200, {
      status: 'timeout_retry',
      message: '服务重启期间已收到用户反馈，但连接已断开。请重新提交 review request 以获取最新反馈。',
      sessionDir: review.sessionDir,
    });
  }

  const reviewTimeoutMs = s.config.reviewDefaultTimeout * 1000;
  const reviewDeadline = (review.createdTs || Date.now()) + reviewTimeoutMs;
  const reviewRemainingMs = reviewDeadline - Date.now();

  if (reviewRemainingMs <= 0 && !review._timeoutHandled) {
    review._timeoutHandled = true;
    review.consecutiveTimeouts++;
  }

  const timerMs = Math.min(timeoutMs, Math.max(reviewRemainingMs, 500));

  const result = await new Promise((resolve) => {
    const timer = setTimeout(async () => {
      const isReviewTimeout = Date.now() >= reviewDeadline - 500;

      if (!isReviewTimeout) { resolve({ pollExpired: true }); return; }

      if (!review._timeoutHandled) {
        review._timeoutHandled = true;
        review.consecutiveTimeouts++;
        console.log(`⏰ [${agentId}] Review 超时 ${review.consecutiveTimeouts}/${s.MAX_CONSECUTIVE_TIMEOUTS} (review.timeoutSec=${review.timeoutSec}s)`);
      }

      if (review.consecutiveTimeouts >= s.MAX_CONSECUTIVE_TIMEOUTS) {
        console.log(`🔚 [${agentId}] 达到最大连续超时次数，自动回复"任务完成"`);
        try {
          const autoMsg = `Reviewer 长时间未响应（${review.consecutiveTimeouts} 次超时），系统自动结束。`;
          if (USE_FEISHU && s.feishuConnected) {
            await feishu.feishuSendReminder(review, autoMsg);
          } else if (USE_QQ) {
            const recent = s.recentMessages.filter(m => {
              if (m.platform === 'feishu') return false;
              const w = m.source === 'c2c' ? 60 * 60 * 1000 : 5 * 60 * 1000;
              return Date.now() - m.ts < w;
            }).pop();
            if (recent) {
              const tid = recent.source === 'c2c' ? recent.authorId : recent.targetId;
              const seq = s.nextMsgSeq(recent.msgId);
              if (recent.source === 'group') await replyToGroupMessage(tid, recent.msgId, autoMsg, seq);
              else await replyToC2CMessage(tid, recent.msgId, autoMsg, seq);
            }
          }
        } catch {}
        resolve({ feedback: '任务完成', sessionDir: review.sessionDir, autoCompleted: true });
        return;
      }

      if (review.consecutiveTimeouts >= 3 && !review.urgentSent && USE_FEISHU && review.feishuCardMsgId) {
        const urgentTarget = review.replyTargetId || [...s.feishuKnownUsers.keys()].slice(-1)[0];
        if (urgentTarget) {
          const ok = await feishu.feishuUrgentMessage(review.feishuCardMsgId, [urgentTarget]);
          if (ok) review.urgentSent = true;
        }
      }

      const readStatus = review.readTs ? '已读' : '未读';
      const nextReviewDeadline = new Date(Date.now() + reviewTimeoutMs);
      const nextDeadlineStr = nextReviewDeadline.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
      try {
        const reminder = `超时 (${review.consecutiveTimeouts}/${s.MAX_CONSECUTIVE_TIMEOUTS}，${readStatus})：仍在等待反馈，截止：${nextDeadlineStr}`;
        if (USE_FEISHU && s.feishuConnected) {
          await feishu.feishuSendReminder(review, reminder);
        } else if (USE_QQ) {
          const recent = s.recentMessages.filter(m => {
            if (m.platform === 'feishu') return false;
            const w = m.source === 'c2c' ? 60 * 60 * 1000 : 5 * 60 * 1000;
            return Date.now() - m.ts < w;
          }).pop();
          if (recent) {
            const tid = recent.source === 'c2c' ? recent.authorId : recent.targetId;
            const seq = s.nextMsgSeq(recent.msgId);
            if (recent.source === 'group') await replyToGroupMessage(tid, recent.msgId, reminder, seq);
            else await replyToC2CMessage(tid, recent.msgId, reminder, seq);
          } else {
            const [userId] = [...s.knownUsers.keys()].slice(-1);
            if (userId) await sendActiveC2CMessage(userId, reminder);
          }
        }
      } catch (err) {
        console.log(`⚠ [${agentId}] 超时提醒失败: ${err.message}`);
      }

      const stallMsg = generateStallMessage(review.consecutiveTimeouts);
      review.lastStallMsg = stallMsg;
      if (USE_FEISHU && review.feishuCardMsgId) {
        feishu.feishuUpdateCardToCompleted(review, stallMsg, { isAutoTimeout: true })
          .catch(err => console.log(`⚠ [${agentId}] 超时卡片更新失败: ${err.message}`));
      }
      resolve(null);
    }, timerMs);
    review.feedbackCallbacks.push((r) => { clearTimeout(timer); resolve(r); });
  });

  const FEEDBACK_SUFFIX = '\n\n---\n在执行过程中，如有中间结果可直接通过 /send 发送给我（不超过 3 次）。完成后请发起 review request。\n\n**重要：只有当用户明确回复"任务完成"时，你才能真正结束当前任务。在此之前，请根据用户反馈继续工作并再次提交 review。**';

  if (result?.autoCompleted) {
    review.queuedMessages = s.consumeReviewQueue(agentId);
    review.consecutiveTimeouts = 0;
    review.feedbackReceived = true;
    review.feedbackTs = Date.now();
    review.feedback = '任务完成';
    const autoFeedbackText = `⏰ Reviewer 长时间未响应（${s.MAX_CONSECUTIVE_TIMEOUTS} 次超时），系统自动结束`;
    review.feedbackDisplay = autoFeedbackText;
    if (USE_FEISHU && review.feishuCardMsgId) {
      feishu.feishuUpdateCardToCompleted(review, autoFeedbackText, { isAutoTimeout: true }).catch(err => console.log(`⚠ 自动完成卡片更新失败: ${err.message}`));
    }
    if (review.sessionDir) {
      appendFileSync(join(review.sessionDir, 'log.txt'),
        `[${new Date().toISOString()}] Auto-completed after ${s.MAX_CONSECUTIVE_TIMEOUTS} timeouts\n`);
    }
    s.lastFeedbacks.set(agentId, { ...review });
    s.reviewHistory.push({
      agentId, agentLabel: review.agentLabel,
      summary: review.summary, feedback: review.feedback,
      createdTs: review.createdTs, feedbackTs: review.feedbackTs,
      sessionDir: review.sessionDir, attachmentCount: 0, autoCompleted: true,
    });
    if (s.reviewHistory.length > s.HISTORY_MAX) s.reviewHistory.shift();
    for (const cb of review.feedbackCallbacks.splice(0)) cb(review);
    s.pendingReviews.delete(agentId);
    return jsonResp(res, 200, { status: 'replied', feedback: '任务完成' + FEEDBACK_SUFFIX, sessionDir: result.sessionDir });
  }

  if (result?.pollExpired) {
    return jsonResp(res, 200, { status: 'poll_continue' });
  }

  if (!result) {
    const stallMsg = generateStallMessage(review.consecutiveTimeouts);
    review._timeoutHandled = false;
    review.createdTs = Date.now();
    return jsonResp(res, 200, {
      status: 'timeout_retry', message: stallMsg,
      consecutiveTimeouts: review.consecutiveTimeouts,
      maxTimeouts: s.MAX_CONSECUTIVE_TIMEOUTS,
      reviewReadByUser: !!review.readTs,
      sessionDir: review.sessionDir,
    });
  }

  let feedback = result.feedback || result.feedbackDisplay;
  if (review.queuedMessages?.length > 0) {
    const queueText = review.queuedMessages.map(m => {
      const time = new Date(m.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      return `[${time}] ${formatQueueMsgText(m, 200)}`;
    }).join('\n');
    feedback += `\n\n📥 等待队列 (${review.queuedMessages.length} 条，在 review 请求前收到):\n${queueText}`;
  }
  const attachList = (result.attachments || [])
    .filter(a => a.localPath)
    .map(a => ({ type: a.content_type, name: a.localName, path: a.localPath }));
  return jsonResp(res, 200, { status: 'replied', feedback: feedback + FEEDBACK_SUFFIX, sessionDir: result.sessionDir, attachments: attachList });
}

async function handleSendHtml(req, res, s) {
  const body = await parseBody(req);
  if (!body.html && !body.markdown) return jsonResp(res, 400, { error: '需要 html 或 markdown 字段' });

  const html = body.html || markdownToStyledHtml(body.markdown);
  const now = Date.now();
  const recentPassive = s.recentMessages.filter(m => {
    const window = m.source === 'c2c' ? 60 * 60 * 1000 : 5 * 60 * 1000;
    return now - m.ts < window;
  }).pop();

  let targetId, isGroup, msgId, msgSeq;
  if (recentPassive) {
    targetId = recentPassive.source === 'c2c' ? recentPassive.authorId : recentPassive.targetId;
    isGroup = recentPassive.source === 'group';
    msgId = recentPassive.msgId;
    msgSeq = s.nextMsgSeq(msgId);
  } else {
    const [userId] = [...s.knownUsers.keys()].slice(-1);
    if (userId) { targetId = userId; isGroup = false; }
    else {
      const [groupId] = [...s.knownGroups.keys()].slice(-1);
      if (groupId) { targetId = groupId; isGroup = true; }
    }
  }

  if (!targetId) return jsonResp(res, 400, { error: '无可用联系人，请先在 QQ 中发消息' });

  try {
    const useRawHtml = !!body.html;
    const result = await renderAndSendImage(targetId, html, msgId, msgSeq, isGroup, s.SESSIONS_DIR, useRawHtml);
    return jsonResp(res, 200, result);
  } catch (err) {
    console.error('HTML 渲染/发送失败:', err.message);
    return jsonResp(res, 500, { error: err.message });
  }
}
