/**
 * Feedback aggregation: collecting multi-message feedback (images + text)
 * and finalizing with attachments download.
 */
import { appendFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { apiCall } from '../qq/api.mjs';
import * as feishuApi from '../feishu/api.mjs';

/**
 * Receive a feedback message and aggregate.
 * @param {object} entry - incoming message
 * @param {object} review - the pending review object
 * @param {object} s - shared state
 * @param {object} feishu - Feishu helpers (feishuSendSystemCard)
 * @param {boolean} USE_FEISHU
 */
export function receiveFeedback(entry, review, s, feishu, USE_FEISHU) {
  if (!review) return;

  const hasAttachment = entry.attachments?.length > 0;
  const hasText = entry.content?.replace(/\n附件:.*$/s, '').trim().length > 0;

  review.feedbackBuffer.push(entry);
  console.log(`   [${review.agentId}] 聚合中: 已收集 ${review.feedbackBuffer.length} 条消息 (${hasAttachment ? '含附件' : '纯文本'})`);

  if (review.sessionDir) {
    appendFileSync(join(review.sessionDir, 'log.txt'),
      `[${new Date().toISOString()}] Message #${review.feedbackBuffer.length}: text=${hasText} attach=${hasAttachment} content="${(entry.content || '').substring(0, 80)}"\n`);
  }

  if (review.feedbackSilenceTimer) clearTimeout(review.feedbackSilenceTimer);

  if (hasText && hasAttachment) {
    finalizeFeedback(review, s, feishu, USE_FEISHU);
    return;
  }

  if (hasText && !hasAttachment) {
    finalizeFeedback(review, s, feishu, USE_FEISHU);
    return;
  }

  const FEEDBACK_SILENCE_TIMEOUT_MS = s.config.feedbackSilenceTimeout;
  const imgCount = review.feedbackBuffer.filter(e => e.attachments?.length > 0).length;
  const timeoutSec = Math.round(FEEDBACK_SILENCE_TIMEOUT_MS / 1000);
  const ackText = `✅ [${review.agentLabel}] 已收到第 ${imgCount} 张附件，请在 ${timeoutSec}s 内追加下一条消息，或发送文本以提交`;
  sendAckToUser(entry, ackText, s, feishu);

  review.feedbackSilenceTimer = setTimeout(() => {
    console.log(`⏱ [${review.agentId}] 聚合超时 (${timeoutSec}s 无新消息)，强制完成`);
    finalizeFeedback(review, s, feishu, USE_FEISHU);
  }, FEEDBACK_SILENCE_TIMEOUT_MS);
}

export async function sendAckToUser(msg, text, s, feishu) {
  try {
    if (msg.platform === 'feishu') {
      await feishu.feishuSendSystemCard(msg.targetId, '📎 附件接收', text, 'blue');
      console.log(`✓ 已发送聚合提示 (飞书卡片)`);
      return;
    }
    const seq = s.nextMsgSeq(msg.msgId);
    const body = { content: text, msg_type: 0, msg_id: msg.msgId, msg_seq: seq };
    if (msg.source === 'c2c') {
      await apiCall('POST', `/v2/users/${msg.targetId}/messages`, body);
    } else {
      await apiCall('POST', `/v2/groups/${msg.targetId}/messages`, body);
    }
    console.log(`✓ 已发送聚合提示 (seq=${seq})`);
  } catch (err) {
    console.log(`⚠ 聚合提示失败: ${err.message}`);
  }
}

async function finalizeFeedback(review, s, feishu, USE_FEISHU) {
  if (review.feedbackSilenceTimer) { clearTimeout(review.feedbackSilenceTimer); review.feedbackSilenceTimer = null; }
  if (!review || review.feedbackBuffer.length === 0) return;

  if (!review.queuedMessages) {
    review.queuedMessages = s.consumeReviewQueue(review.agentId);
  }

  const lastMsg = review.feedbackBuffer[review.feedbackBuffer.length - 1];
  const attachCount = review.feedbackBuffer.filter(e => e.attachments?.length > 0).length;

  if (lastMsg.platform !== 'feishu') {
    const ackText = attachCount > 0
      ? `✅ [${review.agentLabel}] 已提交反馈，共 ${review.feedbackBuffer.length} 条消息（含 ${attachCount} 张附件）`
      : `✅ [${review.agentLabel}]`;
    try {
      const seq = s.nextMsgSeq(lastMsg.msgId);
      const ackBody = { content: ackText, msg_type: 0, msg_id: lastMsg.msgId, msg_seq: seq };
      if (lastMsg.source === 'c2c') {
        await apiCall('POST', `/v2/users/${lastMsg.targetId}/messages`, ackBody);
      } else {
        await apiCall('POST', `/v2/groups/${lastMsg.targetId}/messages`, ackBody);
      }
      console.log(`✓ [${review.agentId}] 已发送最终确认 (seq=${seq})`);
    } catch (err) {
      console.log(`⚠ [${review.agentId}] 确认失败: ${err.message}`);
    }
  }

  review.feedbackReceived = true;
  review.feedbackAuthor = review.feedbackBuffer[0].authorId;
  review.feedbackTs = Date.now();
  review.consecutiveTimeouts = 0;

  if (lastMsg?.platform === 'feishu' && USE_FEISHU) {
    for (const msg of review.feedbackBuffer) {
      if (msg.msgId && msg.platform === 'feishu') {
        feishu.feishuAddReaction(msg.msgId, 'DONE').catch(() => {});
      }
    }
  }

  const allAttachments = [];
  const textParts = [];
  const displayParts = [];
  for (const msg of review.feedbackBuffer) {
    const cleanText = (msg.content || '').replace(/\n附件:.*$/s, '').trim();
    const msgAttachments = msg.attachments || [];
    if (cleanText) textParts.push(cleanText);
    if (msgAttachments.length) allAttachments.push(...msgAttachments);
    const imgs = msgAttachments.filter(a => a.content_type === 'image').length;
    const files = msgAttachments.length - imgs;
    if (cleanText && msgAttachments.length > 0) {
      displayParts.push(`${cleanText} 📎${msgAttachments.length}`);
    } else if (cleanText) {
      displayParts.push(cleanText);
    } else if (msgAttachments.length > 0) {
      const ph = [];
      if (imgs) ph.push(imgs > 1 ? `[图片×${imgs}]` : '[图片]');
      if (files) ph.push(files > 1 ? `[文件×${files}]` : '[文件]');
      displayParts.push(ph.join(' '));
    }
  }

  const downloadedFiles = [];
  if (allAttachments.length && review.sessionDir) {
    const imagesDir = join(review.sessionDir, 'images');
    mkdirSync(imagesDir, { recursive: true });

    for (let i = 0; i < allAttachments.length; i++) {
      const att = allAttachments[i];
      const ext = (att.filename || '').split('.').pop() || (att.content_type === 'image' ? 'png' : 'bin');
      const localName = `${i + 1}.${ext}`;
      const localPath = join(imagesDir, localName);
      try {
        if (att.feishu_file_key && s.feishuClient) {
          const type = att.content_type === 'image' ? 'image' : 'file';
          const result = await feishuApi.getMessageResource(att.feishu_message_id, att.feishu_file_key, type);
          await result.writeFile(localPath);
          downloadedFiles.push({ ...att, localPath, localName });
          const { size } = statSync(localPath);
          console.log(`   ↓ [${review.agentId}] 下载飞书附件: ${localName} (${size} bytes)`);
        } else {
          const resp = await fetch(att.url);
          if (resp.ok) {
            const buf = Buffer.from(await resp.arrayBuffer());
            writeFileSync(localPath, buf);
            downloadedFiles.push({ ...att, localPath, localName });
            console.log(`   ↓ [${review.agentId}] 下载附件: ${localName} (${buf.length} bytes)`);
          } else {
            console.log(`   ⚠ [${review.agentId}] 下载失败: ${att.filename} (${resp.status})`);
            downloadedFiles.push({ ...att, localPath: null, localName, error: `HTTP ${resp.status}` });
          }
        }
      } catch (err) {
        console.log(`   ⚠ [${review.agentId}] 下载异常: ${att.filename || att.feishu_file_key} (${err.message})`);
        downloadedFiles.push({ ...att, localPath: null, localName, error: err.message });
      }
    }
  }

  const combinedText = textParts.join('\n');
  const displayText = displayParts.join('\n');
  const attachSummary = downloadedFiles
    .map(a => `[${a.content_type}:${a.localPath || a.localName}]`)
    .join(' ');
  review.feedback = combinedText + (attachSummary ? `\n附件: ${attachSummary}` : '');
  review.feedbackDisplay = displayText;
  review.attachments = downloadedFiles;

  const bufferSnapshot = [...review.feedbackBuffer];
  const msgCount = bufferSnapshot.length;
  const firstSource = bufferSnapshot[0]?.source || 'unknown';

  console.log(`✓ [${review.agentId}] 反馈聚合完成: ${msgCount} 条消息, ${downloadedFiles.length} 个附件, 文本长度=${combinedText.length}`);

  if (USE_FEISHU && review.feishuCardMsgId) {
    feishu.feishuUpdateCardToCompleted(review, displayText).catch(err => console.error('[飞书] 更新卡片为完成状态失败:', err.message));
  }

  s.lastFeedbacks.set(review.agentId, { ...review });

  s.reviewHistory.push({
    agentId: review.agentId, agentLabel: review.agentLabel,
    summary: review.summary, feedback: review.feedback,
    createdTs: review.createdTs, feedbackTs: review.feedbackTs,
    sessionDir: review.sessionDir,
    attachmentCount: downloadedFiles.length,
    autoCompleted: false,
  });
  if (s.reviewHistory.length > s.HISTORY_MAX) s.reviewHistory.shift();

  if (review.sessionDir) {
    let attachSection = '';
    if (downloadedFiles.length) {
      attachSection = '\n\n## Attachments\n' + downloadedFiles.map(a =>
        `- ${a.localName} (${a.content_type}, ${a.width || '?'}x${a.height || '?'}, ${a.size || '?'} bytes)` +
        (a.localPath ? `\n  Local: ${a.localPath}` : `\n  Error: ${a.error}`) +
        `\n  URL: ${a.url}`
      ).join('\n');
    }
    try {
      writeFileSync(join(review.sessionDir, 'response.md'),
        `# Review Response\n\nAgent: ${review.agentId}\nFrom: ${review.feedbackAuthor}\nSource: ${firstSource}\nMessages: ${msgCount}\n\n${combinedText}${attachSection}\n`);
      appendFileSync(join(review.sessionDir, 'log.txt'),
        `[${new Date().toISOString()}] Feedback finalized: ${msgCount} messages, ${downloadedFiles.length} attachments\n`);
    } catch (err) {
      console.log(`⚠ [${review.agentId}] 保存 session 失败: ${err.message}`);
    }
  }

  review.feedbackBuffer = [];
  for (const cb of review.feedbackCallbacks.splice(0)) cb(review);
  s.pendingReviews.delete(review.agentId);
}
