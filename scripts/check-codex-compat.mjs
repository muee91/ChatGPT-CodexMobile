/**
 * 验证本机 Codex 的 schema 合约和只读 app-server 调用，不创建线程或启动回合。
 */
import {
  createCodexAppServerClient,
  resolveCodexBinary
} from '../server/codex-app-server.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectAppServerContract } from './codex-compat-contract.mjs';

const binary = resolveCodexBinary(process.env);
let client = null;
let schemaDirectory = null;

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

function generatedSchemaContract() {
  schemaDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'codexmobile-app-server-schema-'));
  execFileSync(binary, [
    'app-server',
    'generate-json-schema',
    '--experimental',
    '--out',
    schemaDirectory
  ], {
    encoding: 'utf8',
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const readSchema = (name) => JSON.parse(fs.readFileSync(path.join(schemaDirectory, name), 'utf8'));
  return inspectAppServerContract({
    clientRequest: readSchema('ClientRequest.json'),
    serverNotification: readSchema('ServerNotification.json'),
    serverRequest: readSchema('ServerRequest.json')
  });
}

try {
  const contract = generatedSchemaContract();
  if (!contract.compatible) {
    const error = new Error('Codex app-server schema no longer satisfies the CodexMobile contract');
    error.contract = contract;
    throw error;
  }
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
  const firstThreadId = String(threads?.data?.[0]?.id || '').trim();
  const threadRead = firstThreadId
    ? await client.request('thread/read', {
      threadId: firstThreadId,
      includeTurns: false
    }, { timeoutMs: 15_000 })
    : null;
  const models = await client.request('model/list', {
    cursor: null,
    limit: 1,
    includeHidden: false
  }, { timeoutMs: 15_000 });
  const skills = await client.request('skills/list', {}, { timeoutMs: 15_000 });
  console.log(JSON.stringify({
    compatible: true,
    binary,
    version: codexVersion(),
    contract,
    probes: {
      initialize: true,
      threadList: Array.isArray(threads?.data),
      threadRead: firstThreadId ? threadRead?.thread?.id === firstThreadId : 'skipped:no-threads',
      modelList: Array.isArray(models?.data),
      skillsList: Array.isArray(skills?.data)
    },
    checkedAt: new Date().toISOString()
  }));
} catch (error) {
  console.error(JSON.stringify({
    compatible: false,
    binary,
    version: codexVersion(),
    error: error?.message || String(error),
    contract: error?.contract || null
  }));
  process.exitCode = 1;
} finally {
  client?.close();
  if (schemaDirectory) {
    fs.rmSync(schemaDirectory, { recursive: true, force: true });
  }
}
