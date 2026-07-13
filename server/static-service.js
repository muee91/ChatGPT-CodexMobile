/**
 * 静态资源与本地文件服务：MIME、缓存头、鉴权 local-image、多格式文件预览与 Range 流式传输。
 *
 * Keywords: static-service, local-files, file-preview, office-preview, range, media
 *
 * Exports:
 * - DEFAULT_MIME_TYPES / EDITABLE_TEXT_EXTENSIONS。
 * - resolveLocalImagePath / safeDecodeLocalPath / stripLocalFileLineSuffix / contentDisposition。
 * - sendLocalImage / sendRemoteImage / sendLocalFile / sendLocalFilePreview / writeLocalTextFile / deleteLocalFile / serveFileFromRoot。
 * - createStaticService — 组装根目录与缓存策略。
 *
 * Inward（本模块依赖/组装的关键符号）: http-utils.sendStaticContent、Node fs。
 *
 * Outward（谁在用/调用场景）: server/index 静态与 /api/local-* 路径。
 *
 * 不负责: 业务会话数据。
 */
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { sendJson, sendStaticContent, staticCacheControl } from './http-utils.js';

export const DEFAULT_MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.cer', 'application/x-x509-ca-cert'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.ico', 'image/x-icon'],
  ['.pdf', 'application/pdf'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.docm', 'application/vnd.ms-word.document.macroEnabled.12'],
  ['.doc', 'application/msword'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.xls', 'application/vnd.ms-excel'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.ppt', 'application/vnd.ms-powerpoint'],
  ['.mp4', 'video/mp4'],
  ['.m4v', 'video/mp4'],
  ['.mov', 'video/quicktime'],
  ['.webm', 'video/webm'],
  ['.ogv', 'video/ogg'],
  ['.mp3', 'audio/mpeg'],
  ['.m4a', 'audio/mp4'],
  ['.aac', 'audio/aac'],
  ['.wav', 'audio/wav'],
  ['.ogg', 'audio/ogg'],
  ['.flac', 'audio/flac'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.markdown', 'text/markdown; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.csv', 'text/csv; charset=utf-8'],
  ['.htm', 'text/html; charset=utf-8']
]);

export const EDITABLE_TEXT_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.csv',
  '.json',
  '.html',
  '.htm',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.css',
  '.xml',
  '.log'
]);

const REMOTE_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const REMOTE_IMAGE_TIMEOUT_MS = 15_000;
const WORD_PREVIEW_EXTENSIONS = new Set(['.docx', '.docm']);
const HTML_PREVIEW_EXTENSIONS = new Set(['.html', '.htm']);
const SPREADSHEET_PREVIEW_EXTENSIONS = new Set(['.csv', '.xlsx', '.xls']);
const PRESENTATION_PREVIEW_EXTENSIONS = new Set(['.pptx']);
const PREVIEW_MAX_ROWS = 500;
const PREVIEW_MAX_COLS = 80;
const PREVIEW_MAX_SHEETS = 20;
const PREVIEW_MAX_SLIDES = 120;
const ATTACHMENT_ONLY_EXTENSIONS = new Set([
  '.apk',
  '.ipa',
  '.zip',
  '.rar',
  '.7z',
  '.dmg',
  '.pkg',
  '.exe',
  '.msi'
]);

export function resolveLocalImagePath(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (/^file:\/\//i.test(raw)) {
    return fileURLToPath(raw);
  }
  if (raw === '~') {
    return os.homedir();
  }
  if (raw.startsWith('~/') || raw.startsWith('~\\')) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return raw;
}

export function safeDecodeLocalPath(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function stripLocalFileLineSuffix(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(.+):\d+(?::\d+)?$/);
  if (!match) {
    return '';
  }
  const candidate = match[1];
  return path.extname(candidate) ? candidate : '';
}

