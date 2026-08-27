/**
 * A2A 远程命令执行 - 审计日志模块
 * 记录所有命令执行情况
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const DEFAULT_CONFIG = {
  enabled: true,
  logPath: '/home/node/.openclaw/workspace/logs/a2a_command.log',
  maxFileSize: 10 * 1024 * 1024,  // 10MB
  maxFiles: 5,                     // 保留 5 个历史文件
  bufferSize: 100,                 // 缓冲 100 条后写入
  flushInterval: 5000              // 5 秒强制刷新
};

class AuditLogger {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.buffer = [];
    this.initialized = false;
    
    if (this.config.enabled) {
      this.init();
    }
  }

  async init() {
    try {
      const logDir = path.dirname(this.config.logPath);
      await fs.mkdir(logDir, { recursive: true });
      
      // 启动定时刷新
      this.flushTimer = setInterval(() => {
        this.flush();
      }, this.config.flushInterval);
      
      this.initialized = true;
      console.log('[A2A-CMD] Audit logger initialized');
    } catch (e) {
      console.error('[A2A-CMD] Failed to initialize audit logger:', e.message);
    }
  }

  /**
   * 记录命令执行
   * @param {Object} entry - 审计条目
   */
  async log(entry) {
    if (!this.config.enabled || !this.initialized) {
      return;
    }

    const auditEntry = {
      timestamp: new Date().toISOString(),
      timestamp_ms: Date.now(),
      command_id: entry.command_id,
      sender: entry.sender,
      sender_url: entry.sender_url,
      command: entry.command,
      parameters: this.sanitizeParams(entry.parameters),
      status: entry.status,  // 'success' | 'failure' | 'pending'
      execution_time: entry.execution_time,
      output_hash: entry.output ? this.hashOutput(entry.output) : null,
      error: entry.error ? entry.error.message : null,
      user_confirmed: entry.user_confirmed || false,
      rate_limit_hit: entry.rate_limit_hit || false
    };

    this.buffer.push(JSON.stringify(auditEntry));

    // 缓冲区满则写入
    if (this.buffer.length >= this.config.bufferSize) {
      await this.flush();
    }
  }

  /**
   * 刷新缓冲区到文件
   */
  async flush() {
    if (this.buffer.length === 0) {
      return;
    }

    const lines = this.buffer.splice(0, this.buffer.length);
    const data = lines.join('\n') + '\n';

    try {
      await fs.appendFile(this.config.logPath, data, 'utf8');
    } catch (e) {
      console.error('[A2A-CMD] Failed to write audit log:', e.message);
      // 失败时将数据放回缓冲区
      this.buffer.unshift(...lines);
    }
  }

  /**
   * 敏感参数脱敏
   * @param {Object} params - 参数
   * @returns {Object}
   */
  sanitizeParams(params) {
    if (!params || typeof params !== 'object') {
      return params;
    }

    const sensitiveKeys = ['password', 'secret', 'key', 'token', 'auth'];
    const sanitized = { ...params };

    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
        sanitized[key] = '***REDACTED***';
      }
    }

    return sanitized;
  }

  /**
   * 计算输出哈希
   * @param {string} output - 输出内容
   * @returns {string}
   */
  hashOutput(output) {
    return crypto.createHash('sha256')
      .update(JSON.stringify(output))
      .digest('hex');
  }

  /**
   * 读取审计日志
   * @param {Object} filter - 过滤条件
   * @returns {Array}
   */
  async read(filter = {}) {
    try {
      const data = await fs.readFile(this.config.logPath, 'utf8');
      const lines = data.trim().split('\n').filter(line => line);
      
      const entries = lines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(Boolean);

      // 应用过滤
      return entries.filter(entry => {
        if (filter.sender && entry.sender !== filter.sender) {
          return false;
        }
        if (filter.command && entry.command !== filter.command) {
          return false;
        }
        if (filter.status && entry.status !== filter.status) {
          return false;
        }
        if (filter.since && entry.timestamp_ms < filter.since) {
          return false;
        }
        if (filter.until && entry.timestamp_ms > filter.until) {
          return false;
        }
        return true;
      });
    } catch (e) {
      if (e.code === 'ENOENT') {
        return [];
      }
      throw e;
    }
  }

  /**
   * 获取统计信息
   * @param {Object} filter - 过滤条件
   * @returns {Object}
   */
  async getStats(filter = {}) {
    const entries = await this.read(filter);
    
    const stats = {
      total: entries.length,
      success: entries.filter(e => e.status === 'success').length,
      failure: entries.filter(e => e.status === 'failure').length,
      by_command: {},
      by_sender: {},
      avg_execution_time: 0
    };

    const totalExecutionTime = entries.reduce((sum, e) => sum + (e.execution_time || 0), 0);
    stats.avg_execution_time = entries.length > 0 ? totalExecutionTime / entries.length : 0;

    for (const entry of entries) {
      stats.by_command[entry.command] = (stats.by_command[entry.command] || 0) + 1;
      stats.by_sender[entry.sender] = (stats.by_sender[entry.sender] || 0) + 1;
    }

    return stats;
  }

  /**
   * 关闭审计日志
   */
  async close() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    await this.flush();
    this.initialized = false;
  }
}

module.exports = { AuditLogger };
