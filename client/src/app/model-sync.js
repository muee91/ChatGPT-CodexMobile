/**
 * 将服务端 `status` 中的模型与推理档位与用户本地选择对齐：仅在「服务端从旧值变为新值」时覆盖本地，避免编辑中途被意外重置。
 *
 * Keywords: model-sync, reasoning-effort, status-reconcile
 *
 * Exports:
 * - `nextSyncedComposerSettings` — 基于当前/上一次 status 计算下一组 `model` 与 `reasoningEffort`。
 * - `mergeModelSettingsIntoStatus` — 将服务端模型设置广播合并回 status。
 * - `effectiveComposerSettingsSource` — 以当前会话为先，解析 Composer 应该跟随的模型来源。
 * - `shouldApplyModelSettings` — 判断线程级模型广播是否属于当前会话。
 *
 * Inward: 无外部模块；纯比较逻辑。
 *
 * Outward: `App.jsx` 在 status 更新后同步 Composer 选项。
 */

function clean(value) {
  return String(value || '').trim();
}

function nextSyncedValue({ currentValue, previousStatusValue, statusValue, fallbackValue = '' }) {
  const current = clean(currentValue);
  const previous = clean(previousStatusValue);
  const status = clean(statusValue);

  if (!status) {
    return current || previous || clean(fallbackValue);
  }
  if (!current || !previous || current === previous || current === status || status !== previous) {
    return status;
  }
  return current;
}

export function nextSyncedComposerSettings({
  currentModel,
  previousStatusModel,
  statusModel,
  fallbackModel = 'gpt-5.5',
  currentReasoningEffort,
  previousStatusReasoningEffort,
  statusReasoningEffort,
  fallbackReasoningEffort = 'xhigh'
} = {}) {
  return {
    model: nextSyncedValue({
      currentValue: currentModel,
      previousStatusValue: previousStatusModel,
      statusValue: statusModel,
      fallbackValue: fallbackModel
    }),
    reasoningEffort: nextSyncedValue({
      currentValue: currentReasoningEffort,
      previousStatusValue: previousStatusReasoningEffort,
      statusValue: statusReasoningEffort,
      fallbackValue: fallbackReasoningEffort
    })
  };
}

export function mergeModelSettingsIntoStatus(status = {}, settings = {}) {
  const model = clean(settings.model);
  const reasoningEffort = clean(settings.reasoningEffort);
  const modelShort = clean(settings.modelShort);
  const provider = clean(settings.provider);
  return {
    ...(status || {}),
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(modelShort ? { modelShort } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {})
  };
}

export function effectiveComposerSettingsSource(status = {}, selectedSession = null) {
  const sessionModel = clean(selectedSession?.model);
  const sessionReasoningEffort = clean(selectedSession?.reasoningEffort);
  const sessionProvider = clean(selectedSession?.provider);
  return {
    model: sessionModel || clean(status?.model),
    reasoningEffort: sessionReasoningEffort || clean(status?.reasoningEffort),
    provider: sessionProvider || clean(status?.provider),
    modelShort: clean(status?.modelShort)
  };
}

export function shouldApplyModelSettings(settings = {}, selectedSession = null) {
  const sessionId = clean(settings.sessionId);
  if (!sessionId) {
    return true;
  }
  return sessionId === clean(selectedSession?.id);
}
