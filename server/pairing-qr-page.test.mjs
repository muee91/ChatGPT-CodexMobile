/**
 * 测试 server/pairing-qr-page.js：二维码链接与 HTML 页面渲染。
 *
 * Keywords: pairing, qr, html, test
 *
 * Exports: 无导出 / 内含用例
 *
 * Inward: pairing-qr-page.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPairingAutoUrl, renderPairingQrPage } from './pairing-qr-page.js';

test('buildPairingAutoUrl encodes pairing params into /pair link', () => {
  assert.equal(
    buildPairingAutoUrl({
      origin: 'http://192.168.10.133:3321',
      requestId: 'req-1',
      code: 'ABCDEFGHJK',
      codeLength: 10
    }),
    'http://192.168.10.133:3321/pair?requestId=req-1&code=ABCDEFGHJK&codeLength=10'
  );
});

test('renderPairingQrPage returns HTML with code and inline svg', async () => {
  const html = await renderPairingQrPage({
    origin: 'http://127.0.0.1:3321',
    requestId: 'req-2',
    code: 'ABCDEFGHJK',
    codeLength: 10,
    hostName: 'Test Host'
  });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Test Host/);
  assert.match(html, /ABCDEFGHJK/);
  assert.match(html, /<svg/i);
  assert.match(html, /requestId=req-2/);
});
