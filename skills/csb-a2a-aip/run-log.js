#!/usr/bin/env node
/**
 * run-log.js — 工具运行时日志
 * 
 * 所有 cron 工具统一通过此模块记录运行日志
 * 日志位置: memory/logs/tools/
 * 
 * 用法:
 *   const log = require('./run-log');
 *   log.info('extract-memory-summary', '扫描完成', { files: 5 });
 *   log.error('archive-memory-files', '文件移动失败', { file: 'xxx.md', error: err.message });
 *   log.summary('extract-memory-summary'); // 查看最近运行摘要
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'memory', 'logs', 'tools');

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * 写入日志
 * 
 * @param {string} level    - info / warn / error
 * @param {string} tool     - 工具名称
 * @param {string} message  - 日志消息
 * @param {Object} [data]   - 额外数据
 */
function write(level, tool, message, data = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    tool,
    message,
    data: typeof data === 'object' ? data : { detail: String(data) },
  };

  // 写入今日日志文件
  const today = new Date().toISOString().slice(0, 10);
  const logFile = path.join(LOG_DIR, `${tool}-${today}.log`);
  
  try {
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (e) {
    // 日志写入失败不抛出异常
    process.stderr.write(`[log-error] ${e.message}\n`);
  }

  // 同时输出到控制台（用于 cron 回显）
  const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : '✅';
  const dataStr = Object.keys(data).length ? ` ${JSON.stringify(data).slice(0, 100)}` : '';
  console.log(`${prefix} [${tool}] ${message}${dataStr}`);
}

module.exports = {
  info:  (tool, msg, data) => write('info', tool, msg, data),
  warn:  (tool, msg, data) => write('warn', tool, msg, data),
  error: (tool, msg, data) => write('error', tool, msg, data),

  /**
   * 查看工具最近 N 条运行记录
   */
  summary(tool, n = 5) {
    const logDir = LOG_DIR;
    if (!fs.existsSync(logDir)) return [];

    const files = fs.readdirSync(logDir)
      .filter(f => f.startsWith(`${tool}-`) && f.endsWith('.log'))
      .sort()
      .reverse();

    const entries = [];
    for (const file of files) {
      const content = fs.readFileSync(path.join(logDir, file), 'utf-8');
      const lines = content.trim().split('\n').reverse();
      for (const line of lines) {
        try {
          entries.push(JSON.parse(line));
          if (entries.length >= n) break;
        } catch (e) { /* skip */ }
      }
      if (entries.length >= n) break;
    }
    return entries;
  },
};
