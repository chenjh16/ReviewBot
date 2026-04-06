/**
 * Feishu card builders — pure functions that construct card JSON payloads.
 * No side effects, no shared state, no I/O.
 */

export function formatQueueMsgText(m, maxLen = 100) {
  let text = (m.content || '').substring(0, maxLen);
  const hasAtt = m.attachments?.length > 0;
  if (!text && hasAtt) {
    const imgCount = m.attachments.filter(a => a.content_type === 'image').length;
    const fileCount = m.attachments.length - imgCount;
    const parts = [];
    if (imgCount > 0) parts.push(`[图片×${imgCount}]`);
    if (fileCount > 0) parts.push(`[文件×${fileCount}]`);
    text = parts.join(' ');
  } else if (text && hasAtt) {
    text += ` 📎${m.attachments.length}`;
  }
  return text || '[消息]';
}

export function formatProjectPath(projectPath) {
  if (!projectPath) return null;
  const parts = projectPath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 2) return `📁 …/${parts.join('/')}`;
  return `📁 …/${parts.slice(-3).join('/')}`;
}

export function toFeishuMarkdown(text) {
  return (text || '')
    .replace(/\\n/g, '\n')
    .replace(/^#{1,6}\s+(.+)$/gm, '**$1**')
    .replace(/^(\|.+\|)\s*$/gm, (line) => {
      if (/^\|[\s:|-]+\|$/.test(line.trim())) return '';
      return line.replace(/\|/g, '｜').trim();
    })
    .replace(/\n{3,}/g, '\n\n');
}

export function formatDeadline(timeoutSec, createdTs = null) {
  const base = createdTs || Date.now();
  const deadline = new Date(base + timeoutSec * 1000);
  return deadline.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
}

export function buildFeishuReviewCard(summary, agentId, agentLabel, timeoutSec, queuedMessages, projectPath, createdTs) {
  const deadlineStr = formatDeadline(timeoutSec, createdTs);
  const formattedSummary = toFeishuMarkdown(summary);
  const pathNote = formatProjectPath(projectPath);
  const elements = [];
  if (pathNote) {
    elements.push({ tag: 'markdown', content: `<font color="grey">${pathNote}</font>` });
  }
  elements.push({ tag: 'markdown', content: formattedSummary });
  if (queuedMessages && queuedMessages.length > 0) {
    elements.push({ tag: 'hr' });
    const queueText = queuedMessages.map(m => {
      const time = new Date(m.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      return `[${time}] ${formatQueueMsgText(m)}`;
    }).join('\n');
    elements.push({ tag: 'markdown', content: `📥 **等待队列** (${queuedMessages.length} 条)\n${queueText}` });
  }
  elements.push({ tag: 'hr' });
  elements.push({ tag: 'markdown', content: `*请回复审查意见，截止 ${deadlineStr}*` });
  elements.push({
    tag: 'action',
    layout: 'bisected',
    actions: [
      {
        tag: 'button',
        text: { tag: 'plain_text', content: '✅ 任务完成' },
        type: 'primary',
        value: { action: 'approve', agent_id: agentId },
      },
      {
        tag: 'button',
        text: { tag: 'plain_text', content: '💬 回复反馈' },
        type: 'default',
        value: { action: 'feedback', agent_id: agentId },
      },
    ],
  });
  return {
    header: {
      title: { tag: 'plain_text', content: `${agentLabel} | 📝 Review Request` },
      template: 'blue',
    },
    elements,
  };
}

export function buildFeishuFeedbackSelectedCard(summary, agentId, agentLabel, deadlineStr, projectPath) {
  const formattedSummary = toFeishuMarkdown(summary);
  const pathNote = formatProjectPath(projectPath);
  const elements = [];
  if (pathNote) elements.push({ tag: 'markdown', content: `<font color="grey">${pathNote}</font>` });
  elements.push({ tag: 'markdown', content: formattedSummary });
  return {
    header: {
      title: { tag: 'plain_text', content: `${agentLabel} | 💬 Selected` },
      template: 'orange',
    },
    elements: [
      ...elements,
      { tag: 'hr' },
      ...(deadlineStr ? [{ tag: 'markdown', content: `*请回复审查意见，截止 ${deadlineStr}*` }] : []),
      {
        tag: 'action',
        layout: 'bisected',
        actions: [
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '✅ 任务完成' },
            type: 'default',
            disabled: true,
            value: { action: 'approve', agent_id: agentId },
          },
          {
            tag: 'button',
            text: { tag: 'plain_text', content: '✔ 请反馈' },
            type: 'danger',
            value: { action: 'feedback', agent_id: agentId },
          },
        ],
      },
    ],
  };
}

export function buildFeishuCompletedCard(agentLabel, summary, feedback, queuedMessages, { isAutoTimeout = false, statusOverride = null } = {}) {
  const fmtSummary = toFeishuMarkdown(summary);
  const fmtFeedback = toFeishuMarkdown(feedback);
  const elements = [
    { tag: 'markdown', content: `**摘要：**\n${fmtSummary}` },
  ];
  elements.push({ tag: 'hr' });
  let feedbackContent = '';
  if (queuedMessages && queuedMessages.length > 0) {
    const queueText = queuedMessages.map(m => {
      const time = new Date(m.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      return `[${time}] ${formatQueueMsgText(m)}`;
    }).join('\n');
    feedbackContent += `📥 等待队列 (${queuedMessages.length} 条)\n${queueText}\n\n`;
  }
  feedbackContent += fmtFeedback;
  elements.push({ tag: 'markdown', content: `**反馈：**\n${feedbackContent}` });
  elements.push({ tag: 'hr' });
  elements.push({ tag: 'markdown', content: `*${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}*` });

  const headerTitle = statusOverride
    ? `${agentLabel} | ${statusOverride}`
    : (isAutoTimeout ? `${agentLabel} | ⏰ Timeout` : `${agentLabel} | ✅ Completed`);
  const headerTemplate = statusOverride ? 'blue' : (isAutoTimeout ? 'orange' : 'green');

  return {
    header: {
      title: { tag: 'plain_text', content: headerTitle },
      template: headerTemplate,
    },
    elements,
  };
}

export function buildFeishuNotificationCard(content, agentLabel, projectPath) {
  const formattedContent = toFeishuMarkdown(content);
  const pathNote = formatProjectPath(projectPath);
  const elements = [];
  if (pathNote) {
    elements.push({ tag: 'markdown', content: `<font color="grey">${pathNote}</font>` });
  }
  elements.push({ tag: 'markdown', content: formattedContent });
  elements.push({ tag: 'hr' });
  elements.push({ tag: 'markdown', content: `*${new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })}*` });
  return {
    header: {
      title: { tag: 'plain_text', content: `${agentLabel} | 💬 Notification` },
      template: 'turquoise',
    },
    elements,
  };
}

export function buildFeishuSystemCard(title, content, template = 'indigo') {
  const formattedContent = toFeishuMarkdown(content);
  return {
    header: {
      title: { tag: 'plain_text', content: title },
      template,
    },
    elements: [
      { tag: 'markdown', content: formattedContent },
    ],
  };
}
