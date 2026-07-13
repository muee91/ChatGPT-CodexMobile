/**
 * 测试 server/permission-policy.js：权限模式到 Codex 与桌面沙箱策略的映射。
 *
 * Keywords: permission-policy, sandbox, danger-full-access, test
 *
 * Exports: 无导出，内含用例
 *
 * Inward: permission-policy.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  codexSandboxForPermissionMode,
  desktopSandboxPolicyForPermissionMode,
  desktopTurnPermissionsForPermissionMode,
  normalizePermissionMode
} from './permission-policy.js';

test('bypassPermissions is rejected unless danger full access is explicitly enabled', () => {
  assert.throws(() => normalizePermissionMode('bypassPermissions'), /danger-full-access is disabled/);
  assert.equal(normalizePermissionMode('bypassPermissions', { dangerFullAccessEnabled: true }), 'bypassPermissions');
});

test('unknown permission modes fall back to workspace-write defaults', () => {
  assert.equal(normalizePermissionMode('unknown'), 'default');
  assert.deepEqual(codexSandboxForPermissionMode('unknown'), {
    sandboxMode: 'workspace-write',
    approvalPolicy: 'never'
  });
});

test('desktop policies switch between workspace-write and danger full access', () => {
  assert.deepEqual(desktopSandboxPolicyForPermissionMode('acceptEdits', {
    writableRoots: ['/repo'],
    networkAccess: true
  }), {
    type: 'workspaceWrite',
    writableRoots: ['/repo'],
    networkAccess: true,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false
  });
  assert.deepEqual(desktopTurnPermissionsForPermissionMode('default', { writableRoots: ['/repo'] }), {
    approvalPolicy: 'on-request',
    approvalsReviewer: 'guardian_subagent',
    sandboxPolicy: {
      type: 'workspaceWrite',
      writableRoots: ['/repo'],
      networkAccess: true,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false
    }
  });
  assert.deepEqual(desktopSandboxPolicyForPermissionMode('bypassPermissions', { dangerFullAccessEnabled: true }), {
    type: 'dangerFullAccess'
  });
});
