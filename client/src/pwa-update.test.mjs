/**
 * 测试 app/pwa-update.js：前端资源指纹提取与新版本判断。
 * Keywords: pwa, update, tests
 * Exports: 无导出 / 内含用例
 * Inward: app/pwa-update.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assetSignatureFromDocument,
  assetSignatureFromHtml,
  cacheBustedReloadUrl,
  fetchLatestAssetSignature,
  frontendAssetsChanged,
  isCapacitorNativeShell,
  isElectronRenderer,
  pwaUpdateChecksEnabled
} from './app/pwa-update.js';

test('assetSignatureFromHtml extracts and sorts built frontend assets', () => {
  const signature = assetSignatureFromHtml(`
    <link rel="stylesheet" href="/assets/index-B.css">
    <script type="module" src="/assets/index-A.js"></script>
    <link rel="manifest" href="/assets/manifest-C.webmanifest">
  `, 'http://localhost:3321/current');

  assert.equal(signature, '/assets/index-A.js|/assets/index-B.css|/assets/manifest-C.webmanifest');
});

test('assetSignatureFromDocument ignores non-built dev and external assets', () => {
  const nodes = [
    { getAttribute: (name) => (name === 'src' ? '/src/main.jsx' : '') },
    { getAttribute: (name) => (name === 'href' ? '/assets/index-D.css' : '') },
    { getAttribute: (name) => (name === 'src' ? 'http://localhost:3321/assets/index-E.js' : '') }
  ];
  const doc = {
    querySelectorAll(selector) {
      assert.equal(selector, 'script[src], link[href]');
      return nodes;
    }
  };

  assert.equal(assetSignatureFromDocument(doc), '/assets/index-D.css|/assets/index-E.js');
});

test('frontendAssetsChanged requires both signatures and detects asset hash changes', () => {
  assert.equal(frontendAssetsChanged('', '/assets/index-A.js'), false);
  assert.equal(frontendAssetsChanged('/assets/index-A.js', ''), false);
  assert.equal(frontendAssetsChanged('/assets/index-A.js', '/assets/index-A.js'), false);
  assert.equal(frontendAssetsChanged('/assets/index-A.js', '/assets/index-B.js'), true);
});

test('fetchLatestAssetSignature fetches index without cache and parses assets', async () => {
  const calls = [];
  const signature = await fetchLatestAssetSignature({
    cacheBust: 123,
    location: { href: 'http://localhost:3321/thread' },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async text() {
          return '<script type="module" src="/assets/index-A.js"></script>';
        }
      };
    }
  });

  assert.equal(signature, '/assets/index-A.js');
  assert.equal(calls[0].url, 'http://localhost:3321/?__codexmobile_pwa_check=123');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].options.headers['cache-control'], 'no-cache');
});

test('isElectronRenderer excludes the packaged desktop shell from PWA update prompts', () => {
  assert.equal(isElectronRenderer({ navigator: { userAgent: 'Mozilla/5.0 Electron/43.2.0' } }), true);
  assert.equal(isElectronRenderer({ navigator: { userAgent: 'Mozilla/5.0 Safari/605.1.15' } }), false);
});

test('Capacitor native shells do not run browser PWA update checks', () => {
  const nativeShell = {
    navigator: { userAgent: 'Mozilla/5.0 wv' },
    Capacitor: { isNativePlatform: () => true }
  };
  assert.equal(isCapacitorNativeShell(nativeShell), true);
  assert.equal(pwaUpdateChecksEnabled(nativeShell), false);
  assert.equal(pwaUpdateChecksEnabled({ navigator: { userAgent: 'Mozilla/5.0 Safari/605.1.15' } }), true);
});

test('cacheBustedReloadUrl preserves the current route while forcing a fresh document request', () => {
  assert.equal(
    cacheBustedReloadUrl('http://localhost:3321/projects/demo?view=chat', 123),
    'http://localhost:3321/projects/demo?view=chat&__codexmobile_pwa_reload=123'
  );
});
