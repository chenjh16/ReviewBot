#!/usr/bin/env node
/**
 * ReviewBot Server - Multi-platform review service (Feishu + QQ Bot).
 *
 * Supports Feishu (via WebSocket SDK) and QQ Bot (via WebSocket API).
 * Feishu is the default when FEISHU_APP_ID/SECRET are configured.
 * Provides an HTTP API for sending review requests and collecting feedback.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createState } from './lib/core/state.mjs';
import { initFeishu } from './lib/feishu/ws.mjs';
import { initQQApi, getToken } from './lib/qq/api.mjs';
import { initMedia, closeBrowser } from './lib/util/media.mjs';
import { handleBotCommand, buildFeishuQueueManageCard, VIBE_COMMANDS } from './lib/core/commands.mjs';
import { connectWs, stopHeartbeat, registerQQEventHandler } from './lib/qq/ws.mjs';
import { receiveFeedback, sendAckToUser } from './lib/core/feedback.mjs';
import { createHttpServer } from './lib/core/server.mjs';
import { buildFeishuReviewCard } from './lib/feishu/cards.mjs';
import * as feishuApi from './lib/feishu/api.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Load .env ───
const envFile = join(__dirname, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// ─── Configuration ───
const envInt = (key, def) => { const v = process.env[key]; return v ? parseInt(v, 10) : def; };

const CONFIG = {
  feishu: {
    appId:     process.env.FEISHU_APP_ID || '',
    appSecret: process.env.FEISHU_APP_SECRET || '',
  },
  qq: {
    appId:     process.env.QQBOT_APP_ID || '',
    appSecret: process.env.QQBOT_APP_SECRET || '',
  },
  port:                    envInt('REVIEWBOT_PORT', 0),
  reviewDefaultTimeout:    envInt('REVIEW_DEFAULT_TIMEOUT', 300),
  maxConsecutiveTimeouts:  envInt('MAX_CONSECUTIVE_TIMEOUTS', 12),
  queueMaxPerAgent:        envInt('QUEUE_MAX_PER_AGENT', 50),
  feedbackSilenceTimeout:  envInt('FEEDBACK_SILENCE_TIMEOUT', 300) * 1000,
  reviewMaxTtl:            envInt('REVIEW_MAX_TTL_HOURS', 24) * 3600_000,
  allowedReviewers:        (process.env.ALLOWED_REVIEWERS || '').split(',').map(s => s.trim()).filter(Boolean),
  chromePath:              process.env.CHROME_PATH || '',
};

// ─── Logging ───
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LOG_LEVEL = LOG_LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LOG_LEVELS.info;

const log = {
  debug: (...args) => { if (LOG_LEVEL <= LOG_LEVELS.debug) console.log('[DEBUG]', ...args); },
  info:  (...args) => { if (LOG_LEVEL <= LOG_LEVELS.info)  console.log(...args); },
  warn:  (...args) => { if (LOG_LEVEL <= LOG_LEVELS.warn)  console.log('⚠', ...args); },
  error: (...args) => { if (LOG_LEVEL <= LOG_LEVELS.error) console.error(...args); },
};

// ─── Platform flags ───
const USE_FEISHU = !!(CONFIG.feishu.appId && CONFIG.feishu.appSecret);
const USE_QQ = !!(CONFIG.qq.appId && CONFIG.qq.appSecret);

if (!USE_FEISHU && !USE_QQ) {
  console.error('❌ 必须设置 FEISHU_APP_ID/SECRET 或 QQBOT_APP_ID/SECRET');
  process.exit(1);
}

// ─── Initialize modules ───
if (USE_QQ) initQQApi(CONFIG.qq.appId, CONFIG.qq.appSecret);
initMedia(CONFIG.chromePath);

// ─── Shared state ───
const s = createState(CONFIG, __dirname);
mkdirSync(s.SESSIONS_DIR, { recursive: true });
s.loadState();

// ─── Feishu card refresh helper (needed by commands + feishu-ws) ───
async function refreshPendingReviewCards() {
  if (!feishuApi.getClient()) return;
  for (const [agentId, review] of s.pendingReviews) {
    if (!review.sent || review.feedbackReceived || !review.feishuCardMsgId) continue;
    const userInfo = review.replyTargetId ? s.feishuKnownUsers.get(review.replyTargetId) : null;
    if (userInfo?.replyTarget === agentId) continue;
    const queueMsgs = s.getReviewQueueSnapshot(agentId);
    const card = buildFeishuReviewCard(review.summary, agentId, review.agentLabel, review.timeoutSec, queueMsgs, review.projectPath, review.createdTs);
    await feishuApi.patchCard(review.feishuCardMsgId, card);
  }
}

// Forward-declared feishu helpers (populated after initFeishu)
let feishu = null;

// ─── Bound callbacks (closures over s, feishu) ───
const boundHandleBotCommand = (text, target, platform) =>
  handleBotCommand(text, target, platform, s, feishu, (msg, txt) => sendAckToUser(msg, txt, s, feishu), boundReceiveFeedback);

const boundReceiveFeedback = (entry, review) =>
  receiveFeedback(entry, review, s, feishu, USE_FEISHU);

// ─── Main ───
async function main() {
  const platform = USE_FEISHU ? '飞书' : 'QQ Bot';
  console.log(`🤖 ReviewBot Server (${platform}) 启动中...`);

  if (USE_FEISHU) {
    console.log(`   飞书 App ID: ${CONFIG.feishu.appId}`);
    try {
      feishu = await initFeishu(s, {
        log,
        handleBotCommand: boundHandleBotCommand,
        receiveFeedback: boundReceiveFeedback,
        buildFeishuQueueManageCard: () => buildFeishuQueueManageCard(s),
        refreshPendingReviewCards,
        VIBE_COMMANDS,
      });
    } catch (err) {
      console.error(`❌ 飞书初始化失败: ${err.message}`);
      if (!USE_QQ) process.exit(1);
      console.log('↓ 回退到 QQ Bot...');
    }
  }

  // Provide a minimal feishu object for QQ-only mode
  if (!feishu) {
    feishu = {
      feishuSendSystemCard: async () => null,
      sendFeishuReviewCard: async () => {},
      feishuSendNotificationCard: async () => null,
      feishuSendText: async () => {},
      feishuSendCard: async () => null,
      feishuUpdateCardToCompleted: async () => {},
      feishuSendReminder: async () => {},
      feishuUrgentMessage: async () => false,
      feishuAddReaction: async () => null,
      refreshPendingReviewCards: async () => {},
    };
  }

  if (USE_QQ && (!USE_FEISHU || !s.feishuConnected)) {
    console.log(`   QQ Bot AppID: ${CONFIG.qq.appId}`);
    s.loadKnownContacts();
    registerQQEventHandler(s, {
      handleBotCommand: boundHandleBotCommand,
      receiveFeedback: boundReceiveFeedback,
      sendAckToUser: (msg, txt) => sendAckToUser(msg, txt, s, feishu),
    });
    await getToken();
    await connectWs(s);
  } else if (USE_QQ && s.feishuConnected) {
    console.log(`   QQ Bot 可用但飞书已连接，QQ Bot 作为备用`);
    s.loadKnownContacts();
    registerQQEventHandler(s, {
      handleBotCommand: boundHandleBotCommand,
      receiveFeedback: boundReceiveFeedback,
      sendAckToUser: (msg, txt) => sendAckToUser(msg, txt, s, feishu),
    });
  }

  const httpServer = createHttpServer(s, feishu, boundReceiveFeedback, USE_FEISHU, USE_QQ);

  httpServer.timeout = 0;
  httpServer.requestTimeout = 0;
  httpServer.headersTimeout = 0;
  httpServer.keepAliveTimeout = 0;
  httpServer.listen(CONFIG.port, '127.0.0.1', () => {
    const actualPort = httpServer.address().port;
    writeFileSync(s.PORT_FILE, String(actualPort));
    console.log(`\n🌐 HTTP API: http://127.0.0.1:${actualPort}  (port file: ${s.PORT_FILE})`);
    console.log('');
    console.log('端点:');
    console.log(`  GET  /status         - 状态（含所有 pending reviews）`);
    console.log(`  GET  /history        - 最近完成的审核记录 (?limit=20)`);
    console.log(`  POST /review         - 提交 review {"agent_id": "...", "summary": "...", "client_uuid": "...", "format": "markdown"}`);
    console.log(`  POST /send           - 发送消息 {"message": "...", "agent_id": "...", "project_path": "..."} (有 agent_id 时发卡片)`);
    console.log(`  POST /send-html      - 发送 HTML 截图 {"markdown": "...", "html": "..."}`);
    console.log(`  POST /wait-feedback  - 等待反馈 {"agent_id": "...", "timeout": 300}`);
    console.log('');
    console.log(`平台: ${USE_FEISHU && s.feishuConnected ? '飞书 (默认)' : ''} ${USE_QQ ? 'QQ Bot' : ''}`);
    console.log('');
    console.log('配置:');
    console.log(`  Review 默认超时: ${CONFIG.reviewDefaultTimeout}s`);
    console.log(`  最大连续超时次数: ${CONFIG.maxConsecutiveTimeouts}`);
    console.log(`  每 Agent 队列上限: ${CONFIG.queueMaxPerAgent}`);
    console.log(`  反馈聚合静默超时: ${CONFIG.feedbackSilenceTimeout / 1000}s`);
    console.log(`  Review 最大存活: ${CONFIG.reviewMaxTtl / 3600_000}h`);
    if (CONFIG.allowedReviewers.length) console.log(`  允许的 Reviewer: ${CONFIG.allowedReviewers.join(', ')}`);
    console.log('');
    console.log('多 Agent 支持: 每个 agent_id 独立管理审核流程，符号自动分配');
    console.log('等待中...');
  });

  // Periodic auto-save + stale review cleanup
  const REVIEW_MAX_TTL_MS = CONFIG.reviewMaxTtl;
  const autoSaveTimer = setInterval(() => {
    if (s.totalQueueSize() > 0 || s.cardMsgRegistry.size > 0 || s.feishuKnownUsers.size > 0) s.saveState();

    const now = Date.now();
    for (const [agentId, review] of s.pendingReviews) {
      const age = now - (review.createdTs || now);
      if (age > REVIEW_MAX_TTL_MS && !review.feedbackReceived) {
        console.log(`🧹 [${agentId}] Review 超过 ${Math.round(age / 3600000)}h，自动清理`);
        review.feedbackReceived = true;
        review.feedbackTs = now;
        review.feedback = '⏹ [超时自动清理]';
        for (const cb of review.feedbackCallbacks.splice(0)) {
          cb({ feedback: '⏹ [超时自动清理]', sessionDir: review.sessionDir, autoCompleted: true });
        }
        if (review.feishuCardMsgId) {
          feishu.feishuUpdateCardToCompleted(review, '超时自动清理 (>24h)', { isAutoTimeout: true }).catch(() => {});
        }
        s.pendingReviews.delete(agentId);
      }
    }
  }, 60_000);

  let shuttingDown = false;
  const cleanup = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n🛑 ${signal} received, shutting down...`);
    clearInterval(autoSaveTimer);
    s.saveState();
    console.log('   ✓ State saved');
    stopHeartbeat(s); s.ws?.close();
    if (s.feishuWsClient) { try { s.feishuWsClient.close?.(); } catch {} }
    httpServer.close();
    console.log('   ✓ Connections closed');
    await closeBrowser();
    try { unlinkSync(s.PORT_FILE); } catch {}
    console.log('   ✓ Port file removed');
    process.exit(0);
  };
  process.on('SIGINT', () => cleanup('SIGINT'));
  process.on('SIGTERM', () => cleanup('SIGTERM'));
}

main().catch(err => { console.error('启动失败:', err); process.exit(1); });
