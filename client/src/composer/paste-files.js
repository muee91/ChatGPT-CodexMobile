/**
 * 从 ClipboardData 抽取 File 列表并去重，供 Composer 粘贴上传。
 *
 * Keywords: clipboard, paste, file upload, dedupe
 *
 * Exports:
 * - filesFromClipboardData — 合并 files 与 items 中的文件并按键去重。
 *
 * Inward: 浏览器 Clipboard API 数据结构。
 *
 * Outward: Composer.jsx
 */

function fileKey(file) {
  return [
    file?.name || '',
    file?.size ?? '',
    file?.type || ''
  ].join(':');
}

export function filesFromClipboardData(clipboardData) {
  if (!clipboardData) {
    return [];
  }

  const files = [];
  const seen = new Set();
  const addFile = (file) => {
    if (!file) {
      return;
    }
    const key = fileKey(file);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    files.push(file);
  };

  for (const file of Array.from(clipboardData.files || [])) {
    addFile(file);
  }

  for (const item of Array.from(clipboardData.items || [])) {
    if (item?.kind !== 'file' || typeof item.getAsFile !== 'function') {
      continue;
    }
    addFile(item.getAsFile());
  }

  return files;
}
