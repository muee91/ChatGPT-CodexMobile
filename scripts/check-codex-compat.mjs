/**
 * Verifies the installed Codex app-server can satisfy CodexMobile's read-only
 * compatibility contract without creating a thread or starting a turn.
 */
import {
  createCodexAppServerClient,
  resolveCodexBinary
} from '../server/codex-app-server.js';
import { execFileSync } from 'node:child_process';

const binary = resolveCodexBinary(process.env);
let client = null;

function codexVersion() {
  try {
    return execFileSync(binary, ['--version'], {
      encoding: 'utf8',
      timeout: 5_000
    }).trim();
  } catch {
    return 'unknown';
  }
}

try {
  client = await createCodexAppServerClient({
    clientInfo: { name: 'CodexMobileCompatibilityCheck', title: null, version: '2.0.5' },
    allowHeadlessLocal: true,
    transport: {
      mode: 'headless-local',
      strict: false,
      sockPath: null,
      connected: true,
      reason: 'CodexMobile compatibility check'
    }
  });
  const threads = await client.request('thread/list', {
    cursor: null,
    limit: 1,
    sortKey: 'updated_at',
    sortDirection: 'desc',
    archived: false
  }, { timeoutMs: 15_000 });
  console.log(JSON.stringify({
    compatible: true,
    binary,
    version: codexVersion(),
    threadListSupported: Array.isArray(threads?.data),
    checkedAt: new Date().toISOString()
  }));
} catch (error) {
  console.error(JSON.stringify({
    compatible: false,
    binary,
    version: codexVersion(),
    error: error?.message || String(error)
  }));
  process.exitCode = 1;
} finally {
  client?.close();
}
