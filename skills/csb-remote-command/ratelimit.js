/**
 * A2A 远程命令执行 - 频率限制模块
 * 防止 DoS 攻击
 */

const DEFAULT_CONFIG = {
  maxPerMinute: 10,           // 每分钟最多 10 次命令执行
  maxHighRiskPerMinute: 3,    // 每分钟最多 3 次高风险操作
  cooldownPeriod: 60000,      // 1 分钟冷却时间
  whitelist: []               // 白名单（不限制频率）
};

class RateLimiter {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.requests = new Map();  // sender -> [{timestamp, command, isHighRisk}]
    this.blocked = new Map();   // sender -> unblockTime
  }

  /**
   * 检查是否在高风险列表
   * @param {string} commandType - 命令类型
   * @returns {boolean}
   */
  isHighRiskCommand(commandType) {
    const highRiskCommands = ['config.update', 'service.restart', 'exec.shell'];
    return highRiskCommands.includes(commandType);
  }

  /**
   * 检查频率限制
   * @param {string} sender - 发送者名称
   * @param {string} commandType - 命令类型
   * @returns {Object} { allowed: boolean, reason?: string, retryAfter?: number }
   */
  checkLimit(sender, commandType) {
    // 检查是否在白名单
    if (this.config.whitelist.includes(sender)) {
      return { allowed: true };
    }

    // 检查是否被封禁
    const unblockTime = this.blocked.get(sender);
    if (unblockTime && Date.now() < unblockTime) {
      return {
        allowed: false,
        reason: 'Sender temporarily blocked',
        retryAfter: unblockTime - Date.now(),
        code: -32008
      };
    }

    const now = Date.now();
    const windowStart = now - this.config.cooldownPeriod;

    // 获取该发送方的历史请求
    let history = this.requests.get(sender) || [];
    
    // 清理过期请求
    history = history.filter(r => r.timestamp > windowStart);

    // 检查总频率
    if (history.length >= this.config.maxPerMinute) {
      this.blocked.set(sender, now + this.config.cooldownPeriod);
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${this.config.maxPerMinute} requests per minute`,
        retryAfter: this.config.cooldownPeriod,
        code: -32008
      };
    }

    // 检查高风险操作频率
    const isHighRisk = this.isHighRiskCommand(commandType);
    const highRiskCount = history.filter(r => r.isHighRisk).length;
    
    if (isHighRisk && highRiskCount >= this.config.maxHighRiskPerMinute) {
      this.blocked.set(sender, now + this.config.cooldownPeriod);
      return {
        allowed: false,
        reason: `High risk rate limit exceeded: ${this.config.maxHighRiskPerMinute} per minute`,
        retryAfter: this.config.cooldownPeriod,
        code: -32008
      };
    }

    // 记录本次请求
    history.push({
      timestamp: now,
      command: commandType,
      isHighRisk
    });
    
    this.requests.set(sender, history);

    return { allowed: true };
  }

  /**
   * 获取发送者的请求统计
   * @param {string} sender - 发送者名称
   * @returns {Object}
   */
  getStats(sender) {
    const windowStart = Date.now() - this.config.cooldownPeriod;
    const history = (this.requests.get(sender) || [])
      .filter(r => r.timestamp > windowStart);

    return {
      total: history.length,
      highRisk: history.filter(r => r.isHighRisk).length,
      remaining: this.config.maxPerMinute - history.length,
      highRiskRemaining: this.config.maxHighRiskPerMinute - history.filter(r => r.isHighRisk).length
    };
  }

  /**
   * 清理过期数据
   */
  cleanup() {
    const now = Date.now();
    const windowStart = now - this.config.cooldownPeriod;

    // 清理过期请求
    for (const [sender, history] of this.requests) {
      const filtered = history.filter(r => r.timestamp > windowStart);
      if (filtered.length === 0) {
        this.requests.delete(sender);
      } else {
        this.requests.set(sender, filtered);
      }
    }

    // 清理过期封禁
    for (const [sender, unblockTime] of this.blocked) {
      if (now >= unblockTime) {
        this.blocked.delete(sender);
      }
    }
  }

  /**
   * 手动封禁发送者
   * @param {string} sender - 发送者名称
   * @param {number} duration - 封禁时长（毫秒）
   */
  block(sender, duration = 60000) {
    this.blocked.set(sender, Date.now() + duration);
    console.log(`[A2A-CMD] Blocked sender ${sender} for ${duration}ms`);
  }

  /**
   * 手动解封发送者
   * @param {string} sender - 发送者名称
   */
  unblock(sender) {
    this.blocked.delete(sender);
    console.log(`[A2A-CMD] Unblocked sender ${sender}`);
  }
}

module.exports = { RateLimiter };
