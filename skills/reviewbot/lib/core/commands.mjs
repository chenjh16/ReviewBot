/**
 * Bot commands (status, help, new, stop) and VIBE_COMMANDS quick replies.
 * Also includes buildFeishuQueueManageCard for the interactive queue management card.
 */
import {
  formatQueueMsgText,
  buildFeishuReviewCard,
} from '../feishu/cards.mjs';
import * as feishuApi from '../feishu/api.mjs';

export const BOT_COMMANDS = {
  '📊 状态': 'status', '📊 查看状态': 'status', '/status': 'status',
  '❓ 帮助': 'help', '/help': 'help',
  '📥 队列': 'status', '📥 管理队列': 'status', '/queue': 'status',
  '/new': 'new', '/stop': 'stop',
};

export const VIBE_COMMANDS = {
  '✅ 任务完成': '任务完成',
  '▶️ 继续执行': '请继续执行当前任务。如有中间结果可通过 /send 发送进展，完成后发起 review request。',
  '📝 更新文档': '请同步更新相关文档，确保文档与当前代码实现保持一致。需要检查项目中所有的 .md 文件（包括 README.md、AGENTS.md、SKILL.md、docs/ 目录等），逐一对比代码实现，修正过时或缺失的内容。完成后发起 review request。',
  '🧪 端到端测试': '请完成端到端测试，验证所有功能正常工作，确保没有回归问题。如有测试失败，请修复后重新测试。完成后发起 review request。',
  '📦 提交代码': '请提交当前的代码变更。使用简洁、有意义的 commit message 描述本次修改内容。提交完成后发起 review request。',
};

/**
 * Build Feishu queue management card.
 * @param {object} s - shared state
 */
