/**
 * Markdown 消息正文：GFM、安全链接、本地文件/图片/视频、Mermaid、代码块与记忆引用展示。
 *
 * Keywords: react-markdown, message content, citation, media preview
 *
 * Exports:
 * - MarkdownContent、MessageContent — 完整与拆分正文渲染。
 * - contentWithAttachmentPreviews、splitMessageImages — 附件行与图文拆分。
 *
 * Inward: ../app/session-utils、clipboard、memory-citation、ImagePreview。
 *
 * Outward: ChatMessage.jsx、PlanMessage、ActivityTimeline 等。
 */

import { BookOpen, Check, Copy, RotateCcw } from 'lucide-react';
import { memo, useEffect, useId, useRef, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import {
  isLocalFileSource,
  isLocalImageSource,
  localFileApiPath,
  localFileOpenPath,
  sourceMediaKind
} from '../app/session-utils.js';
import { copyTextToClipboard } from '../utils/clipboard.js';
import { GeneratedImage } from './ImagePreview.jsx';
import { formatCitationLines, shortRolloutId, splitMemoryCitationBlock } from './memory-citation.js';

export function MarkdownContent({ text, onPreviewImage, className = 'message-content' }) {
  const value = String(text || '');

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        skipHtml
        urlTransform={markdownUrlTransform}
        components={{
          a({ node, href, children, ...props }) {
            const safeHref = normalizeInlineHref(href);
            if (!safeHref) {
              return <span {...props}>{children}</span>;
            }
            return (
              <a href={safeHref} target="_blank" rel="noreferrer noopener" {...props}>
                {children}
              </a>
            );
          },
          img({ node, src, alt }) {
            if (!src) {
              return null;
            }
            const kind = sourceMediaKind(src);
            if (kind === 'video' || kind === 'audio') {
              return <MarkdownMediaPreview kind={kind} src={src} title={alt || (kind === 'video' ? '视频' : '音频')} />;
            }
            return <GeneratedImage part={{ type: 'image', url: src, alt: alt || '图片' }} onPreviewImage={onPreviewImage} />;
          },
          table({ node, children, ...props }) {
            return (
              <div className="markdown-table-wrap">
                <table {...props}>{children}</table>
              </div>
            );
          },
          pre({ node, children }) {
            return <>{children}</>;
          },
          code({ node, className, children, ...props }) {
            const language = String(className || '').match(/language-([\w-]+)/)?.[1] || '';
            const isBlock = Boolean(language) || node?.position?.start?.line !== node?.position?.end?.line;
            if (!isBlock) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
            const code = String(children).replace(/\n$/, '');
            if (language.toLowerCase() === 'mermaid') {
              return <MermaidBlock code={code} />;
            }
            return <CodeBlock language={language || 'text'} code={code} />;
          }
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}

const MarkdownMediaPreview = memo(function MarkdownMediaPreview({ kind, src, title }) {
  const [failed, setFailed] = useState(false);
  const raw = String(src || '').trim();
  const mediaSrc = isLocalFileSource(raw) ? localFileApiPath(raw) : raw;
  const label = title || (kind === 'video' ? '视频' : '音频');
  if (!mediaSrc) {
    return null;
  }

  return (
    <div className={`message-media-card is-${kind} ${failed ? 'is-failed' : ''}`}>
      {kind === 'video' ? (
        <video
          className="message-media"
          src={mediaSrc}
          controls
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
        />
      ) : (
        <audio
          className="message-media-audio"
          src={mediaSrc}
          controls
          preload="metadata"
          onError={() => setFailed(true)}
        />
      )}
      <div className="message-media-meta">
        <span>{failed ? `${label}加载失败` : label}</span>
        <a href={mediaSrc} target="_blank" rel="noreferrer noopener">
          打开文件
        </a>
      </div>
    </div>
  );
});

export function MessageContent({ content, onPreviewImage, usePlainText = false }) {
  const { text, citation } = splitMemoryCitationBlock(content);
  return (
    <>
      {text ? (
        usePlainText
          ? <div className="message-content message-content-plain">{text}</div>
          : <MarkdownContent text={text} onPreviewImage={onPreviewImage} />
      ) : null}
      {citation ? <MemoryCitationBlock citation={citation} /> : null}
    </>
  );
}

function MemoryCitationBlock({ citation }) {
  const entries = Array.isArray(citation?.entries) ? citation.entries : [];
  const rolloutIds = Array.isArray(citation?.rolloutIds) ? citation.rolloutIds : [];
  if (!entries.length && !rolloutIds.length) {
    return null;
  }
  const count = entries.length || rolloutIds.length;

  return (
    <details className="memory-citation-card">
      <summary>
        <span className="memory-citation-icon" aria-hidden="true">
          <BookOpen size={14} />
        </span>
        <span className="memory-citation-title">{count} 条记忆引用</span>
      </summary>
      <div className="memory-citation-body">
        {entries.length ? (
          <ul className="memory-citation-list">
            {entries.map((entry, index) => (
              <li key={`${entry.file}-${entry.lineStart}-${entry.lineEnd}-${index}`}>
                <span className="memory-citation-file">{entry.file}</span>
                <span className="memory-citation-lines">{formatCitationLines(entry)}</span>
                {entry.note ? <span className="memory-citation-note">{entry.note}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {rolloutIds.length ? (
          <div className="memory-citation-rollouts">
            {rolloutIds.length} 个 rollout：{rolloutIds.map(shortRolloutId).join('、')}
          </div>
        ) : null}
      </div>
    </details>
  );
}

const mermaidRenderCache = new Map();

function stableHash(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function resolvedMermaidTheme() {
  if (typeof document === 'undefined') {
    return 'light';
  }
  return document.documentElement?.dataset?.theme === 'dark' ? 'dark' : 'light';
}

function mermaidThemeVariables(theme) {
  if (theme === 'dark') {
    return {
      darkMode: true,
      background: '#101012',
      mainBkg: '#18181b',
      primaryColor: '#18181b',
      primaryTextColor: '#f4f4f5',
      primaryBorderColor: '#3f3f46',
      secondaryColor: '#27272a',
      tertiaryColor: '#111113',
      lineColor: '#a1a1aa',
      textColor: '#f4f4f5',
      edgeLabelBackground: '#18181b',
      clusterBkg: '#111113',
      clusterBorder: '#3f3f46',
      fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    };
  }
  return {
    darkMode: false,
    background: '#ffffff',
    mainBkg: '#f8fafc',
    primaryColor: '#f8fafc',
    primaryTextColor: '#1f2937',
    primaryBorderColor: '#cfd5dd',
    secondaryColor: '#eef2f7',
    tertiaryColor: '#ffffff',
    lineColor: '#64748b',
    textColor: '#1f2937',
    edgeLabelBackground: '#ffffff',
    clusterBkg: '#ffffff',
    clusterBorder: '#cfd5dd',
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  };
}

function useMermaidTheme() {
  const [theme, setTheme] = useState(() => resolvedMermaidTheme());

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }
    const update = () => setTheme(resolvedMermaidTheme());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', update);
    return () => {
      observer.disconnect();
      media?.removeEventListener?.('change', update);
    };
  }, []);

  return theme;
}

function MermaidBlock({ code }) {
  const rawId = useId();
  const theme = useMermaidTheme();
  const instanceIdRef = useRef(`mermaid-${rawId.replace(/[^a-zA-Z0-9_-]/g, '') || stableHash(code)}`);
  const cacheKey = `${theme}:${stableHash(code)}:${code}`;
  const [rendered, setRendered] = useState(() => mermaidRenderCache.get(cacheKey) || { svg: '', error: '' });
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef(null);

  useEffect(() => {
    const cached = mermaidRenderCache.get(cacheKey);
    if (cached) {
      setRendered(cached);
      return undefined;
    }
    let cancelled = false;
    setRendered((current) => current.svg ? current : { svg: '', error: '' });
    const diagramId = `${instanceIdRef.current}-${theme}-${stableHash(code)}`;
    import('mermaid')
      .then(({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          themeVariables: mermaidThemeVariables(theme)
        });
        return mermaid.render(diagramId, code);
      })
      .then(({ svg }) => {
        const next = { svg, error: '' };
        mermaidRenderCache.set(cacheKey, next);
        if (!cancelled) {
          setRendered(next);
        }
      })
      .catch((error) => {
        const next = { svg: '', error: error?.message || 'Mermaid 渲染失败' };
        mermaidRenderCache.set(cacheKey, next);
        if (!cancelled) {
          setRendered(next);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, code, theme]);

  useEffect(() => () => {
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
  }, []);

  async function handleCopy() {
    const ok = await copyTextToClipboard(code);
    if (!ok) {
      return;
    }
    setCopied(true);
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className={`markdown-mermaid-block ${rendered.error ? 'is-error' : ''}`}>
      <div className="markdown-code-head">
        <span>mermaid</span>
        <button type="button" onClick={handleCopy} aria-label="复制 Mermaid 源码">
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
      {rendered.svg ? (
        <div className="markdown-mermaid-canvas" dangerouslySetInnerHTML={{ __html: rendered.svg }} />
      ) : rendered.error ? (
        <div className="markdown-mermaid-error">
          <RotateCcw size={14} />
          <span>{rendered.error}</span>
        </div>
      ) : (
        <div className="markdown-mermaid-loading">正在渲染图表</div>
      )}
    </div>
  );
}

function CodeBlock({ language, code }) {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef(null);

  useEffect(() => () => {
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
  }, []);

  async function handleCopy() {
    const ok = await copyTextToClipboard(code);
    if (!ok) {
      return;
    }
    setCopied(true);
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-head">
        <span>{language}</span>
        <button type="button" onClick={handleCopy} aria-label="复制代码">
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
      <pre>
        <code className={`language-${language}`}>{code}</code>
      </pre>
    </div>
  );
}

function normalizeInlineHref(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (isLocalFileSource(raw)) {
    return localFileOpenPath(raw);
  }
  if (/^https?:\/\//i.test(raw) || /^mailto:/i.test(raw) || raw.startsWith('/') || raw.startsWith('#')) {
    return raw;
  }
  return `https://${raw}`;
}

function markdownUrlTransform(url, key) {
  const raw = String(url || '').trim();
  if (key === 'href' && isLocalFileSource(raw)) {
    return raw;
  }
  if (key === 'src' && /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(raw)) {
    return raw;
  }
  if (key === 'src' && isLocalImageSource(raw)) {
    return raw;
  }
  return defaultUrlTransform(raw);
}

function renderInlineText(text, keyPrefix) {
  const value = String(text || '');
  const pattern = /(`([^`]+)`)|(\*\*([^*]+)\*\*)|(__([^_]+)__)|\[([^\]]+)\]\(((?:https?:\/\/|www\.|mailto:|\/)[^\s)]*)\)|((?:https?:\/\/|www\.)[^\s<>()]+)/gi;
  const nodes = [];
  let lastIndex = 0;
  let match;
  let partIndex = 0;

  while ((match = pattern.exec(value))) {
    if (match.index > lastIndex) {
      nodes.push(<span key={`${keyPrefix}-text-${partIndex++}`}>{value.slice(lastIndex, match.index)}</span>);
    }

    if (match[2]) {
      nodes.push(<code key={`${keyPrefix}-code-${partIndex++}`}>{match[2]}</code>);
    } else if (match[4] || match[6]) {
      nodes.push(<strong key={`${keyPrefix}-strong-${partIndex++}`}>{match[4] || match[6]}</strong>);
    } else if (match[7] && match[8]) {
      const href = normalizeInlineHref(match[8]);
      nodes.push(
        <a key={`${keyPrefix}-link-${partIndex++}`} href={href} target="_blank" rel="noreferrer noopener">
          {match[7]}
        </a>
      );
    } else if (match[9]) {
      const href = normalizeInlineHref(match[9]);
      nodes.push(
        <a key={`${keyPrefix}-link-${partIndex++}`} href={href} target="_blank" rel="noreferrer noopener">
          {match[9]}
        </a>
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < value.length) {
    nodes.push(<span key={`${keyPrefix}-text-${partIndex++}`}>{value.slice(lastIndex)}</span>);
  }

  return nodes.length ? nodes : [<span key={`${keyPrefix}-text-0`}>{value}</span>];
}

function renderInlineWithBreaks(text, keyPrefix) {
  return String(text || '')
    .split('\n')
    .flatMap((line, index, lines) => {
      const nodes = renderInlineText(line, `${keyPrefix}-line-${index}`);
      if (index < lines.length - 1) {
        nodes.push(<br key={`${keyPrefix}-br-${index}`} />);
      }
      return nodes;
    });
}

function markdownImageFromLine(line) {
  const match = String(line || '').trim().match(/^!\[([^\]]*)\]\((?:<([^>]*)>|([^)]*?))\)$/);
  if (!match) {
    return null;
  }
  const url = String(match[2] || match[3] || '').trim();
  if (!url) {
    return null;
  }
  const kind = sourceMediaKind(url);
  if (kind && kind !== 'image') {
    return null;
  }
  return { type: 'image', alt: match[1] || '图片', url };
}

function legacyAttachmentImageFromLine(line) {
  const match = String(line || '').trim().match(/^[-*]\s*图片[:：]\s*(.*?)\s*\((.+)\)\s*$/);
  if (!match) {
    return null;
  }
  const url = String(match[2] || '').trim();
  if (!isLocalImageSource(url) && !/\.(?:png|jpe?g|webp|gif)(?:[?#].*)?$/i.test(url)) {
    return null;
  }
  return { type: 'image', alt: match[1] || '图片', url };
}

function markdownImageDestination(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (/[\s<>()]/.test(raw)) {
    return `<${raw.replace(/>/g, '%3E')}>`;
  }
  return raw;
}

function markdownImageAlt(value) {
  return String(value || '图片').replace(/[\[\]\n\r]/g, '').trim() || '图片';
}

export function contentWithAttachmentPreviews(content, attachments = []) {
  const imageLines = (Array.isArray(attachments) ? attachments : [])
    .filter((attachment) => attachment?.kind === 'image' && attachment.path)
    .map((attachment) => `![${markdownImageAlt(attachment.name)}](${markdownImageDestination(attachment.path)})`)
    .filter(Boolean);
  return [content, imageLines.join('\n')].filter(Boolean).join('\n\n');
}

export function splitMessageImages(content) {
  const textLines = [];
  const images = [];
  const seenImages = new Set();
  for (const line of String(content || '').replace(/\r\n?/g, '\n').split('\n')) {
    const image = markdownImageFromLine(line) || legacyAttachmentImageFromLine(line);
    if (image) {
      const key = image.url || line;
      if (!seenImages.has(key)) {
        seenImages.add(key);
        images.push(image);
      }
    } else {
      textLines.push(line);
    }
  }
  return {
    text: textLines.join('\n').replace(/\n*附件路径[:：]\s*$/g, '').replace(/\n{3,}/g, '\n\n').trim(),
    images
  };
}

function isListLine(line) {
  return /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line);
}

function isBlockStarter(line, nextLine) {
  return (
    /^```/.test(line) ||
    /^#{1,6}\s+/.test(line) ||
    /^>\s?/.test(line) ||
    isListLine(line) ||
    Boolean(markdownImageFromLine(line)) ||
    (line.includes('|') && isTableSeparator(nextLine || ''))
  );
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(String(line || ''));
}

function splitTableRow(line) {
  return String(line || '')
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function renderMarkdownBlocks(content, onPreviewImage) {
  const lines = String(content || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```([^\s`]*)?.*$/);
    if (fence) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push(
        <pre key={`code-${blocks.length}`}>
          <code className={fence[1] ? `language-${fence[1]}` : undefined}>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    const image = markdownImageFromLine(line);
    if (image) {
      blocks.push(<GeneratedImage key={`image-${blocks.length}-${image.url}`} part={image} onPreviewImage={onPreviewImage} />);
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length + 2, 6);
      const HeadingTag = `h${level}`;
      blocks.push(<HeadingTag key={`heading-${blocks.length}`}>{renderInlineWithBreaks(heading[2], `heading-${blocks.length}`)}</HeadingTag>);
      index += 1;
      continue;
    }

    if (line.includes('|') && isTableSeparator(lines[index + 1] || '')) {
      const headers = splitTableRow(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push(
        <div className="markdown-table-wrap" key={`table-${blocks.length}`}>
          <table>
            <thead>
              <tr>
                {headers.map((cell, cellIndex) => (
                  <th key={`head-${cellIndex}`}>{renderInlineWithBreaks(cell, `table-${blocks.length}-head-${cellIndex}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {headers.map((_, cellIndex) => (
                    <td key={`cell-${rowIndex}-${cellIndex}`}>
                      {renderInlineWithBreaks(row[cellIndex] || '', `table-${blocks.length}-cell-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push(<blockquote key={`quote-${blocks.length}`}>{renderInlineWithBreaks(quoteLines.join('\n'), `quote-${blocks.length}`)}</blockquote>);
      continue;
    }

    if (isListLine(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const ListTag = ordered ? 'ol' : 'ul';
      const items = [];
      while (index < lines.length && isListLine(lines[index]) && /^\s*\d+[.)]\s+/.test(lines[index]) === ordered) {
        items.push(lines[index].replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, ''));
        index += 1;
      }
      blocks.push(
        <ListTag key={`list-${blocks.length}`}>
          {items.map((item, itemIndex) => (
            <li key={`item-${itemIndex}`}>{renderInlineWithBreaks(item, `list-${blocks.length}-item-${itemIndex}`)}</li>
          ))}
        </ListTag>
      );
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStarter(lines[index], lines[index + 1])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(<p key={`paragraph-${blocks.length}`}>{renderInlineWithBreaks(paragraph.join('\n'), `paragraph-${blocks.length}`)}</p>);
  }

  return blocks.length ? blocks : null;
}
