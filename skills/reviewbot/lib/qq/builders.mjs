/**
 * QQ Bot payload builders — pure functions, no I/O, no shared state.
 */

import { formatDeadline } from '../feishu/cards.mjs';

export function buildArkPayload(title, lines) {
  return {
    template_id: 23,
    kv: [
      { key: '#DESC#', value: title },
      { key: '#PROMPT#', value: title },
      { key: '#LIST#', obj: lines.map(line => ({ obj_kv: [{ key: 'desc', value: line }] })) },
    ],
  };
}

export function buildReviewKeyboard(agentId, symbol) {
  return {
    content: {
      rows: [{
        buttons: [
          {
            id: `approve_${agentId}`,
            render_data: { label: '✅ 任务完成', visited_label: '✅ 已确认', style: 1 },
            action: {
              type: 2, permission: { type: 2 },
              data: `#${agentId} 任务完成`,
              enter: true,
              unsupport_tips: `请回复 #${agentId} 任务完成`,
            },
          },
          {
            id: `revise_${agentId}`,
            render_data: { label: '🔄 回复反馈', visited_label: '🔄 已回复', style: 0 },
            action: {
              type: 2, permission: { type: 2 },
              data: `#${agentId} `,
              enter: false,
              unsupport_tips: `请回复 #${agentId} 你的反馈`,
            },
          },
        ],
      }],
    },
  };
}

export const REVIEW_DECORATIONS = [
  '📋', '🔍', '✨', '🎯', '📝', '💡', '🔖', '📌', '🧩', '🎲',
  '⚡', '🌟', '🔔', '📎', '🏷️', '🪄', '🎪', '🧪', '🔬', '🎨',
];

export function buildReviewText(summary, timeoutSec, agentLabel = null, createdTs = null) {
  const deadlineStr = formatDeadline(timeoutSec, createdTs);
  if (agentLabel) {
    return `# ${agentLabel} | Review Request\n\n${summary}\n\n---\n*请回复您的审查意见，截止 ${deadlineStr}*`;
  }
  const deco = REVIEW_DECORATIONS[Math.floor(Math.random() * REVIEW_DECORATIONS.length)];
  return `# ${deco} Review Request\n\n${summary}\n\n---\n*请回复您的审查意见，截止 ${deadlineStr}*`;
}
