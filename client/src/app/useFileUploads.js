/**
 * 将用户选择的文件经 `/api/uploads` 上传，并把返回的附件附加到 Composer 与消息列表。
 *
 * Keywords: file-upload, attachments, formdata
 *
 * Exports:
 * - `useFileUploads` — 提供 `handleUploadFiles` 与上传中状态的 hook。
 *
 * Inward: `api`。
 *
 * Outward: `App.jsx` Composer 附件流程。
 */

import { apiFetch } from '../api.js';

export function useFileUploads({
  setUploading,
  appendAttachmentToDraftKey,
  setMessages,
  getAttachmentWriteTarget,
  isAttachmentWriteTargetCurrent
}) {
  async function handleUploadFiles(files) {
    setUploading(true);
    const writeTarget = getAttachmentWriteTarget?.() || null;
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        const result = await apiFetch('/api/uploads', {
          method: 'POST',
          body: formData
        });
        if (writeTarget && !isAttachmentWriteTargetCurrent?.(writeTarget)) {
          continue;
        }
        appendAttachmentToDraftKey?.(writeTarget?.key, result.upload);
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `upload-error-${Date.now()}`,
          role: 'activity',
          content: error.message,
          timestamp: new Date().toISOString()
        }
      ]);
    } finally {
      setUploading(false);
    }
  }

  function handleRemoveAttachment(id) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  return {
    handleUploadFiles,
    handleRemoveAttachment
  };
}
