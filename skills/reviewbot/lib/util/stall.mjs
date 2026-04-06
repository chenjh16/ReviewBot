/**
 * Stall-message generator — combinatorial "reviewer needs more time" phrases.
 */

const STALL_OPENERS = [
  '收到，reviewer 还在审查中',
  '好的，reviewer 仍在仔细审阅',
  'reviewer 正在认真查看你的提交',
  '请稍候，reviewer 还需要一些时间',
  '了解，reviewer 尚未完成审查',
  'reviewer 还在分析中，请耐心等待',
  '审查仍在进行中，请继续等候',
];

const STALL_REASONS = [
  '内容比较多，需要逐项核对',
  '涉及的改动面较广，需要仔细评估',
  '需要对照之前的上下文来审查',
  '正在测试和验证具体的改动效果',
  '一些细节需要反复确认',
  '需要结合整体架构来考量',
  '可能还需要参考一些文档和代码',
];

const STALL_CLOSERS = [
  '请继续耐心等待反馈',
  '稍后会给出具体意见',
  '预计很快就会有回复',
  '请不要中断当前的等待流程',
  '你可以在此期间继续其他准备工作',
  '感谢你的耐心配合',
  '收到反馈后会立即通知你',
];

export function generateStallMessage(attempt) {
  const o = STALL_OPENERS[attempt % STALL_OPENERS.length];
  const r = STALL_REASONS[(attempt * 3 + 1) % STALL_REASONS.length];
  const c = STALL_CLOSERS[(attempt * 5 + 2) % STALL_CLOSERS.length];
  return `${o}，${r}。${c}`;
}
