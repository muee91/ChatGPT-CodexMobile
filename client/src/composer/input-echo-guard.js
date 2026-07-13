/**
 * 过滤移动端输入法在提交后回灌的旧文本，避免已发送内容重新出现在输入框。
 *
 * Keywords: composer, input, ime, android, stale-echo
 *
 * Exports:
 * - createSubmittedInputGuard — 记录最近一次提交文本，并判断后续 change 是否是陈旧回灌。
 *
 * Inward: 无；纯函数状态机。
 *
 * Outward: Composer.jsx。
 *
 * 不负责: 正常输入内容的去重或持久化。
 */

export function createSubmittedInputGuard() {
  let pendingSubmittedText = '';

  return {
    markSubmitted(text) {
      pendingSubmittedText = String(text || '').trim();
    },
    clear() {
      pendingSubmittedText = '';
    },
    shouldIgnoreIncoming({ currentInput = '', nextInput = '' } = {}) {
      const current = String(currentInput || '');
      const next = String(nextInput || '');
      if (!pendingSubmittedText) {
        return false;
      }
      if (!current.trim() && next.trim() === pendingSubmittedText) {
        pendingSubmittedText = '';
        return true;
      }
      if (next.trim() !== pendingSubmittedText) {
        pendingSubmittedText = '';
      }
      return false;
    }
  };
}
