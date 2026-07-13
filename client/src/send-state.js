/**
 * 桌面桥规范化与 Composer 发送按钮禁用态/文案推导。
 *
 * Keywords: desktop-bridge, composer, send-state, capabilities
 *
 * Exports:
 * - normalizeDesktopBridge — 统一 bridge 形状。
 * - desktopBridgeCanCreateThread — 兼容旧调用；移动端发送不再依赖此能力。
 * - composerSendState — disabled、label、mode 等发送区状态。
 *
 * Inward: 无。
 *
 * Outward: Composer、提交流程与会话创建入口。
 */

export function normalizeDesktopBridge(bridge = null) {
  return {
    strict: bridge?.strict !== false,
    connected: Boolean(bridge?.connected),
    mode: bridge?.mode || 'unavailable',
    reason: bridge?.reason || null,
    capabilities: bridge?.capabilities && typeof bridge.capabilities === 'object'
      ? bridge.capabilities
      : {}
  };
}

export function desktopBridgeCanCreateThread(bridge = null) {
  const normalized = normalizeDesktopBridge(bridge);
  if (!normalized.connected) {
    return false;
  }
  if (normalized.mode === 'desktop-ipc') {
    return true;
  }
  if (normalized.capabilities.backgroundCodex || normalized.capabilities.createThreadViaBackground) {
    return true;
  }
  if (normalized.capabilities.createThread === false) {
    return false;
  }
  if (normalized.mode === 'desktop-ipc' && normalized.capabilities.createThread !== true) {
    return false;
  }
  return true;
}

export function composerSendState({
  running = false,
  submitting = false,
  hasInput = false,
  uploading = false,
  desktopBridge = null,
  steerable = true,
  sessionIsDraft = false
} = {}) {
  const bridge = normalizeDesktopBridge(desktopBridge);
  void bridge;
  void sessionIsDraft;
  if (uploading) {
    return {
      disabled: true,
      label: '正在上传',
      mode: 'uploading',
      showMenu: false,
      canSteer: false,
      canQueue: false,
      canInterrupt: false
    };
  }
  if (submitting) {
    return {
      disabled: true,
      label: '发送中',
      mode: 'submitting',
      showMenu: false,
      canSteer: false,
      canQueue: false,
      canInterrupt: false
    };
  }
  if (running && !hasInput) {
    return {
      disabled: false,
      label: '中止当前任务',
      mode: 'abort',
      showMenu: false,
      canSteer: false,
      canQueue: false,
      canInterrupt: true
    };
  }
  if (running && hasInput) {
    return {
      disabled: false,
      label: '选择发送方式',
      mode: steerable ? 'steer' : 'queue',
      showMenu: true,
      canSteer: Boolean(steerable),
      canQueue: true,
      canInterrupt: true
    };
  }
  return {
    disabled: !hasInput,
    label: '发送消息',
    mode: 'start',
    showMenu: false,
    canSteer: false,
    canQueue: false,
    canInterrupt: false
  };
}
