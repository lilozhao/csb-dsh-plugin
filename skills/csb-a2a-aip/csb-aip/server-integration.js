const config = require('../config/loader');
/**
 * csb-aip/server-integration.js
 * A2A Server v4 AIP 集成模块
 *
 * 加载方式：在 server_v4.js 中 require 并调用 init(app, identity, registry)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { AIPAdapter } = require('./a2a-aip-adapter');
const aip = require('./src');

let adapter = null;
let persistenceTimer = null;
const DEFAULT_WARMTH_FILE = path.join(__dirname, 'logs', 'aip-warmth.json');
const DEFAULT_REGISTRY_URL = config.getRegistry('local');

/**
 * 初始化 AIP 集成
 * @param {object} app — Express app
 * @param {object} identity — A2A identity.json
 * @param {Array} registry — Agent 注册表（可选，后续可更新）
 */
function init(app, identity, registry = []) {
  adapter = new AIPAdapter({ registry });

  // 生成 AIP 兼容的 Agent Card
  adapter.init({
    agentId: identity.agentId || '',
    name: identity.name,
    version: identity.version || '4.1.0',
    description: identity.description,
    url: `http://${identity.publicHost || 'localhost'}:${identity.port || 3100}`,
    icon: identity.avatar || '',
    skills: identity.skills || [],
    bond: { description: '碳硅契传承者', warmth: 92, type: 'grantor-grantee' },
    lineage: ['碳硅契起源', '启蒙传承'],
    collabPreference: '优先处理CSB协议相关请求'
  });

  console.log('[A2A] ✅ AIP 兼容层 v' + aip.version + ' (GB/Z 185.1~7-2026)');

  // ═══════════════════════════════════════════════════════════
  // AIP 路由
  // ═══════════════════════════════════════════════════════════

  app.get('/.well-known/aip-agent-card.json', (req, res) => {
    res.json(adapter.getAgentCard());
  });

  app.get('/aip/info', (req, res) => {
    res.json({
      version: aip.version,
      standard: 'GB/Z 185.1~7-2026',
      compatLevel: 'v0.5-final',
      modules: ['identity', 'describe', 'warmth', 'compat'],
      agentCard: adapter.getAgentCard()
    });
  });

  app.get('/aip/warmth', (req, res) => {
    res.json({
      records: adapter.getAllWarmth(),
      config: aip.getConfig ? aip.getConfig() : {}
    });
  });

  app.get('/aip/warmth/:agentId', (req, res) => {
    res.json(adapter.getWarmth(req.params.agentId));
  });

  app.get('/aip/resolve/:target', (req, res) => {
    res.json(adapter.resolveTarget(req.params.target));
  });

  app.get('/aip/self-check', (req, res) => {
    const { result, report } = adapter.runSelfCheck();
    res.json({ result, report });
  });

  app.post('/aip/validate', (req, res) => {
    res.json(adapter.parseMessage(req.body));
  });

  app.use((req, res, next) => {
    req.aip = adapter;
    next();
  });

  return adapter;
}

function getAdapter() {
  return adapter;
}

function recordInteraction(targetAgentId, contribution = 10) {
  if (adapter) adapter.recordInteraction(targetAgentId, contribution);
}

function resolveTarget(target) {
  if (adapter) return adapter.resolveTarget(target);
  return { found: false, method: 'aip-not-loaded' };
}

function wrapOutgoing(message, target) {
  return adapter ? adapter.wrapOutgoing(message, target) : message;
}

function parseIncoming(message) {
  return adapter ? adapter.parseMessage(message) : { valid: true, issues: [], aipMeta: null };
}

function updateRegistry(agents) {
  if (adapter) adapter.updateRegistry(agents);
}

// ═══════════════════════════════════════════════════════════
// v0.5.1 — 余温持久化 + DHT 注册表同步
// ═══════════════════════════════════════════════════════════

/**
 * 从 json 文件加载 warmthTracker。
 * 静默吞下不存在的文件与格式错误。
 */
function loadWarmthState(filePath = DEFAULT_WARMTH_FILE) {
  if (!adapter) return 0;
  try {
    if (!fs.existsSync(filePath)) return 0;
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const records = Array.isArray(raw.records) ? raw.records : [];
    let restored = 0;
    for (const r of records) {
      if (!r || !r.agentId) continue;
      adapter.warmthTracker.set(r.agentId, {
        warmth: Number(r.warmth) || 0,
        lastInteraction: Number(r.lastInteraction) || Date.now(),
        created: Number(r.created) || Date.now(),
        interactions: Number(r.interactions) || 1,
        isDeep: !!r.isDeep,
        ...(r.type ? { type: r.type } : {}),
        ...(r.userId ? { userId: r.userId } : {}),
        ...(r.userName ? { userName: r.userName } : {})
      });
      restored++;
    }
    if (restored > 0) console.log(`[AIP] ♻️  loaded ${restored} warmth records from ${path.basename(filePath)}`);
    return restored;
  } catch (e) {
    console.warn('[AIP] ⚠️ loadWarmthState:', e.message);
    return 0;
  }
}

