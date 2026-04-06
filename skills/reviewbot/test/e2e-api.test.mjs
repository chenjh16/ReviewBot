/**
 * E2E test for ReviewBot HTTP API.
 * Starts a lightweight mock server that mirrors the HTTP handler logic,
 * then tests endpoints against it.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { parseBody, jsonResp } from '../lib/util/http.mjs';

let server;
let baseUrl;

const pendingReviews = new Map();
const reviewHistory = [];
const HISTORY_MAX = 100;

function buildMockServer() {
  return createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost`);
    const path = url.pathname;
    try {
      if (req.method === 'GET' && path === '/status') {
        return jsonResp(res, 200, {
          connected: false,
          platform: 'disconnected',
          hasPendingReview: pendingReviews.size > 0,
          pendingReviews: [...pendingReviews.values()],
          messageQueue: 0,
        });
      }

      if (req.method === 'GET' && path === '/history') {
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), HISTORY_MAX);
        const entries = reviewHistory.slice(-limit).reverse();
        return jsonResp(res, 200, { total: reviewHistory.length, entries });
      }

      if (req.method === 'POST' && path === '/review') {
        const body = await parseBody(req);
        if (!body.summary) return jsonResp(res, 400, { error: '需要 summary' });
        if (!body.agent_id) return jsonResp(res, 400, { error: '需要 agent_id' });
        const review = {
          agentId: body.agent_id,
          summary: body.summary,
          sent: false,
          createdTs: Date.now(),
        };
        pendingReviews.set(body.agent_id, review);
        return jsonResp(res, 200, { ok: true, agent_id: body.agent_id, sent: false });
      }

      if (req.method === 'POST' && path === '/send') {
        const body = await parseBody(req);
        if (!body.message) return jsonResp(res, 400, { error: '需要 message' });
        return jsonResp(res, 200, { ok: true, queued: true });
      }

      if (req.method === 'GET' && path === '/feedback') {
        const agentId = url.searchParams.get('agent_id');
        if (!agentId) return jsonResp(res, 400, { error: '需要 agent_id' });
        const review = pendingReviews.get(agentId);
        if (!review) return jsonResp(res, 200, { status: 'no_review', feedback: null });
        if (review.feedbackReceived) {
          return jsonResp(res, 200, { status: 'completed', feedback: review.feedback });
        }
        return jsonResp(res, 200, { status: 'waiting', feedback: null });
      }

      jsonResp(res, 404, { error: 'not found' });
    } catch (err) {
      jsonResp(res, 500, { error: err.message });
    }
  });
}

async function fetchJson(path, opts = {}) {
  const resp = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  return { status: resp.status, data: await resp.json() };
}

before(async () => {
  pendingReviews.clear();
  reviewHistory.length = 0;
  server = buildMockServer();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  server.close();
});

describe('GET /status', () => {
  it('returns server status', async () => {
    const { status, data } = await fetchJson('/status');
    assert.equal(status, 200);
    assert.equal(data.connected, false);
    assert.equal(data.platform, 'disconnected');
  });
});

describe('POST /review', () => {
  it('rejects missing summary', async () => {
    const { status, data } = await fetchJson('/review', {
      method: 'POST',
      body: JSON.stringify({ agent_id: 'test' }),
    });
    assert.equal(status, 400);
    assert.ok(data.error.includes('summary'));
  });

  it('rejects missing agent_id', async () => {
    const { status, data } = await fetchJson('/review', {
      method: 'POST',
      body: JSON.stringify({ summary: 'test' }),
    });
    assert.equal(status, 400);
    assert.ok(data.error.includes('agent_id'));
  });

  it('accepts valid review request', async () => {
    const { status, data } = await fetchJson('/review', {
      method: 'POST',
      body: JSON.stringify({ summary: 'Please review', agent_id: 'my-agent' }),
    });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.agent_id, 'my-agent');
  });

  it('review appears in status', async () => {
    const { data } = await fetchJson('/status');
    assert.equal(data.hasPendingReview, true);
    assert.ok(data.pendingReviews.some(r => r.agentId === 'my-agent'));
  });
});

describe('POST /send', () => {
  it('rejects missing message', async () => {
    const { status, data } = await fetchJson('/send', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    assert.equal(status, 400);
  });

  it('accepts valid notification', async () => {
    const { status, data } = await fetchJson('/send', {
      method: 'POST',
      body: JSON.stringify({ message: 'Hello from agent', agent_id: 'my-agent' }),
    });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
  });
});

describe('GET /feedback', () => {
  it('rejects missing agent_id', async () => {
    const { status } = await fetchJson('/feedback');
    assert.equal(status, 400);
  });

  it('returns waiting for pending review', async () => {
    const { status, data } = await fetchJson('/feedback?agent_id=my-agent');
    assert.equal(status, 200);
    assert.equal(data.status, 'waiting');
  });

  it('returns no_review for unknown agent', async () => {
    const { status, data } = await fetchJson('/feedback?agent_id=nonexistent');
    assert.equal(status, 200);
    assert.equal(data.status, 'no_review');
  });
});

describe('GET /history', () => {
  it('returns empty history initially', async () => {
    const { status, data } = await fetchJson('/history');
    assert.equal(status, 200);
    assert.equal(data.total, 0);
    assert.deepEqual(data.entries, []);
  });

  it('respects limit parameter', async () => {
    reviewHistory.push({ agentId: 'a1' }, { agentId: 'a2' }, { agentId: 'a3' });
    const { data } = await fetchJson('/history?limit=2');
    assert.equal(data.entries.length, 2);
    assert.equal(data.total, 3);
  });
});

describe('404 handling', () => {
  it('returns 404 for unknown endpoints', async () => {
    const { status } = await fetchJson('/nonexistent');
    assert.equal(status, 404);
  });
});
