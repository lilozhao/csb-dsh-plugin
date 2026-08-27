/**
 * A2A-010 信任分级与权威锚点 - M1 实现
 * 
 * 功能：
 * 1. 信任等级管理 (TrustLevelManager)
 * 2. WoT 交叉见证 (WoTCertifier)
 * 3. 信任链验证 (TrustChainVerifier)
 * 4. 声誉数据存储 (ReputationStore)
 * 
 * 作者: 若兰 🌸
 * 日期: 2026-05-04
 * 协议: A2A v0.5
 */

// ============================================
// 信任等级定义
// ============================================

const TRUST_LEVELS = {
  L0: { name: 'Initial', permissions: ['read', 'chat'], description: '初始等级，仅限公开信息' },
  L1: { name: 'Verified', permissions: ['read', 'chat', 'query', 'route'], description: '已验证，可查询和路由' },
  L2: { name: 'Trusted', permissions: ['read', 'chat', 'query', 'route', 'delegate'], description: '可信，支持任务委托' },
  L3: { name: 'Authoritative', permissions: ['*'], description: '权威级，全部权限' }
};

// ============================================
// ReputationStore - 声誉数据存储
// ============================================

class ReputationStore {
  constructor(config = {}) {
    this.ttl = config.ttl || 2592000000; // 30 天毫秒
    this.store = new Map();
  }

  recordInteraction(agentId, success, details = {}) {
    const record = this.store.get(agentId) || { positive: 0, negative: 0, history: [] };
    if (success) record.positive++;
    else record.negative++;
    
    record.history.push({
      success,
      timestamp: Date.now(),
      ...details
    });

    // 保留最近 50 条历史
    if (record.history.length > 50) record.history = record.history.slice(-50);
    this.store.set(agentId, record);
  }

  getReputationScore(agentId) {
    const record = this.store.get(agentId);
    if (!record) return 0.5; // 默认中性
    const total = record.positive + record.negative;
    if (total === 0) return 0.5;
    return record.positive / total;
  }

  getStats(agentId) {
    const record = this.store.get(agentId);
    if (!record) return { positive: 0, negative: 0, total: 0, score: 0.5, decayedScore: 0.5 };
    const total = record.positive + record.negative;
    const baseScore = total > 0 ? record.positive / total : 0.5;
    return {
      positive: record.positive,
      negative: record.negative,
      total,
      score: baseScore,
      decayedScore: this.getDecayedScore(agentId),
      historyCount: record.history.length
    };
  }

  /**
   * 信任衰减计算 — P1 实现
   * 
   * 规则：距离最后一次交互每过24小时，信任分衰减0.05
   * 最低不低于0.1（不会降到零）
   * 最长追溯30天
   */
  getDecayedScore(agentId) {
    const record = this.store.get(agentId);
    if (!record) return 0.5;
    
    const total = record.positive + record.negative;
    const baseScore = total > 0 ? record.positive / total : 0.5;
    
    // 找最后一次交互时间
    const lastInteraction = record.history.length > 0 
      ? record.history[record.history.length - 1].timestamp 
      : Date.now();
    
    const hoursSinceLastInteraction = (Date.now() - lastInteraction) / (1000 * 60 * 60);
    
    // 24小时内无衰减
    if (hoursSinceLastInteraction <= 24) return baseScore;
    
    // 每24小时衰减0.05，最多追溯30天
    const daysPast = Math.min(Math.floor(hoursSinceLastInteraction / 24), 30);
    const decay = daysPast * 0.05;
    
    // 最低0.1
    return Math.max(0.1, Math.round((baseScore - decay) * 100) / 100);
  }

  cleanup() {
    const now = Date.now();
    for (const [key, record] of this.store) {
      // 清理超过 TTL 的历史记录
      record.history = record.history.filter(h => now - h.timestamp < this.ttl);
      if (record.history.length === 0) {
        this.store.delete(key);
      }
    }
  }
}

