/**
 * 测试 scripts/system-proxy-env.mjs：macOS scutil 输出解析与环境变量检测。
 *
 * Keywords: system-proxy, scutil, test
 *
 * Exports: 无导出，内含用例
 *
 * Inward: ../scripts/system-proxy-env.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { hasExplicitProxyEnv, proxyUrlFromScutilOutput } from '../scripts/system-proxy-env.mjs';

test('proxyUrlFromScutilOutput reads the enabled macOS HTTPS proxy', () => {
  const output = `
<dictionary> {
  HTTPEnable : 1
  HTTPPort : 7897
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7897
  HTTPSProxy : 127.0.0.1
}
`;

  assert.equal(proxyUrlFromScutilOutput(output), 'http://127.0.0.1:7897');
});

test('hasExplicitProxyEnv detects user supplied proxy settings', () => {
  assert.equal(hasExplicitProxyEnv({ HTTPS_PROXY: 'http://proxy.local:8080' }), true);
  assert.equal(hasExplicitProxyEnv({}), false);
});
