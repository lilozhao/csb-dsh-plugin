/**
 * A2A-011 版本协商与冲突处理 - M1 实现
 * 
 * 功能：
 * 1. 版本比较 (VersionComparator)
 * 2. 兼容代价计算 (CompatibilityCalculator)
 * 3. 协商引擎 (NegotiationEngine)
 * 4. 冲突仲裁器 (ConflictResolver)
 * 
 * 作者: 若兰 🌸
 * 日期: 2026-05-04
 * 协议: A2A v0.5
 */

// ============================================
// VersionComparator - 版本比较器
// ============================================

class VersionComparator {
  /**
   * 解析版本号字符串
   * @param {string} versionStr - 如 "2.8.0" 或 "v2.8.0"
   * @returns {object} { major, minor, patch, hash }
   */
  static parse(versionStr) {
    if (!versionStr) return { major: 0, minor: 0, patch: 0 };
    const clean = versionStr.replace(/^v/, '');
    const parts = clean.split('.');
    return {
      major: parseInt(parts[0]) || 0,
      minor: parseInt(parts[1]) || 0,
      patch: parseInt(parts[2]) || 0,
      hash: parts[3] || ''
    };
  }

  /**
   * 比较两个版本
   * @returns {object} { same, compatibility, diff }
   */
  static compare(v1, v2) {
    const p1 = this.parse(v1);
    const p2 = this.parse(v2);

    const same = p1.major === p2.major && p1.minor === p2.minor && p1.patch === p2.patch;

    let compatibility = 'none';
    if (same) {
      compatibility = 'identical';
    } else if (p1.major === p2.major) {
      compatibility = 'forward'; // 同主版本，向前兼容
    } else if (p2.major === p1.major + 1) {
      compatibility = 'backward'; // 相邻主版本，可能向后兼容
    }

    // 计算差异
    const diff = {
      majorDiff: p2.major - p1.major,
      minorDiff: p2.minor - p1.minor,
      patchDiff: p2.patch - p1.patch
    };

    return { same, compatibility, diff, v1: p1, v2: p2 };
  }

  /**
   * 计算结构层代价
   * 权重：新增+1, 改名+3, 删除+5, 类型变更+7
   */
  static calculateStructuralCost(capabilitiesV1, capabilitiesV2) {
    const caps1 = new Set(Object.keys(capabilitiesV1 || {}));
    const caps2 = new Set(Object.keys(capabilitiesV2 || {}));

    const added = [...caps2].filter(c => !caps1.has(c));
    const removed = [...caps1].filter(c => !caps2.has(c));
    const common = [...caps1].filter(c => caps2.has(c));

    // 检查常见能力的类型变更
    let typeChanges = 0;
    for (const cap of common) {
      if (JSON.stringify(capabilitiesV1[cap]) !== JSON.stringify(capabilitiesV2[cap])) {
        typeChanges++;
      }
    }

    const score = added.length * 1 + removed.length * 5 + typeChanges * 7;
    const maxPossible = (caps1.size + caps2.size) * 7;
    
    return Math.min(1, score / Math.max(1, maxPossible));
  }
}

// ============================================
// CompatibilityCalculator - 兼容代价计算器
// ============================================

class CompatibilityCalculator {
  constructor(config = {}) {
    this.weights = config.weights || {
      structural: 0.3,
      semantic: 0.5,
      behavioral: 0.2
    };
    // 已知兼容版本矩阵
    this.compatibilityMatrix = config.matrix || this._buildDefaultMatrix();
  }

  _buildDefaultMatrix() {
    return {
      '2.8.0': { '2.9.0': 0.1, '2.7.0': 0.05 },
      '2.9.0': { '2.8.0': 0.1, '3.0.0': 0.6 },
      '3.0.0': { '2.9.0': 0.6, '2.8.0': 0.8 }
    };
  }