export function contentDisposition(filePath, mode = 'inline') {
  const baseName = path.basename(String(filePath || 'file')) || 'file';
  const fallback = baseName.replace(/[^\x20-\x7E]|["\\;]/g, '_') || 'file';
  const normalizedMode = mode === 'attachment' ? 'attachment' : 'inline';
  return `${normalizedMode}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(baseName)}`;
}

function localFileDisposition(url, filePath) {
  if (String(url.searchParams.get('download') || '') === '1') {
    return contentDisposition(filePath, 'attachment');
  }
  const extension = path.extname(String(filePath || '')).toLowerCase();
  if (ATTACHMENT_ONLY_EXTENSIONS.has(extension)) {
    return contentDisposition(filePath, 'attachment');
  }
  return contentDisposition(filePath, 'inline');
}

function localFileCandidatesFromUrl(url) {
  const requestedPath = resolveLocalImagePath(url.searchParams.get('path'));
  const decodedPath = /%[0-9a-f]{2}/i.test(requestedPath) ? resolveLocalImagePath(safeDecodeLocalPath(requestedPath)) : '';
  const baseCandidates = [...new Set([requestedPath, decodedPath].filter(Boolean))];
  const candidates = [
    ...baseCandidates,
    ...baseCandidates.map(stripLocalFileLineSuffix)
  ].filter(Boolean);
  return {
    requestedPath,
    checkedPaths: [...new Set(candidates)]
  };
}

async function resolveExistingLocalFile(url) {
  const { requestedPath, checkedPaths } = localFileCandidatesFromUrl(url);
  if (!checkedPaths.length || !checkedPaths.some((candidate) => path.isAbsolute(candidate))) {
    const error = new Error('File path must be absolute');
    error.statusCode = 400;
    error.requestedPath = requestedPath;
    error.checkedPaths = checkedPaths;
    throw error;
  }
  const errors = [];
  for (const candidate of checkedPaths) {
    if (!path.isAbsolute(candidate)) {
      continue;
    }
    const filePath = path.resolve(candidate);
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        continue;
      }
      return { requestedPath, checkedPaths, filePath, stat };
    } catch (error) {
      errors.push({
        path: filePath,
        code: error.code || '',
        message: error.message || 'unknown error'
      });
    }
  }
  const error = new Error('File not found');
  error.statusCode = 404;
  error.requestedPath = requestedPath;
  error.checkedPaths = checkedPaths;
  error.details = errors;
  throw error;
}

function backupFileName(filePath) {
  const now = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = path.basename(filePath).replace(/[^\w.-]+/g, '_') || 'file';
  return `${now}-${baseName}`;
}

function parseRangeHeader(value, size) {
  const match = String(value || '').match(/^bytes=(\d*)-(\d*)$/);
  if (!match || !Number.isFinite(size) || size <= 0 || (match[1] === '' && match[2] === '')) {
    return null;
  }

  let start;
  let end;
  if (match[1] === '') {
    const suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Number(match[2]);
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
}

function sendFileStream(req, res, filePath, stat, headers) {
  const range = parseRangeHeader(req.headers?.range, stat.size);
  const baseHeaders = {
    ...headers,
    'accept-ranges': 'bytes'
  };
  const streamOptions = range ? { start: range.start, end: range.end } : {};
  const contentLength = range ? range.end - range.start + 1 : stat.size;
  res.writeHead(range ? 206 : 200, {
    ...baseHeaders,
    ...(range ? { 'content-range': `bytes ${range.start}-${range.end}/${stat.size}` } : {}),
    'content-length': contentLength
  });

  return new Promise((resolve, reject) => {
    const stream = fsSync.createReadStream(filePath, streamOptions);
    let settled = false;
    const settle = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      callback(value);
    };
    stream.on('data', (chunk) => {
      res.write(chunk);
    });
    stream.once('error', (error) => {
      if (typeof res.destroy === 'function') {
        res.destroy(error);
      }
      settle(reject, error);
    });
    stream.once('end', () => {
      res.end();
      settle(resolve);
    });
  });
}

