/**
 * 测试 server/codex-app-server.js：桌面线程列表参数、归档筛选与 control socket 失败降级。
 * Keywords: codex-app-server, archive, thread-list, socket, fallback
 * Exports: 无导出，内含用例
 * Inward: codex-app-server.js
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CodexAppServerClient,
  codexBinaryCandidates,
  desktopProxyFailureFallbackTransport,
  desktopThreadListRequestParams,
  filterDesktopThreadsForArchiveMode,
  resolveCodexBinary
} from './codex-app-server.js';

test('Codex binary discovery prefers explicit configuration over bundled app paths', () => {
  assert.equal(resolveCodexBinary({ CODEXMOBILE_CODEX_BINARY: process.execPath, PATH: '' }), process.execPath);
});

test('Codex binary discovery includes the current ChatGPT bundle before the legacy Codex bundle', () => {
  const candidates = codexBinaryCandidates({ PATH: '' });
  assert.ok(candidates.indexOf('/Applications/ChatGPT.app/Contents/Resources/codex') >= 0);
  assert.ok(candidates.indexOf('/Applications/ChatGPT.app/Contents/Resources/codex') < candidates.indexOf('/Applications/Codex.app/Contents/Resources/codex'));
});

test('Codex app-server stdout parser preserves split JSON-RPC lines', () => {
  const client = new CodexAppServerClient({
    transport: { mode: 'headless-local', strict: false, connected: true, sockPath: null, reason: null }
  });
  const lines = [];
  client.handleLine = (line) => lines.push(line);

  client.handleStdoutChunk(Buffer.from('{"id":1}\r'));
  client.handleStdoutChunk(Buffer.from('\n{"method":"turn/started"}\n'));

  assert.deepEqual(lines, ['{"id":1}', '{"method":"turn/started"}']);
  client.close();
});

test('Codex app-server stdout parser accepts complete JSON-RPC lines larger than the legacy 8 MiB limit', () => {
  const client = new CodexAppServerClient({
    transport: { mode: 'headless-local', strict: false, connected: true, sockPath: null, reason: null }
  });
  const lines = [];
  client.handleLine = (line) => lines.push(line);
  const largeLine = Buffer.alloc(9 * 1024 * 1024, 0x78);

  client.handleStdoutChunk(largeLine);
  client.handleStdoutChunk(Buffer.from('\n'));

  assert.equal(lines.length, 1);
  assert.equal(lines[0].length, largeLine.length);
  client.close();
});

test('Codex app-server suppresses a late response after serverRequest/resolved', async () => {
  let resolveRequest;
  const responses = [];
  const notifications = [];
  const client = new CodexAppServerClient({
    transport: { mode: 'headless-local', strict: false, connected: true, sockPath: null, reason: null },
    onServerRequest: () => new Promise((resolve) => {
      resolveRequest = resolve;
    }),
    onNotification: (message) => notifications.push(message)
  });
  client.respond = (id, result) => responses.push({ id, result });
  client.respondError = (id, message) => responses.push({ id, error: message });

  const handling = client.handleServerRequest({
    id: 17,
    method: 'item/tool/requestUserInput',
    params: { threadId: 'thread-1' }
  });
  await Promise.resolve();
  client.handleLine(JSON.stringify({
    method: 'serverRequest/resolved',
    params: { threadId: 'thread-1', requestId: 17 }
  }));
  resolveRequest({ answers: {} });
  await handling;

  assert.deepEqual(responses, []);
  assert.equal(notifications.at(-1).method, 'serverRequest/resolved');
  client.close();
});

test('desktopThreadListRequestParams passes archived mode through to thread/list', () => {
  assert.deepEqual(desktopThreadListRequestParams({ cursor: 'next', limit: 25, archived: true }), {
    cursor: 'next',
    limit: 25,
    sortKey: 'updated_at',
    sortDirection: 'desc',
    archived: true
  });
});

test('filterDesktopThreadsForArchiveMode keeps archived threads only for archive box mode', () => {
  const threads = [
    { id: 'open-1', status: 'completed' },
    { id: 'archived-1', status: 'archived' },
    { id: 'archived-2', archived: true },
    { status: 'archived' }
  ];

  assert.deepEqual(filterDesktopThreadsForArchiveMode(threads, { archived: false }).map((thread) => thread.id), ['open-1']);
  assert.deepEqual(filterDesktopThreadsForArchiveMode(threads, { archived: true }).map((thread) => thread.id), [
    'open-1',
    'archived-1',
    'archived-2'
  ]);
});

test('desktopProxyFailureFallbackTransport falls back to isolated mode for read-only calls', () => {
  assert.deepEqual(desktopProxyFailureFallbackTransport({}, { allowReadOnlyIsolated: true }), {
    mode: 'isolated-dev',
    strict: false,
    sockPath: null,
    connected: true,
    reason: '桌面端 control socket 无法连接，正在使用独立开发 app-server'
  });
});

test('desktopProxyFailureFallbackTransport falls back to headless mode for writable calls', () => {
  assert.deepEqual(desktopProxyFailureFallbackTransport({}, { allowHeadlessLocal: true }), {
    mode: 'headless-local',
    strict: false,
    sockPath: null,
    connected: true,
    reason: '桌面端 control socket 无法连接，正在使用后台 Codex 执行'
  });
});

test('desktopProxyFailureFallbackTransport respects disabled headless mode', () => {
  assert.equal(
    desktopProxyFailureFallbackTransport({ CODEXMOBILE_DISABLE_HEADLESS_CODEX: '1' }, { allowHeadlessLocal: true }),
    null
  );
});
