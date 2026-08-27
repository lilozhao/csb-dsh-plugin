/**
 * A2A 标准 Task 数据模型 & 任务存储 v1.1
 * 实现 A2A 规范 §4 (数据模型) + §3.1.3~3.1.5 (GetTask/ListTasks/CancelTask)
 *
 * Code Review 修复:
 *   - createTaskStatus: 补上 REJECTED 时间戳
 *   - _savePersistence: 改为异步批量写盘 (1s debounce)
 *   - cleanup: 增加 maxTasks 淘汰策略 (LRU)
 *   - createPart: 修复 metadata 逻辑 (consumedKeys追踪)
 *
 * 版本: 1.1.0 | 2026-05-10
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ============================================
// 任务状态枚举 (TaskState)
// ============================================
const TASK_STATE = {
  SUBMITTED:      'TASK_STATE_SUBMITTED',
  WORKING:        'TASK_STATE_WORKING',
  INPUT_REQUIRED: 'TASK_STATE_INPUT_REQUIRED',
  AUTH_REQUIRED:  'TASK_STATE_AUTH_REQUIRED',
  COMPLETED:      'TASK_STATE_COMPLETED',
  FAILED:         'TASK_STATE_FAILED',
  CANCELED:       'TASK_STATE_CANCELED',
  REJECTED:       'TASK_STATE_REJECTED',
};

// 终止状态集合（不可再变更）
const TERMINAL_STATES = new Set([
  TASK_STATE.COMPLETED,
  TASK_STATE.FAILED,
  TASK_STATE.CANCELED,
  TASK_STATE.REJECTED,
]);

// ============================================
// 角色枚举 (Role)
// ============================================
const ROLE = {
  USER: 'ROLE_USER',
  AGENT: 'ROLE_AGENT',
};

// ============================================
// 核心对象工厂
// ============================================

/**
 * 创建 Part（消息或产物的基本内容容器）
 */
function createPart(content, type = 'text', metadata = {}) {
  const part = {};
  const consumed = new Set();

  if (type === 'text') {
    part.text = String(content);
  } else if (type === 'file') {
    part.file = {
      name: metadata.name || 'file',
      mimeType: metadata.mimeType || 'application/octet-stream',
      uri: metadata.uri || String(content),
      ...(metadata.fileSizeBytes ? { fileSizeBytes: metadata.fileSizeBytes } : {}),
    };
    consumed.add('name'); consumed.add('mimeType'); consumed.add('uri'); consumed.add('fileSizeBytes');
  } else if (type === 'data') {
    part.data = content;
  }

  // 未消费的 metadata 键才附加到 part
  const remaining = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (!consumed.has(k)) remaining[k] = v;
  }
  if (Object.keys(remaining).length > 0) {
    part.metadata = remaining;
  }

  return part;
}

/**
 * 创建 Message（通信消息）
 */
function createMessage(role, parts, options = {}) {
  const msg = {
    role,
    parts: Array.isArray(parts) ? parts : [createPart(parts)],
    messageId: options.messageId || generateId('msg'),
  };
  if (options.timestamp) msg.timestamp = options.timestamp;
  if (options.name) msg.name = options.name;
  if (options.metadata) msg.metadata = options.metadata;
  return msg;
}

/**
 * 创建 Artifact（产物）
 */
function createArtifact(parts, options = {}) {
  const art = {
    artifactId: options.artifactId || generateId('art'),
    name: options.name || 'artifact',
    parts: Array.isArray(parts) ? parts : [createPart(parts)],
  };
  if (options.mimeType) art.mimeType = options.mimeType;
  if (options.metadata) art.metadata = options.metadata;
  if (options.lastChunk !== undefined) art.lastChunk = options.lastChunk;
  if (options.index !== undefined) art.index = options.index;
  if (options.append !== undefined) art.append = options.append;
  return art;
}

/**
 * 创建 TaskStatus（任务状态）
 */