export async function sendLocalImage(req, res, url, {
  mimeTypes = DEFAULT_MIME_TYPES
} = {}) {
  const requestedPath = resolveLocalImagePath(url.searchParams.get('path'));
  const decodedPath = /%[0-9a-f]{2}/i.test(requestedPath) ? resolveLocalImagePath(safeDecodeLocalPath(requestedPath)) : '';
  const candidates = [...new Set([requestedPath, decodedPath].filter(Boolean))];
  if (!candidates.length || !candidates.some((candidate) => path.isAbsolute(candidate))) {
    sendJson(res, 400, { error: 'Image path must be absolute' });
    return;
  }

  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) {
      continue;
    }
    const filePath = path.resolve(candidate);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes.get(ext) || '';
    if (!contentType.startsWith('image/')) {
      continue;
    }
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        continue;
      }
      await sendFileStream(req, res, filePath, stat, {
        'content-type': contentType,
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff'
      });
      return;
    } catch {
      // Try the decoded candidate before reporting a miss.
    }
  }

  sendJson(res, 404, { error: 'Image not found' });
}

export async function sendRemoteImage(req, res, url, {
  fetchRemoteImage = fetch,
  maxBytes = REMOTE_IMAGE_MAX_BYTES,
  timeoutMs = REMOTE_IMAGE_TIMEOUT_MS
} = {}) {
  const rawUrl = String(url.searchParams.get('url') || '').trim();
  let imageUrl;
  try {
    imageUrl = new URL(rawUrl);
  } catch {
    sendJson(res, 400, { error: 'Image URL is invalid' });
    return;
  }
  if (imageUrl.protocol !== 'https:' && imageUrl.protocol !== 'http:') {
    sendJson(res, 400, { error: 'Image URL must use http or https' });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetchRemoteImage(imageUrl.href, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'user-agent': 'CodexMobile/2.0 image proxy'
      }
    });
    if (!upstream.ok) {
      sendJson(res, upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502, {
        error: `Remote image request failed: ${upstream.status}`
      });
      return;
    }

    const contentType = String(upstream.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!contentType.startsWith('image/')) {
      sendJson(res, 415, { error: 'Remote URL did not return an image' });
      return;
    }
    const contentLength = Number(upstream.headers?.get?.('content-length') || 0);
    if (contentLength > maxBytes) {
      sendJson(res, 413, { error: 'Remote image is too large' });
      return;
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    if (body.length > maxBytes) {
      sendJson(res, 413, { error: 'Remote image is too large' });
      return;
    }
    res.writeHead(200, {
      'content-type': contentType,
      'content-length': body.length,
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff'
    });
    res.end(body);
  } catch (error) {
    sendJson(res, error?.name === 'AbortError' ? 504 : 502, {
      error: error?.name === 'AbortError' ? 'Remote image request timed out' : 'Remote image request failed'
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendLocalFile(req, res, url, {
  mimeTypes = DEFAULT_MIME_TYPES
} = {}) {
  try {
    const { filePath, stat } = await resolveExistingLocalFile(url);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes.get(ext) || 'application/octet-stream';
    await sendFileStream(req, res, filePath, stat, {
      'content-type': contentType,
      'cache-control': 'private, max-age=60',
      'content-disposition': localFileDisposition(url, filePath),
      'x-local-file-mtime-ms': String(Math.round(stat.mtimeMs)),
      'x-local-file-size': String(stat.size),
      'x-local-file-editable': EDITABLE_TEXT_EXTENSIONS.has(ext) ? '1' : '0',
      'x-content-type-options': 'nosniff'
    });
  } catch (error) {
    console.warn(`[local-file] read failed path=${error.requestedPath || ''} checked=${(error.checkedPaths || []).join(' | ')} errors=${JSON.stringify(error.details || [])}`);
    sendJson(res, error.statusCode || 500, {
      error: error.message || 'File not found',
      path: error.requestedPath || '',
      checked: error.checkedPaths || [],
      details: error.details || []
    });
  }
}

function sanitizePreviewHtml(value) {
  return String(value || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\1/gi, '');
}

function decodeXmlText(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function normalizeSheetRows(rows, {
  maxRows = PREVIEW_MAX_ROWS,
  maxCols = PREVIEW_MAX_COLS
} = {}) {
  const normalized = (Array.isArray(rows) ? rows : [])
    .slice(0, maxRows)
    .map((row) => (Array.isArray(row) ? row : [row])
      .slice(0, maxCols)
      .map((cell) => String(cell ?? '')));
  let lastRow = normalized.length - 1;
  while (lastRow >= 0 && normalized[lastRow].every((cell) => !String(cell || '').trim())) {
    lastRow -= 1;
  }
  const croppedRows = normalized.slice(0, lastRow + 1);
  let lastCol = 0;
  for (const row of croppedRows) {
    for (let index = row.length - 1; index >= 0; index -= 1) {
      if (String(row[index] || '').trim()) {
        lastCol = Math.max(lastCol, index + 1);
        break;
      }
    }
  }
  return croppedRows.map((row) => row.slice(0, lastCol));
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const raw = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (quoted) {
      if (char === '"' && raw[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return normalizeSheetRows(rows);
}

function spreadsheetPreviewFromWorkbook(buffer) {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: false,
    cellHTML: false,
    cellNF: false
  });
  const sheetNames = Array.isArray(workbook.SheetNames) ? workbook.SheetNames.slice(0, PREVIEW_MAX_SHEETS) : [];
  return sheetNames.map((name) => {
    const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
      header: 1,
      raw: false,
      defval: ''
    });
    return {
      name,
      rows: normalizeSheetRows(rawRows),
      truncatedRows: rawRows.length > PREVIEW_MAX_ROWS
    };
  });
}

async function presentationPreviewFromPptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slideEntries = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((left, right) => Number(left.match(/slide(\d+)\.xml/i)?.[1] || 0) - Number(right.match(/slide(\d+)\.xml/i)?.[1] || 0))
    .slice(0, PREVIEW_MAX_SLIDES);
  const slides = [];
  for (const entryName of slideEntries) {
    const xml = await zip.files[entryName].async('string');
    const texts = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi)]
      .map((match) => decodeXmlText(match[1]).replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const index = Number(entryName.match(/slide(\d+)\.xml/i)?.[1] || slides.length + 1);
    slides.push({
      index,
      title: texts[0] || `Slide ${index}`,
      texts
    });
  }
  return {
    slides,
    truncatedSlides: slideEntries.length >= PREVIEW_MAX_SLIDES
  };
}

export async function sendLocalFilePreview(req, res, url) {
  try {
    const { filePath, stat } = await resolveExistingLocalFile(url);
    const ext = path.extname(filePath).toLowerCase();
    if (WORD_PREVIEW_EXTENSIONS.has(ext)) {
      const buffer = await fs.readFile(filePath);
      const result = await mammoth.convertToHtml({ buffer });
      sendJson(res, 200, {
        kind: 'word',
        html: sanitizePreviewHtml(result.value),
        messages: Array.isArray(result.messages) ? result.messages.map((message) => ({
          type: message.type || '',
          message: message.message || ''
        })) : [],
        mtimeMs: Math.round(stat.mtimeMs),
        size: stat.size
      });
      return;
    }
    if (HTML_PREVIEW_EXTENSIONS.has(ext)) {
      const html = await fs.readFile(filePath, 'utf8');
      sendJson(res, 200, {
        kind: 'html',
        html: sanitizePreviewHtml(html),
        mtimeMs: Math.round(stat.mtimeMs),
        size: stat.size
      });
      return;
    }
    if (SPREADSHEET_PREVIEW_EXTENSIONS.has(ext)) {
      const buffer = await fs.readFile(filePath);
      const sheets = ext === '.csv'
        ? [{ name: path.basename(filePath), rows: parseCsvRows(buffer.toString('utf8')), truncatedRows: false }]
        : spreadsheetPreviewFromWorkbook(buffer);
      sendJson(res, 200, {
        kind: 'spreadsheet',
        sheets,
        mtimeMs: Math.round(stat.mtimeMs),
        size: stat.size
      });
      return;
    }
    if (PRESENTATION_PREVIEW_EXTENSIONS.has(ext)) {
      const preview = await presentationPreviewFromPptx(await fs.readFile(filePath));
      sendJson(res, 200, {
        kind: 'presentation',
        ...preview,
        mtimeMs: Math.round(stat.mtimeMs),
        size: stat.size
      });
      return;
    }
    sendJson(res, 415, { error: 'This file type cannot be previewed yet' });
  } catch (error) {
    console.warn(`[local-file-preview] read failed path=${error.requestedPath || ''} checked=${(error.checkedPaths || []).join(' | ')} message=${error.message || ''}`);
    sendJson(res, error.statusCode || 500, {
      error: error.message || 'File preview failed',
      path: error.requestedPath || '',
      checked: error.checkedPaths || []
    });
  }
}

export async function writeLocalTextFile(req, res, url, body) {
  try {
    const { filePath, stat } = await resolveExistingLocalFile(url);
    const ext = path.extname(filePath).toLowerCase();
    if (!EDITABLE_TEXT_EXTENSIONS.has(ext)) {
      sendJson(res, 415, { error: 'Only text files can be edited' });
      return;
    }
    const content = String(body?.content ?? '');
    if (content.length > 5 * 1024 * 1024) {
      sendJson(res, 413, { error: 'File is too large to edit on mobile' });
      return;
    }
    const baseMtimeMs = Number(body?.baseMtimeMs || 0);
    if (baseMtimeMs && Math.abs(Math.round(stat.mtimeMs) - Math.round(baseMtimeMs)) > 5) {
      sendJson(res, 409, {
        error: 'File changed on disk. Refresh before saving.',
        mtimeMs: Math.round(stat.mtimeMs),
        size: stat.size
      });
      return;
    }

    const backupRoot = path.join(process.cwd(), '.codexmobile', 'backups', 'local-files');
    await fs.mkdir(backupRoot, { recursive: true });
    const backupPath = path.join(backupRoot, backupFileName(filePath));
    await fs.copyFile(filePath, backupPath);
    await fs.writeFile(filePath, content, 'utf8');
    const nextStat = await fs.stat(filePath);
    sendJson(res, 200, {
      ok: true,
      mtimeMs: Math.round(nextStat.mtimeMs),
      size: nextStat.size,
      backupPath
    });
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: error.message || 'Failed to save file',
      path: error.requestedPath || '',
      checked: error.checkedPaths || [],
      details: error.details || []
    });
  }
}

