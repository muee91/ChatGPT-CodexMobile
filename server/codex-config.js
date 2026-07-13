/**
 * 读写 ~/.codex 下 config.toml、技能列表、模型缓存与项目外线程注册。
 *
 * Keywords: codex-config, toml, skills, sqlite-path, projectless
 *
 * Exports:
 * - CODEX_HOME 等路径常量。
 * - readCodexSkills / readCodexModels / readCodexWorkspaceState。
 * - registerProjectlessThread(s) / readCodexConfig / readCodexModelSettings / writeCodexModelSettings。
 * - readCodexThreadModelSettings / normalizeCodexThreadModelSettingsRow / modelSettingsKey。
 *
 * Inward（本模块依赖/组装的关键符号）: Node fs、CODEX_HOME 目录布局。
 *
 * Outward（谁在用/调用场景）: codex-data、provider-api、全站配置读取。
 *
 * 不负责: 执行 Codex 二进制。
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

export const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
export const CODEX_CONFIG_PATH = path.join(CODEX_HOME, 'config.toml');
export const CODEX_GLOBAL_STATE_PATH = path.join(CODEX_HOME, '.codex-global-state.json');
export const CODEX_MODELS_CACHE_PATH = path.join(CODEX_HOME, 'models_cache.json');
export const CODEX_SESSIONS_DIR = path.join(CODEX_HOME, 'sessions');
export const CODEX_SESSION_INDEX = path.join(CODEX_HOME, 'session_index.jsonl');
export const CODEX_STATE_DB = path.join(CODEX_HOME, 'state_5.sqlite');
let codexGlobalStateMutationQueue = Promise.resolve();
let codexConfigMutationQueue = Promise.resolve();
const execFileAsync = promisify(execFile);
const DEFAULT_SKILL_ROOTS = [
  path.join(process.cwd(), 'skills'),
  path.join(CODEX_HOME, 'skills'),
  path.join(os.homedir(), '.agents', 'skills'),
  path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'agent-skills', 'skills'),
  path.join(CODEX_HOME, 'plugins', 'cache', 'openai-bundled'),
  path.join(CODEX_HOME, 'plugins', 'cache', 'openai-curated')
];

function stripQuotes(value) {
  const trimmed = String(value || '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function tomlString(value) {
  return JSON.stringify(String(value || ''));
}

function rootTomlAssignmentValue(line, key) {
  const match = String(line || '').match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*(?:#.*)?$`));
  return match ? stripQuotes(match[1]).trim() : null;
}

export function updateRootTomlAssignments(raw, assignments = {}) {
  const text = String(raw || '');
  const hadTrailingNewline = text.endsWith('\n');
  const lines = text ? text.replace(/\r\n/g, '\n').split('\n') : [];
  const entries = Object.entries(assignments)
    .map(([key, value]) => [String(key || '').trim(), value])
    .filter(([key, value]) => key && value != null && String(value).trim());
  if (!entries.length) {
    return text;
  }
  const pending = new Map(entries);
  let firstSectionIndex = lines.length;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith('[')) {
      firstSectionIndex = index;
      break;
    }
    const assignment = trimmed.match(/^([A-Za-z0-9_]+)\s*=/);
    const key = assignment?.[1];
    if (key && pending.has(key)) {
      lines[index] = `${key} = ${tomlString(pending.get(key))}`;
      pending.delete(key);
    }
  }

  if (pending.size) {
    const insertions = [...pending.entries()].map(([key, value]) => `${key} = ${tomlString(value)}`);
    const needsSpacer = firstSectionIndex < lines.length && lines[firstSectionIndex]?.trim();
    lines.splice(firstSectionIndex, 0, ...insertions, ...(needsSpacer ? [''] : []));
  }

  const body = lines.join('\n');
  return hadTrailingNewline ? `${body.replace(/\n+$/, '')}\n` : body;
}

function shortModelName(model) {
  if (!model) {
    return '5.5 中';
  }
  return model
    .replace(/^gpt-/i, '')
    .replace(/-codex.*$/i, '')
    .replace(/-mini$/i, ' mini') + ' 中';
}

export function modelSettingsKey(settings = {}) {
  return [
    settings.sessionId || '',
    settings.provider || 'codex',
    settings.model || '',
    settings.reasoningEffort || ''
  ].join('\n');
}

export function normalizeCodexThreadModelSettingsRow(row = {}) {
  const sessionId = String(row.sessionId || row.id || '').trim();
  const model = String(row.model || '').trim();
  const reasoningEffort = String(row.reasoningEffort || row.reasoning_effort || '').trim();
  if (!sessionId || (!model && !reasoningEffort)) {
    return null;
  }
  const provider = String(row.provider || row.modelProvider || row.model_provider || 'openai').trim() || 'openai';
  const updatedAtMs = Number(row.updatedAtMs ?? row.updated_at_ms);
  return {
    provider,
    model: model || 'gpt-5.5',
    modelShort: shortModelName(model || 'gpt-5.5'),
    reasoningEffort: reasoningEffort || null,
    sessionId,
    updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : null
  };
}

function publicModel(entry, provider = null) {
  if (!entry?.slug) {
    return null;
  }
  if (entry.visibility && entry.visibility !== 'list') {
    return null;
  }
  return {
    value: entry.slug,
    label: entry.display_name || entry.slug,
    ...(provider ? { provider } : {}),
    ...(Array.isArray(entry.supported_reasoning_levels)
      ? {
          supportedReasoningEfforts: entry.supported_reasoning_levels
            .map((level) => typeof level === 'string' ? level : level?.effort)
            .filter(Boolean)
        }
      : {})
  };
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function firstFrontmatterValue(raw, key) {
  const text = String(raw || '');
  if (!text.startsWith('---')) {
    return '';
  }
  const end = text.indexOf('\n---', 3);
  if (end === -1) {
    return '';
  }
  const frontmatter = text.slice(3, end);
  const match = frontmatter.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, 'mi'));
  return stripQuotes(match?.[1] || '').trim();
}

function skillNameFromPath(skillPath) {
  return path.basename(path.dirname(skillPath));
}

function skillRoots() {
  const extra = String(process.env.CODEXMOBILE_SKILL_ROOTS || process.env.CODEXMOBILE_SKILLS_DIR || '')
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
  return [...extra, ...DEFAULT_SKILL_ROOTS];
}

async function findSkillFiles(root, { maxDepth = 6, maxFiles = 500 } = {}) {
  const found = [];
  async function walk(dir, depth) {
    if (found.length >= maxFiles || depth > maxDepth) {
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('[config] Failed to scan skill root:', dir, error.message);
      }
      return;
    }

    if (entries.some((entry) => entry.isFile() && entry.name === 'SKILL.md')) {
      found.push(path.join(dir, 'SKILL.md'));
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name === '.git') {
        continue;
      }
      await walk(path.join(dir, entry.name), depth + 1);
      if (found.length >= maxFiles) {
        return;
      }
    }
  }

  await walk(root, 0);
  return found;
}

export async function readCodexSkills() {
  const skills = new Map();

  for (const root of skillRoots()) {
    const files = await findSkillFiles(root);
    for (const skillPath of files) {
      try {
        const raw = await fs.readFile(skillPath, 'utf8');
        const name = firstFrontmatterValue(raw, 'name') || skillNameFromPath(skillPath);
        const description = firstFrontmatterValue(raw, 'description');
        if (!skills.has(name)) {
          skills.set(name, {
            name,
            label: name,
            description,
            path: skillPath
          });
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.warn('[config] Failed to read skill:', skillPath, error.message);
        }
      }
    }
  }

  return [...skills.values()].sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'));
}

function contextWindowFromModel(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  return {
    contextWindow: numberOrNull(entry.context_window),
    maxContextWindow: numberOrNull(entry.max_context_window),
    effectiveContextWindowPercent: numberOrNull(entry.effective_context_window_percent)
  };
}

async function readCodexModelContext(currentModel = 'gpt-5.5', modelCatalogPath = null) {
  const catalogEntry = (await readModelCatalogEntries(modelCatalogPath))
    .find((entry) => entry?.slug === currentModel);
  const catalogContext = contextWindowFromModel(catalogEntry);
  if (catalogContext) {
    return catalogContext;
  }
  try {
    const raw = await fs.readFile(CODEX_MODELS_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed.models) ? parsed.models : [];
    const entry = entries.find((item) => item?.slug === currentModel);
    return contextWindowFromModel(entry);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[config] Failed to read Codex model context:', error.message);
    }
    return null;
  }
}

async function readModelCatalogEntries(modelCatalogPath) {
  const catalogPath = String(modelCatalogPath || '').trim();
  if (!catalogPath) {
    return [];
  }
  try {
    const raw = await fs.readFile(catalogPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.models) ? parsed.models : [];
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[config] Failed to read Codex model catalog:', error.message);
    }
    return [];
  }
}

export async function readCodexModels(currentModel = 'gpt-5.5', { provider = null, modelCatalogPath = null } = {}) {
  const models = new Map();

  for (const entry of await readModelCatalogEntries(modelCatalogPath)) {
    const model = publicModel(entry, provider);
    if (model && !models.has(model.value)) {
      models.set(model.value, model);
    }
  }

  try {
    const raw = await fs.readFile(CODEX_MODELS_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed.models) ? parsed.models : [];
    for (const entry of entries) {
      const model = publicModel(entry, provider);
      if (model && !models.has(model.value)) {
        models.set(model.value, model);
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[config] Failed to read Codex model cache:', error.message);
    }
  }

  if (currentModel && !models.has(currentModel)) {
    models.set(currentModel, { value: currentModel, label: currentModel, ...(provider ? { provider } : {}) });
  }

  return [...models.values()];
}

export async function readCodexWorkspaceState() {
  try {
    const raw = await fs.readFile(CODEX_GLOBAL_STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const labels = parsed['electron-workspace-root-labels'] || {};
    const projectlessThreadIds = Array.isArray(parsed['projectless-thread-ids'])
      ? parsed['projectless-thread-ids'].filter((id) => typeof id === 'string' && id.trim())
      : [];
    const threadWorkspaceRootHints = parsed['thread-workspace-root-hints'] &&
      typeof parsed['thread-workspace-root-hints'] === 'object' &&
      !Array.isArray(parsed['thread-workspace-root-hints'])
      ? parsed['thread-workspace-root-hints']
      : {};
    const orderedRoots = [
      ...(Array.isArray(parsed['project-order']) ? parsed['project-order'] : []),
      ...(Array.isArray(parsed['electron-saved-workspace-roots']) ? parsed['electron-saved-workspace-roots'] : [])
    ];
    const seen = new Set();
    const projects = [];

    for (const root of orderedRoots) {
      if (!root || typeof root !== 'string') {
        continue;
      }
      const key = process.platform === 'win32' ? root.toLowerCase() : root;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      projects.push({
        path: root,
        label: typeof labels[root] === 'string' ? labels[root] : null
      });
    }

    return { projects, projectlessThreadIds, threadWorkspaceRootHints };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[config] Failed to read Codex workspace state:', error.message);
    }
    return { projects: [], projectlessThreadIds: [], threadWorkspaceRootHints: {} };
  }
}

export function defaultProjectlessWorkspaceRoot() {
  return path.join(os.homedir(), 'Documents', 'Codex');
}

async function readCodexGlobalStateForMutation() {
  try {
    return JSON.parse(await fs.readFile(CODEX_GLOBAL_STATE_PATH, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    return {};
  }
}

async function writeCodexGlobalStateAtomically(nextState) {
  await fs.mkdir(CODEX_HOME, { recursive: true });
  const tempPath = `${CODEX_GLOBAL_STATE_PATH}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  await fs.writeFile(tempPath, JSON.stringify(nextState), 'utf8');
  await fs.rename(tempPath, CODEX_GLOBAL_STATE_PATH);
}

async function writeCodexConfigAtomically(raw) {
  await fs.mkdir(CODEX_HOME, { recursive: true });
  const tempPath = `${CODEX_CONFIG_PATH}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  await fs.writeFile(tempPath, raw, 'utf8');
  await fs.rename(tempPath, CODEX_CONFIG_PATH);
}

function mutateCodexGlobalState(mutator) {
  const run = async () => {
    const state = await readCodexGlobalStateForMutation();
    const { nextState, result } = await mutator(state);
    if (nextState) {
      await writeCodexGlobalStateAtomically(nextState);
    }
    return result;
  };
  const task = codexGlobalStateMutationQueue.then(run, run);
  codexGlobalStateMutationQueue = task.catch(() => {});
  return task;
}

function mutateCodexConfig(mutator) {
  const run = async () => {
    let raw = '';
    try {
      raw = await fs.readFile(CODEX_CONFIG_PATH, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    const { nextRaw, result } = await mutator(raw);
    if (typeof nextRaw === 'string' && nextRaw !== raw) {
      await writeCodexConfigAtomically(nextRaw);
    }
    return result;
  };
  const task = codexConfigMutationQueue.then(run, run);
  codexConfigMutationQueue = task.catch(() => {});
  return task;
}

export async function registerProjectlessThread(threadId, workspaceRoot = defaultProjectlessWorkspaceRoot()) {
  const id = String(threadId || '').trim();
  if (!id) {
    return null;
  }

  const [result] = await registerProjectlessThreads([{ id, workspaceRoot }]);
  return result || null;
}

export async function registerProjectlessThreads(entries = []) {
  const normalizedEntries = entries
    .map((entry) => ({
      id: String(entry?.id || entry?.threadId || '').trim(),
      workspaceRoot: path.resolve(entry?.workspaceRoot || entry?.projectPath || defaultProjectlessWorkspaceRoot())
    }))
    .filter((entry) => entry.id);

  if (!normalizedEntries.length) {
    return [];
  }

  return mutateCodexGlobalState(async (state) => {
    const projectlessThreadIds = Array.isArray(state['projectless-thread-ids'])
      ? state['projectless-thread-ids'].filter((value) => typeof value === 'string' && value.trim())
      : [];
    const threadWorkspaceRootHints = state['thread-workspace-root-hints'] &&
      typeof state['thread-workspace-root-hints'] === 'object' &&
      !Array.isArray(state['thread-workspace-root-hints'])
      ? state['thread-workspace-root-hints']
      : {};
    const nextHints = { ...threadWorkspaceRootHints };
    const results = [];
    let changed = false;

    for (const entry of normalizedEntries) {
      if (!projectlessThreadIds.includes(entry.id)) {
        projectlessThreadIds.push(entry.id);
        changed = true;
      }
      if (nextHints[entry.id] !== entry.workspaceRoot) {
        nextHints[entry.id] = entry.workspaceRoot;
        changed = true;
      }
      results.push({ threadId: entry.id, workspaceRoot: entry.workspaceRoot });
    }

    if (!changed) {
      return { nextState: null, result: results };
    }

    return {
      nextState: {
        ...state,
        'projectless-thread-ids': projectlessThreadIds,
        'thread-workspace-root-hints': nextHints
      },
      result: results
    };
  });
}

export async function readCodexModelSettings() {
  const settings = {
    provider: 'codex',
    model: 'gpt-5.5',
    modelShort: '5.5 中',
    reasoningEffort: null
  };
  let raw = '';
  try {
    raw = await fs.readFile(CODEX_CONFIG_PATH, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[config] Failed to read Codex model settings:', error.message);
    }
    return settings;
  }

  let inRoot = true;
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    if (line.startsWith('[')) {
      inRoot = false;
      continue;
    }
    if (!inRoot) {
      continue;
    }
    const provider = rootTomlAssignmentValue(rawLine, 'model_provider');
    const model = rootTomlAssignmentValue(rawLine, 'model');
    const reasoning = rootTomlAssignmentValue(rawLine, 'model_reasoning_effort');
    if (provider) {
      settings.provider = provider;
    }
    if (model) {
      settings.model = model;
    }
    if (reasoning) {
      settings.reasoningEffort = reasoning;
    }
  }
  settings.modelShort = shortModelName(settings.model);
  return settings;
}

export async function readCodexThreadModelSettings({ limit = 200 } = {}) {
  try {
    await fs.access(CODEX_STATE_DB);
    const cappedLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
    const query = `
      select
        id as sessionId,
        model,
        reasoning_effort as reasoningEffort,
        model_provider as provider,
        updated_at_ms as updatedAtMs
      from threads
      where (model is not null and trim(model) != '')
         or (reasoning_effort is not null and trim(reasoning_effort) != '')
      order by updated_at_ms desc
      limit ${cappedLimit}
    `;
    const { stdout } = await execFileAsync('sqlite3', ['-json', CODEX_STATE_DB, query], {
      maxBuffer: 2 * 1024 * 1024
    });
    const parsed = JSON.parse(stdout || '[]');
    return (Array.isArray(parsed) ? parsed : [])
      .map((row) => normalizeCodexThreadModelSettingsRow(row))
      .filter(Boolean);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[config] Failed to read Codex thread model settings:', error.message);
    }
    return [];
  }
}

export async function writeCodexModelSettings({ provider, model, reasoningEffort } = {}) {
  const assignments = {};
  if (provider != null && String(provider).trim()) {
    assignments.model_provider = String(provider).trim();
  }
  if (model != null && String(model).trim()) {
    assignments.model = String(model).trim();
  }
  if (reasoningEffort != null && String(reasoningEffort).trim()) {
    assignments.model_reasoning_effort = String(reasoningEffort).trim();
  }
  if (!Object.keys(assignments).length) {
    return readCodexModelSettings();
  }
  return mutateCodexConfig(async (raw) => ({
    nextRaw: updateRootTomlAssignments(raw, assignments),
    result: null
  })).then(() => readCodexModelSettings());
}

export async function readCodexConfig() {
  const fallback = {
    provider: 'codex',
    model: 'gpt-5.5',
    modelShort: '5.5 中',
    reasoningEffort: null,
    modelContextWindow: null,
    modelAutoCompactTokenLimit: null,
    modelCatalogPath: null,
    baseUrl: null,
    models: [{ value: 'gpt-5.5', label: 'gpt-5.5' }],
    skills: [],
    projects: [],
    context: {
      modelContextWindow: null,
      configuredContextWindow: null,
      maxContextWindow: null,
      autoCompactTokenLimit: null,
      autoCompactEnabled: true,
      effectiveContextWindowPercent: null
    }
  };

  let raw;
  try {
    raw = await fs.readFile(CODEX_CONFIG_PATH, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[config] Failed to read Codex config:', error.message);
    }
    fallback.models = await readCodexModels(fallback.model, { provider: fallback.provider });
    fallback.skills = await readCodexSkills();
    return fallback;
  }

  const config = {
    ...fallback,
    projects: []
  };
  const projectMap = new Map();
  const providerBaseUrls = new Map();
  let currentProject = null;
  let currentProvider = null;

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const projectMatch = line.match(/^\[projects\.(?:'([^']+)'|"([^"]+)")\]$/);
    if (projectMatch) {
      currentProject = stripQuotes(projectMatch[1] || projectMatch[2]);
      currentProvider = null;
      if (!projectMap.has(currentProject)) {
        projectMap.set(currentProject, { path: currentProject, trustLevel: null });
      }
      continue;
    }

    const providerMatch = line.match(/^\[model_providers\.(?:'([^']+)'|"([^"]+)"|([^\]]+))\]$/);
    if (providerMatch) {
      currentProject = null;
      currentProvider = stripQuotes(providerMatch[1] || providerMatch[2] || providerMatch[3]);
      continue;
    }

    if (line.startsWith('[')) {
      currentProject = null;
      currentProvider = null;
      continue;
    }

    const assignment = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!assignment) {
      continue;
    }

    const key = assignment[1];
    const value = stripQuotes(assignment[2]);

    if (currentProject) {
      if (key === 'trust_level') {
        projectMap.get(currentProject).trustLevel = value;
      }
      continue;
    }

    if (currentProvider) {
      if (key === 'base_url') {
        providerBaseUrls.set(currentProvider, value);
      }
      continue;
    }

    if (key === 'model_provider') {
      config.provider = value;
    } else if (key === 'model') {
      config.model = value;
    } else if (key === 'model_reasoning_effort') {
      config.reasoningEffort = value;
    } else if (key === 'model_context_window') {
      config.modelContextWindow = numberOrNull(value);
    } else if (key === 'model_auto_compact_token_limit') {
      config.modelAutoCompactTokenLimit = numberOrNull(value);
    } else if (key === 'model_catalog_json') {
      config.modelCatalogPath = value;
    }
  }

  const cwd = process.cwd();
  if (!projectMap.has(cwd)) {
    projectMap.set(cwd, { path: cwd, trustLevel: 'trusted' });
  }

  config.modelShort = shortModelName(config.model);
  config.baseUrl = providerBaseUrls.get(config.provider) || (config.provider === 'cliproxyapi' ? 'http://127.0.0.1:8317/v1' : null);
  config.models = await readCodexModels(config.model, {
    provider: config.provider,
    modelCatalogPath: config.modelCatalogPath
  });
  config.skills = await readCodexSkills();
  const modelContext = await readCodexModelContext(config.model, config.modelCatalogPath);
  const modelContextWindow =
    config.modelContextWindow ||
    modelContext?.contextWindow ||
    modelContext?.maxContextWindow ||
    null;
  config.context = {
    modelContextWindow,
    configuredContextWindow: config.modelContextWindow || null,
    maxContextWindow: modelContext?.maxContextWindow || modelContextWindow,
    autoCompactTokenLimit: config.modelAutoCompactTokenLimit || null,
    autoCompactEnabled: Boolean(config.modelAutoCompactTokenLimit || modelContextWindow),
    effectiveContextWindowPercent: modelContext?.effectiveContextWindowPercent || null
  };
  config.projects = [...projectMap.values()];
  return config;
}
