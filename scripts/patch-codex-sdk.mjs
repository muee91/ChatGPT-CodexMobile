/**
 * postinstall：为 @openai/codex-sdk 的 spawn 调用注入 windowsHide，减少 Windows 弹窗。
 *
 * Keywords: codex-sdk, postinstall, spawn, windowsHide, patch
 *
 * Exports:
 * - 无 default，脚本副作用执行后退出。
 *
 * Inward（本模块依赖/组装的关键符号）: node:fs、node:path；目标为 node_modules 内 SDK 产物路径。
 *
 * Outward（谁在用/调用场景）: package.json postinstall 钩子。
 */

import fs from 'node:fs';
import path from 'node:path';

const sdkPath = path.resolve('node_modules', '@openai', 'codex-sdk', 'dist', 'index.js');

if (!fs.existsSync(sdkPath)) {
  console.warn(`[patch-codex-sdk] skipped, not found: ${sdkPath}`);
  process.exit(0);
}

const source = fs.readFileSync(sdkPath, 'utf8');
if (source.includes('windowsHide: true')) {
  console.log('[patch-codex-sdk] already patched');
  process.exit(0);
}

const target = /const child = spawn\(this\.executablePath, commandArgs, \{\n\s+env,\n\s+signal: args\.signal\n\s+}\);/;

if (!target.test(source)) {
  console.warn('[patch-codex-sdk] target snippet not found; SDK may have changed');
  process.exit(0);
}

fs.writeFileSync(
  sdkPath,
  source.replace(target, (match) => match.replace(/\n\s+}\);$/, ',\n      windowsHide: true\n    });')),
  'utf8'
);
console.log('[patch-codex-sdk] patched Codex SDK spawn options');