function createTaskStatus(state, message) {
  const status = { state };
  if (message) status.message = message;
  // 所有终止状态都加时间戳 (修复: 补上 REJECTED)
  if (TERMINAL_STATES.has(state)) {
    status.timestamp = new Date().toISOString();
  }
  return status;
}

/**
 * 创建 Task（任务）
 */
function createTask(options = {}) {
  const now = new Date().toISOString();
  return {
    id: options.id || generateId('task'),
    contextId: options.contextId || generateId('ctx'),
    status: options.status || createTaskStatus(TASK_STATE.SUBMITTED),
    ...(options.history ? { history: options.history } : {}),
    ...(options.artifacts ? { artifacts: options.artifacts } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {}),
    createdAt: options.createdAt || now,
    updatedAt: options.updatedAt || now,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
  };
}

// ============================================
// TaskStore - 任务存储 (Optimized)
// ============================================

class TaskStore {
  constructor(options = {}) {
    this.tasks = new Map();
    this.persistencePath = options.persistencePath || '/tmp/a2a-task-store.json';
    this.maxTasks    = options.maxTasks    || 10000;
    this.taskTTL     = options.taskTTL     || 7 * 24 * 60 * 60 * 1000;
    this.pageSize    = options.pageSize    || 20;
    this.debounceMs  = options.debounceMs  || 1000;

    // 异步批量写盘 (修复: debounce 替代同步写)
    this._dirty = false;
    this._saveTimer = null;

    this._loadPersistence();
  }

