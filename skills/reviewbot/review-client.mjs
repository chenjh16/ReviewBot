#!/usr/bin/env node
/**
 * ReviewBot Client - Send review request and wait for feedback via QQ Bot group.
 *
 * Usage:
 *   node review-client.mjs --summary "Task summary" --agent-id "project-name" [--format markdown|image|text] [--timeout 300]
 *
 * --agent-id defaults to the basename of the current working directory.
 *
 * Requires reviewbot-server.mjs to be running.
 * Output: JSON to stdout with { status, summary_sent, reviewer_reply, session_dir }
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT_FILE = join(__dirname, '.port');

function discoverPort() {
  if (process.env.REVIEWBOT_PORT) return parseInt(process.env.REVIEWBOT_PORT, 10);
  try { return parseInt(readFileSync(PORT_FILE, 'utf-8').trim(), 10); } catch { return null; }
}

const API_PORT = discoverPort();
const API_BASE = API_PORT ? `http://127.0.0.1:${API_PORT}` : null;

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function cleanStaleSessions(dir) {
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.uuid')) continue;
      const pid = parseInt(f.replace('.uuid', ''));
      if (!isNaN(pid) && !isProcessAlive(pid)) {
        try { unlinkSync(join(dir, f)); } catch {}
      }
    }
  } catch {}
}

function getOrCreateWindowUUID() {
  const cursorPid = process.env.VSCODE_PID;
  const cwd = process.cwd();

  if (cursorPid) {
    const sessionDir = join(cwd, '.cursor', '.reviewbot-sessions');
    const sessionFile = join(sessionDir, `${cursorPid}.uuid`);
    try {
      const existing = readFileSync(sessionFile, 'utf8').trim();
      if (existing && existing.length === 36) return existing;
    } catch {}

    const uuid = randomUUID();
    try {
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(sessionFile, uuid);
      cleanStaleSessions(sessionDir);
    } catch {}
    return uuid;
  }

  const fallbackFile = join(cwd, '.cursor', '.reviewbot-uuid');
  try {
    const existing = readFileSync(fallbackFile, 'utf8').trim();
    if (existing && existing.length === 36) return existing;
  } catch {}

  const uuid = randomUUID();
  try {
    mkdirSync(dirname(fallbackFile), { recursive: true });
    writeFileSync(fallbackFile, uuid);
  } catch {}
  return uuid;
}

const CLIENT_UUID = getOrCreateWindowUUID();

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { summary: '', timeout: 300, format: 'markdown', agentId: '' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--summary' && args[i + 1]) opts.summary = args[++i];
    else if (args[i] === '--format' && args[i + 1]) opts.format = args[++i];
    else if (args[i] === '--timeout' && args[i + 1]) opts.timeout = parseInt(args[++i], 10);
    else if (args[i] === '--agent-id' && args[i + 1]) opts.agentId = args[++i];
  }
  if (!opts.agentId) opts.agentId = basename(process.cwd());
  return opts;
}

function output(result) {
  process.stdout.write(JSON.stringify(result) + '\n');
}

async function fetchJson(url, opts = {}) {
  const resp = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000) });
  return resp.json();
}

async function main() {
  const opts = parseArgs();
  if (!opts.summary) {
    output({ status: 'error', error: 'Missing --summary argument' });
    process.exit(1);
  }

  if (!API_BASE) {
    output({ status: 'error', error: 'ReviewBot 端口未知。请先启动 reviewbot-server.mjs（端口会写入 .port 文件）或设置 REVIEWBOT_PORT 环境变量' });
    process.exit(1);
  }

  // Check server running
  try {
    const status = await fetchJson(`${API_BASE}/status`);
    if (!status.connected) {
      output({ status: 'error', error: 'ReviewBot 未连接 QQ Bot，请先启动 reviewbot-server.mjs' });
      process.exit(1);
    }
  } catch {
    output({ status: 'error', error: `ReviewBot 服务未运行 (端口 ${API_PORT})，请先启动 reviewbot-server.mjs` });
    process.exit(1);
  }

  // Submit review
  process.stderr.write(`📋 提交 Review 请求 [${opts.agentId}]...\n`);
  let submitResult;
  try {
    submitResult = await fetchJson(`${API_BASE}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: opts.summary, format: opts.format, timeout: opts.timeout, agent_id: opts.agentId, client_uuid: CLIENT_UUID, project_path: process.cwd() }),
    });
  } catch (err) {
    output({ status: 'error', error: `提交失败: ${err.message}` });
    process.exit(1);
  }

  if (!submitResult.ok) {
    output({ status: 'error', error: '提交失败', detail: submitResult });
    process.exit(1);
  }

  const effectiveAgentId = submitResult.assigned_agent_id || opts.agentId;
  if (submitResult.assigned_agent_id && submitResult.assigned_agent_id !== opts.agentId) {
    process.stderr.write(`🔀 Server 分配 ID: ${submitResult.assigned_agent_id} (原始: ${opts.agentId})\n`);
  }

  if (submitResult.sent) {
    process.stderr.write(`✓ Review 已发送给 Reviewer。\n`);
  } else {
    process.stderr.write(`⏳ Review 已存储。等待 Reviewer 在 QQ 群 @CurBot 或私聊发消息...\n`);
  }

  process.stderr.write(`⏳ 等待 Reviewer 反馈 (最长 ${opts.timeout}s)...\n`);

  // Poll with shorter intervals to avoid TCP idle timeout (~300s on macOS)
  const POLL_INTERVAL_S = Math.min(opts.timeout, 120);
  const deadline = Date.now() + opts.timeout * 1000;

  while (true) {
    const remaining = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
    const pollTimeout = Math.min(POLL_INTERVAL_S, remaining);

    let feedbackResult;
    const currentPort = discoverPort();
    const currentBase = currentPort ? `http://127.0.0.1:${currentPort}` : API_BASE;
    try {
      feedbackResult = await fetch(`${currentBase}/wait-feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeout: pollTimeout, agent_id: effectiveAgentId }),
        signal: AbortSignal.timeout((pollTimeout + 15) * 1000),
      }).then(r => r.json());
    } catch (err) {
      if (Date.now() >= deadline) {
        output({ status: 'error', error: `等待反馈失败: ${err.message}` });
        process.exit(1);
      }
      process.stderr.write(`⚠ 连接中断，重试中...\n`);
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }

    if (feedbackResult.status === 'replied') {
      process.stderr.write(`✓ 收到反馈!\n`);
      const result = {
        status: 'replied',
        summary_sent: opts.summary,
        reviewer_reply: feedbackResult.feedback,
        session_dir: feedbackResult.sessionDir || submitResult.sessionDir,
      };
      if (feedbackResult.attachments?.length) {
        result.attachments = feedbackResult.attachments;
      }
      output(result);
      return;
    }

    // Poll keepalive expired — server has no real timeout yet, just reconnect
    if (feedbackResult.status === 'poll_continue') {
      continue;
    }

    if (feedbackResult.status === 'timeout_retry') {
      // Real review timeout — always exit so the agent can re-submit
      const cntInfo = feedbackResult.consecutiveTimeouts
        ? ` (${feedbackResult.consecutiveTimeouts}/${feedbackResult.maxTimeouts})`
        : '';
      process.stderr.write(`⏰ 超时${cntInfo}，已通知 Reviewer。建议再次调用 review-client 继续等待。\n`);
      output({
        status: 'timeout_retry',
        summary_sent: opts.summary,
        reviewer_reply: feedbackResult.message || null,
        message: feedbackResult.message,
        consecutiveTimeouts: feedbackResult.consecutiveTimeouts,
        maxTimeouts: feedbackResult.maxTimeouts,
        session_dir: feedbackResult.sessionDir || submitResult.sessionDir,
      });
      return;
    }

    process.stderr.write(`⚠ 超时未收到反馈\n`);
    output({
      status: 'timeout',
      summary_sent: opts.summary,
      reviewer_reply: null,
      session_dir: submitResult.sessionDir,
    });
    return;
  }
}

main().catch(err => {
  output({ status: 'error', error: err.message });
  process.exit(1);
});
