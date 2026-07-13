/**
 * 本地文件浏览服务：解析桌面路径、列目录、生成常用根入口与文件编辑元数据。
 *
 * Keywords: file-browser, directory, roots, metadata, local-files
 *
 * Exports:
 * - localFileRoots — 返回 Home / 常用目录 / 当前工作目录等入口。
 * - listLocalDirectory — 读取指定目录并返回目录优先的文件条目。
 * - fileBrowserInternals — 测试用路径解析和排序辅助函数。
 *
 * Inward: Node fs/os/path；static-service 的可编辑扩展名集合。
 *
 * Outward: file-routes 的 /api/files/roots 与 /api/files/list。
 *
 * 不负责: 文件内容读取、编辑保存与多格式预览。
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDITABLE_TEXT_EXTENSIONS } from './static-service.js';

const ROOT_DIR = path.parse(os.homedir()).root || path.sep;

function uniqueRoots(roots) {
  const seen = new Set();
  return roots.filter((root) => {
    const rootPath = path.resolve(String(root.path || ''));
    if (!rootPath || seen.has(rootPath)) {
      return false;
    }
    seen.add(rootPath);
    root.path = rootPath;
    return true;
  });
}

function resolveBrowserPath(value, { homedir = os.homedir() } = {}) {
  const raw = String(value || '').trim();
  if (!raw) {
    return homedir;
  }
  if (/^file:\/\//i.test(raw)) {
    return fileURLToPath(raw);
  }
  if (raw === '~') {
    return homedir;
  }
  if (raw.startsWith('~/') || raw.startsWith('~\\')) {
    return path.join(homedir, raw.slice(2));
  }
  return raw;
}

function entryKind(dirent, stat) {
  if (dirent.isDirectory() || stat.isDirectory()) {
    return 'directory';
  }
  if (dirent.isSymbolicLink()) {
    return stat.isDirectory() ? 'directory' : 'file';
  }
  return 'file';
}

function sortBrowserEntries(entries) {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'directory' ? -1 : 1;
    }
    return left.name.localeCompare(right.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
  });
}

async function browserEntryFromDirent(root, dirent) {
  const filePath = path.join(root, dirent.name);
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return null;
  }
  const kind = entryKind(dirent, stat);
  const ext = kind === 'file' ? path.extname(filePath).toLowerCase() : '';
  return {
    name: dirent.name,
    path: filePath,
    kind,
    size: kind === 'file' ? stat.size : null,
    mtimeMs: Math.round(stat.mtimeMs),
    extension: ext,
    editable: kind === 'file' && EDITABLE_TEXT_EXTENSIONS.has(ext)
  };
}

export function localFileRoots({ cwd = process.cwd(), homedir = os.homedir() } = {}) {
  return uniqueRoots([
    { id: 'home', label: 'Home', path: homedir },
    { id: 'desktop', label: 'Desktop', path: path.join(homedir, 'Desktop') },
    { id: 'documents', label: 'Documents', path: path.join(homedir, 'Documents') },
    { id: 'downloads', label: 'Downloads', path: path.join(homedir, 'Downloads') },
    { id: 'code', label: 'Code', path: path.join(homedir, 'Code') },
    { id: 'cwd', label: 'CodexMobile', path: cwd },
    { id: 'root', label: ROOT_DIR === '/' ? 'Macintosh HD' : ROOT_DIR, path: ROOT_DIR }
  ]);
}

export async function listLocalDirectory(value, { limit = 500 } = {}) {
  const requestedPath = resolveBrowserPath(value);
  const dirPath = path.resolve(requestedPath);
  let stat;
  try {
    stat = await fs.stat(dirPath);
  } catch (error) {
    error.statusCode = error.code === 'ENOENT' ? 404 : 500;
    throw error;
  }
  if (!stat.isDirectory()) {
    const error = new Error('Path is not a directory');
    error.statusCode = 400;
    throw error;
  }

  const dirents = await fs.readdir(dirPath, { withFileTypes: true });
  const entries = [];
  for (const dirent of dirents.slice(0, Math.max(1, Number(limit) || 500))) {
    const entry = await browserEntryFromDirent(dirPath, dirent);
    if (entry) {
      entries.push(entry);
    }
  }

  return {
    path: dirPath,
    parentPath: dirPath === path.parse(dirPath).root ? '' : path.dirname(dirPath),
    entries: sortBrowserEntries(entries),
    truncated: dirents.length > entries.length
  };
}

export const fileBrowserInternals = {
  resolveBrowserPath,
  sortBrowserEntries
};
