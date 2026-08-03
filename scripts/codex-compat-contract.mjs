/**
 * CodexMobile 使用的公开 app-server 协议最小合约。
 * schema 检查负责发现 Codex 升级后的方法删除或改名，运行探测另行验证只读调用。
 */

export const REQUIRED_CLIENT_METHODS = Object.freeze([
  'initialize',
  'thread/start',
  'thread/resume',
  'thread/list',
  'thread/read',
  'thread/loaded/list',
  'thread/archive',
  'thread/unarchive',
  'thread/name/set',
  'thread/compact/start',
  'turn/start',
  'turn/steer',
  'turn/interrupt',
  'model/list',
  'skills/list'
]);

export const REQUIRED_SERVER_NOTIFICATIONS = Object.freeze([
  'error',
  'thread/started',
  'thread/status/changed',
  'thread/archived',
  'thread/unarchived',
  'serverRequest/resolved',
  'turn/started',
  'turn/completed',
  'item/started',
  'item/completed',
  'item/agentMessage/delta',
  'item/commandExecution/outputDelta',
  'thread/tokenUsage/updated'
]);

export const REQUIRED_SERVER_REQUESTS = Object.freeze([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
  'item/tool/requestUserInput',
  'mcpServer/elicitation/request'
]);

export function schemaMethods(schema = {}) {
  const methods = new Set();
  for (const entry of Array.isArray(schema?.oneOf) ? schema.oneOf : []) {
    const values = entry?.properties?.method?.enum;
    if (!Array.isArray(values)) {
      continue;
    }
    for (const value of values) {
      const method = String(value || '').trim();
      if (method) {
        methods.add(method);
      }
    }
  }
  return methods;
}

export function missingContractMethods(available, required) {
  const methods = available instanceof Set ? available : new Set(available || []);
  return required.filter((method) => !methods.has(method));
}

export function inspectAppServerContract({ clientRequest, serverNotification, serverRequest } = {}) {
  const available = {
    clientMethods: schemaMethods(clientRequest),
    notificationMethods: schemaMethods(serverNotification),
    serverRequestMethods: schemaMethods(serverRequest)
  };
  const missing = {
    clientMethods: missingContractMethods(available.clientMethods, REQUIRED_CLIENT_METHODS),
    notificationMethods: missingContractMethods(available.notificationMethods, REQUIRED_SERVER_NOTIFICATIONS),
    serverRequestMethods: missingContractMethods(available.serverRequestMethods, REQUIRED_SERVER_REQUESTS)
  };
  return {
    compatible: Object.values(missing).every((entries) => entries.length === 0),
    missing,
    counts: Object.fromEntries(
      Object.entries(available).map(([key, value]) => [key, value.size])
    )
  };
}
