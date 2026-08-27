/**
 * A2A-020: 可观测性 (Observability) v1.0
 *
 * 实现:
 *   - 请求追踪 (trace-id 传递)
 *   - Prometheus 指标导出
 *   - 结构化日志
 *   - 健康检查增强
 *   - 审计日志 (A2A-022 合并)
 *
 * 协议: A2A v0.5 §A2A-020
 * 版本: 1.0.0 | 2026-05-10
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ============================================
// 指标收集器 (Prometheus 兼容)
// ============================================
class MetricsCollector {
  constructor() {
    this.counters = new Map();
    this.histograms = new Map();
    this.gauges = new Map();
  }

  // Counter: 累积计数
  inc(name, labels = {}, value = 1) {
    const key = this._key(name, labels);
    this.counters.set(key, (this.counters.get(key) || 0) + value);
  }

  // Histogram: 分布统计 (近似)
  observe(name, value, labels = {}) {
    const key = this._key(name, labels);
    if (!this.histograms.has(key)) {
      this.histograms.set(key, { count: 0, sum: 0, min: Infinity, max: -Infinity, buckets: new Map() });
    }
    const h = this.histograms.get(key);
    h.count++;
    h.sum += value;
    if (value < h.min) h.min = value;
    if (value > h.max) h.max = value;
    // 动态分桶
    const bucket = Math.pow(2, Math.floor(Math.log2(Math.max(value, 1))));
    h.buckets.set(bucket, (h.buckets.get(bucket) || 0) + 1);
  }

  // Gauge: 瞬时值
  setGauge(name, value, labels = {}) {
    this.gauges.set(this._key(name, labels), value);
  }

  /**
   * 导出 Prometheus 格式
   */
  exportPrometheus() {
    const lines = [];
    const PREFIX = 'a2a_';

    for (const [key, val] of this.counters) {
      lines.push(`${PREFIX}${key} ${val}`);
    }
    for (const [key, val] of this.gauges) {
      lines.push(`${PREFIX}${key} ${val}`);
    }
    for (const [key, h] of this.histograms) {
      lines.push(`${PREFIX}${key}_count ${h.count}`);
      lines.push(`${PREFIX}${key}_sum ${h.sum}`);
      if (h.count > 0) lines.push(`${PREFIX}${key}_min ${h.min}`);
      if (h.count > 0) lines.push(`${PREFIX}${key}_max ${h.max}`);
    }

    return lines.join('\n') + '\n';
  }

  _key(name, labels) {
    const parts = [name];
    const sorted = Object.entries(labels || {}).sort();
    for (const [k, v] of sorted) parts.push(`${k}=${v}`);
    return parts.filter(Boolean).join('{').replace(/[^a-zA-Z0-9_{}=]/g, '_') + (sorted.length ? '}' : '');
  }
}

// ============================================
// 审计日志 (A2A-022)
// ============================================
class AuditLogger {
  constructor(options = {}) {
    this.logPath = options.logPath || '/tmp/a2a-audit.log';
    this.buffer  = [];
    this.maxBuffer = options.maxBuffer || 100;
    this.flushInterval = options.flushInterval || 5000;

    this._timer = setInterval(() => this.flush(), this.flushInterval);
  }

  record(event) {
    const entry = {
      timestamp: new Date().toISOString(),
      traceId: event.traceId || 'unknown',
      event: event.event || 'unknown',
      agent: event.agent || 'unknown',
      method: event.method || '',
      status: event.status || '',
      durationMs: event.durationMs || 0,
      details: event.details || '',
    };
    this.buffer.push(JSON.stringify(entry));
    if (this.buffer.length >= this.maxBuffer) this.flush();
  }

  flush() {
    if (this.buffer.length === 0) return;
    try {
      fs.appendFileSync(this.logPath, this.buffer.join('\n') + '\n');
      this.buffer = [];
    } catch (e) {
      console.error('[Audit] 写入失败:', e.message);
    }
  }

  shutdown() {
    clearInterval(this._timer);
    this.flush();
  }
}

// ============================================
// 请求追踪中间件
// ============================================

function traceMiddleware(options = {}) {
  return (req, res, next) => {
    const traceId = req.headers['x-trace-id'] || generateTraceId();
    req.traceId = traceId;
    req.startTime = Date.now();

    res.setHeader('X-Trace-Id', traceId);

    res.on('finish', () => {
      const duration = Date.now() - (req.startTime || Date.now());
      const method = req.body?.method || req.method;
      const status = res.statusCode < 400 ? 'OK' : 'error';

      if (options.metrics) {
        options.metrics.inc('requests_total', { method, status });
        options.metrics.observe('request_duration_ms', duration, { method });
      }

      if (options.auditLogger) {
        options.auditLogger.record({
          traceId, event: 'request',
          method: method.toString(),
          status: status,
          durationMs: duration,
          details: req.body?.params?.message?.parts?.[0]?.text?.substring(0, 50) || '',
        });
      }
    });

    next();
  };
}

// ============================================
// 系统收集
// ============================================

function collectSystemMetrics(metrics, taskStore) {
  setInterval(() => {
    const mem = process.memoryUsage();
    metrics.setGauge('process_memory_rss_bytes', mem.rss);
    metrics.setGauge('process_memory_heap_bytes', mem.heapUsed);
    metrics.setGauge('process_uptime_seconds', Math.floor(process.uptime()));

    if (taskStore) {
      const stats = taskStore.getStats();
      metrics.setGauge('tasks_total', stats.total);
      metrics.setGauge('tasks_terminal', stats.terminalTasks);
    }
  }, 30000); // 每 30s
}

// ============================================
// 辅助
// ============================================

function generateTraceId() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = {
  MetricsCollector,
  AuditLogger,
  traceMiddleware,
  collectSystemMetrics,
  generateTraceId,
};
