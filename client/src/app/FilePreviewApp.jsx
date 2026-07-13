/**
 * 独立/内嵌文件预览入口：按类型渲染 PDF/Office/HTML/Markdown/文本/媒体或下载 fallback，并提供工具栏与外链分享。
 *
 * Keywords: file-preview, embedded-preview, pdf, office, html, spreadsheet, presentation, media
 *
 * Exports:
 * - default — `FilePreviewApp`（由 `main` 按需挂载的整页预览壳）。
 *
 * Inward: `api`；`MarkdownContent`、`PdfPreview`、`session-utils`（路径与本地文件 URL）、`pwa-theme`。
 *
 * Outward: `main.jsx` 单独路由或入口挂载。
 */

import { ArrowLeft, Check, Code2, Copy, ExternalLink, FileText, Minus, PanelsTopLeft, Plus, RefreshCw, Save, Share2, Table2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch, apiRequestHeaders, getServerUrl, resolveApiUrl } from '../api.js';
import { MarkdownContent } from '../chat/MarkdownContent.jsx';
import { copyTextToClipboard } from '../utils/clipboard.js';
import { THEME_KEY } from './AppState.js';
import { PdfPreview } from './PdfPreview.jsx';
import { resolvePwaTheme } from './pwa-theme.js';
import { compactPath, localFileApiPath, localFilePreviewDataPath, normalizeLocalFileTarget } from './session-utils.js';

function fileNameFromPath(value) {
  const normalized = String(value || '').replaceAll('\\', '/');
  return normalized.split('/').filter(Boolean).pop() || '文件预览';
}

