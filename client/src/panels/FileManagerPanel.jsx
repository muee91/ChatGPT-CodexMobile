/**
 * 本机文件管理面板：左侧集中目录浏览与位置操作，右侧整屏承载桌面端文件预览/编辑。
 *
 * Keywords: file-manager, local-files, directory, preview, desktop-workbench
 *
 * Exports:
 * - FileManagerPanel — 全屏文件浏览面板组件。
 *
 * Inward: apiFetch、file-manager-state、session-utils、本地项目列表与 lucide-react。
 *
 * Outward: AppShell 在 Drawer 底部入口打开后渲染。
 *
 * 不负责: 文件内容解析、保存编辑与危险文件操作。
 */

import { ArrowUp, ChevronDown, ChevronLeft, ExternalLink, File, FileText, Folder, FolderOpen, HardDrive, Home, Loader2, MapPinned, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api.js';
import { fileManagerEntryOpenAction, sortFileManagerEntries } from '../file-manager-state.js';
import { compactPath, localFileApiPath, localFilePreviewPath } from '../app/session-utils.js';

function entryIcon(entry) {
  if (entry.kind === 'directory') {
    return <Folder size={17} />;
  }
  if (entry.editable || /\.(?:md|txt|json|js|jsx|ts|tsx|css|html?|csv)$/i.test(entry.name || '')) {
    return <FileText size={17} />;
  }
  return <File size={17} />;
}

function formatFileSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size < 0) {
    return '';
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  }
  if (size < 1024 * 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatMtime(value) {
  if (!value) {
    return '';
  }
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(Number(value)));
  } catch {
    return '';
  }
}

function projectRoots(projects = []) {
  return (Array.isArray(projects) ? projects : [])
    .filter((project) => !project.projectless && project.path)
    .slice(0, 8)
    .map((project) => ({
      id: `project-${project.id}`,
      label: project.name || 'Project',
      path: project.path,
      project: true
    }));
}

function dedupeRoots(roots = []) {
  const seen = new Set();
  return roots.filter((root) => {
    const rootPath = String(root.path || '').trim();
    if (!rootPath || seen.has(rootPath)) {
      return false;
    }
    seen.add(rootPath);
    return true;
  });
}

