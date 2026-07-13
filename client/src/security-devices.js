/**
 * 设置页安全设备列表的轻量数据模型：排序、摘要与当前设备识别。
 *
 * Keywords: security-devices, trusted-devices, delete, logout
 *
 * Exports:
 * - sortDevicesForDisplay — 当前设备优先，再按最近访问排序。
 * - deviceStatusText / deviceMetaText — 设备状态与元信息摘要。
 *
 * Inward（本模块依赖/组装的关键符号）: 设备 API 返回对象。
 *
 * Outward（谁在用/调用场景）: panels/DrawerSettingsView.jsx 与 security-devices 测试。
 *
 * 不负责: HTTP 请求与 UI 事件。
 */
export function sortDevicesForDisplay(devices = []) {
  return [...devices].sort((left, right) => {
    if (left.current !== right.current) return left.current ? -1 : 1;
    return Date.parse(right.lastSeenAt || right.createdAt || 0) - Date.parse(left.lastSeenAt || left.createdAt || 0);
  });
}

export function deviceStatusText(device = {}) {
  if (device.current) return '当前设备';
  return '已信任';
}

export function deviceMetaText(device = {}) {
  const parts = [];
  if (device.lastRemoteAddress) {
    parts.push(device.lastRemoteAddress);
  }
  const lastSeenAt = device.lastSeenAt || device.createdAt;
  if (lastSeenAt) {
    const timestamp = new Date(lastSeenAt);
    if (!Number.isNaN(timestamp.getTime())) {
      parts.push(timestamp.toLocaleString());
    }
  }
  const agent = String(device.lastUserAgent || device.userAgent || '').split(') ')[0]?.replace('(', '') || '';
  if (agent) {
    parts.push(agent);
  }
  return parts.join(' · ') || '暂无访问记录';
}