export async function deleteLocalFile(req, res, url) {
  try {
    const { filePath, stat } = await resolveExistingLocalFile(url);
    const backupRoot = path.join(process.cwd(), '.codexmobile', 'backups', 'deleted-local-files');
    await fs.mkdir(backupRoot, { recursive: true });
    const backupPath = path.join(backupRoot, backupFileName(filePath));
    await fs.copyFile(filePath, backupPath);
    await fs.unlink(filePath);
    sendJson(res, 200, {
      ok: true,
      path: filePath,
      mtimeMs: Math.round(stat.mtimeMs),
      size: stat.size,
      backupPath
    });
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: error.message || 'Failed to delete file',
      path: error.requestedPath || '',
      checked: error.checkedPaths || [],
      details: error.details || []
    });
  }
}

export async function serveFileFromRoot(req, res, rootDir, requestedPath, cacheControl, {
  mimeTypes = DEFAULT_MIME_TYPES
} = {}) {
  const relativePath = requestedPath.replace(/^\/+/, '');
  const candidate = path.normalize(path.join(rootDir, relativePath));
  const rootWithSep = rootDir.endsWith(path.sep) ? rootDir : `${rootDir}${path.sep}`;
  if (candidate !== rootDir && !candidate.startsWith(rootWithSep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return true;
  }

  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return true;
    }
    const ext = path.extname(candidate);
    const content = await fs.readFile(candidate);
    sendStaticContent(req, res, 200, content, {
      'content-type': mimeTypes.get(ext) || 'application/octet-stream',
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff'
    }, ext);
    return true;
  } catch {
    res.writeHead(404);
    res.end('Not found');
    return true;
  }
}