export function FileManagerPanel({
  open,
  state,
  dispatch,
  projects,
  selectedProject,
  onClose
}) {
  const [roots, setRoots] = useState([]);
  const [rootsError, setRootsError] = useState('');
  const [pathDraft, setPathDraft] = useState('');
  const [query, setQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [rootsMenuOpen, setRootsMenuOpen] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deletingPath, setDeletingPath] = useState('');
  const [desktopPreview, setDesktopPreview] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return false;
    }
    return window.matchMedia('(min-width: 900px)').matches;
  });
  const currentPath = state?.path || '';
  const entries = Array.isArray(state?.entries) ? state.entries : [];
  const projectRootItems = useMemo(() => projectRoots(projects), [projects]);
  const rootItems = useMemo(() => dedupeRoots([
    ...(selectedProject?.path ? [{ id: `selected-${selectedProject.id}`, label: selectedProject.name || '当前项目', path: selectedProject.path, project: true }] : []),
    ...projectRootItems,
    ...roots
  ]), [projectRootItems, roots, selectedProject]);
  const normalizedQuery = query.trim().toLowerCase();
  const searchVisible = searchExpanded || Boolean(query);
  const visibleEntries = useMemo(() => {
    if (!normalizedQuery) {
      return sortFileManagerEntries(entries);
    }
    return sortFileManagerEntries(entries.filter((entry) => {
      const haystack = `${entry.name || ''} ${entry.path || ''}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    }));
  }, [entries, normalizedQuery]);

  const loadDirectory = useCallback(async (nextPath = '') => {
    dispatch({ type: 'loading', path: nextPath });
    setSelectedFile(null);
    setDeleteError('');
    try {
      const params = new URLSearchParams();
      if (nextPath) {
        params.set('path', nextPath);
      }
      const data = await apiFetch(`/api/files/list?${params.toString()}`);
      dispatch({
        type: 'loaded',
        path: data.path || nextPath,
        parentPath: data.parentPath || '',
        entries: Array.isArray(data.entries) ? data.entries : []
      });
      setPathDraft(data.path || nextPath);
    } catch (error) {
      dispatch({ type: 'failed', error: error?.message || '目录读取失败' });
    }
  }, [dispatch]);

  useEffect(() => {
    if (!open || typeof window === 'undefined' || !window.matchMedia) {
      return undefined;
    }
    const queryList = window.matchMedia('(min-width: 900px)');
    const syncDesktopPreview = () => setDesktopPreview(queryList.matches);
    syncDesktopPreview();
    queryList.addEventListener?.('change', syncDesktopPreview);
    return () => {
      queryList.removeEventListener?.('change', syncDesktopPreview);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    let stopped = false;
    async function loadRoots() {
      setRootsError('');
      try {
        const data = await apiFetch('/api/files/roots');
        if (!stopped) {
          setRoots(Array.isArray(data.roots) ? data.roots : []);
        }
      } catch (error) {
        if (!stopped) {
          setRootsError(error?.message || '常用位置读取失败');
        }
      }
    }
    loadRoots();
    loadDirectory(currentPath);
    return () => {
      stopped = true;
    };
  }, [open, currentPath, loadDirectory]);

  useEffect(() => {
    if (open) {
      setPathDraft(currentPath);
    }
  }, [currentPath, open]);

  if (!open) {
    return null;
  }

  function openEntry(entry) {
    const action = fileManagerEntryOpenAction(entry, { desktop: desktopPreview });
    if (action.type === 'directory') {
      setQuery('');
      loadDirectory(action.path);
      return;
    }
    if (action.type === 'preview') {
      setDeleteError('');
      setSelectedFile(entry);
      return;
    }
    window.location.href = localFilePreviewPath(action.path);
  }

  function submitPath(event) {
    event.preventDefault();
    setQuery('');
    loadDirectory(pathDraft);
  }

  function openRoot(rootPath) {
    setQuery('');
    setRootsMenuOpen(false);
    loadDirectory(rootPath);
  }

  function toggleSearch() {
    setSearchExpanded((value) => !value);
  }

  async function deleteSelectedFile() {
    if (!selectedFile?.path || selectedFile.kind === 'directory' || deletingPath) {
      return;
    }
    const confirmed = window.confirm(`删除文件「${selectedFile.name || '未命名文件'}」？`);
    if (!confirmed) {
      return;
    }
    setDeleteError('');
    setDeletingPath(selectedFile.path);
    try {
      await apiFetch(localFileApiPath(selectedFile.path), { method: 'DELETE' });
      setSelectedFile(null);
      await loadDirectory(currentPath);
    } catch (error) {
      setDeleteError(error?.message || '删除失败');
    } finally {
      setDeletingPath('');
    }
  }

  return (
    <section className="file-manager-panel" role="dialog" aria-modal="true" aria-label="文件管理">
      <div className="file-manager-shell">
        <aside className="file-manager-sidebar" aria-label="文件浏览">
          <header className="file-manager-header">
            <button className="icon-button" type="button" onClick={onClose} aria-label="关闭文件管理">
              <ChevronLeft size={22} />
            </button>
            <div className="file-manager-title">
              <strong>文件管理</strong>
              <span>{currentPath ? compactPath(currentPath) : '本机文件'}</span>
            </div>
          </header>

          <div className="file-manager-sidebar-actions">
            <div className="file-manager-root-menu">
              <button
                type="button"
                className="file-manager-tool-button"
                onClick={() => setRootsMenuOpen((value) => !value)}
                aria-label="常用位置"
                aria-expanded={rootsMenuOpen ? 'true' : 'false'}
              >
                <MapPinned size={16} />
                <span>位置</span>
                <ChevronDown size={14} />
              </button>
              {rootsMenuOpen ? (
                <div className="file-manager-root-popover" role="menu" aria-label="常用位置">
                  {rootItems.map((root) => (
                    <button key={`${root.id}-${root.path}`} type="button" onClick={() => openRoot(root.path)} role="menuitem">
                      {root.id === 'home' ? <Home size={15} /> : root.project ? <FolderOpen size={15} /> : <HardDrive size={15} />}
                      <span>{root.label}</span>
                      <small>{compactPath(root.path)}</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button className="file-manager-tool-button is-icon" type="button" onClick={() => state.parentPath && loadDirectory(state.parentPath)} disabled={!state.parentPath} aria-label="返回上级">
              <ArrowUp size={16} />
            </button>
            <button className="file-manager-tool-button is-icon" type="button" onClick={() => loadDirectory(currentPath)} disabled={state.loading} aria-label="刷新目录">
              {state.loading ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
            </button>
            {selectedFile?.path ? (
              <a className="file-manager-tool-button is-icon" href={localFilePreviewPath(selectedFile.path)} target="_blank" rel="noreferrer noopener" aria-label="打开完整预览">
                <ExternalLink size={16} />
              </a>
            ) : null}
            {selectedFile?.path && selectedFile.kind !== 'directory' ? (
              <button
                className="file-manager-tool-button is-icon is-danger"
                type="button"
                onClick={deleteSelectedFile}
                disabled={deletingPath === selectedFile.path}
                aria-label="删除文件"
              >
                {deletingPath === selectedFile.path ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
              </button>
            ) : null}
            <div className={`file-manager-search-toggle ${searchVisible ? 'is-open' : ''}`}>
              <button className="file-manager-tool-button is-icon" type="button" onClick={toggleSearch} aria-label="搜索当前目录" aria-expanded={searchVisible ? 'true' : 'false'}>
                <Search size={16} />
              </button>
              {searchVisible ? (
                <label className="file-manager-search">
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索当前目录"
                    aria-label="搜索当前目录"
                    autoFocus
                  />
                </label>
              ) : null}
            </div>
          </div>

          {rootsError || deleteError ? <div className="file-manager-inline-error">{deleteError || rootsError}</div> : null}

          <form className="file-manager-location" onSubmit={submitPath}>
            <input value={pathDraft} onChange={(event) => setPathDraft(event.target.value)} aria-label="文件路径" placeholder="/Users/..." />
            <button type="submit" aria-label="跳转路径">
              <ExternalLink size={15} />
            </button>
          </form>

          <div className="file-manager-list" role="list" aria-busy={state.loading ? 'true' : 'false'}>
            {state.loading ? <div className="file-manager-status">正在读取目录...</div> : null}
            {!state.loading && state.error ? <div className="file-manager-error">{state.error}</div> : null}
            {!state.loading && !state.error && visibleEntries.length === 0 ? (
              <div className="file-manager-status">{normalizedQuery ? '没有匹配文件' : '这个目录是空的'}</div>
            ) : null}
            {!state.loading && !state.error ? visibleEntries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className={`file-manager-row ${selectedFile?.path === entry.path ? 'is-selected' : ''}`}
                onClick={() => openEntry(entry)}
                role="listitem"
              >
                <span className={`file-manager-entry-icon is-${entry.kind}`} aria-hidden="true">
                  {entryIcon(entry)}
                </span>
                <span className="file-manager-entry-main">
                  <strong>{entry.name}</strong>
                  <small>{entry.kind === 'directory' ? compactPath(entry.path) : [formatFileSize(entry.size), formatMtime(entry.mtimeMs)].filter(Boolean).join(' · ')}</small>
                </span>
                <span className="file-manager-entry-kind">{entry.kind === 'directory' ? '目录' : entry.editable ? '可编辑' : '文件'}</span>
              </button>
            )) : null}
          </div>
        </aside>

        <main className="file-manager-preview" aria-label="文件预览">
          {selectedFile?.path ? (
            <iframe
              className="file-manager-preview-frame"
              src={localFilePreviewPath(selectedFile.path, { embed: true })}
              title={`预览 ${selectedFile.name || '文件'}`}
            />
            ) : (
            <div className="file-manager-preview-empty">
              <FileText size={30} />
              <strong>选择一个文件</strong>
            </div>
          )}
        </main>
      </div>
    </section>
  );
}
