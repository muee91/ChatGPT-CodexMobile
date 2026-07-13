/**
 * 校验并归一化 Codex service tier 字符串（仅 fast / flex 有效）。
 *
 * Keywords: service-tier, normalizeServiceTier, codex, validation
 *
 * Exports:
 * - normalizeServiceTier — 合法 tier 返回原值，否则 null。
 *
 * Inward（本模块依赖/组装的关键符号）: 无。
 *
 * Outward（谁在用/调用场景）: server chat-request-prep、codex-runner。
 */

const SERVICE_TIERS = new Set(['fast', 'flex']);

export function normalizeServiceTier(value) {
  const serviceTier = String(value || '').trim();
  return SERVICE_TIERS.has(serviceTier) ? serviceTier : null;
}
