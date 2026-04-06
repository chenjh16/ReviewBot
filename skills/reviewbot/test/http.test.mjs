import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { parseBody, jsonResp } from '../lib/util/http.mjs';

function mockReq(body) {
  const stream = new Readable({ read() {} });
  process.nextTick(() => {
    stream.push(typeof body === 'string' ? body : JSON.stringify(body));
    stream.push(null);
  });
  return stream;
}

function mockRes() {
  const res = {
    _status: null,
    _headers: {},
    _body: '',
    writeHead(status, headers) { res._status = status; Object.assign(res._headers, headers); },
    end(body) { res._body = body; },
  };
  return res;
}

describe('parseBody', () => {
  it('parses valid JSON', async () => {
    const data = await parseBody(mockReq({ key: 'value' }));
    assert.deepEqual(data, { key: 'value' });
  });

  it('rejects invalid JSON', async () => {
    await assert.rejects(
      () => parseBody(mockReq('not json')),
      { message: 'Invalid JSON' },
    );
  });
});

describe('jsonResp', () => {
  it('sets status and Content-Type', () => {
    const res = mockRes();
    jsonResp(res, 200, { ok: true });
    assert.equal(res._status, 200);
    assert.equal(res._headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(res._body), { ok: true });
  });

  it('supports error status', () => {
    const res = mockRes();
    jsonResp(res, 400, { error: 'bad' });
    assert.equal(res._status, 400);
  });
});