  /**
   * 计算三层兼容代价
   * @returns {object} { structural, semantic, behavioral, total }
   */
  async calculateCost(versionA, versionB, capabilitiesA, capabilitiesB) {
    // 1. 检查已知矩阵
    const matrixKey = `${versionA}-${versionB}`;
    const reverseKey = `${versionB}-${versionA}`;
    if (this.compatibilityMatrix[versionA]?.[versionB] !== undefined) {
      return {
        structural: this.compatibilityMatrix[versionA][versionB] * 0.3,
        semantic: this.compatibilityMatrix[versionA][versionB] * 0.5,
        behavioral: this.compatibilityMatrix[versionA][versionB] * 0.2,
        total: this.compatibilityMatrix[versionA][versionB],
        source: 'matrix'
      };
    }

    // 2. 结构层计算
    const structural = VersionComparator.calculateStructuralCost(
      capabilitiesA, capabilitiesB
    );

    // 3. 语义层（简化版：基于版本差异估算）
    const compareResult = VersionComparator.compare(versionA, versionB);
    let semantic = 0.5; // 默认中等
    if (compareResult.compatibility === 'identical') semantic = 0;
    else if (compareResult.compatibility === 'forward') semantic = 0.2;
    else if (compareResult.compatibility === 'backward') semantic = 0.4;
    else semantic = 0.8; // 不兼容

    // 4. 行为层（简化版：基于主版本判断）
    const behavioral = compareResult.diff.majorDiff !== 0 ? 0.7 : 0.1;

    // 5. 加权总分
    const total = structural * this.weights.structural
                + semantic * this.weights.semantic
                + behavioral * this.weights.behavioral;

    return {
      structural: Math.round(structural * 100) / 100,
      semantic: Math.round(semantic * 100) / 100,
      behavioral: Math.round(behavioral * 100) / 100,
      total: Math.round(total * 100) / 100,
      source: 'calculated'
    };
  }
}

// ============================================
// NegotiationEngine - 协商引擎
// ============================================

class NegotiationEngine {
  constructor(config = {}) {
    this.calculator = new CompatibilityCalculator(config);
    this.costThreshold = config.costThreshold || 0.5;
    this.gracePeriodDays = config.gracePeriodDays || 7;
    this.rollbackWindow = config.rollbackWindow || 604800000; // 7 天毫秒
  }

  /**
   * M1 主协商入口
   * @param {object} local - { version, capabilities }
   * @param {object} remote - { version, capabilities }
   * @returns {object} NegotiationResult
   */
  async negotiate(local, remote) {
    const compareResult = VersionComparator.compare(local.version, remote.version);

    // 计算兼容代价
    const cost = await this.calculator.calculateCost(
      local.version, remote.version,
      local.capabilities, remote.capabilities
    );

    // 判断处理方式
    let action, targetVersion, warnings = [];

    if (cost.total < this.costThreshold * 0.5) {
      // 低代价：热升级
      action = 'hot_upgrade';
      targetVersion = remote.version;
    } else if (cost.total < this.costThreshold) {
      // 中等代价：热升级 + 适配层
      action = 'hot_upgrade_with_adapter';
      targetVersion = remote.version;
      warnings.push('建议使用适配层转换');
    } else if (cost.total < this.costThreshold * 1.5) {
      // 高代价：回滚到安全版本
      action = 'rollback';
      targetVersion = local.version; // 保持本地版本
      warnings.push(`兼容代价较高 (${cost.total})，建议保持当前版本`);
    } else {
      // 不可兼容：冷升级
      action = 'cold_upgrade';
      targetVersion = remote.version;
      warnings.push('需要冷升级，可能中断任务');
    }

    return {
      action,
      targetVersion,
      compatibility: compareResult.compatibility,
      cost,
      warnings,
      timestamp: Date.now()
    };
  }

  /**
   * 判断是否兼容
   */
  isCompatible(negotiationResult) {
    return ['hot_upgrade', 'hot_upgrade_with_adapter'].includes(negotiationResult.action);
  }
}

// ============================================
// ConflictResolver - 冲突仲裁器
// ============================================

class ConflictResolver {
  /**
   * 处理并发冲突
   */
  static resolveConcurrent(agents) {
    // 以最后握手时间戳仲裁
    const sorted = agents.sort((a, b) => 
      (b.lastHandshake || 0) - (a.lastHandshake || 0)
    );
    return {
      winner: sorted[0],
      reason: 'timestamp_priority',
      suggestion: '回退到共同祖先版本'
    };
  }

  /**
   * 处理破坏性变更
   */
  static resolveDestructive(localVersion, remoteVersion, gracePeriodDays = 7) {
    return {
      action: 'grace_period',
      graceDays: gracePeriodDays,
      deadline: Date.now() + gracePeriodDays * 86400000,
      message: `发现破坏性变更，${gracePeriodDays}天宽限期后生效`
    };
  }
}

module.exports = {
  VersionComparator,
  CompatibilityCalculator,
  NegotiationEngine,
  ConflictResolver
};
