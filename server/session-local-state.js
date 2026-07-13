/**
 * 移动端本地会话状态：隐藏会话/删除消息等持久化到 state 目录。
 *
 * Keywords: session-local-state, hide-session, deleted-messages
 *
 * Exports:
 * - filterDeletedMessages — 过滤已删 message id。
 * - createSessionLocalState — 工厂。
 * - hideSessionInMobile / unhideSessionInMobile / hideSessionMessageInLocalState 等 — 默认实例便捷方法。
 *
 * Inward（本模块依赖/组装的关键符号）: Node fs/promises、.codexmobile/state 路径约定。
 *
 * Outward（谁在用/调用场景）: 会话与聊天流程在需要剔除本地可见消息时调用。
 *
 * 不负责: Codex 桌面端原始 rollout。
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_STATE_DIR = path.join(process.cwd(), '.codexmobile', 'state');
const DEFAULT_DELETED_MESSAGES_PATH = path.join(DEFAULT_STATE_DIR, 'deleted-messages.json');
const DEFAULT_HIDDEN_SESSIONS_PATH = path.join(DEFAULT_STATE_DIR, 'hidden-sessions.json');

function emptyDeletedMessagesState() {
  return { version: 1, sessions: {} };
}

function emptyHiddenSessionsState() {
  return { version: 1, sessions: {} };
}

export function filterDeletedMessages(messages, deletedIds) {
  if (!deletedIds.size) {
    return messages;
  }
  return messages.filter((message) => !deletedIds.has(String(message.id || '')));
}

export function createSessionLocalState({
  deletedMessagesPath = DEFAULT_DELETED_MESSAGES_PATH,
  hiddenSessionsPath = DEFAULT_HIDDEN_SESSIONS_PATH
} = {}) {
  async function readDeletedMessagesState() {
    try {
      const raw = await fs.readFile(deletedMessagesPath, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        version: 1,
        sessions: parsed && typeof parsed.sessions === 'object' && !Array.isArray(parsed.sessions)
          ? parsed.sessions
          : {}
      };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('[sessions] Failed to read deleted message state:', error.message);
      }
      return emptyDeletedMessagesState();
    }
  }

  async function writeDeletedMessagesState(state) {
    await fs.mkdir(path.dirname(deletedMessagesPath), { recursive: true });
    await fs.writeFile(
      deletedMessagesPath,
      JSON.stringify({ version: 1, sessions: state.sessions || {} }, null, 2),
      'utf8'
    );
  }

  async function readHiddenSessionsState() {
    try {
      const raw = await fs.readFile(hiddenSessionsPath, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        version: 1,
        sessions: parsed && typeof parsed.sessions === 'object' && !Array.isArray(parsed.sessions)
          ? parsed.sessions
          : {}
      };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('[sessions] Failed to read hidden session state:', error.message);
      }
      return emptyHiddenSessionsState();
    }
  }

  async function writeHiddenSessionsState(state) {
    await fs.mkdir(path.dirname(hiddenSessionsPath), { recursive: true });
    await fs.writeFile(
      hiddenSessionsPath,
      JSON.stringify({ version: 1, sessions: state.sessions || {} }, null, 2),
      'utf8'
    );
  }

  async function readHiddenSessionIds() {
    const state = await readHiddenSessionsState();
    return new Set(Object.keys(state.sessions || {}));
  }

  async function hideSessionInMobile(session) {
    const id = String(session?.id || '').trim();
    if (!id) {
      const error = new Error('Session id is required');
      error.statusCode = 400;
      throw error;
    }

    const state = await readHiddenSessionsState();
    const existing = state.sessions[id];
    state.sessions[id] = {
      hiddenAt: existing?.hiddenAt || new Date().toISOString(),
      projectId: session.projectId || existing?.projectId || null,
      projectPath: session.cwd || existing?.projectPath || null,
      title: session.title || existing?.title || null
    };
    await writeHiddenSessionsState(state);
    return { sessionId: id, hiddenAt: state.sessions[id].hiddenAt };
  }

  async function unhideSessionInMobile(sessionId) {
    const id = String(sessionId || '').trim();
    if (!id) {
      const error = new Error('Session id is required');
      error.statusCode = 400;
      throw error;
    }

    const state = await readHiddenSessionsState();
    const existing = state.sessions[id] || null;
    if (existing) {
      delete state.sessions[id];
      await writeHiddenSessionsState(state);
    }
    return { sessionId: id, unhidden: Boolean(existing) };
  }

  async function readDeletedMessageIds(sessionId) {
    const id = String(sessionId || '').trim();
    if (!id) {
      return new Set();
    }
    const state = await readDeletedMessagesState();
    return new Set(Object.keys(state.sessions?.[id] || {}));
  }

  async function hideSessionMessage(sessionId, messageId) {
    const id = String(sessionId || '').trim();
    const itemId = String(messageId || '').trim();
    if (!id || !itemId) {
      const error = new Error('sessionId and messageId are required');
      error.statusCode = 400;
      throw error;
    }

    const state = await readDeletedMessagesState();
    if (!state.sessions[id] || typeof state.sessions[id] !== 'object' || Array.isArray(state.sessions[id])) {
      state.sessions[id] = {};
    }
    const existing = state.sessions[id][itemId];
    const deletedAt = existing?.deletedAt || new Date().toISOString();
    state.sessions[id][itemId] = { deletedAt };
    await writeDeletedMessagesState(state);
    return { sessionId: id, messageId: itemId, deletedAt };
  }

  return {
    hideSessionInMobile,
    unhideSessionInMobile,
    hideSessionMessage,
    readDeletedMessageIds,
    readHiddenSessionIds
  };
}

const defaultSessionLocalState = createSessionLocalState();

export const hideSessionInMobile = (...args) => defaultSessionLocalState.hideSessionInMobile(...args);
export const unhideSessionInMobile = (...args) => defaultSessionLocalState.unhideSessionInMobile(...args);
export const hideSessionMessageInLocalState = (...args) => defaultSessionLocalState.hideSessionMessage(...args);
export const readDeletedMessageIds = (...args) => defaultSessionLocalState.readDeletedMessageIds(...args);
export const readHiddenSessionIds = (...args) => defaultSessionLocalState.readHiddenSessionIds(...args);
