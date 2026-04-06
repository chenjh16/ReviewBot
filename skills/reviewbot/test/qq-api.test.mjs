import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { initQQApi, authHeaders, API_BASE } from '../lib/qq/api.mjs';

describe('initQQApi', () => {
  it('stores credentials without error', () => {
    initQQApi('test_app_id', 'test_secret');
  });
});

describe('authHeaders', () => {
  it('returns object with Authorization and Content-Type', () => {
    const headers = authHeaders();
    assert.ok('Authorization' in headers);
    assert.equal(headers['Content-Type'], 'application/json');
  });
});

describe('API_BASE', () => {
  it('points to QQ Bot API', () => {
    assert.equal(API_BASE, 'https://api.sgroup.qq.com');
  });
});
