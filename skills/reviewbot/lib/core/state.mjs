/**
 * Centralized application state, queue management, contacts, and persistence.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createSymbolAssigner } from './routing.mjs';

export function createState(config, baseDir) {
  const STATE_FILE = join(baseDir, '.state.json');
  const STATE_VERSION = 1;
  const KNOWN_CONTACTS_FILE = join(baseDir, '.known-contacts.json');

  const symbolAssigner = createSymbolAssigner();

  const s = {
    // QQ WebSocket
    ws: null, wsSessionId: null, wsSeqNo: null, heartbeatTimer: null,
    connected: false, reconnecting: false,

    // Feishu
    lark: null, feishuClient: null, feishuWsClient: null, feishuConnected: false,
    feishuKnownUsers: new Map(),

    // Reviews
    pendingReviews: new Map(),
    lastFeedbacks: new Map(),
    reviewHistory: [],
    HISTORY_MAX: 100,

    // Card registry
    cardMsgRegistry: new Map(),
    REGISTRY_MAX_SIZE: 200,
    cardActionDedup: new Map(),

    // Message queues
    messageQueues: new Map(),
    QUEUE_MAX_PER_AGENT: config.queueMaxPerAgent,

    // Recent messages & contacts
    recentMessages: [],
    msgSeqCounters: new Map(),
    knownUsers: new Map(),
    knownGroups: new Map(),

    // Symbol assignment
    symbolAssigner,
    assignSymbol: (agentId) => symbolAssigner.assign(agentId),
    agentSymbols: symbolAssigner.getMap(),

    // Config
    config,
    SESSIONS_DIR: join(baseDir, 'sessions'),
    PORT_FILE: join(baseDir, '.port'),
    STATE_FILE,
    KNOWN_CONTACTS_FILE,
    ALLOWED_REVIEWERS: new Set(config.allowedReviewers),
    MAX_CONSECUTIVE_TIMEOUTS: config.maxConsecutiveTimeouts,
  };

  // --- Queue helpers ---
  s.registerCardMsg = (messageId, agentId, type = 'review') => {
    if (!messageId) return;
    s.cardMsgRegistry.set(messageId, { agentId: agentId || null, type, ts: Date.now() });
    if (s.cardMsgRegistry.size > s.REGISTRY_MAX_SIZE) {
      const oldest = s.cardMsgRegistry.keys().next().value;
      s.cardMsgRegistry.delete(oldest);
    }
  };

  s.getQueue = (agentId) => {
    const key = agentId || '_general';
    if (!s.messageQueues.has(key)) s.messageQueues.set(key, []);
    return s.messageQueues.get(key);
  };

  s.enqueue = (message, agentId) => {
    const key = agentId || '_general';
    const queue = s.getQueue(key);
    queue.push(message);
    if (queue.length > s.QUEUE_MAX_PER_AGENT) queue.shift();
    return key;
  };

  s.totalQueueSize = () => {
    let total = 0;
    for (const q of s.messageQueues.values()) total += q.length;
    return total;
  };

  s.allQueuedMessages = () => {
    const all = [];
    for (const [key, msgs] of s.messageQueues) {
      for (const m of msgs) all.push({ ...m, _queueKey: key });
    }
    return all.sort((a, b) => a.ts - b.ts);
  };

  s.getReviewQueueSnapshot = (agentId) => {
    const agentQueue = s.messageQueues.get(agentId) || [];
    const generalQueue = s.messageQueues.get('_general') || [];
    const combined = [...agentQueue, ...generalQueue].sort((a, b) => a.ts - b.ts);
    return combined.length > 0 ? combined : null;
  };

  s.consumeReviewQueue = (agentId) => {
    const snapshot = s.getReviewQueueSnapshot(agentId);
    if (snapshot) {
      s.messageQueues.delete(agentId);
      s.messageQueues.delete('_general');
    }
    return snapshot;
  };

  s.nextMsgSeq = (msgId) => {
    const current = s.msgSeqCounters.get(msgId) || 0;
    const next = current + 1;
    s.msgSeqCounters.set(msgId, next);
    if (s.msgSeqCounters.size > 50) {
      const first = s.msgSeqCounters.keys().next().value;
      s.msgSeqCounters.delete(first);
    }
    return next;
  };

  // --- Agent ID resolution ---
  s.resolveAgentId = (rawId, clientUUID) => {
    const existing = s.pendingReviews.get(rawId);
    if (!existing) return rawId;
    if (existing.feedbackReceived) { s.pendingReviews.delete(rawId); return rawId; }

    if (clientUUID && existing.clientUUID === clientUUID) {
      if (existing.feedbackSilenceTimer) clearTimeout(existing.feedbackSilenceTimer);
      for (const cb of (existing.feedbackCallbacks || [])) {
        try { cb({ status: 'replaced', message: 'review replaced by new submission' }); } catch {}
      }
      s.pendingReviews.delete(rawId);
      return rawId;
    }
    if (!clientUUID) {
      if (existing.feedbackSilenceTimer) clearTimeout(existing.feedbackSilenceTimer);
      for (const cb of (existing.feedbackCallbacks || [])) {
        try { cb({ status: 'replaced', message: 'review replaced by new submission' }); } catch {}
      }
      s.pendingReviews.delete(rawId);
      return rawId;
    }

    let suffix = 2;
    while (s.pendingReviews.has(`${rawId}.${suffix}`)) {
      const other = s.pendingReviews.get(`${rawId}.${suffix}`);
      if (other.feedbackReceived) { s.pendingReviews.delete(`${rawId}.${suffix}`); break; }
      if (other.clientUUID === clientUUID) {
        if (other.feedbackSilenceTimer) clearTimeout(other.feedbackSilenceTimer);
        for (const cb of (other.feedbackCallbacks || [])) {
          try { cb({ status: 'replaced', message: 'review replaced by new submission' }); } catch {}
        }
        s.pendingReviews.delete(`${rawId}.${suffix}`);
        return `${rawId}.${suffix}`;
      }
      suffix++;
    }
    console.log(`🔀 [${rawId}] 冲突检测：UUID 不匹配，分配后缀 → ${rawId}.${suffix}`);
    return `${rawId}.${suffix}`;
  };

  // --- State persistence ---
  s.serializeState = () => {
    const cleanUsers = {};
    for (const [k, v] of s.feishuKnownUsers) {
      const { replyTarget, ...rest } = v;
      cleanUsers[k] = rest;
    }
    const cleanReviews = {};
    for (const [k, v] of s.pendingReviews) {
      if (v.feedbackReceived) continue;
      cleanReviews[k] = {
        agentId: v.agentId, agentLabel: v.agentLabel, agentSymbol: v.agentSymbol,
        clientUUID: v.clientUUID, summary: v.summary, projectPath: v.projectPath,
        feishuCardMsgId: v.feishuCardMsgId, createdTs: v.createdTs, sentTs: v.sentTs,
        sent: v.sent, timeoutSec: v.timeoutSec, format: v.format,
        queuedMessages: v.queuedMessages, sessionDir: v.sessionDir,
        consecutiveTimeouts: v.consecutiveTimeouts || 0, lastStallMsg: v.lastStallMsg || null,
        readTs: v.readTs || null, readBy: v.readBy || null, urgentSent: v.urgentSent || false,
      };
    }
    return JSON.stringify({
      version: STATE_VERSION, ts: Date.now(),
      messageQueues: Object.fromEntries(s.messageQueues),
      cardMsgRegistry: Object.fromEntries(s.cardMsgRegistry),
      feishuKnownUsers: cleanUsers,
      agentSymbols: Object.fromEntries(s.symbolAssigner.getMap()),
      nextSymbolIdx: s.symbolAssigner.getNextIdx(),
      pendingReviews: cleanReviews,
    });
  };

  s.saveState = () => {
    try {
      writeFileSync(STATE_FILE, s.serializeState());
      console.log('💾 状态已保存');
    } catch (err) {
      console.error(`⚠ 状态保存失败: ${err.message}`);
    }
  };

  s.loadState = () => {
    try {
      if (!existsSync(STATE_FILE)) return false;
      const raw = readFileSync(STATE_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (data.version !== STATE_VERSION) {
        console.log(`⚠ 状态文件版本不兼容 (文件: v${data.version}, 当前: v${STATE_VERSION})，跳过恢复`);
        return false;
      }
      if (data.messageQueues) {
        for (const [key, msgs] of Object.entries(data.messageQueues)) {
          if (Array.isArray(msgs) && msgs.length > 0) s.messageQueues.set(key, msgs);
        }
      }
      if (data.cardMsgRegistry) {
        for (const [key, val] of Object.entries(data.cardMsgRegistry)) s.cardMsgRegistry.set(key, val);
      }
      if (data.feishuKnownUsers) {
        for (const [key, val] of Object.entries(data.feishuKnownUsers)) s.feishuKnownUsers.set(key, val);
      }
      if (data.agentSymbols) {
        s.symbolAssigner.restore(data.agentSymbols, data.nextSymbolIdx || 0);
      }
      if (data.pendingReviews) {
        for (const [key, val] of Object.entries(data.pendingReviews)) {
          if (!val.feishuCardMsgId) continue;
          s.pendingReviews.set(key, {
            ...val, feedbackReceived: false, feedbackBuffer: [],
            feedbackSilenceTimer: null, feedbackCallbacks: [],
            consecutiveTimeouts: val.consecutiveTimeouts || 0,
            lastStallMsg: val.lastStallMsg || null,
            readTs: val.readTs || null, readBy: val.readBy || null,
            urgentSent: val.urgentSent || false,
          });
        }
      }
      const age = Date.now() - (data.ts || 0);
      const ageStr = age < 60000 ? `${Math.round(age / 1000)}s` : `${Math.round(age / 60000)}m`;
      console.log(`✓ 状态已恢复 (${ageStr} ago): 队列 ${s.totalQueueSize()} 条, 卡片注册 ${s.cardMsgRegistry.size}, 已知用户 ${s.feishuKnownUsers.size}, 待处理 Review ${s.pendingReviews.size}`);
      return true;
    } catch (err) {
      console.error(`⚠ 状态恢复失败: ${err.message}`);
      return false;
    }
  };

  // --- Known contacts ---
  s.loadKnownContacts = () => {
    try {
      if (existsSync(KNOWN_CONTACTS_FILE)) {
        const data = JSON.parse(readFileSync(KNOWN_CONTACTS_FILE, 'utf8'));
        for (const [k, v] of Object.entries(data.users || {})) s.knownUsers.set(k, v);
        for (const [k, v] of Object.entries(data.groups || {})) s.knownGroups.set(k, v);
        for (const [k, v] of Object.entries(data.feishuUsers || {})) s.feishuKnownUsers.set(k, v);
        console.log(`✓ 已加载联系人: ${s.knownUsers.size} QQ用户, ${s.knownGroups.size} 群, ${s.feishuKnownUsers.size} 飞书用户`);
      }
    } catch {}
  };

  s.saveKnownContacts = () => {
    const data = {
      users: Object.fromEntries(s.knownUsers),
      groups: Object.fromEntries(s.knownGroups),
      feishuUsers: Object.fromEntries(s.feishuKnownUsers),
    };
    writeFileSync(KNOWN_CONTACTS_FILE, JSON.stringify(data, null, 2));
  };

  return s;
}
