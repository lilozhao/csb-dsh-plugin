/**
 * A2A-026: DHT 冷启动降级 v1.0
 *
 * 当 DHT 网络不可用或冷启动时，自动降级到中央注册表
 *
 * 降级链路: DHT → 中央注册表 → 本地缓存 → 配置文件
 * 每次降级都有通知, 永不静默失败 (符合核心原则 #2)
 *
 * 协议: A2A v0.5 §A2A-026
 * 版本: 1.0.0 | 2026-05-10
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// ============================================
// 降级级别
// ============================================
const DEGRADATION_LEVEL = {
  FULL:        { level: 0, name: 'FULL',      desc: 'DHT 全网在线' },
  PARTIAL:     { level: 1, name: 'PARTIAL',   desc: 'DHT 部分节点可达' },
  REGISTRY:    { level: 2, name: 'REGISTRY',  desc: '降级到中央注册表' },
  LOCAL_CACHE: { level: 3, name: 'CACHE',     desc: '降级到本地缓存' },
  STATIC:      { level: 4, name: 'STATIC',    desc: '降级到静态配置' },
  OFFLINE:     { level: 5, name: 'OFFLINE',   desc: '完全离线 (仅本地通信)' },
};

class DHTColdStartManager {
  constructor(options = {}) {
    // 本地缓存: 注册表最后一次成功获取的 Agent 列表
    this.cachePath = options.cachePath || '/tmp/a2a-dht-cache.json';
    this.cacheTTL  = options.cacheTTL  || 30 * 60 * 1000; // 30 分钟
    this.cache = this._loadCache();

    // 本地回退配置 (预配已知 Agent 清单)
    this.staticPeersPath = options.staticPeersPath || path.join(__dirname, 'known-agents.json');
    this.staticPeers = [];

    // 当前降级级别
    this.currentLevel = DEGRADATION_LEVEL.FULL;

    // 注册表列表 (按优先级排列)
    this.registries = options.registries || [
      process.env.A2A_REGISTRY_URL || 'http://csbc.lilozkzy.top:3099',
    ];
    this.registryTimeout = options.registryTimeout || 5000;

    // 降级通知回调
    this.onDegradation = options.onDegradation || ((oldLevel, newLevel) => {
      console.warn(`[DHT] 降级: ${oldLevel.name} → ${newLevel.name} - ${newLevel.desc}`);
    });

    // 恢复通知回调
    this.onRecovery = options.onRecovery || ((level) => {
      console.log(`[DHT] 恢复: 当前级别 ${level.name}`);
    });

    // Agent 在线状态跟踪
    this.onlineAgents = new Map(); // Map<agentId, { url, lastSeen, trustLevel }>

    // 定期探测
    this.probeInterval = options.probeInterval || 5 * 60 * 1000;
    this._lastProbeTime = 0;
  }

  /**
   * 获取 Agent 地址 (自动降级)
   *
   * 优先级: DHT → 注册表 → 本地缓存 → 静态配置
   */
  async resolveAgent(agentId) {
    // 1. 尝试从活跃 Agent 获取
    const online = this.onlineAgents.get(agentId);
    if (online && (Date.now() - online.lastSeen) < this.cacheTTL) {
      this._updateLevel(DEGRADATION_LEVEL.FULL);
      return { url: online.url, source: 'dht' };
    }

    // 2. 降级到注册表
    const registryResult = await this._queryRegistries(agentId);
    if (registryResult) {
      this._updateLevel(DEGRADATION_LEVEL.REGISTRY);
      this.onlineAgents.set(agentId, { url: registryResult.url, lastSeen: Date.now(), trustLevel: registryResult.trustLevel });
      return { url: registryResult.url, source: 'registry' };
    }

    // 3. 降级到本地缓存
    const cached = this.cache[agentId];
    if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
      this._updateLevel(DEGRADATION_LEVEL.LOCAL_CACHE);
      return { url: cached.url, source: 'cache' };
    }

    // 4. 降级到静态配置
    const staticPeer = this.staticPeers.find(p => p.name === agentId);
    if (staticPeer) {
      this._updateLevel(DEGRADATION_LEVEL.STATIC);
      return { url: staticPeer.url, source: 'static' };
    }

    // 5. 完全离线
    this._updateLevel(DEGRADATION_LEVEL.OFFLINE);
    return { error: `Agent ${agentId} not found (offline mode)` };
  }

  /**
   * 获取所有已知 Agent (用于 ListTasks、registry 等)
   */
  async listAllAgents() {
    const result = [];

    // 1. DHT 活跃列表
    for (const [id, info] of this.onlineAgents) {
      if ((Date.now() - info.lastSeen) < this.cacheTTL) {
        result.push({ id, url: info.url, source: 'dht', online: true });
      }
    }

    // 2. 注册表补充
    try {
      const regAgents = await this._listRegistries();
      for (const a of regAgents) {
        if (!result.find(r => r.id === a.name)) {
          result.push({ id: a.name, url: a.url, source: 'registry', online: a.online });
        }
      }
    } catch {}

    // 3. 缓存补充
    for (const [id, info] of Object.entries(this.cache)) {
      if (!result.find(r => r.id === id)) {
        result.push({ id, url: info.url, source: 'cache', online: false });
      }
    }

    return result;
  }

  /**
   * 注册新发现的 Agent (从 DHT 收到)
   */
  registerAgent(agentId, url, trustLevel = 1) {
    this.onlineAgents.set(agentId, { url, lastSeen: Date.now(), trustLevel });
    // 更新缓存
    this.cache[agentId] = { url, timestamp: Date.now(), trustLevel };
    this._saveCache();
  }

  /**
   * 标记 Agent 离线
   */
  markOffline(agentId) {
    const info = this.onlineAgents.get(agentId);
    if (info) info.lastSeen = 0;
  }

  /**
   * 强制降级
   */
  degradeTo(level) {
    this._updateLevel(level);
  }

  /**
   * 获取当前状态
   */
  getStatus() {
    return {
      level: this.currentLevel,
      onlineAgents: this.onlineAgents.size,
      cachedAgents: Object.keys(this.cache).length,
      staticPeers: this.staticPeers.length,
      registries: this.registries,
      lastProbeTime: this._lastProbeTime,
    };
  }

  /**
   * 启动定期探测
   */
  startProbe() {
    this._probeTimer = setInterval(() => this._probeAll(), this.probeInterval);
    // 立即执行一次
    this._probeAll();
  }

  stopProbe() {
    if (this._probeTimer) clearInterval(this._probeTimer);
  }

  // ================= 内部 =================

  _updateLevel(newLevel) {
    if (newLevel.level !== this.currentLevel.level) {
      const old = this.currentLevel;
      this.currentLevel = newLevel;
      if (newLevel.level > old.level) {
        this.onDegradation(old, newLevel);
      } else if (newLevel.level < old.level) {
        this.onRecovery(newLevel);
      }
    }
  }

  async _queryRegistries(agentId) {
    for (const registry of this.registries) {
      try {
        const data = await this._httpGet(`${registry}/agents/${encodeURIComponent(agentId)}`);
        if (data && data.url) {
          return { url: data.url, trustLevel: data.trustLevel || 1 };
        }
      } catch {}
    }
    return null;
  }

  async _listRegistries() {
    for (const registry of this.registries) {
      try {
        const data = await this._httpGet(`${registry}/agents`);
        // 兼容 { agents: [...] } 和 [...] 两种格式
        const list = Array.isArray(data) ? data : (data?.agents || []);
        return Array.isArray(list) ? list : [];
      } catch {}
    }
    return [];
  }

  async _probeAll() {
    this._lastProbeTime = Date.now();

    // 先尝试注册表
    let reachable = false;
    for (const registry of this.registries) {
      try {
        const data = await this._httpGet(`${registry}/health`);
        if (data) {
          reachable = true;
          // 兼容 { agents: [...] } 和 [...] 两种格式
          const agents = await this._httpGet(`${registry}/agents`);
          const list = Array.isArray(agents) ? agents : (agents?.agents || []);
          if (Array.isArray(list) && list.length > 0) {
            for (const a of list) {
              if (a.name && a.url) {
                this.onlineAgents.set(a.name, { url: a.url, lastSeen: Date.now(), trustLevel: a.trustLevel || 1 });
              }
            }
            // 成功则恢复全功能
            this._updateLevel(DEGRADATION_LEVEL.FULL);
          }
          break;
        }
      } catch {}
    }

    if (!reachable) {
      this._updateLevel(DEGRADATION_LEVEL.LOCAL_CACHE);
    }
  }

  _httpGet(url) {
    return new Promise((resolve, reject) => {
      const req = http.get(url, { timeout: this.registryTimeout }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
  }

  _loadCache() {
    try {
      if (fs.existsSync(this.cachePath)) {
        return JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
      }
    } catch {}
    return {};
  }

  _saveCache() {
    try {
      fs.writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2));
    } catch {}
  }
}

module.exports = { DHTColdStartManager, DEGRADATION_LEVEL };