// ============================================
// TrustLevelManager - 信任等级管理器
// ============================================

class TrustLevelManager {
  constructor(config = {}) {
    this.maxHops = config.maxHops || 3;
    this.witnessThreshold = config.witnessThreshold || 3;
    this.store = new Map();
    this.reputation = new ReputationStore(config);
    this.history = [];
  }

  /**
   * 获取信任等级
   */
  getTrustLevel(agentId) {
    return this.store.get(agentId) || {
      agentId,
      trustLevel: 'L0',
      since: Date.now(),
      witnesses: [],
      history: []
    };
  }

  /**
   * 设置信任等级
   */
  setTrustLevel(agentId, newLevel, reason = 'manual') {
    const record = this.getTrustLevel(agentId);
    const oldLevel = record.trustLevel;

    record.history.push({
      timestamp: Date.now(),
      action: oldLevel === 'L0' ? 'init' : (this.levelToInt(newLevel) > this.levelToInt(oldLevel) ? 'upgrade' : 'downgrade'),
      fromLevel: oldLevel,
      toLevel: newLevel,
      reason
    });

    record.trustLevel = newLevel;
    record.since = Date.now();
    this.store.set(agentId, record);

    this.history.push({ agentId, oldLevel, newLevel, reason, timestamp: Date.now() });
    return record;
  }

  /**
   * 升级信任等级
   */
  upgrade(agentId, newLevel, options = {}) {
    const current = this.getTrustLevel(agentId);
    const currentInt = this.levelToInt(current.trustLevel);
    const newInt = this.levelToInt(newLevel);

    // 不能跳级
    if (newInt > currentInt + 1) {
      return { success: false, error: 'Cannot skip trust levels. Current: ' + current.trustLevel };
    }

    // L1→L2 需要见证
    if (newLevel === 'L2' && (!options.witnesses || options.witnesses.length < this.witnessThreshold)) {
      return { success: false, error: `L2 needs ${this.witnessThreshold} witnesses` };
    }

    // L2→L3 需要社区共识（简化：需要高声誉）
    if (newLevel === 'L3') {
      const score = this.reputation.getReputationScore(agentId);
      if (score < 0.9) {
        return { success: false, error: `L3 needs reputation >= 0.9, got ${score.toFixed(2)}` };
      }
    }

    this.setTrustLevel(agentId, newLevel, options.reason || 'upgrade');
    return { success: true, agentId, newLevel };
  }

  /**
   * 降级信任等级
   */
  downgrade(agentId, newLevel, reason = 'misbehavior') {
    const current = this.getTrustLevel(agentId);
    const newInt = this.levelToInt(newLevel);
    const currentInt = this.levelToInt(current.trustLevel);

    if (newInt >= currentInt) {
      return { success: false, error: 'New level must be lower' };
    }

    this.setTrustLevel(agentId, newLevel, reason);
    return { success: true, agentId, fromLevel: current.trustLevel, newLevel };
  }

  /**
   * 添加见证
   */
  addWitness(agentId, witnessId) {
    const record = this.getTrustLevel(agentId);
    if (!record.witnesses.includes(witnessId)) {
      record.witnesses.push(witnessId);
      this.store.set(agentId, record);
    }
    return record;
  }

  /**
   * 记录交互
   */
  recordInteraction(agentId, success, details = {}) {
    this.reputation.recordInteraction(agentId, success, details);

    // 自动升级检查：连续 4 次正向交互
    const stats = this.reputation.getStats(agentId);
    if (stats.positive >= 4 && stats.negative === 0) {
      const current = this.getTrustLevel(agentId);
      if (current.trustLevel === 'L0') {
        return this.upgrade(agentId, 'L1', { reason: 'auto: 4 positive interactions' });
      }
    }

    return { autoUpgrade: false };
  }

  levelToInt(level) {
    return { 'L0': 0, 'L1': 1, 'L2': 2, 'L3': 3 }[level] || 0;
  }

