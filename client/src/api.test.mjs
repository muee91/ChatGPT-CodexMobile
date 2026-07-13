/**
 * 测试 api.js：远端桌面服务失联时的地址恢复与自动重试。
 *
 * Keywords: api-fetch, server-recovery, network-retry
 *
 * Exports: 无导出 / 内含用例
 *
 * Inward: api.js
 */
import assert from 'node:assert/strict';
import test from 'node:test';

test('apiFetch retries with a remembered healthy server url after a network failure', async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  const store = new Map([
    ['codexmobile.serverUrl', 'http://192.168.10.10:3321'],
    ['codexmobile.serverUrlHistory', JSON.stringify([
      'http://192.168.10.10:3321',
      'http://192.168.10.20:3321'
    ])]
  ]);
  const calls = [];

  globalThis.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    }
  };

  globalThis.fetch = async (url, options = {}) => {
    calls.push(String(url));
    if (String(url).startsWith('http://192.168.10.10:3321/api/chat/send')) {
      throw new TypeError('Failed to fetch');
    }
    if (String(url) === 'http://192.168.10.20:3321/api/status') {
      return new Response(JSON.stringify({ connected: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (String(url) === 'http://192.168.10.20:3321/api/chat/send') {
      return new Response(JSON.stringify({ ok: true, sessionId: 'session-1', turnId: 'turn-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    throw new Error(`Unexpected fetch url: ${url} ${options.method || 'GET'}`);
  };

  try {
    const api = await import(`./api.js?case=recovery-${Date.now()}`);
    const result = await api.apiFetch('/api/chat/send', {
      method: 'POST',
      body: { message: 'test' }
    });

    assert.deepEqual(result, { ok: true, sessionId: 'session-1', turnId: 'turn-1' });
    assert.equal(store.get('codexmobile.serverUrl'), 'http://192.168.10.20:3321');
    assert.deepEqual(calls, [
      'http://192.168.10.10:3321/api/chat/send',
      'http://192.168.10.20:3321/api/status',
      'http://192.168.10.20:3321/api/chat/send'
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocalStorage) {
      globalThis.localStorage = originalLocalStorage;
    } else {
      delete globalThis.localStorage;
    }
  }
});
