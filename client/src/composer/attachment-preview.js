/**
 * 判断附件是否为图片并生成本地图片预览 URL（Cookie 鉴权，不拼 token）。
 *
 * Keywords: attachment, image, preview URL, local-image, cookie-auth
 *
 * Exports:
 * - isImageAttachment — 按 kind 或 MIME 判断是否为图片。
 * - attachmentPreviewUrl — 拼接 /api/local-image 查询串。
 *
 * Inward: 附件对象字段 path、mimeType、kind。
 *
 * Outward: Composer.jsx 与消息渲染中的图片引用。
 */

export function isImageAttachment(attachment = {}) {
  const mimeType = String(attachment.mimeType || '').toLowerCase();
  return attachment.kind === 'image' || mimeType.startsWith('image/');
}

export function attachmentPreviewUrl(attachment = {}) {
  const imagePath = String(attachment.path || '').trim();
  if (!imagePath) {
    return '';
  }
  return `/api/local-image?path=${encodeURIComponent(imagePath)}`;
}