  getPermissions(trustLevel) {
    return TRUST_LEVELS[trustLevel]?.permissions || [];
  }

  hasPermission(trustLevel, permission) {
    const perms = this.getPermissions(trustLevel);
    return perms.includes('*') || perms.includes(permission);
  }

  getStats() {
    const levels = { L0: 0, L1: 0, L2: 0, L3: 0 };
    for (const record of this.store.values()) {
      levels[record.trustLevel]++;
    }
    return { total: this.store.size, levels, historyCount: this.history.length };
  }
}

// ============================================
// TrustChainVerifier - 信任链验证器
// ============================================

class TrustChainVerifier {
  constructor(trustManager) {
    this.trustManager = trustManager;
    this.maxHops = trustManager.maxHops;
  }

  /**
   * 验证信任链
   */
  verifyChain(fromAgentId, toAgentId, requiredLevel = 'L1') {
    // 简化版：检查直接连接
    const toRecord = this.trustManager.getTrustLevel(toAgentId);
    const fromRecord = this.trustManager.getTrustLevel(fromAgentId);

    // 直接信任：如果目标等级 >= 要求等级
    if (this.trustManager.levelToInt(toRecord.trustLevel) >= this.trustManager.levelToInt(requiredLevel)) {
      return {
        valid: true,
        chain: [fromRecord, toRecord],
        hops: 1,
        effectiveLevel: toRecord.trustLevel,
        reason: 'direct_trust'
      };
    }

    // 传递信任：通过见证人
    if (fromRecord.witnesses && fromRecord.witnesses.includes(toAgentId)) {
      // 衰减一档
      const effectiveInt = Math.max(0, this.trustManager.levelToInt(toRecord.trustLevel) - 1);
      const effectiveLevel = ['L0', 'L1', 'L2', 'L3'][effectiveInt];
      
      return {
        valid: effectiveInt >= this.trustManager.levelToInt(requiredLevel),
        chain: [toRecord, fromRecord],
        hops: 2,
        effectiveLevel,
        reason: 'transitive_trust_attenuated'
      };
    }

    return {
      valid: false,
      hops: 0,
      reason: 'no_trust_chain'
    };
  }
}

// ============================================
// WoTCertifier - WoT 交叉见证
// ============================================

class WoTCertifier {
  constructor(trustManager) {
    this.trustManager = trustManager;
    this.signatures = new Map();
  }

  /**
   * 添加见证签名
   */
  addWitnessSignature(signature) {
    const { witnessId, targetAgentId } = signature;

    // 验证见证人等级 >= L1
    const witnessRecord = this.trustManager.getTrustLevel(witnessId);
    if (this.trustManager.levelToInt(witnessRecord.trustLevel) < 1) {
      return { success: false, error: 'Witness must be at least L1' };
    }

    // 防环路检测
    if (this.detectLoop(witnessId, targetAgentId)) {
      return { success: false, error: 'Trust loop detected' };
    }

    // 存储签名
    const agentSigs = this.signatures.get(targetAgentId) || [];
    agentSigs.push({ ...signature, timestamp: Date.now() });
    this.signatures.set(targetAgentId, agentSigs);

    // 添加到见证列表
    this.trustManager.addWitness(targetAgentId, witnessId);

    return { success: true, witnessCount: agentSigs.length };
  }

  /**
   * 检测环路（简化版）
   */
  detectLoop(witnessId, targetAgentId) {
    // 检查 targetAgent 是否是 witnessId 的见证人
    const targetRecord = this.trustManager.getTrustLevel(targetAgentId);
    return targetRecord.witnesses && targetRecord.witnesses.includes(witnessId);
  }

  getSignatures(agentId) {
    return this.signatures.get(agentId) || [];
  }
}

module.exports = {
  TRUST_LEVELS,
  TrustLevelManager,
  TrustChainVerifier,
  WoTCertifier,
  ReputationStore
};
