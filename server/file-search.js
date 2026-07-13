/**
 * 在项目根目录下用 git ls-files + 限定路径做轻量文件搜索。
 *
 * Keywords: file-search, git-ls-files, ripgrep-alternative
 *
 * Exports:
 * - searchProjectFiles — 按 query 返回匹配路径列表。
 * - fileSearchInternals — 测试用内部钩子。
 *
 * Inward（本模块依赖/组装的关键符号）: child_process.execFile、项目 cwd。
 *
 * Outward（谁在用/调用场景）: file-routes。
 *
 * 不负责: 内容级全文检索。
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_LIMIT = 20;
const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', '.codexmobile', 'client/dist']);

function normalizeQuery(value) {
  return String(value || '').trim().toLowerCase();
}

function isIgnoredRelativePath(relativePath) {
  const parts = String(relativePath || '').split(/[\\/]+/).filter(Boolean);
  return parts.some((part, index) => IGNORE_DIRS.has(part) || IGNORE_DIRS.has(parts.slice(0, index + 1).join('/')));
}

function fileMatchScore(relativePath, query) {
  const normalized = relativePath.toLowerCase();
  const base = path.basename(normalized);
  if (!query) {
    return 100;
  }
  if (base === query) {
    return 0;
  }
  if (base.startsWith(query)) {
    return 5;
  }
  if (base.includes(query)) {
    return 15;
  }
  if (normalized.startsWith(query)) {
    return 25;
  }
  if (normalized.includes(query)) {
    return 40;
  }
  return Number.POSITIVE_INFINITY;
}

function toSearchResult(root, relativePath) {
  const cleanRelative = relativePath.replace(/\\/g, '/');
  return {
    name: path.basename(cleanRelative),
    path: path.join(root, cleanRelative),
    relativePath: cleanRelative
  };
}

async function listFilesWithRg(root) {
  const { stdout } = await execFileAsync('rg', ['--files', '--hidden'], {
    cwd: root,
    maxBuffer: 8 * 1024 * 1024
  });
  return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function listFilesWithFs(root, current = root, results = []) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    const relativePath = path.relative(root, fullPath).replace(/\\/g, '/');
    if (isIgnoredRelativePath(relativePath)) {
      continue;
    }
    if (entry.isDirectory()) {
      await listFilesWithFs(root, fullPath, results);
    } else if (entry.isFile()) {
      results.push(relativePath);
    }
  }
  return results;
}

export async function searchProjectFiles(project, query, { limit = DEFAULT_LIMIT } = {}) {
  const root = path.resolve(project?.path || '');
  if (!root || root === path.parse(root).root && !project?.path) {
    return [];
  }

  const normalizedQuery = normalizeQuery(query);
  let files = [];
  try {
    files = await listFilesWithRg(root);
  } catch {
    files = await listFilesWithFs(root);
  }

  return files
    .filter((file) => file && !isIgnoredRelativePath(file))
    .map((file) => ({ file, score: fileMatchScore(file, normalizedQuery) }))
    .filter((item) => item.score !== Number.POSITIVE_INFINITY)
    .sort((a, b) => a.score - b.score || a.file.length - b.file.length || a.file.localeCompare(b.file))
    .slice(0, Math.max(1, Number(limit) || DEFAULT_LIMIT))
    .map((item) => toSearchResult(root, item.file));
}

export const fileSearchInternals = {
  isIgnoredRelativePath,
  fileMatchScore
};
