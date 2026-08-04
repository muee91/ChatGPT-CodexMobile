/**
 * 配对响应辅助：电脑端保留配对秘密，手机端只接收继续扫码/输码所需的公开状态。
 *
 * Keywords: pairing, qr, secret-redaction, response-shape
 *
 * Exports:
 * - pairingRequestUrlsForRequest — 构造仅供电脑端展示的配对与二维码地址。
 * - publicPairingRequestResponse — 返回不含 code、pairingUrl、qrUrl 的手机端响应。
 */

export function pairingRequestUrlsForRequest(requestId, code, codeLength, origin) {
  const params = new URLSearchParams({
    requestId: String(requestId || ''),
    code: String(code || ''),
    codeLength: String(codeLength || 10)
  });
  const query = params.toString();
  const base = String(origin || '').replace(/\/+$/, '');
  return {
    pairingUrl: `${base}/pair?${query}`,
    qrUrl: `${base}/pair/qr?${query}`
  };
}

export function publicPairingRequestResponse(result = {}) {
  return {
    requestId: result.requestId,
    codeLength: result.codeLength,
    expiresAt: result.expiresAt,
    requestCooldownSeconds: result.requestCooldownSeconds
  };
}