export function createStaticService({
  clientDist,
  generatedRoot,
  httpsRootCaPath,
  fetchRemoteImage = fetch,
  mimeTypes = DEFAULT_MIME_TYPES
}) {
  async function serveStatic(req, res, url) {
    let requestedPath = decodeURIComponent(url.pathname);
    if (requestedPath === '/codexmobile-root-ca.cer') {
      try {
        const stat = await fs.stat(httpsRootCaPath);
        const content = await fs.readFile(httpsRootCaPath);
        res.writeHead(200, {
          'content-type': 'application/x-x509-ca-cert',
          'content-length': stat.size,
          'cache-control': 'no-store',
          'content-disposition': 'attachment; filename="codexmobile-root-ca.cer"',
          'x-content-type-options': 'nosniff'
        });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end('Certificate not found');
      }
      return;
    }

    if (requestedPath.startsWith('/generated/')) {
      await serveFileFromRoot(
        req,
        res,
        generatedRoot,
        requestedPath.slice('/generated/'.length),
        'private, max-age=86400',
        { mimeTypes }
      );
      return;
    }

    if (requestedPath === '/') {
      requestedPath = '/index.html';
    }

    const candidate = path.normalize(path.join(clientDist, requestedPath));
    if (!candidate.startsWith(clientDist)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    try {
      const stat = await fs.stat(candidate);
      const filePath = stat.isDirectory() ? path.join(candidate, 'index.html') : candidate;
      const ext = path.extname(filePath);
      const content = await fs.readFile(filePath);
      sendStaticContent(req, res, 200, content, {
        'content-type': mimeTypes.get(ext) || 'application/octet-stream',
        'cache-control': staticCacheControl(ext, filePath),
        'x-content-type-options': 'nosniff'
      }, ext);
    } catch {
      const indexPath = path.join(clientDist, 'index.html');
      try {
        const content = await fs.readFile(indexPath);
        sendStaticContent(req, res, 200, content, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff'
        }, '.html');
      } catch {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('CodexMobile server is running. Build the PWA with: npm run build');
      }
    }
  }

  async function sendLocalImageFromRequest(req, res, url) {
    await sendLocalImage(req, res, url, { mimeTypes });
  }

  async function sendRemoteImageFromRequest(req, res, url) {
    await sendRemoteImage(req, res, url, { fetchRemoteImage });
  }

  async function sendLocalFileFromRequest(req, res, url) {
    await sendLocalFile(req, res, url, { mimeTypes });
  }

  async function sendLocalFilePreviewFromRequest(req, res, url) {
    await sendLocalFilePreview(req, res, url);
  }

  async function writeLocalFileFromRequest(req, res, url, body) {
    await writeLocalTextFile(req, res, url, body);
  }

  async function deleteLocalFileFromRequest(req, res, url) {
    await deleteLocalFile(req, res, url);
  }

  return {
    serveStatic,
    sendLocalImage: sendLocalImageFromRequest,
    sendRemoteImage: sendRemoteImageFromRequest,
    sendLocalFile: sendLocalFileFromRequest,
    sendLocalFilePreview: sendLocalFilePreviewFromRequest,
    writeLocalFile: writeLocalFileFromRequest,
    deleteLocalFile: deleteLocalFileFromRequest
  };
}
