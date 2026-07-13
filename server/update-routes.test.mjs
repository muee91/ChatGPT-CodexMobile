/**
 * 测试 server/update-routes.js 的更新状态、触发与进度 HTTP 形状。
 *
 * Keywords: update-routes, update-api, test
 *
 * Exports: 无导出 / 内含用例
 *
 * Inward: update-routes.js
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createUpdateRouteHandler } from './update-routes.js';

function createResponse() {
  return {
    statusCode: null,
    headers: null,
    body: '',
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = '') {
      this.body = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
    }
  };
}

function createRequest(method = 'GET', body = null) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = {};
  req.socket = { remoteAddress: '127.0.0.1' };
  req.destroy = () => {};
  req.sendBody = () => {
    if (body !== null) {
      req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.emit('end');
  };
  return req;
}

async function callWithBody(handler, req, res, url) {
  const promise = handler(req, res, url);
  req.sendBody();
  return promise;
}

test('update route handler exposes status, progress, and apply responses', async () => {
  const calls = [];
  const handler = createUpdateRouteHandler({
    updateService: {
      async checkForUpdates() {
        calls.push('status');
        return { currentVersion: '2.0.1', latestTag: 'v2.0.2', updateAvailable: true };
      },
      async readProgress() {
        calls.push('progress');
        return { state: 'idle' };
      },
      async applyUpdate(body) {
        calls.push(['apply', body.tag]);
        return { accepted: true, tag: body.tag };
      }
    }
  });

  const statusRes = createResponse();
  assert.equal(await handler(createRequest('GET'), statusRes, new URL('http://local/api/update/status')), true);
  assert.deepEqual(JSON.parse(statusRes.body), {
    success: true,
    update: { currentVersion: '2.0.1', latestTag: 'v2.0.2', updateAvailable: true }
  });

  const progressRes = createResponse();
  assert.equal(await handler(createRequest('GET'), progressRes, new URL('http://local/api/update/progress')), true);
  assert.deepEqual(JSON.parse(progressRes.body), { success: true, progress: { state: 'idle' } });

  const applyReq = createRequest('POST', { tag: 'v2.0.2' });
  const applyRes = createResponse();
  assert.equal(await callWithBody(handler, applyReq, applyRes, new URL('http://local/api/update/apply')), true);
  assert.equal(applyRes.statusCode, 202);
  assert.deepEqual(JSON.parse(applyRes.body), { success: true, accepted: true, tag: 'v2.0.2' });
  assert.deepEqual(calls, ['status', 'progress', ['apply', 'v2.0.2']]);
});