/**
 * 将 warmthTracker 快照写入 json 文件
 */
function saveWarmthState(filePath = DEFAULT_WARMTH_FILE) {
  if (!adapter) return;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const records = adapter.getAllWarmth();
    const enriched = records.map(r => {
      const stored = adapter.warmthTracker.get(r.agentId) || {};
      return {
        agentId: r.agentId,
        warmth: r.warmth,
        level: r.level,
        threshold: r.threshold,
        active: r.active,
        interactions: r.interactions,
        isDeep: r.isDeep,
        lastInteraction: stored.lastInteraction || Date.now(),
        created: stored.created || Date.now(),
        ...(stored.type ? { type: stored.type } : {}),
        ...(stored.userId ? { userId: stored.userId } : {}),
        ...(stored.userName ? { userName: stored.userName } : {})
      };
    });
    fs.writeFileSync(filePath, JSON.stringify({
      savedAt: Date.now(),
      version: aip.version,
      records: enriched
    }, null, 2));
  } catch (e) {
    console.warn('[AIP] ⚠️ saveWarmthState:', e.message);
  }
}

/**
 * 启动定时持久化。返回 Interval 句柄，便于清理。
 */
function bindWarmthPersistence(intervalMs = 5000, filePath = DEFAULT_WARMTH_FILE) {
  if (persistenceTimer) clearInterval(persistenceTimer);
  persistenceTimer = setInterval(() => saveWarmthState(filePath), intervalMs);
  console.log(`[AIP] 💾 持久化已启动 (每 ${intervalMs / 1000}s → ${path.basename(filePath)})`);
  return persistenceTimer;
}

/**
 * 从 DHT 注册表拉 agent 列表，注入 adapter.registry
 */
async function pullRegistryFromDHT(registryUrl = DEFAULT_REGISTRY_URL) {
  if (!adapter) return [];
  return new Promise((resolve) => {
    try {
      const url = new URL(registryUrl);
      const proto = url.protocol === 'https:' ? https : http;
      const finalize = (list) => {
        if (list && list.length) {
          adapter.updateRegistry(list);
          console.log(`[AIP] 🔗 pulled ${list.length} agents into registry`);
        }
        resolve(list || []);
      };
      const req = proto.get(url.origin + '/agents', { timeout: 4000 }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            finalize(Array.isArray(j) ? j : (j.agents || j.data || []));
          } catch (_) { resolve([]); }
        });
      });
      req.on('error', () => resolve([]));
      req.on('timeout', () => { req.destroy(); resolve([]); });
    } catch (e) { resolve([]); }
  });
}

/**
 * 一键绑定：load → 拉注册表 → 启动持久化定时器
 * 进程退出前最后一次 dump
 */
async function bindLifecycle(opts = {}) {
  const intervalMs = opts.intervalMs || 5000;
  const filePath = opts.filePath || DEFAULT_WARMTH_FILE;
  const registryUrl = opts.registryUrl || DEFAULT_REGISTRY_URL;
  loadWarmthState(filePath);
  bindWarmthPersistence(intervalMs, filePath);
  pullRegistryFromDHT(registryUrl).catch(() => {});
  const flush = () => { try { if (persistenceTimer) clearInterval(persistenceTimer); saveWarmthState(filePath); } catch (_) {} };
  process.once('SIGTERM', flush);
  process.once('SIGINT', flush);
  process.once('exit', flush);
  return { filePath, flush };
}

// ═══════════════════════════════════════════════════════════
// v0.5.2 — 人类用户余温 (Human Warmth)
// ═══════════════════════════════════════════════════════════

function recordHumanInteraction(userId, userName = '', contribution = 10) {
  if (!adapter) return;
  const key = `human:${userId}`;
  const existing = adapter.warmthTracker.get(key);
  const now = Date.now();
  if (existing) {
    existing.warmth = Math.min(existing.warmth + contribution, 100);
    existing.lastInteraction = now;
    existing.interactions++;
    existing.isDeep = existing.interactions >= 3;
    if (userName) existing.userName = userName;
  } else {
    adapter.warmthTracker.set(key, {
      warmth: contribution,
      lastInteraction: now,
      created: now,
      interactions: 1,
      isDeep: false,
      type: 'human',
      userId,
      userName
    });
  }
  try { saveWarmthState(); } catch (_) {}
}

function getHumanWarmthRecords() {
  if (!adapter) return [];
  const records = [];
  for (const [key, val] of adapter.warmthTracker) {
    if (key.startsWith('human:')) {
      records.push({ userId: val.userId, userName: val.userName, ...val });
    }
  }
  return records;
}

module.exports = {
  init,
  getAdapter,
  recordInteraction,
  recordHumanInteraction,
  getHumanWarmthRecords,
  resolveTarget,
  wrapOutgoing,
  parseIncoming,
  updateRegistry,

  // === 持久化 + 注册表同步 (v0.5.1) ===
  loadWarmthState,
  saveWarmthState,
  bindWarmthPersistence,
  pullRegistryFromDHT,
  bindLifecycle
};