  /** 标记写入 (debounce) */
  _markDirty() {
    this._dirty = true;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._savePersistence();
      this._dirty = false;
    }, this.debounceMs);
  }

  /** 立即保存 (给关闭时用) */
  flushSync() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    if (this._dirty) {
      this._savePersistence();
      this._dirty = false;
    }
  }

  // ================= CRUD =================

  createTask(taskData = {}) {
    this._evictIfNeeded();
    const task = createTask(taskData);
    this.tasks.set(task.id, task);
    this._markDirty();
    return task;
  }

  getTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    if (this._isExpired(task)) {
      this.tasks.delete(taskId);
      this._markDirty();
      return null;
    }
    return this._cloneTask(task);
  }

  updateTaskStatus(taskId, newState, message) {
    const task = this.tasks.get(taskId);
    if (!task) return { error: 'TaskNotFoundError', code: -32001 };
    if (TERMINAL_STATES.has(task.status.state)) {
      return { error: 'TaskNotCancelableError', code: -32002 };
    }
    task.status = createTaskStatus(newState, message);
    task.updatedAt = new Date().toISOString();
    this._markDirty();
    return { task: this._cloneTask(task) };
  }

  addArtifact(taskId, artifact) {
    const task = this.tasks.get(taskId);
    if (!task) return { error: 'TaskNotFoundError', code: -32001 };
    if (!task.artifacts) task.artifacts = [];
    task.artifacts.push(artifact);
    task.updatedAt = new Date().toISOString();
    this._markDirty();
    return { task: this._cloneTask(task) };
  }

  addHistory(taskId, message) {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (!task.history) task.history = [];
    task.history.push(message);
    task.updatedAt = new Date().toISOString();
    this._markDirty();
    return true;
  }

  listTasks(options = {}) {
    const { contextId, state, includeArtifacts = false, historyLength, pageToken, pageSize = this.pageSize } = options;

    let all = Array.from(this.tasks.values()).filter(t => !this._isExpired(t));
    if (contextId) all = all.filter(t => t.contextId === contextId);
    if (state)     all = all.filter(t => t.status.state === state);

    all.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    let start = 0;
    if (pageToken) {
      try { const idx = parseInt(Buffer.from(pageToken, 'base64').toString(), 10); if (!isNaN(idx)) start = idx; } catch {}
    }

    const page = all.slice(start, start + pageSize);
    const nextToken = (start + pageSize) < all.length
      ? Buffer.from(String(start + pageSize)).toString('base64') : '';

    const tasks = page.map(t => {
      const task = this._cloneTask(t);
      if (!includeArtifacts) delete task.artifacts;
      if (historyLength !== undefined) {
        if (historyLength === 0) delete task.history;
        else if (task.history && task.history.length > historyLength) task.history = task.history.slice(-historyLength);
      }
      return task;
    });

    return { tasks, nextPageToken: nextToken };
  }

  cancelTask(taskId, reason) {
    const task = this.tasks.get(taskId);
    if (!task) return { error: 'TaskNotFoundError', code: -32001 };
    if (TERMINAL_STATES.has(task.status.state)) {
      return { error: 'TaskNotCancelableError', code: -32002 };
    }
    task.status = createTaskStatus(TASK_STATE.CANCELED, reason || 'Cancelled by user');
    task.updatedAt = new Date().toISOString();
    this._markDirty();
    return { task: this._cloneTask(task) };
  }

  // ================= 维护 =================

  /** 清理过期 + 按 LRU 淘汰 (修复: 新增 maxTasks 限制) */
  cleanup() {
    const now = Date.now();
    // 先清理过期
    for (const [id, task] of this.tasks) {
      if (now - new Date(task.updatedAt).getTime() > this.taskTTL) {
        this.tasks.delete(id);
      }
    }
    // 超量按更新时间淘汰最旧的
    if (this.tasks.size > this.maxTasks) {
      const sorted = Array.from(this.tasks.entries())
        .sort((a, b) => new Date(a[1].updatedAt) - new Date(b[1].updatedAt));
      const toDelete = this.tasks.size - this.maxTasks;
      for (let i = 0; i < toDelete; i++) {
        this.tasks.delete(sorted[i][0]);
      }
    }
    this.flushSync();
  }

  getStats() {
    const byState = {};
    let total = 0;
    for (const t of this.tasks.values()) {
      total++;
      byState[t.status.state] = (byState[t.status.state] || 0) + 1;
    }
    return {
      total,
      byState,
      terminalTasks: Array.from(this.tasks.values()).filter(t => TERMINAL_STATES.has(t.status.state)).length,
    };
  }

  // ================= 内部 =================

  _isExpired(task) {
    return TERMINAL_STATES.has(task.status.state) && (Date.now() - new Date(task.updatedAt).getTime() > this.taskTTL);
  }

  _cloneTask(task) { return JSON.parse(JSON.stringify(task)); }

  _evictIfNeeded() {
    if (this.tasks.size >= this.maxTasks) {
      // 淘汰最旧的 10%
      const sorted = Array.from(this.tasks.entries())
        .sort((a, b) => new Date(a[1].updatedAt) - new Date(b[1].updatedAt));
      const toDelete = Math.max(1, Math.floor(this.maxTasks * 0.1));
      for (let i = 0; i < toDelete; i++) {
        if (sorted[i]) this.tasks.delete(sorted[i][0]);
      }
    }
  }

  _loadPersistence() {
    try {
      if (fs.existsSync(this.persistencePath)) {
        const data = JSON.parse(fs.readFileSync(this.persistencePath, 'utf8'));
        if (Array.isArray(data.tasks)) {
          for (const t of data.tasks) this.tasks.set(t.id, t);
        }
        console.log(`[TaskStore] 已加载 ${this.tasks.size} 个持久化任务`);
      }
    } catch (e) {
      console.warn('[TaskStore] 加载持久化失败:', e.message);
    }
  }

  _savePersistence() {
    try {
      const dir = path.dirname(this.persistencePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      // 原子写入: 先写临时文件再 rename
      const tmp = this.persistencePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({
        tasks: Array.from(this.tasks.values()),
        savedAt: new Date().toISOString(),
      }, null, 2));
      fs.renameSync(tmp, this.persistencePath);
    } catch (e) {
      // 静默失败
    }
  }
}

// ============================================
// ID 生成器
// ============================================
function generateId(prefix = 'a2a') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

module.exports = {
  TASK_STATE, ROLE, TaskStore,
  createPart, createMessage, createArtifact, createTask, createTaskStatus,
  TERMINAL_STATES, generateId,
};
