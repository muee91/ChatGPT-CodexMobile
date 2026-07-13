/**
 * 轻量健康检查：请求本机 CodexMobile /api/status，验证 connected 与 HTTP 成功。
 *
 * Keywords: smoke-test, health-check, api-status, CI
 *
 * Exports:
 * - 无 default，脚本入口自执行。
 *
 * Inward（本模块依赖/组装的关键符号）: 全局 fetch；环境变量 CODEXMOBILE_URL。
 *
 * Outward（谁在用/调用场景）: package.json smoke 脚本。
 */

const url = process.env.CODEXMOBILE_URL || 'http://127.0.0.1:3321/api/status';

try {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || !data.connected) {
    console.error('Smoke failed:', response.status, data);
    process.exit(1);
  }
  console.log(`Smoke ok: ${data.hostName} ${data.provider}/${data.model} synced=${data.syncedAt}`);
} catch (error) {
  console.error(`Smoke failed: ${error.message}`);
  process.exit(1);
}

