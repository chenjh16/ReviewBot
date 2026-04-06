/**
 * Feishu WebSocket initialization and event handling.
 * Includes Feishu card sending helpers.
 */
import {
  formatQueueMsgText, formatDeadline, toFeishuMarkdown,
  buildFeishuReviewCard, buildFeishuFeedbackSelectedCard, buildFeishuCompletedCard,
  buildFeishuNotificationCard, buildFeishuSystemCard,
} from './cards.mjs';
import * as feishuApi from './api.mjs';
import { parseAgentRoute } from '../core/routing.mjs';

/**
 * @param {object} s - shared state (from createState)
 * @param {object} deps - { log, handleBotCommand, receiveFeedback, buildFeishuQueueManageCard, refreshPendingReviewCards }
 */
export async function initFeishu(s, deps) {
  const { log, handleBotCommand, receiveFeedback, buildFeishuQueueManageCard, refreshPendingReviewCards } = deps;
  const {
    config, feishuKnownUsers, pendingReviews, cardMsgRegistry,
    cardActionDedup, messageQueues, registerCardMsg, enqueue,
    totalQueueSize, getReviewQueueSnapshot, consumeReviewQueue,
    assignSymbol, agentSymbols, saveKnownContacts,
  } = s;

  const lark = await import('@larksuiteoapi/node-sdk');
  s.lark = lark;

  const feishuClient = new lark.Client({
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
    disableTokenCache: false,
  });
  s.feishuClient = feishuClient;
  feishuApi.initFeishuApi(feishuClient);

  const eventDispatcher = new lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data) => {
      try {
        const msg = data.message;
        const senderId = data.sender?.sender_id?.open_id;
        const chatId = msg.chat_id;
        const msgType = msg.message_type;
        let textContent = '';
        const attachments = [];
        if (msgType === 'text') {
          try { textContent = JSON.parse(msg.content).text || ''; } catch { textContent = msg.content || ''; }
        } else if (msgType === 'post') {
          try {
            const postBody = JSON.parse(msg.content);
            const lines = [];
            const extractPost = (obj) => {
              if (obj.title) lines.push(obj.title);
              if (Array.isArray(obj.content)) {
                for (const row of obj.content) {
                  if (!Array.isArray(row)) {
                    if (row && typeof row === 'object') {
                      if (row.tag === 'img' && row.image_key) {
                        attachments.push({ content_type: 'image', url: row.image_key, feishu_message_id: msg.message_id, feishu_file_key: row.image_key });
                      } else if (row.tag === 'code_block' && row.text) {
                        lines.push('```' + (row.language || '') + '\n' + row.text + '\n```');
                      } else if (row.tag === 'hr') {
                        lines.push('---');
                      } else if (row.tag === 'md' && row.text) {
                        lines.push(row.text);
                      } else if (row.tag === 'emotion' && row.emoji_type) {
                        lines.push(`[${row.emoji_type}]`);
                      }
                    }
                    continue;
                  }
                  const rowTexts = [];
                  const applyStyle = (txt, style) => {
                    if (!style || !Array.isArray(style) || !txt) return txt;
                    let r = txt;
                    if (style.includes('bold')) r = `**${r}**`;
                    if (style.includes('italic')) r = `*${r}*`;
                    if (style.includes('lineThrough')) r = `~~${r}~~`;
                    return r;
                  };
                  for (const el of row) {
                    if (el.tag === 'text') rowTexts.push(applyStyle(el.text || '', el.style));
                    else if (el.tag === 'a') rowTexts.push(`[${applyStyle(el.text || el.href || '', el.style)}](${el.href || ''})`);
                    else if (el.tag === 'at') rowTexts.push(el.user_name || '');
                    else if (el.tag === 'img' && el.image_key) {
                      attachments.push({ content_type: 'image', url: el.image_key, feishu_message_id: msg.message_id, feishu_file_key: el.image_key });
                    } else if (el.tag === 'media' && el.file_key) {
                      attachments.push({ content_type: 'file', url: el.file_key, feishu_message_id: msg.message_id, feishu_file_key: el.file_key });
                    } else if (el.tag === 'code_block' && el.text) {
                      lines.push(rowTexts.join('')); rowTexts.length = 0;
                      lines.push('```' + (el.language || '') + '\n' + el.text + '\n```');
                    } else if (el.tag === 'hr') {
                      lines.push(rowTexts.join('')); rowTexts.length = 0;
                      lines.push('---');
                    } else if (el.tag === 'md' && el.text) {
                      lines.push(rowTexts.join('')); rowTexts.length = 0;
                      lines.push(el.text);
                    } else if (el.tag === 'emotion' && el.emoji_type) {
                      rowTexts.push(`[${el.emoji_type}]`);
                    }
                  }
                  if (rowTexts.length > 0) lines.push(rowTexts.join(''));
                }
              }
            };
            if (Array.isArray(postBody.content)) {
              extractPost(postBody);
            } else {
              for (const lang of Object.values(postBody || {})) {
                if (lang && typeof lang === 'object' && !Array.isArray(lang)) extractPost(lang);
              }
            }
            textContent = lines.join('\n').trim() || '[富文本消息]';
          } catch { textContent = '[富文本消息]'; }
        } else if (msgType === 'image') {
          try {
            const imgContent = JSON.parse(msg.content);
            if (imgContent.image_key) {
              attachments.push({ content_type: 'image', url: imgContent.image_key, feishu_message_id: msg.message_id, feishu_file_key: imgContent.image_key });
            }
          } catch {}
          textContent = '';
        } else if (msgType === 'file') {
          try {
            const fileContent = JSON.parse(msg.content);
            if (fileContent.file_key) {
              attachments.push({ content_type: 'file', url: fileContent.file_key, feishu_message_id: msg.message_id, feishu_file_key: fileContent.file_key, filename: fileContent.file_name });
            }
          } catch {}
          textContent = `[文件]`;
        } else {
          textContent = `[${msgType}]`;
        }

        const parentId = msg.parent_id || null;
        log.debug(`📩 [飞书] 收到消息: from=${senderId} chat=${chatId} type=${msgType}${parentId ? ` reply_to=${parentId}` : ''} text="${textContent.substring(0, 100)}"`);

        if (senderId) {
          const existing = feishuKnownUsers.get(senderId) || {};
          feishuKnownUsers.set(senderId, { ...existing, lastMsgTs: Date.now(), chatId });
          saveKnownContacts();
        }

        const entry = {
          source: 'feishu', targetId: senderId, chatId,
          msgId: msg.message_id, content: textContent,
          authorId: senderId, attachments, ts: Date.now(), platform: 'feishu',
        };

        if (s.ALLOWED_REVIEWERS.size > 0 && !s.ALLOWED_REVIEWERS.has(senderId)) {
          console.log(`   🚫 用户不在白名单: ${senderId}`);
          return;
        }

        s.recentMessages.push(entry);
        if (s.recentMessages.length > 50) s.recentMessages.shift();

        if (handleBotCommand(textContent, senderId, 'feishu')) return;

        const VIBE_COMMANDS = deps.VIBE_COMMANDS;
        const vibeExpanded = VIBE_COMMANDS[textContent?.trim()];
        if (vibeExpanded) {
          entry.content = vibeExpanded;
          console.log(`   ⚡ Vibe 指令: "${textContent}" → "${vibeExpanded.substring(0, 50)}..."`);
        }

        const unsent = [...pendingReviews.values()].find(r => !r.sent);
        if (unsent) {
          await sendFeishuReviewCard(senderId, unsent);
        }

        let quoteAgent = null;
        if (parentId) {
          const reg = cardMsgRegistry.get(parentId);
          if (reg && reg.agentId) {
            quoteAgent = reg.agentId;
            console.log(`   🔗 引用路由: parent_id=${parentId} → agent=${quoteAgent}`);
          } else if (reg) {
            console.log(`   🔗 引用 server 消息: parent_id=${parentId} type=${reg.type}`);
          }
        }

        const sentReviews = [...pendingReviews.values()].filter(r => r.sent && !r.feedbackReceived);
        if (sentReviews.length > 0) {
          if (quoteAgent && pendingReviews.has(quoteAgent)) {
            const review = pendingReviews.get(quoteAgent);
            if (review.sent && !review.feedbackReceived) {
              receiveFeedback(entry, review);
              const userInfo = feishuKnownUsers.get(senderId);
              if (userInfo) delete userInfo.replyTarget;
              return;
            }
          }
          if (quoteAgent && !pendingReviews.has(quoteAgent)) {
            const queueKey = enqueue(
              { content: textContent, ts: Date.now(), authorId: senderId, attachments, platform: 'feishu', targetId: senderId, chatId, msgId: msg.message_id },
              quoteAgent,
            );
            console.log(`📥 [飞书] 引用路由入队 [${queueKey}] (agent=${quoteAgent} 无 pending review, 总计 ${totalQueueSize()} 条)`);
            return;
          }

          const { agentId, message } = parseAgentRoute(textContent);
          const userInfo = feishuKnownUsers.get(senderId);
          const replyTarget = userInfo?.replyTarget;
          if (agentId && pendingReviews.has(agentId)) {
            const review = pendingReviews.get(agentId);
            if (review.sent && !review.feedbackReceived) {
              entry.content = message;
              receiveFeedback(entry, review);
              if (userInfo) { delete userInfo.replyTarget; }
            }
          } else if (replyTarget && pendingReviews.has(replyTarget)) {
            const review = pendingReviews.get(replyTarget);
            if (review.sent && !review.feedbackReceived) {
              receiveFeedback(entry, review);
              delete userInfo.replyTarget;
            }
          } else if (!agentId && sentReviews.length === 1) {
            receiveFeedback(entry, sentReviews[0]);
          } else if (!agentId && sentReviews.length > 1) {
            const labels = sentReviews.map(r => `\`#${r.agentId}\` ${r.agentLabel}`).join('\n');
            await feishuSendSystemCard(senderId, `🔀 请指定回复目标`, `在消息前加 \`#agent_id\`、引用 Review 卡片回复、或点击「💬 回复反馈」按钮：\n\n${labels}`, 'orange');
          }
        } else if (pendingReviews.size === 0) {
          const queueKey = enqueue(
            { content: textContent, ts: Date.now(), authorId: senderId, attachments, platform: 'feishu', targetId: senderId, chatId, msgId: msg.message_id },
            quoteAgent,
          );
          console.log(`📥 [飞书] 消息加入队列 [${queueKey}] (总计 ${totalQueueSize()} 条)`);
        }
      } catch (err) {
        console.error('[飞书] 消息处理错误:', err.message);
      }
    },

    'card.action.trigger': async (data) => {
      try {
        const event = data.event || data;
        const action = event.action;
        const operator = event.operator;
        const openId = operator?.open_id;
        const value = action?.value;

        const actionKey = `${openId}:${JSON.stringify(value)}`;
        const now = Date.now();
        if (cardActionDedup.get(actionKey) > now - 2000) {
          log.debug(`🔘 [飞书] 卡片交互 (忽略重复): ${actionKey}`);
          return {};
        }
        cardActionDedup.set(actionKey, now);

        log.debug(`🔘 [飞书] 卡片交互: user=${openId} value=${JSON.stringify(value)} form=${action?.form_value ? JSON.stringify(action.form_value) : 'none'} name=${action?.name || 'none'}`);

        if (!openId) return {};
        if (!value && !action?.form_value) return {};

        const agentId = value?.agent_id;
        const actionType = value?.action;

        if (actionType === 'approve' && agentId) {
          const review = pendingReviews.get(agentId);
          if (review && review.sent && !review.feedbackReceived) {
            review.queuedMessages = consumeReviewQueue(agentId);
            const entry = {
              source: 'feishu', targetId: openId, chatId: null,
              msgId: event.context?.open_message_id || '',
              content: '任务完成', authorId: openId, attachments: [], ts: Date.now(), platform: 'feishu',
            };
            receiveFeedback(entry, review);
            const completedCard = buildFeishuCompletedCard(review.agentLabel, review.summary, '任务完成', review.queuedMessages);
            return {
              card: { type: 'raw', data: { config: { update_multi: true }, header: completedCard.header, elements: completedCard.elements } },
            };
          }
          return { toast: { type: 'info', content: '该 Review 已过期' } };
        }

        if (actionType === 'cancel_review' && agentId) {
          const review = pendingReviews.get(agentId);
          if (review) {
            review.feedbackReceived = true;
            review.feedbackTs = Date.now();
            review.feedback = '⏹ [用户手动取消]';
            review.feedbackDisplay = '用户取消';
            for (const cb of review.feedbackCallbacks.splice(0)) {
              cb({ feedback: '⏹ [用户手动取消]', sessionDir: review.sessionDir });
            }
            if (review.feishuCardMsgId) {
              feishuUpdateCardToCompleted(review, '用户手动取消', { isAutoTimeout: true }).catch(() => {});
            }
            pendingReviews.delete(agentId);
            console.log(`⏹ [${agentId}] Review 被用户手动取消`);

            const reviews2 = [...pendingReviews.values()];
            const waiting2 = reviews2.filter(r => r.sent && !r.feedbackReceived);
            const unsent2 = reviews2.filter(r => !r.sent);
            const qTotal2 = totalQueueSize();
            const elements2 = [];
            if (waiting2.length === 0 && unsent2.length === 0 && qTotal2 === 0) {
              elements2.push({ tag: 'markdown', content: '当前没有待处理的 Review 请求，也没有等待中的消息。\n\n*Agent 提交 review 后，这里会显示状态。*' });
            } else {
              for (const r of waiting2) {
                const ago = Math.round((Date.now() - (r.sentTs || r.createdTs)) / 60000);
                const agoText = ago >= 60 ? `${Math.floor(ago / 60)}h${ago % 60}m` : `${ago}m`;
                elements2.push({
                  tag: 'column_set', flex_mode: 'none', background_style: 'default',
                  columns: [
                    { tag: 'column', width: 'weighted', weight: 4, elements: [{ tag: 'markdown', content: `${r.agentLabel}　·　等待 **${agoText}**` }] },
                    { tag: 'column', width: 'weighted', weight: 1, elements: [{ tag: 'button', text: { tag: 'plain_text', content: '↻' }, type: 'text', size: 'small', value: { action: 'resend_review', agent_id: r.agentId } }] },
                    { tag: 'column', width: 'weighted', weight: 1, elements: [{ tag: 'button', text: { tag: 'plain_text', content: '✕' }, type: 'text', size: 'small', value: { action: 'cancel_review', agent_id: r.agentId } }] },
                  ],
                });
              }
              if (unsent2.length > 0) {
                elements2.push({ tag: 'hr' });
                let md = `**📮 待发送**\n`;
                for (const r2 of unsent2) md += `${r2.agentLabel}\n`;
                elements2.push({ tag: 'markdown', content: md });
              }
              if (qTotal2 > 0) {
                elements2.push({ tag: 'hr' });
                const queueCard2 = buildFeishuQueueManageCard();
                elements2.push(...queueCard2.elements);
              }
            }
            const statusLabel2 = waiting2.length > 0
              ? `⏳ ${waiting2.length} 个 Review 等待反馈`
              : (qTotal2 > 0 ? `📥 ${qTotal2} 条等待消息` : '✅ 空闲');
            const templateColor2 = waiting2.length > 0 ? 'orange' : (qTotal2 > 0 ? 'blue' : 'green');

            return {
              toast: { type: 'success', content: `已取消 ${review.agentLabel} 的 Review` },
              card: {
                type: 'raw',
                data: {
                  config: { update_multi: true },
                  header: { title: { tag: 'plain_text', content: statusLabel2 }, template: templateColor2 },
                  elements: elements2,
                },
              },
            };
          }
          return { toast: { type: 'info', content: '该 Review 已过期' } };
        }

        if (actionType === 'resend_review' && agentId) {
          const review = pendingReviews.get(agentId);
          if (review && review.sent && !review.feedbackReceived) {
            const oldMsgId = review.feishuCardMsgId;
            if (oldMsgId) {
              const flushedCard = buildFeishuCompletedCard(review.agentLabel, review.summary, '已刷新，请查看最新卡片', review.queuedMessages, { statusOverride: '🔄 Flushed' });
              feishuApi.patchCard(oldMsgId, flushedCard).catch(() => {});
            }
            const queueMsgs = getReviewQueueSnapshot(agentId);
            const newCard = buildFeishuReviewCard(review.summary, agentId, review.agentLabel, review.timeoutSec, queueMsgs, review.projectPath, review.createdTs);
            try {
              const chatId = feishuKnownUsers.get(openId)?.chatId;
              if (chatId) {
                const cardData = { config: { update_multi: true }, header: newCard.header, elements: newCard.elements };
                const resp = await feishuApi.sendCardToChat(chatId, cardData);
                const newMsgId = resp?.data?.message_id;
                if (newMsgId) {
                  review.feishuCardMsgId = newMsgId;
                  registerCardMsg(newMsgId, agentId, 'review');
                }
              }
            } catch (err) {
              console.log(`⚠ [${agentId}] 重发卡片失败: ${err.message}`);
            }
            review._timeoutHandled = false;
            review.consecutiveTimeouts = 0;
            console.log(`↻ [${agentId}] Review 卡片已重发`);
            return { toast: { type: 'success', content: `已重发 ${review.agentLabel} 的 Review` } };
          }
          return { toast: { type: 'info', content: '该 Review 已过期' } };
        }

        if (actionType === 'feedback' && agentId) {
          const review = pendingReviews.get(agentId);
          if (review && review.sent && !review.feedbackReceived) {
            const userInfo = feishuKnownUsers.get(openId) || {};
            const prevTarget = userInfo.replyTarget;

            if (prevTarget === agentId) {
              delete userInfo.replyTarget;
              feishuKnownUsers.set(openId, userInfo);
              const queueMsgs = getReviewQueueSnapshot(agentId);
              const normalCard = buildFeishuReviewCard(review.summary, agentId, review.agentLabel, review.timeoutSec, queueMsgs, review.projectPath, review.createdTs);
              return {
                card: { type: 'raw', data: { config: { update_multi: true }, header: normalCard.header, elements: normalCard.elements } },
              };
            }

            review.feedbackTargetAgent = agentId;
            feishuKnownUsers.set(openId, { ...userInfo, replyTarget: agentId });

            for (const [otherId, otherReview] of pendingReviews) {
              if (otherId === agentId) continue;
              if (!otherReview.sent || otherReview.feedbackReceived || !otherReview.feishuCardMsgId) continue;
              const otherQueueMsgs = getReviewQueueSnapshot(otherId);
              const normalCard = buildFeishuReviewCard(otherReview.summary, otherId, otherReview.agentLabel, otherReview.timeoutSec, otherQueueMsgs, otherReview.projectPath, otherReview.createdTs);
              feishuApi.patchCard(otherReview.feishuCardMsgId, normalCard).catch(err => console.log(`⚠ 恢复卡片 [${otherId}] 失败: ${err.message}`));
            }

            const selectedCard = buildFeishuFeedbackSelectedCard(review.summary, agentId, review.agentLabel, formatDeadline(review.timeoutSec, review.createdTs), review.projectPath);
            return {
              card: { type: 'raw', data: { config: { update_multi: true }, header: selectedCard.header, elements: selectedCard.elements } },
            };
          }
          return { toast: { type: 'info', content: '该 Review 已过期' } };
        }

        if (actionType === 'clear_all_queue') {
          const count = totalQueueSize();
          messageQueues.clear();
          console.log(`🗑 [飞书] 卡片交互清空所有消息队列 (${count} 条)`);
          refreshPendingReviewCards().catch(err => console.log(`⚠ 刷新 Review 卡片失败: ${err.message}`));
          const updatedCard = buildFeishuQueueManageCard();
          return {
            card: { type: 'raw', data: { config: { update_multi: true }, header: updatedCard.header, elements: updatedCard.elements } },
          };
        }

        if (action?.form_value && action.name === 'delete_checked') {
          const fv = action.form_value;
          const toDeleteMap = new Map();
          for (const [key, val] of Object.entries(fv)) {
            if (val !== true) continue;
            const match = key.match(/^q_(.+?)_(\d+)$/);
            if (match) {
              const qKey = match[1];
              const idx = parseInt(match[2], 10);
              if (!toDeleteMap.has(qKey)) toDeleteMap.set(qKey, new Set());
              toDeleteMap.get(qKey).add(idx);
            }
          }
          if (toDeleteMap.size === 0) {
            return { toast: { type: 'warning', content: '请先勾选要删除的消息' } };
          }
          let totalDeleted = 0;
          for (const [qKey, indices] of toDeleteMap) {
            const queue = messageQueues.get(qKey);
            if (queue) {
              const before = queue.length;
              const filtered = queue.filter((_, i) => !indices.has(i));
              messageQueues.set(qKey, filtered);
              if (filtered.length === 0) messageQueues.delete(qKey);
              totalDeleted += before - filtered.length;
            }
          }
          console.log(`🗑 [飞书] 删除队列消息 (${totalDeleted} 条, 剩余 ${totalQueueSize()} 条)`);
          refreshPendingReviewCards().catch(err => console.log(`⚠ 刷新 Review 卡片失败: ${err.message}`));
          const updatedCard = buildFeishuQueueManageCard();
          return {
            card: { type: 'raw', data: { config: { update_multi: true }, header: updatedCard.header, elements: updatedCard.elements } },
          };
        }

        if (action?.form_value && agentId) {
          const feedbackText = action.form_value.feedback_text;
          if (feedbackText && agentId) {
            const review = pendingReviews.get(agentId);
            if (review && review.sent && !review.feedbackReceived) {
              review.queuedMessages = consumeReviewQueue(agentId);
              const entry = {
                source: 'feishu', targetId: openId, chatId: null,
                msgId: data.event?.context?.open_message_id || '',
                content: feedbackText, authorId: openId, attachments: [], ts: Date.now(), platform: 'feishu',
              };
              receiveFeedback(entry, review);
              return {
                toast: { type: 'success', content: '反馈已提交' },
                card: buildFeishuCompletedCard(review.agentLabel, review.summary, feedbackText, review.queuedMessages),
              };
            }
          }
        }

        return {};
      } catch (err) {
        console.error('[飞书] 卡片回调处理错误:', err.message);
        return {};
      }
    },

    'application.bot.menu_v6': async (data) => {
      try {
        const event = data.event || data;
        const eventKey = event.event_key;
        const openId = event.operator?.operator_id?.open_id;
        console.log(`📋 [飞书] 菜单事件: key=${eventKey} user=${openId}`);
        if (!openId || !eventKey) return;

        const MENU_EVENT_MAP = { check_status: '📊 状态', show_help: '❓ 帮助' };
        const cmdText = MENU_EVENT_MAP[eventKey];
        if (cmdText) {
          handleBotCommand(cmdText, openId, 'feishu');
        } else {
          console.warn(`[飞书] 未识别的菜单 event_key: ${eventKey}`);
        }
      } catch (err) {
        console.error('[飞书] 菜单事件处理错误:', err.message, err.stack);
      }
    },

    'im.chat.access_event.bot_p2p_chat_entered_v1': async (data) => {
      try {
        const event = data.event || data;
        const openId = event.operator_id?.open_id;
        const chatId = event.chat_id;
        if (!openId || !chatId) return;

        console.log(`👋 [飞书] 用户进入会话: user=${openId} chat=${chatId}`);
        const existing = feishuKnownUsers.get(openId) || {};
        const isFirstVisit = !existing.lastMsgTs && !existing.lastEnteredTs;
        feishuKnownUsers.set(openId, { ...existing, chatId, lastEnteredTs: Date.now() });
        saveKnownContacts();

        if (isFirstVisit) {
          await feishuSendSystemCard(openId,
            '👋 欢迎使用 ReviewBot',
            'ReviewBot 是 AI Agent 代码审查助手。\n\n当 Agent 完成任务后，会通过这里发送 Review 请求，等待你的反馈。\n\n使用 `/help` 查看完整使用说明。',
            'blue'
          );
        }
      } catch (err) {
        console.error(`[飞书] 处理用户进入会话事件失败: ${err.message}`);
      }
    },

    'im.message.message_read_v1': async (data) => {
      try {
        const event = data.event || data;
        const readerId = event.reader?.reader_id?.open_id;
        const readTime = event.reader?.read_time;
        const messageIds = event.message_id_list || [];
        if (!readerId || !messageIds.length) return;

        console.log(`👁 [飞书] 消息已读: user=${readerId} msgs=${messageIds.length}`);
        for (const msgId of messageIds) {
          const cardInfo = cardMsgRegistry.get(msgId);
          if (cardInfo?.type === 'review' && cardInfo.agentId) {
            const review = pendingReviews.get(cardInfo.agentId);
            if (review && review.sent && !review.feedbackReceived && !review.readTs) {
              review.readTs = parseInt(readTime) || Date.now();
              review.readBy = readerId;
              console.log(`   [${cardInfo.agentId}] Review 卡片已被用户阅读`);
            }
          }
        }
      } catch (err) {
        console.error(`[飞书] 处理消息已读事件失败: ${err.message}`);
      }
    },

    'im.message.reaction.created_v1': async (data) => {
      try {
        const event = data.event || data;
        const messageId = event.message_id;
        const emojiType = event.reaction_type?.emoji_type;
        const operatorId = event.operator_id?.open_id || event.user_id?.open_id || event.user_id;

        if (!messageId || !emojiType) return;
        console.log(`😀 [飞书] 表情回应: user=${operatorId} msg=${messageId} emoji=${emojiType}`);

        const cardInfo = cardMsgRegistry.get(messageId);
        if (!cardInfo || cardInfo.type !== 'review' || !cardInfo.agentId) return;
        const review = pendingReviews.get(cardInfo.agentId);
        if (!review || !review.sent || review.feedbackReceived) return;

        const COMPLETE_EMOJIS = ['THUMBSUP', 'OK', 'DONE', 'CHECK', 'CHECKMARK', 'YES'];
        const CONTINUE_EMOJIS = ['CYCLE', 'REPEAT', 'ARROWS_COUNTERCLOCKWISE'];
        const LOOKING_EMOJIS = ['EYES', 'LOOKING'];
        const REJECT_EMOJIS = ['THUMBSDOWN', 'CrossMark', 'NO', 'CROSS'];

        if (COMPLETE_EMOJIS.includes(emojiType)) {
          if (review._reactionCompleted) return;
          review._reactionCompleted = true;
          const userId = operatorId || review.replyTargetId || [...feishuKnownUsers.keys()].slice(-1)[0];
          console.log(`   [${cardInfo.agentId}] Reaction → 任务完成 (${emojiType})`);
          receiveFeedback({
            source: 'feishu', targetId: userId, chatId: null, msgId: messageId,
            content: '✅ 任务完成', authorId: userId, attachments: [], ts: Date.now(), platform: 'feishu',
          }, review);
        } else if (CONTINUE_EMOJIS.includes(emojiType)) {
          if (review._reactionCompleted) return;
          review._reactionCompleted = true;
          const userId = operatorId || review.replyTargetId || [...feishuKnownUsers.keys()].slice(-1)[0];
          console.log(`   [${cardInfo.agentId}] Reaction → 继续执行 (${emojiType})`);
          receiveFeedback({
            source: 'feishu', targetId: userId, chatId: null, msgId: messageId,
            content: '🔄 请继续执行当前任务。如有中间结果可通过 /send 发送进展，完成后发起 review request。', authorId: userId,
            attachments: [], ts: Date.now(), platform: 'feishu',
          }, review);
        } else if (LOOKING_EMOJIS.includes(emojiType)) {
          review.readTs = Date.now();
          review.readBy = operatorId;
          console.log(`   [${cardInfo.agentId}] Reaction → 正在查看 (${emojiType})`);
        } else if (REJECT_EMOJIS.includes(emojiType)) {
          console.log(`   [${cardInfo.agentId}] Reaction → 请回复意见 (${emojiType})`);
          if (operatorId) {
            await feishuSendSystemCard(operatorId, '❌ 请回复意见',
              `检测到你对 Review #${cardInfo.agentId} 表示有问题。\n请直接回复具体修改意见。`, 'orange');
          }
        } else {
          review.readTs = review.readTs || Date.now();
          console.log(`   [${cardInfo.agentId}] Reaction 已阅: ${emojiType}`);
        }
      } catch (err) {
        console.error(`[飞书] 处理 Reaction 事件失败: ${err.message}`);
      }
    },

    'im.message.reaction.deleted_v1': async (data) => {
      const event = data.event || data;
      const emojiType = event.reaction_type?.emoji_type;
      const operatorId = event.operator_id?.open_id || event.user_id?.open_id || event.user_id;
      console.log(`😶 [飞书] 取消表情回应: user=${operatorId} emoji=${emojiType}`);
    },

    'im.message.recalled_v1': async (data) => {
      try {
        const event = data.event || data;
        const messageId = event.message_id;
        if (!messageId) return;
        console.log(`🗑 [飞书] 消息撤回: msg=${messageId}`);
        for (const [agentId, review] of pendingReviews) {
          if (!review.feedbackBuffer?.length) continue;
          const idx = review.feedbackBuffer.findIndex(m => m.msgId === messageId);
          if (idx !== -1) {
            const removed = review.feedbackBuffer.splice(idx, 1)[0];
            console.log(`   [${agentId}] 从反馈缓冲区移除撤回消息: "${(removed.content || '').substring(0, 50)}"`);
            break;
          }
        }
        const cardInfo = cardMsgRegistry.get(messageId);
        if (cardInfo) {
          console.log(`   撤回的消息是注册的卡片: type=${cardInfo.type} agent=${cardInfo.agentId}`);
          cardMsgRegistry.delete(messageId);
        }
      } catch (err) {
        console.error(`[飞书] 处理消息撤回事件失败: ${err.message}`);
      }
    },
  });

  const originalInvoke = eventDispatcher.invoke.bind(eventDispatcher);
  eventDispatcher.invoke = function(data) {
    try {
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      const eventType = parsed?.header?.event_type || parsed?.type || 'unknown';
      if (eventType !== 'card.action.trigger') {
        log.debug(`📨 [飞书 SDK] 事件到达: type=${eventType}`);
      }
    } catch {}
    return originalInvoke(data);
  };

  s.feishuWsClient = new lark.WSClient({
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
    loggerLevel: lark.LoggerLevel.WARN,
  });

  await s.feishuWsClient.start({ eventDispatcher });
  s.feishuConnected = true;
  console.log(`✓ [飞书] WebSocket 长连接已建立`);

  // --- Feishu card sending helpers (closures over s) ---
  async function feishuSendSystemCard(openId, title, content, template) {
    const card = buildFeishuSystemCard(title, content, template);
    try {
      const result = await feishuApi.sendCard(openId, card);
      const msgId = result?.data?.message_id;
      if (msgId) registerCardMsg(msgId, null, 'system');
      return result;
    } catch (err) {
      console.error(`[飞书] 发送系统卡片失败: ${err.message}`);
      return null;
    }
  }

  async function sendFeishuReviewCard(openId, review) {
    const queueSnapshot = getReviewQueueSnapshot(review.agentId);
    const queueCount = queueSnapshot?.length || 0;
    console.log(`   [${review.agentId}] 队列展示: ${queueCount} 条 (不消费，保留可编辑)`);

    const card = buildFeishuReviewCard(review.summary, review.agentId, review.agentLabel, review.timeoutSec || config.reviewDefaultTimeout, queueSnapshot, review.projectPath, review.createdTs);
    const result = await feishuApi.sendCard(openId, card);
    if (result) {
      review.sent = true;
      review.sentTs = Date.now();
      review.replySource = 'feishu';
      review.replyTargetId = openId;
      review.feishuCardMsgId = result?.data?.message_id;
      registerCardMsg(review.feishuCardMsgId, review.agentId, 'review');
      console.log(`✓ [${review.agentId}] Review 已通过飞书发送 → ${openId} (msg=${review.feishuCardMsgId}${queueCount ? `, 展示 ${queueCount} 条队列消息` : ''})`);

      feishuApi.pushFollowUp(review.feishuCardMsgId, [
        { content: '✅ 任务完成', i18n_contents: { zh_cn: '✅ 任务完成', en_us: '✅ Task Complete' } },
        { content: '▶️ 继续执行', i18n_contents: { zh_cn: '▶️ 继续执行', en_us: '▶️ Continue' } },
        { content: '❌ 有问题', i18n_contents: { zh_cn: '❌ 有问题', en_us: '❌ Has Issues' } },
      ]).then(() => log.debug(`[飞书] Follow-up bubbles sent for msg=${review.feishuCardMsgId}`)).catch(() => {});

      if (review.sessionDir) {
        const { appendFileSync } = await import('node:fs');
        const { join } = await import('node:path');
        let logLine = `[${new Date().toISOString()}] Review sent via Feishu card to ${openId}`;
        if (queueCount) logLine += ` (displaying ${queueCount} queued messages)`;
        appendFileSync(join(review.sessionDir, 'log.txt'), logLine + '\n');
      }
    }
  }

  // Return the helpers that HTTP routes and other modules need
  return {
    feishuSendSystemCard,
    sendFeishuReviewCard,

    async feishuSendNotificationCard(openId, content, agentId, projectPath) {
      const symbol = assignSymbol(agentId);
      const agentLabel = `${symbol} ${agentId}`;
      const card = buildFeishuNotificationCard(content, agentLabel, projectPath);
      try {
        const result = await feishuApi.sendCard(openId, card);
        const msgId = result?.data?.message_id;
        if (msgId) registerCardMsg(msgId, agentId, 'notification');
        return result;
      } catch (err) {
        console.error(`[飞书] 发送通知卡片失败: ${err.message}`);
        return null;
      }
    },

    async feishuSendText(openId, text, richText = false) {
      const result = await feishuApi.sendText(openId, text, richText);
      const msgId = result?.data?.message_id;
      if (msgId) registerCardMsg(msgId, null, 'notification');
    },

    feishuSendCard: (openId, card) => feishuApi.sendCard(openId, card),

    async feishuUpdateCardToCompleted(review, feedback, opts = {}) {
      if (!review.feishuCardMsgId || !feishuApi.getClient()) return;
      const completedCard = buildFeishuCompletedCard(review.agentLabel, review.summary, feedback, review.queuedMessages, opts);
      await feishuApi.patchCard(review.feishuCardMsgId, completedCard);
      console.log(`✓ [${review.agentId}] 飞书卡片已更新为${opts.isAutoTimeout ? '超时' : '完成'}状态`);
    },

    async feishuSendReminder(review, message) {
      const [userId] = [...feishuKnownUsers.keys()].slice(-1);
      if (userId) {
        try {
          const card = {
            header: { title: { tag: 'plain_text', content: `${review.agentLabel} | ⏰ Reminder` }, template: 'orange' },
            elements: [{ tag: 'markdown', content: toFeishuMarkdown(message) }],
          };
          const result = await feishuApi.sendCard(userId, card);
          const msgId = result?.data?.message_id;
          if (msgId) registerCardMsg(msgId, review.agentId, 'reminder');
        } catch (err) {
          console.error(`[飞书] 发送提醒失败: ${err.message}`);
        }
      }
    },

    feishuUrgentMessage: (messageId, userIds) => feishuApi.urgentMessage(messageId, userIds),

    feishuAddReaction: (messageId, emojiType) => feishuApi.addReaction(messageId, emojiType),

    refreshPendingReviewCards,
  };
}
