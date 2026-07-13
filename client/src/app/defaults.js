/**
 * 应用初始状态快照：连接与桌面桥、默认模型与推理档位、文档集成占位、上下文窗口占位等常量对象。
 *
 * Keywords: default-status, initial-state, reasoning-effort, desktop-refresh
 *
 * Exports:
 * - `DEFAULT_STATUS` — 完整默认 `status` 形状。
 * - `DEFAULT_REASONING_EFFORT` / `REASONING_DEFAULT_VERSION` — 推理相关默认与版本标记。
 *
 * Inward: 无外部模块；纯数据定义。
 *
 * Outward: `App.jsx` bootstrap 与多处 hook 的基线状态。
 */

export const DEFAULT_STATUS = {
  connected: false,
  desktopBridge: {
    strict: true,
    connected: false,
    mode: 'unavailable',
    reason: null
  },
  provider: 'cliproxyapi',
  model: 'gpt-5.5',
  modelShort: '5.5 中',
  reasoningEffort: 'xhigh',
  pairing: {
    cwd: '',
    commands: ['cd <CodexMobile 项目目录>', 'npm run pair']
  },
  models: [{ value: 'gpt-5.5', label: 'gpt-5.5' }],
  skills: [],
  docs: {
    provider: 'feishu',
    integration: 'lark-cli',
    label: '飞书文档',
    configured: false,
    connected: false,
    user: null,
    homeUrl: 'https://docs.feishu.cn/',
    cliInstalled: false,
    skillsInstalled: false,
    capabilities: [],
    codexEnabled: false,
    authorizationReady: false,
    missingScopes: [],
    scopeGroups: [],
    slidesAuthorized: false,
    sheetsAuthorized: false,
    authPending: null
  },
  context: {
    inputTokens: null,
    totalTokens: null,
    contextWindow: null,
    modelContextWindow: null,
    configuredContextWindow: null,
    maxContextWindow: null,
    percent: null,
    updatedAt: null,
    autoCompact: {
      enabled: false,
      tokenLimit: null,
      detected: false,
      status: 'unknown',
      lastCompactedAt: null,
      reason: ''
    }
  },
  auth: { authenticated: false, canPair: true, trustedDevices: 0 },
  security: {
    publicAccess: false,
    publicUrl: '',
    dangerFullAccessEnabled: false
  },
  runtimeDebug: {
    envEnabled: false,
    uiEnabled: false,
    enabled: false,
    logRelativePath: '.codexmobile/logs/runtime-debug.jsonl'
  },
  desktopRefresh: {
    enabled: false,
    supported: false,
    experimental: true,
    mode: 'completion',
    lastTriggeredAt: null,
    lastError: null
  }
};

export const DEFAULT_REASONING_EFFORT = 'xhigh';
export const REASONING_DEFAULT_VERSION = 'xhigh-v1';