export function buildFeishuQueueManageCard(s) {
  const total = s.totalQueueSize();
  const elements = [];
  if (total === 0) {
    const hasActiveReviews = [...s.pendingReviews.values()].some(r => r.sent && !r.feedbackReceived);
    let emptyMsg = '当前没有等待中的消息。';
    if (hasActiveReviews) {
      emptyMsg += '\n\n*队列消息会随 Review 请求一并发送给 Agent，发送后自动清空。*';
    }
    elements.push({ tag: 'markdown', content: emptyMsg });
  } else {
    const formElements = [];
    const sortedKeys = [...s.messageQueues.keys()].sort((a, b) => {
      if (a === '_general') return 1;
      if (b === '_general') return -1;
      return a.localeCompare(b);
    });
    for (const qKey of sortedKeys) {
      const queue = s.messageQueues.get(qKey);
      if (!queue || queue.length === 0) continue;
      const symbol = qKey !== '_general' ? (s.agentSymbols.get(qKey) || '📨') : '📨';
      const label = qKey !== '_general' ? `${symbol} ${qKey} (${queue.length})` : `${symbol} 通用 (${queue.length})`;
      formElements.push({ tag: 'markdown', content: `**${label}**` });
      for (let i = 0; i < queue.length; i++) {
        const m = queue[i];
        const time = new Date(m.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        const displayText = formatQueueMsgText(m, 60);
        formElements.push({
          tag: 'checker',
          name: `q_${qKey}_${i}`,
          checked: false,
          text: { tag: 'plain_text', content: `[${time}] ${displayText}` },
          checked_style: { show_strikethrough: true, opacity: 0.4 },
          behaviors: [{ type: 'callback', value: { action: 'queue_check', queue: qKey, index: i } }],
        });
      }
    }
    formElements.push({ tag: 'hr' });
    formElements.push({
      tag: 'column_set', flex_mode: 'none', horizontal_spacing: 'default',
      columns: [
        { tag: 'column', width: 'auto', vertical_align: 'top', elements: [{ tag: 'button', text: { tag: 'plain_text', content: '🗑 删除选中' }, type: 'primary', action_type: 'form_submit', name: 'delete_checked' }] },
        { tag: 'column', width: 'auto', vertical_align: 'top', elements: [{ tag: 'button', text: { tag: 'plain_text', content: '🗑 清空全部' }, type: 'danger', value: { action: 'clear_all_queue' }, name: 'clear_all_queue' }] },
      ],
    });
    elements.push({ tag: 'form', name: 'queue_manage_form', elements: formElements });
  }
  return {
    header: {
      title: { tag: 'plain_text', content: total > 0 ? `📥 等待队列 · ${total} 条` : '📥 等待队列 · 空' },
      template: total > 0 ? 'blue' : 'grey',
    },
    elements,
  };
}

/**
 * Handle bot text commands.
 * @param {string} text
 * @param {string|object} target - Feishu: openId string; QQ: entry object
 * @param {'feishu'|'qqbot'} platform
 * @param {object} s - shared state
 * @param {object} feishu - Feishu helpers from initFeishu
 * @param {Function} sendAckToUser - QQ ack function
 * @param {Function} receiveFeedback
 */
export function handleBotCommand(text, target, platform, s, feishu, sendAckToUser, receiveFeedback) {
  const cmd = BOT_COMMANDS[text?.trim()];
  if (!cmd) return false;

  const { pendingReviews, feishuKnownUsers, totalQueueSize, allQueuedMessages, getReviewQueueSnapshot, registerCardMsg } = s;

  const sendReply = (msg) => {
    if (platform === 'feishu') {
      feishu.feishuSendSystemCard(target, 'ReviewBot', msg, 'blue').catch(() => {});
    } else {
      sendAckToUser(target, msg);
    }
  };

  if (cmd === 'status') {
    const reviews = [...pendingReviews.values()];
    const waiting = reviews.filter(r => r.sent && !r.feedbackReceived);
    const unsent = reviews.filter(r => !r.sent);
    const qTotal = totalQueueSize();

    if (platform === 'feishu') {
      const elements = [];
      if (waiting.length === 0 && unsent.length === 0 && qTotal === 0) {
        elements.push({ tag: 'markdown', content: '当前没有待处理的 Review 请求，也没有等待中的消息。\n\n*Agent 提交 review 后，这里会显示状态。*' });
      } else {
        if (waiting.length > 0) {
          for (const r of waiting) {
            const ago = Math.round((Date.now() - (r.sentTs || r.createdTs)) / 60000);
            const agoText = ago >= 60 ? `${Math.floor(ago / 60)}h${ago % 60}m` : `${ago}m`;
            elements.push({
              tag: 'column_set', flex_mode: 'none', background_style: 'default',
              columns: [
                { tag: 'column', width: 'weighted', weight: 4, elements: [{ tag: 'markdown', content: `${r.agentLabel}　·　等待 **${agoText}**` }] },
                { tag: 'column', width: 'weighted', weight: 1, elements: [{ tag: 'button', text: { tag: 'plain_text', content: '↻' }, type: 'text', size: 'small', value: { action: 'resend_review', agent_id: r.agentId } }] },
                { tag: 'column', width: 'weighted', weight: 1, elements: [{ tag: 'button', text: { tag: 'plain_text', content: '✕' }, type: 'text', size: 'small', value: { action: 'cancel_review', agent_id: r.agentId } }] },
              ],
            });
          }
        }
        if (unsent.length > 0) {
          elements.push({ tag: 'hr' });
          let md = `**📮 待发送**\n`;
          for (const r of unsent) md += `${r.agentLabel}\n`;
          elements.push({ tag: 'markdown', content: md });
        }
        if (qTotal > 0) {
          elements.push({ tag: 'hr' });
          const queueCard = buildFeishuQueueManageCard(s);
          elements.push(...queueCard.elements);
        }
      }
      const statusLabel = waiting.length > 0
        ? `⏳ ${waiting.length} 个 Review 等待反馈`
        : (qTotal > 0 ? `📥 ${qTotal} 条等待消息` : '✅ 空闲');
      const templateColor = waiting.length > 0 ? 'orange' : (qTotal > 0 ? 'blue' : 'green');
      const card = {
        header: { title: { tag: 'plain_text', content: statusLabel }, template: templateColor },
        elements,
      };
      feishu.feishuSendCard(target, card).then(r => {
        if (r) { registerCardMsg(r?.data?.message_id, null, 'system'); console.log(`✓ 状态卡片已发送`); }
      }).catch(err => console.error('[飞书] 发送状态卡片失败:', err.message));
    } else {
      let msg = '📊 ReviewBot 状态\n\n';
      if (waiting.length === 0 && unsent.length === 0) {
        msg += '当前没有待处理的 Review 请求。';
      } else {
        if (waiting.length > 0) {
          msg += `⏳ 等待反馈 (${waiting.length})：\n`;
          for (const r of waiting) {
            const ago = Math.round((Date.now() - (r.sentTs || r.createdTs)) / 60000);
            msg += `  ${r.agentLabel} — 等待 ${ago} 分钟\n`;
          }
        }
        if (unsent.length > 0) {
          msg += `📮 待发送 (${unsent.length})：\n`;
          for (const r of unsent) msg += `  ${r.agentLabel}\n`;
        }
      }
      if (qTotal > 0) {
        const allMsgs = allQueuedMessages();
        msg += `\n📥 等待队列 (${qTotal} 条)：\n`;
        for (const m of allMsgs.slice(-5)) {
          const time = new Date(m.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
          const prefix = m._queueKey !== '_general' ? `[${m._queueKey}] ` : '';
          msg += `  [${time}] ${prefix}${formatQueueMsgText(m, 50)}\n`;
        }
        if (qTotal > 5) msg += `  ...共 ${qTotal} 条\n`;
      }
      sendReply(msg);
    }
    return true;
  }

  if (cmd === 'help') {
    if (platform === 'feishu') {
      const card = {
        header: { title: { tag: 'plain_text', content: 'ReviewBot 使用指南' }, template: 'violet' },
        elements: [
          { tag: 'markdown', content: '**💬 如何回复 Agent**\n直接发送文字即可回复当前选中的 Agent。\n也可以**引用** Review 卡片回复，自动路由到对应 Agent。' },
          { tag: 'hr' },
          { tag: 'markdown', content: '**🎯 多 Agent 路由**\n• 点击 Review 卡片上的 **「💬 回复反馈」** 选中目标\n• 或在消息前加 `#agent_id`（如 `#my-project 继续`）' },
          { tag: 'hr' },
          { tag: 'markdown', content: '**📎 附件反馈**\n直接发送图片或文件，会附带给 Agent。支持图文混排。' },
          { tag: 'hr' },
          { tag: 'markdown', content: '**🎛 快捷菜单**\n输入框旁的悬浮菜单：' },
          { tag: 'markdown', content: '1. 📊 **状态** — Review 进度和队列管理\n2. ❓ **帮助** — 显示本指南\n3. ⚡ **指令** — Vibe Coding 快捷回复：\n   - ✅ 任务完成\n   - ▶️ 继续执行\n   - 📝 更新文档\n   - 🧪 端到端测试\n   - 📦 提交代码' },
          { tag: 'hr' },
          { tag: 'markdown', content: '**🔘 卡片按钮**\n• **✔ 请反馈** — 选中后，后续消息发送给该 Agent\n• **✕** — 取消等待中的 Review' },
          { tag: 'hr' },
          { tag: 'markdown', content: '**⌨️ 文本命令**\n手动输入：\n- `/status` — 查看 Review 状态\n- `/help` — 显示本指南\n- `/new` — 开始新对话\n- `/stop` — 停止当前 Agent' },
        ],
      };
      feishu.feishuSendCard(target, card).then(r => {
        if (r) registerCardMsg(r?.data?.message_id, null, 'system');
      }).catch(err => console.error('[飞书] 发送帮助卡片失败:', err.message));
    } else {
      sendReply('❓ ReviewBot 帮助\n\n'
        + '💬 直接发送文字回复当前 Agent\n'
        + '🎯 #agent_id 消息 → 指定回复目标\n'
        + '📎 发送图片/文件 → 附件反馈\n'
        + '📊 /status → 查看 Review 状态\n'
        + '⌨️ /new 新对话 · /stop 停止 Agent');
    }
    return true;
  }

  if (cmd === 'new') {
    if (platform === 'feishu') {
      const userInfo = feishuKnownUsers.get(target);
      const prevTarget = userInfo?.replyTarget;
      if (prevTarget) {
        delete userInfo.replyTarget;
        feishuKnownUsers.set(target, userInfo);
        const review = pendingReviews.get(prevTarget);
        if (review?.feishuCardMsgId) {
          const queueMsgs = getReviewQueueSnapshot(prevTarget);
          const normalCard = buildFeishuReviewCard(review.summary, prevTarget, review.agentLabel, review.timeoutSec, queueMsgs, review.projectPath, review.createdTs);
          feishuApi.patchCard(review.feishuCardMsgId, normalCard).catch(() => {});
        }
        feishu.feishuSendSystemCard(target, '🔄 已重置', `已取消选择 ${prevTarget}，可以重新选择反馈对象。`, 'blue').catch(() => {});
      } else {
        feishu.feishuSendSystemCard(target, '🔄 当前无选中', '当前没有选中的反馈对象。\n收到 Review 卡片后，点击「✔ 请反馈」选择目标。', 'grey').catch(() => {});
      }
    } else {
      sendReply('🔄 已重置反馈选择，可以重新选择目标 Agent。');
    }
    return true;
  }

  if (cmd === 'stop') {
    const sentReviews = [...pendingReviews.values()].filter(r => r.sent && !r.feedbackReceived);
    if (sentReviews.length === 0) {
      if (platform === 'feishu') {
        feishu.feishuSendSystemCard(target, '⏹ 无待处理', '当前没有等待反馈的 Review 请求。', 'grey').catch(() => {});
      } else {
        sendReply('⏹ 当前没有等待反馈的 Review 请求。');
      }
      return true;
    }
    let dismissed = 0;
    for (const review of sentReviews) {
      receiveFeedback({ content: '⏹ [用户手动终止]', ts: Date.now(), source: 'feishu' }, review);
      dismissed++;
    }
    if (platform === 'feishu') {
      const userInfo = feishuKnownUsers.get(target);
      if (userInfo?.replyTarget) {
        delete userInfo.replyTarget;
        feishuKnownUsers.set(target, userInfo);
      }
      feishu.feishuSendSystemCard(target, '⏹ 已终止', `已终止 ${dismissed} 个等待中的 Review 请求。\nAgent 将收到终止通知。`, 'red').catch(() => {});
    } else {
      sendReply(`⏹ 已终止 ${dismissed} 个等待中的 Review 请求。`);
    }
    return true;
  }

  return false;
}