function previewKind(pathValue, contentType) {
  const lowerType = String(contentType || '').toLowerCase();
  const lowerPath = String(pathValue || '').toLowerCase();
  if (lowerType.startsWith('image/') || /\.(?:png|jpe?g|webp|gif|svg|ico)(?:$|[:?#])/i.test(lowerPath)) {
    return 'image';
  }
  if (lowerType.startsWith('video/') || /\.(?:mp4|m4v|mov|webm|ogv)(?:$|[:?#])/i.test(lowerPath)) {
    return 'video';
  }
  if (lowerType.startsWith('audio/') || /\.(?:mp3|m4a|aac|wav|ogg|flac)(?:$|[:?#])/i.test(lowerPath)) {
    return 'audio';
  }
  if (lowerType.includes('pdf') || /\.pdf(?:$|[:?#])/i.test(lowerPath)) {
    return 'pdf';
  }
  if (
    lowerType.includes('wordprocessingml.document') ||
    lowerType.includes('application/msword') ||
    /\.(?:docx|docm|doc)(?:$|[:?#])/i.test(lowerPath)
  ) {
    return 'word';
  }
  if (lowerType.includes('presentationml.presentation') || lowerType.includes('ms-powerpoint') || /\.(?:pptx|ppt)(?:$|[:?#])/i.test(lowerPath)) {
    return 'presentation';
  }
  if (lowerType.includes('spreadsheetml.sheet') || lowerType.includes('ms-excel') || /\.(?:xlsx|xls|csv)(?:$|[:?#])/i.test(lowerPath)) {
    return 'spreadsheet';
  }
  if (lowerType.includes('html') || /\.html?(?:$|[:?#])/i.test(lowerPath)) {
    return 'html';
  }
  if (
    lowerType.includes('markdown') ||
    /\.(?:md|markdown)(?:$|[:?#])/i.test(lowerPath)
  ) {
    return 'markdown';
  }
  if (lowerType.startsWith('text/') || /\.(?:txt|csv|json|log|xml|html?|js|jsx|ts|tsx|css)(?:$|[:?#])/i.test(lowerPath)) {
    return 'text';
  }
  return 'download';
}

function usesPreviewDataApi(kind) {
  return kind === 'word' || kind === 'html' || kind === 'spreadsheet' || kind === 'presentation';
}

function previewKindLabel(kind) {
  if (kind === 'spreadsheet') {
    return '表格';
  }
  if (kind === 'presentation') {
    return 'PPT';
  }
  return kind.toUpperCase();
}

function previewKindIcon(kind) {
  if (kind === 'spreadsheet') {
    return <Table2 size={15} />;
  }
  if (kind === 'presentation') {
    return <PanelsTopLeft size={15} />;
  }
  if (kind === 'word' || kind === 'html') {
    return <FileText size={15} />;
  }
  return <Code2 size={15} />;
}

function isNativeMediaKind(kind) {
  return kind === 'image' || kind === 'video' || kind === 'audio';
}

function stripFrontmatter(value) {
  const text = String(value || '');
  if (!text.startsWith('---')) {
    return text;
  }
  return text.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trimStart();
}

function cleanMimeType(value, fallback = 'application/octet-stream') {
  return String(value || fallback).split(';')[0].trim() || fallback;
}

export default function FilePreviewApp() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const filePath = params.get('path') || '';
  const resolvedFilePath = normalizeLocalFileTarget(filePath);
  const embedded = params.get('embed') === '1';
  const rawFilePath = localFileApiPath(resolvedFilePath);
  const rawFileUrl = resolveApiUrl(rawFilePath);
  const [mode, setMode] = useState('rendered');
  const [fontScale, setFontScale] = useState(1);
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [state, setState] = useState({
    loading: true,
    error: '',
    text: '',
    html: '',
    sheets: [],
    slides: [],
    objectUrl: '',
    pdfData: null,
    contentType: '',
    mtimeMs: 0,
    editable: false
  });
  const [sheetIndex, setSheetIndex] = useState(0);

  useEffect(() => {
    const theme = resolvePwaTheme(localStorage.getItem(THEME_KEY), window);
    const previousTheme = document.documentElement.dataset.theme;
    const previewEmbeddedClass = 'is-file-preview-embedded';
    const previousBody = {
      position: document.body.style.position,
      inset: document.body.style.inset,
      overflow: document.body.style.overflow,
      touchAction: document.body.style.touchAction
    };
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle(previewEmbeddedClass, embedded);
    document.documentElement.style.overflow = 'hidden';
    document.body.style.position = 'static';
    document.body.style.inset = 'auto';
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'pan-y';
    return () => {
      if (previousTheme) {
        document.documentElement.dataset.theme = previousTheme;
      } else {
        delete document.documentElement.dataset.theme;
      }
      document.documentElement.classList.remove(previewEmbeddedClass);
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.position = previousBody.position;
      document.body.style.inset = previousBody.inset;
      document.body.style.overflow = previousBody.overflow;
      document.body.style.touchAction = previousBody.touchAction;
    };
  }, [embedded]);

  useEffect(() => {
    let stopped = false;
    let objectUrl = '';

    async function loadFile() {
      if (!filePath) {
        setState({ loading: false, error: '缺少文件路径', text: '', html: '', sheets: [], slides: [], objectUrl: '', pdfData: null, contentType: '', mtimeMs: 0, editable: false });
        return;
      }
      setSheetIndex(0);
      setState({ loading: true, error: '', text: '', html: '', sheets: [], slides: [], objectUrl: '', pdfData: null, contentType: '', mtimeMs: 0, editable: false });
      try {
        const pathKind = previewKind(resolvedFilePath || filePath, '');
        if (isNativeMediaKind(pathKind) || pathKind === 'pdf') {
          setState({
            loading: false,
            error: '',
            text: '',
            html: '',
            sheets: [],
            slides: [],
            objectUrl: '',
            pdfData: null,
            contentType: pathKind === 'pdf' ? 'application/pdf' : '',
            mtimeMs: 0,
            editable: false
          });
          return;
        }
        if (usesPreviewDataApi(pathKind)) {
          const result = await apiFetch(localFilePreviewDataPath(resolvedFilePath));
          if (!stopped) {
            setState({
              loading: false,
              error: '',
              text: '',
              html: result.html || '',
              sheets: Array.isArray(result.sheets) ? result.sheets : [],
              slides: Array.isArray(result.slides) ? result.slides : [],
              objectUrl: '',
              pdfData: null,
              contentType: result.kind || pathKind,
              mtimeMs: Number(result.mtimeMs || 0),
              editable: false
            });
          }
          return;
        }
        const configuredServerUrl = getServerUrl();
        const response = await fetch(resolveApiUrl(localFileApiPath(resolvedFilePath)), {
          credentials: configuredServerUrl ? 'include' : 'same-origin',
          headers: apiRequestHeaders()
        });
        if (!response.ok) {
          const text = await response.text();
          let message = `Request failed: ${response.status}`;
          try {
            message = JSON.parse(text).error || message;
          } catch {
            message = text || message;
          }
          throw new Error(message);
        }
        const blob = await response.blob();
        if (stopped) {
          return;
        }
        const kind = previewKind(resolvedFilePath || filePath, blob.type);
        const mtimeMs = Number(response.headers.get('x-local-file-mtime-ms') || 0);
        const editable = response.headers.get('x-local-file-editable') === '1';
        if (kind === 'markdown' || kind === 'text') {
          const text = await blob.text();
          if (!stopped) {
            setDraft(text);
            setState({ loading: false, error: '', text, html: '', sheets: [], slides: [], objectUrl: '', pdfData: null, contentType: blob.type, mtimeMs, editable });
          }
          return;
        }
        if (kind === 'pdf') {
          const pdfData = await blob.arrayBuffer();
          setState({ loading: false, error: '', text: '', html: '', sheets: [], slides: [], objectUrl: '', pdfData, contentType: blob.type, mtimeMs, editable: false });
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setState({ loading: false, error: '', text: '', html: '', sheets: [], slides: [], objectUrl, contentType: blob.type, mtimeMs, editable: false });
      } catch (error) {
        if (!stopped) {
          setState({
            loading: false,
            error: error?.message || '文件读取失败',
            text: '',
            html: '',
            sheets: [],
            slides: [],
            objectUrl: '',
            pdfData: null,
            contentType: '',
            mtimeMs: 0,
            editable: false
          });
        }
      }
    }

    loadFile();
    return () => {
      stopped = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [filePath, resolvedFilePath]);

  const kind = previewKind(resolvedFilePath || filePath, state.contentType);
  const title = fileNameFromPath(filePath);
  const subtitle = compactPath(filePath);
  const canRenderMarkdown = kind === 'markdown';
  const canEdit = state.editable && (kind === 'markdown' || kind === 'text');
  const canAdjustFont = kind === 'markdown' || kind === 'text' || kind === 'word' || kind === 'spreadsheet' || kind === 'presentation';
  const editing = mode === 'edit';
  const markdownText = canRenderMarkdown ? stripFrontmatter(state.text) : state.text;
  const sheets = Array.isArray(state.sheets) ? state.sheets : [];
  const slides = Array.isArray(state.slides) ? state.slides : [];
  const selectedSheet = sheets[Math.min(sheetIndex, Math.max(0, sheets.length - 1))] || null;

  async function handleCopyPath() {
    const ok = await copyTextToClipboard(filePath);
    if (!ok) {
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  async function fileBlobForShare() {
    const type = cleanMimeType(state.contentType);
    if (state.pdfData) {
      return new Blob([state.pdfData], { type });
    }
    if (kind === 'markdown' || kind === 'text') {
      return new Blob([state.text], { type });
    }
    if (state.objectUrl) {
      const response = await fetch(state.objectUrl);
      return response.blob();
    }
    const configuredServerUrl = getServerUrl();
    const response = await fetch(rawFileUrl, {
      credentials: configuredServerUrl ? 'include' : 'same-origin',
      headers: apiRequestHeaders()
    });
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    return response.blob();
  }

  async function handleShareFile() {
    if (!filePath || state.loading || state.error || sharing) {
      return;
    }
    const fileUrl = new URL(rawFileUrl, window.location.href).href;
    setSharing(true);
    setNotice('');
    try {
      if (!navigator.share) {
        const copiedUrl = await copyTextToClipboard(fileUrl);
        setNotice(copiedUrl ? '当前环境不支持系统分享，已复制文件链接' : '当前环境不支持系统分享');
        window.setTimeout(() => setNotice(''), 1600);
        return;
      }
      const blob = await fileBlobForShare();
      const file = new File([blob], title, {
        type: cleanMimeType(blob.type || state.contentType),
        lastModified: state.mtimeMs || Date.now()
      });
      const payload = { title, files: [file] };
      if (!navigator.canShare || navigator.canShare(payload)) {
        await navigator.share(payload);
        return;
      }
      await navigator.share({ title, url: fileUrl });
    } catch (error) {
      if (error?.name !== 'AbortError') {
        setNotice(error?.message || '分享失败');
        window.setTimeout(() => setNotice(''), 1800);
      }
    } finally {
      setSharing(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setNotice('');
    try {
      const result = await apiFetch(rawFilePath, {
        method: 'PUT',
        body: {
          content: draft,
          baseMtimeMs: state.mtimeMs
        }
      });
      setState((current) => ({
        ...current,
        text: draft,
        mtimeMs: result.mtimeMs || current.mtimeMs
      }));
      setMode(canRenderMarkdown ? 'rendered' : 'raw');
      setNotice('已保存');
      window.setTimeout(() => setNotice(''), 1400);
    } catch (error) {
      setNotice(error?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={`file-preview-page ${embedded ? 'is-embedded' : ''}`} style={{ '--preview-font-scale': fontScale }}>
      {!embedded ? (
        <header className="file-preview-header">
          <button type="button" className="file-preview-icon-button" onClick={() => window.history.back()} aria-label="返回">
            <ArrowLeft size={18} />
          </button>
          <div className="file-preview-title">
            <strong>{title}</strong>
            <span>{subtitle}</span>
          </div>
          <div className="file-preview-header-actions">
            <button type="button" className="file-preview-icon-button" onClick={handleCopyPath} aria-label="复制路径">
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
            <button
              type="button"
              className="file-preview-icon-button"
              onClick={handleShareFile}
              disabled={sharing || state.loading || !!state.error}
              aria-label="分享文件"
            >
              <Share2 size={16} />
            </button>
            <button type="button" className="file-preview-icon-button" onClick={() => window.location.reload()} aria-label="刷新">
              <RefreshCw size={17} />
            </button>
          </div>
        </header>
      ) : null}

      {kind !== 'pdf' ? (
        <div className="file-preview-toolbar" aria-label="预览工具">
          {canRenderMarkdown ? (
            <div className="file-preview-segmented">
              <button type="button" className={mode === 'rendered' ? 'is-active' : ''} onClick={() => setMode('rendered')}>
                <FileText size={15} />
                <span>渲染</span>
              </button>
              {canEdit ? (
                <button type="button" className={mode === 'edit' ? 'is-active' : ''} onClick={() => setMode('edit')}>
                  <Save size={15} />
                  <span>编辑</span>
                </button>
              ) : null}
            </div>
          ) : (
            <div className="file-preview-segmented">
              <button type="button" className={mode !== 'edit' ? 'is-active' : ''} onClick={() => setMode('raw')}>
                {previewKindIcon(kind)}
                <span>{previewKindLabel(kind)}</span>
              </button>
              {canEdit ? (
                <button type="button" className={mode === 'edit' ? 'is-active' : ''} onClick={() => setMode('edit')}>
                  <Save size={15} />
                  <span>编辑</span>
                </button>
              ) : null}
            </div>
          )}
          <div className="file-preview-tool-buttons">
            {editing ? (
              <>
                <button type="button" onClick={handleSave} disabled={saving || draft === state.text} aria-label="保存">
                  <Save size={15} />
                </button>
                <button type="button" onClick={() => { setDraft(state.text); setMode(canRenderMarkdown ? 'rendered' : 'raw'); }} aria-label="取消编辑">
                  <X size={15} />
                </button>
              </>
            ) : null}
            {canAdjustFont ? (
              <>
                <button type="button" onClick={() => setFontScale((value) => Math.max(0.88, value - 0.06))} aria-label="缩小字号">
                  <Minus size={15} />
                </button>
                <button type="button" onClick={() => setFontScale((value) => Math.min(1.28, value + 0.06))} aria-label="放大字号">
                  <Plus size={15} />
                </button>
              </>
            ) : null}
            <a href={rawFileUrl} target="_blank" rel="noreferrer noopener" aria-label="打开原文件">
              <ExternalLink size={15} />
            </a>
          </div>
        </div>
      ) : null}

      <section className="file-preview-body">
        {notice ? <div className={`file-preview-notice ${notice === '已保存' ? 'is-success' : 'is-error'}`}>{notice}</div> : null}
        {state.loading ? <div className="file-preview-status">正在读取文件...</div> : null}
        {!state.loading && state.error ? (
          <div className="file-preview-error">
            <strong>{state.error}</strong>
            <span>{filePath || '未提供路径'}</span>
          </div>
        ) : null}
        {!state.loading && !state.error && kind === 'markdown' && mode === 'rendered' ? (
          <MarkdownContent text={markdownText} className="file-preview-markdown message-content" />
        ) : null}
        {!state.loading && !state.error && kind === 'word' ? (
          <article className="file-preview-word" dangerouslySetInnerHTML={{ __html: state.html || '<p>Word 文档没有可预览文本。</p>' }} />
        ) : null}
        {!state.loading && !state.error && kind === 'html' ? (
          <iframe
            className="file-preview-html-frame"
            title={title}
            sandbox=""
            srcDoc={state.html || '<p>HTML 文件没有可预览内容。</p>'}
          />
        ) : null}
        {!state.loading && !state.error && kind === 'spreadsheet' ? (
          <div className="file-preview-sheet">
            {sheets.length > 1 ? (
              <div className="file-preview-sheet-tabs">
                {sheets.map((sheet, index) => (
                  <button
                    key={`${sheet.name || 'sheet'}-${index}`}
                    type="button"
                    className={index === sheetIndex ? 'is-active' : ''}
                    onClick={() => setSheetIndex(index)}
                  >
                    {sheet.name || `Sheet ${index + 1}`}
                  </button>
                ))}
              </div>
            ) : null}
            {selectedSheet?.rows?.length ? (
              <div className="file-preview-sheet-scroll">
                <table>
                  <tbody>
                    {selectedSheet.rows.map((row, rowIndex) => (
                      <tr key={`row-${rowIndex}`}>
                        {row.map((cell, cellIndex) => (
                          rowIndex === 0 ? (
                            <th key={`cell-${rowIndex}-${cellIndex}`}>{cell}</th>
                          ) : (
                            <td key={`cell-${rowIndex}-${cellIndex}`}>{cell}</td>
                          )
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="file-preview-status">表格没有可预览内容。</div>
            )}
          </div>
        ) : null}
        {!state.loading && !state.error && kind === 'presentation' ? (
          <div className="file-preview-presentation">
            {slides.length ? slides.map((slide, index) => (
              <article className="file-preview-slide" key={`slide-${slide.index || index}`}>
                <div className="file-preview-slide-number">P{String(slide.index || index + 1).padStart(2, '0')}</div>
                <h2>{slide.title || `Slide ${index + 1}`}</h2>
                {Array.isArray(slide.texts) && slide.texts.length ? (
                  <ul>
                    {slide.texts.slice(1).map((text, textIndex) => (
                      <li key={`slide-${slide.index || index}-${textIndex}`}>{text}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            )) : <div className="file-preview-status">PPT 没有可预览文本。</div>}
          </div>
        ) : null}
        {!state.loading && !state.error && !editing && (kind === 'text' || (kind === 'markdown' && mode === 'raw')) ? (
          <pre className="file-preview-text">{state.text}</pre>
        ) : null}
        {!state.loading && !state.error && editing ? (
          <textarea
            className="file-preview-editor"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
          />
        ) : null}
        {!state.loading && !state.error && kind === 'pdf' ? (
          <PdfPreview data={state.pdfData} fileUrl={rawFileUrl} />
        ) : null}
        {!state.loading && !state.error && kind === 'image' ? (
          <div className="file-preview-media-shell">
            <img
              className="file-preview-media"
              src={rawFileUrl}
              alt={title}
              onError={() => setState((current) => ({ ...current, error: '图片加载失败' }))}
            />
          </div>
        ) : null}
        {!state.loading && !state.error && kind === 'video' ? (
          <div className="file-preview-media-shell">
            <video
              className="file-preview-media"
              src={rawFileUrl}
              controls
              playsInline
              preload="metadata"
              onError={() => setState((current) => ({ ...current, error: '视频加载失败' }))}
            />
          </div>
        ) : null}
        {!state.loading && !state.error && kind === 'audio' ? (
          <div className="file-preview-media-shell is-audio">
            <audio
              className="file-preview-audio"
              src={rawFileUrl}
              controls
              preload="metadata"
              onError={() => setState((current) => ({ ...current, error: '音频加载失败' }))}
            />
          </div>
        ) : null}
        {!state.loading && !state.error && kind === 'download' && state.objectUrl ? (
          <a className="file-preview-open" href={state.objectUrl} target="_blank" rel="noreferrer noopener">
            <ExternalLink size={16} />
            <span>打开文件</span>
          </a>
        ) : null}
      </section>
    </main>
  );
}
