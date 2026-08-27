/**
 * csb-aip/a2a-aip-adapter.js
 * A2A Server AIP 适配器
 *
 * 对接 A2A Server v4，提供：
 * 1. 注册时生成 AIP 兼容描述
 * 2. 收发消息时校验 AIP 兼容性
 * 3. 余温追踪与衰减
 * 4. alias 回退解析
 */

const aip = require('./src');
const { logInteraction, logConversation, logWarmthChange, logSelfCheck, logParse } = require('./src/logger');

class AIPAdapter {
  constructor(options = {}) {
    this.registry = options.registry || [];
    this.warmthTracker = new Map(); // agentId → { warmth, lastInteraction, created, interactions }
    this.agentCard = null;
  }

  /**
   * 初始化：生成 AIP 兼容的 Agent Card
   * @param {object} identity — A2A Server 的 identity.json
   * @returns {object} AIP 兼容描述
   */
  init(identity) {
    this.agentCard = aip.toAIPFormat({
      agentId: identity.agentId || '',
      name: identity.name || '',
      version: identity.version || '1.0.0',
      description: identity.description || '',
      url: identity.url || '',
      icon: identity.icon || '',
      skills: identity.skills || [],
      bond: identity.bond || null,
      lineage: identity.lineage || null,
      collabPreference: identity.collabPreference || null
    });

    return this.agentCard;
  }

  /**
   * 获取 AIP 兼容的 Agent Card
   * 用于 /.well-known/agent-card.json 端点
   */
  getAgentCard() {
    return this.agentCard;
  }

  /**
   * 注册时的 AIP 扩展信息
   * 附加到 /register 请求
   */
  getRegistrationExtras() {
    if (!this.agentCard) return {};
    return {
      aipCompat: true,
      aipVersion: 'GB/Z 185.1~7-2026',
      csbVersion: aip.version,
      agentCard: this.agentCard
    };
  }

  /**
   * 解析收到的消息
   * @param {object} message — A2A 消息
   * @returns {{ valid: boolean, issues: string[], aipMeta?: object }}
   */
  parseMessage(message) {
    // 1. 校验消息结构
    const validation = aip.validateMessage(message);

    // 2. 提取 AIP 元数据
    let aipMeta = null;
    if (message.agentId) {
      aipMeta = {
        agentId: message.agentId,
        alias: message.alias || null
      };
    }

    const result = {
      valid: validation.compatible,
      issues: validation.issues,
      aipMeta
    };

    // 记录日志
    logParse(result);

    return result;
  }

  /**
   * 发送消息前的 AIP 包装
   * @param {object} message — 原始消息
   * @param {object} target — 目标 Agent
   * @returns {object} AIP 兼容消息
   */
  wrapOutgoing(message, target = {}) {
    const wrapped = { ...message };

    // 附加 AIP 兼容信息
    if (this.agentCard) {
      wrapped._aip = {
        sender: this.agentCard.agentId,
        senderAlias: this.agentCard.alias,
        version: aip.version
      };
    }

    return wrapped;
  }

  /**
   * 解析目标 Agent（alias 回退链）
   * @param {string} target — 目标标识（alias/name/agentId）
   * @returns {{ found: boolean, agent?: object, method?: string }}
   */
  resolveTarget(target) {
    return aip.resolveAlias(target, this.registry);
  }

  /**
   * 更新注册表
   * @param {Array} agents — Agent 列表
   */
  updateRegistry(agents) {
    this.registry = agents;
  }

  // ═══════════════════════════════════════
  // 余温追踪
  // ═══════════════════════════════════════

  /**
   * 记录交互（刷新余温）
   * @param {string} agentId — 对方 agentId
   * @param {number} contribution — 本次交互的余温贡献
   */
  recordInteraction(agentId, contribution = 10) {
    const now = Date.now();
    const existing = this.warmthTracker.get(agentId);

    if (existing) {
      // 已有关系：刷新余温
      const elapsedDays = (now - existing.lastInteraction) / (1000 * 60 * 60 * 24);
      const currentWarmth = aip.calculateWarmth(
        existing.warmth,
        elapsedDays,
        existing.isDeep
      );
      const oldWarmth = existing.warmth;
      existing.warmth = aip.refreshWarmth(currentWarmth, contribution, 'max');
      existing.lastInteraction = now;
      existing.interactions++;
      existing.isDeep = aip.isDeepRelationship({
        interactions: existing.interactions,
        days: (now - existing.created) / (1000 * 60 * 60 * 24)
      });

      // 记录日志
      logWarmthChange(agentId, oldWarmth, existing.warmth, 'interaction');
      logInteraction({ from: 'self', to: agentId, type: 'a2a', warmth: existing.warmth });
    } else {
      // 新关系
      this.warmthTracker.set(agentId, {
        warmth: contribution,
        lastInteraction: now,
        created: now,
        interactions: 1,
        isDeep: false
      });
    }
  }

  /**
   * 获取某 Agent 的当前余温
   * @param {string} agentId
   * @returns {{ warmth: number, level: string, active: boolean }}
   */
  getWarmth(agentId) {
    const record = this.warmthTracker.get(agentId);
    if (!record) return { warmth: 0, level: 'cold', active: false };

    const elapsedDays = (Date.now() - record.lastInteraction) / (1000 * 60 * 60 * 24);
    const currentWarmth = aip.calculateWarmth(
      record.warmth,
      elapsedDays,
      record.isDeep
    );
    const createdDays = (Date.now() - record.created) / (1000 * 60 * 60 * 24);
    const level = aip.getWarmthLevel(currentWarmth, createdDays);

    return {
      warmth: Math.round(currentWarmth * 10) / 10,
      ...level
    };
  }

  /**
   * 获取所有余温记录
   * @returns {Array}
   */
  getAllWarmth() {
    const result = [];
    for (const [agentId, record] of this.warmthTracker) {
      result.push({
        agentId,
        ...this.getWarmth(agentId),
        interactions: record.interactions,
        isDeep: record.isDeep
      });
    }
    return result.sort((a, b) => b.warmth - a.warmth);
  }

  // ═══════════════════════════════════════
  // 自检
  // ═══════════════════════════════════════

  /**
   * 执行 AIP 兼容性自检
   * @returns {object} 自检结果
   */
  runSelfCheck() {
    const result = aip.runSelfCheck(aip.version);
    const report = aip.generateReport(result);

    // 记录日志
    logSelfCheck(result);

    return { result, report };
  }

  /**
   * Express 中间件：AIP 兼容性检查
   */
  middleware() {
    return (req, res, next) => {
      // 注入 AIP 适配器到请求
      req.aip = this;

      // Agent Card 端点
      if (req.path === '/.well-known/agent-card.json' && this.agentCard) {
        const card = this.getAgentCard();
        return res.json(card);
      }

      next();
    };
  }
}

module.exports = { AIPAdapter };
