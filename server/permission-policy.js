/**
 * 将前端权限模式映射为 Codex CLI 与桌面 app-server 的安全沙箱策略。
 *
 * Keywords: permission-policy, sandbox, danger-full-access, codex-runner
 *
 * Exports:
 * - dangerFullAccessDisabledError — 完全访问未启用时的标准错误。
 * - normalizePermissionMode — 校验并归一化权限模式。
 * - codexSandboxForPermissionMode / desktopSandboxPolicyForPermissionMode / desktopTurnPermissionsForPermissionMode — 后端运行策略映射。
 *
 * Inward（本模块依赖/组装的关键符号）: 安全配置对象。
 *
 * Outward（谁在用/调用场景）: server/codex-runner、前后端权限测试。
 *
 * 不负责: UI 展示文案。
 */
export function dangerFullAccessDisabledError() {
  const error = new Error('danger-full-access is disabled on this server');
  error.statusCode = 403;
  error.code = 'CODEXMOBILE_DANGER_FULL_ACCESS_DISABLED';
  return error;
}

export function normalizePermissionMode(permissionMode, { dangerFullAccessEnabled = false } = {}) {
  const value = String(permissionMode || '').trim();
  if (value === 'bypassPermissions') {
    if (!dangerFullAccessEnabled) {
      throw dangerFullAccessDisabledError();
    }
    return 'bypassPermissions';
  }
  if (value === 'acceptEdits') {
    return 'acceptEdits';
  }
  return 'default';
}

export function codexSandboxForPermissionMode(permissionMode, options = {}) {
  const normalized = normalizePermissionMode(permissionMode, options);
  if (normalized === 'bypassPermissions') {
    return { sandboxMode: 'danger-full-access', approvalPolicy: 'never' };
  }
  return { sandboxMode: 'workspace-write', approvalPolicy: 'never' };
}

export function desktopSandboxPolicyForPermissionMode(permissionMode, options = {}) {
  const normalized = normalizePermissionMode(permissionMode, options);
  if (normalized === 'bypassPermissions') {
    return { type: 'dangerFullAccess' };
  }
  const writableRoots = Array.isArray(options.writableRoots)
    ? [...new Set(options.writableRoots.filter(Boolean).map((entry) => String(entry)))]
    : [];
  return {
    type: 'workspaceWrite',
    writableRoots,
    networkAccess: options.networkAccess !== false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false
  };
}

export function desktopTurnPermissionsForPermissionMode(permissionMode, options = {}) {
  const normalized = normalizePermissionMode(permissionMode, options);
  if (normalized === 'bypassPermissions') {
    return {
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandboxPolicy: { type: 'dangerFullAccess' }
    };
  }
  if (normalized === 'acceptEdits') {
    return {
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandboxPolicy: desktopSandboxPolicyForPermissionMode(normalized, options)
    };
  }
  return {
    approvalPolicy: 'on-request',
    approvalsReviewer: 'guardian_subagent',
    sandboxPolicy: desktopSandboxPolicyForPermissionMode(normalized, options)
  };
}
