/**
 * A2A-013 语义校验与信任等级 - M1 实现
 * 
 * 功能：
 * 1. 词汇表校验（L0 必须）
 * 2. 参数自洽检查（L1+）
 * 3. 能力声明缓存（TTL 淘汰）
 * 4. Fallback 机制
 * 
 * 作者: 若兰 🌸
 * 日期: 2026-05-04
 * 协议: A2A v0.5
 */

const fs = require('fs');
const path = require('path');

class CapabilityCache {
  constructor(ttlMs = 3600000) { // 默认 1 小时
    this.ttl = ttlMs;
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttl) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key, data) {
    this.store.set(key, { data, timestamp: Date.now() });
  }

  clear() {
    this.store.clear();
  }

  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now - entry.timestamp > this.ttl) {
        this.store.delete(key);
      }
    }
  }
}

class VocabValidator {
  constructor(vocabPath) {
    this.vocab = this.loadVocab(vocabPath);
    this.cache = new CapabilityCache();
  }

  loadVocab(vocabPath) {
    try {
      const vocabData = fs.readFileSync(vocabPath, 'utf-8');
      return JSON.parse(vocabData);
    } catch (err) {
      console.warn(`[A2A-013] 词汇表加载失败: ${err.message}`);
      return { version: '1.0', capabilities: {} };
    }
  }

  // L0: 词汇表校验
  validateVocab(capabilityId) {
    const cap = this.vocab.capabilities[capabilityId];
    if (!cap) {
      return {
        valid: true,       // 野生能力不拒绝，只是标记
        wildCard: true,
        warning: `能力 "${capabilityId}" 未在词汇表中注册，标记为待验证`
      };
    }
    return {
      valid: true,
      wildCard: false,
      info: cap
    };
  }

  // L1+: 参数自洽检查
  validateParams(capabilityId, params) {
    const cap = this.vocab.capabilities[capabilityId];
    if (!cap) {
      // 野生能力，跳过参数检查
      return { valid: true, wildCard: true };
    }

    const required = cap.params || [];
    const missing = required.filter(p => !params || params[p] === undefined);
    
    if (missing.length > 0) {
      return {
        valid: false,
        missing: missing,
        error: `能力 "${capabilityId}" 缺少必需参数: ${missing.join(', ')}`
      };
    }

    return { valid: true };
  }

  // 获取能力信息
  getCapabilityInfo(capabilityId) {
    return this.vocab.capabilities[capabilityId] || null;
  }

  // 获取所有已知能力
  getAllCapabilities() {
    return Object.keys(this.vocab.capabilities);
  }

  // 获取 fallback 选项
  getFallbackOptions(capabilityId) {
    const allCaps = this.getAllCapabilities();
    return allCaps.filter(c => c !== capabilityId);
  }
}

class SemanticValidator {
  constructor(config = {}) {
    const vocabPath = config.vocabPath || path.join(__dirname, 'vocab.json');
    this.validator = new VocabValidator(vocabPath);
    this.wildCardLimit = config.maxWildcardDepth || 3;
    this.enableFallback = config.enableFallback !== false;
    this.validationLog = [];
  }

  /**
   * M1 主校验入口
   * @param {string} capabilityId - 能力标识符
   * @param {object} params - 调用参数
   * @param {string} trustLevel - 信任等级 L0-L3
   * @returns {object} ValidationResult
   */
  async validateCapability(capabilityId, params = {}, trustLevel = 'L0') {
    // 检查缓存
    const cacheKey = `${capabilityId}:${JSON.stringify(params)}:${trustLevel}`;
    const cached = this.validator.cache.get(cacheKey);
    if (cached) return cached;

    const result = {
      valid: true,
      warnings: [],
      errors: [],
      fallbackOptions: [],
      wildCardDetected: false,
      trustLevel: trustLevel
    };

    // L0: 词汇表校验（所有能力必须）
    const vocabResult = this.validator.validateVocab(capabilityId);
    if (!vocabResult.valid) {
      result.errors.push(vocabResult.warning);
      result.valid = false;
    } else if (vocabResult.warning) {
      result.warnings.push(vocabResult.warning);
      result.wildCardDetected = true;
    }

    // L1+: 参数自洽检查
    if (this.trustLevelToInt(trustLevel) >= 1) {
      const paramResult = this.validator.validateParams(capabilityId, params);
      if (!paramResult.valid) {
        result.errors.push(paramResult.error);
        result.valid = false;
        if (this.enableFallback) {
          result.fallbackOptions = this.validator.getFallbackOptions(capabilityId);
        }
      }
    }

    // L2+: 行为验证（简化版 - 记录日志）
    if (this.trustLevelToInt(trustLevel) >= 2) {
      this.logValidation(capabilityId, result);
    }

    // 缓存结果
    this.validator.cache.set(cacheKey, result);

    return result;
  }

  /**
   * 批量校验
   */
  async validateBatch(capabilities) {
    return Promise.all(
      capabilities.map(cap => 
        this.validateCapability(cap.id, cap.params, cap.trustLevel)
      )
    );
  }

  /**
   * 获取能力信息
   */
  getCapabilityInfo(capabilityId) {
    return this.validator.getCapabilityInfo(capabilityId);
  }

  /**
   * 获取所有已知能力列表
   */
  getAllCapabilities() {
    return this.validator.getAllCapabilities();
  }

  /**
   * 获取验证统计
   */
  getValidationStats() {
    const total = this.validationLog.length;
    const wildCards = this.validationLog.filter(v => v.wildCard).length;
    const failed = this.validationLog.filter(v => !v.valid).length;
    
    return {
      total,
      wildCards,
      failed,
      passRate: total > 0 ? ((total - failed) / total * 100).toFixed(1) + '%' : '0%'
    };
  }

  // 内部方法
  trustLevelToInt(level) {
    return { 'L0': 0, 'L1': 1, 'L2': 2, 'L3': 3 }[level] || 0;
  }

  logValidation(capabilityId, result) {
    this.validationLog.push({
      capabilityId,
      trustLevel: result.trustLevel,
      wildCard: result.wildCardDetected,
      valid: result.valid,
      timestamp: Date.now()
    });
    // 保留最近 100 条
    if (this.validationLog.length > 100) {
      this.validationLog = this.validationLog.slice(-100);
    }
  }
}

module.exports = { SemanticValidator, VocabValidator, CapabilityCache };
