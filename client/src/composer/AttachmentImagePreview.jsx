/**
 * 认证图片预览：通过 apiBlobFetch 读取，兼容 Android WebView 的 Bearer 认证。
 */

import { Image } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiBlobFetch } from '../api.js';
import { attachmentPreviewUrl } from './attachment-preview.js';

export function AttachmentImagePreview({ attachment }) {
  const [preview, setPreview] = useState({ attachmentId: '', url: '', failed: false });
  const attachmentId = String(attachment?.id || '');
  const requestUrl = attachmentPreviewUrl(attachment);

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    if (!attachmentId || !requestUrl) {
      setPreview({ attachmentId, url: '', failed: true });
      return undefined;
    }
    setPreview({ attachmentId, url: '', failed: false });
    apiBlobFetch(requestUrl)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview({ attachmentId, url: objectUrl, failed: false });
      })
      .catch(() => {
        if (active) setPreview({ attachmentId, url: '', failed: true });
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachmentId, requestUrl]);

  if (preview.attachmentId === attachmentId && preview.url) {
    return <img src={preview.url} alt={attachment?.name || '图片附件'} />;
  }
  return <span className="attachment-preview-empty" aria-label={preview.failed ? '图片预览加载失败' : '图片预览加载中'}><Image size={18} /></span>;
}
