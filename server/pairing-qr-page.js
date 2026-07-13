/**
 * 配对二维码页面：把一次性配对链接渲染成桌面可扫码的 HTML 页面。
 *
 * Keywords: pairing, qr, html, terminal-link
 *
 * Exports:
 * - buildPairingAutoUrl — 生成手机扫码后可直接完成配对的 URL。
 * - renderPairingQrPage — 返回内联 SVG 的二维码页面 HTML。
 *
 * Inward（本模块依赖/组装的关键符号）: qrcode、URLSearchParams。
 *
 * Outward（谁在用/调用场景）: server/index.js 的 `/pair/qr` 路由、scripts/pair.mjs。
 *
 * 不负责: 配对请求生命周期与鉴权。
 */
import QRCode from 'qrcode';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildPairingAutoUrl({ origin = '', requestId = '', code = '', codeLength = 10 } = {}) {
  const params = new URLSearchParams({
    requestId: String(requestId || ''),
    code: String(code || ''),
    codeLength: String(codeLength || 10)
  });
  return `${String(origin || '').replace(/\/+$/, '')}/pair?${params.toString()}`;
}

export async function renderPairingQrPage({
  origin = '',
  requestId = '',
  code = '',
  codeLength = 10,
  expiresAt = '',
  hostName = ''
} = {}) {
  const pairingUrl = buildPairingAutoUrl({ origin, requestId, code, codeLength });
  const qrSvg = await QRCode.toString(pairingUrl, {
    type: 'svg',
    margin: 1,
    width: 320,
    color: {
      dark: '#111111',
      light: '#ffffff'
    }
  });
  const expiresLabel = expiresAt
    ? new Date(expiresAt).toLocaleString('zh-CN', { hour12: false })
    : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CodexMobile 配对二维码</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #0f1115;
      color: #f5f7fb;
      font: 16px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif;
    }
    main {
      width: min(92vw, 560px);
      padding: 28px;
      border-radius: 18px;
      background: rgba(20, 24, 31, 0.92);
      box-shadow: 0 18px 48px rgba(0,0,0,0.32);
    }
    h1 { margin: 0 0 8px; font-size: 28px; line-height: 1.15; }
    p { margin: 0; color: rgba(245,247,251,0.78); }
    .qr {
      margin: 22px auto 18px;
      width: min(100%, 320px);
      padding: 14px;
      border-radius: 16px;
      background: #ffffff;
    }
    .qr svg { display: block; width: 100%; height: auto; }
    .code {
      margin-top: 18px;
      padding: 14px 16px;
      border-radius: 14px;
      background: rgba(255,255,255,0.08);
      font: 700 22px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
      letter-spacing: 0.08em;
      text-align: center;
    }
    .meta { margin-top: 12px; font-size: 13px; color: rgba(245,247,251,0.6); }
    a { color: #9ec1ff; word-break: break-all; }
  </style>
</head>
<body>
  <main>
    <h1>扫码连接 CodexMobile</h1>
    <p>${escapeHtml(hostName || '这台电脑')} 已生成一次性配对码。用手机端扫码即可自动完成配对。</p>
    <div class="qr" aria-label="配对二维码">${qrSvg}</div>
    <div class="code">${escapeHtml(code)}</div>
    ${expiresLabel ? `<div class="meta">有效期至 ${escapeHtml(expiresLabel)}</div>` : ''}
    <div class="meta">备用链接：<a href="${escapeHtml(pairingUrl)}">${escapeHtml(pairingUrl)}</a></div>
  </main>
</body>
</html>`;
}
