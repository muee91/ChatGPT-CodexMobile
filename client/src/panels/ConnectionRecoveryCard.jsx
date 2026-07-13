/**
 * 展示连接 / 配对异常时的恢复操作条（重试、同步、状态、配对等）。
 *
 * Keywords: connection, recovery, UI, pairing, retry
 *
 * Exports:
 * - ConnectionRecoveryCard — 连接恢复卡片组件。
 *
 * Inward: React；由父组件注入回调与状态文案。
 *
 * Outward: 主布局在断线、重连或需重新配对时挂载。
 */

export function ConnectionRecoveryCard({ state, onRetry, onSync, onPair, onStatus }) {
  if (!state) {
    return null;
  }

  function runAction(action) {
    if (action === 'pair') {
      onPair?.();
    } else if (action === 'sync') {
      onSync?.();
    } else if (action === 'status') {
      onStatus?.();
    } else {
      onRetry?.();
    }
  }

  return (
    <section className={`connection-recovery-card is-${state.state}`} aria-label="连接恢复">
      <span className="connection-recovery-dot" />
      <span className="connection-recovery-main">
        <strong>{state.title}</strong>
        <small>{state.detail}</small>
      </span>
      <button type="button" onClick={() => runAction(state.primaryAction)}>
        {state.primaryLabel}
      </button>
      {state.secondaryAction ? (
        <button type="button" onClick={() => runAction(state.secondaryAction)}>
          {state.secondaryLabel}
        </button>
      ) : null}
    </section>
  );
}
