/**
 * csb-aip/src/logger.js
 * AIP 日志模块
 *
 * 命名方式与 A2A 一致：
 * - 对话日志: csb-aip-conversation-{timestamp}.json
 * - 审计日志: csb-aip-audit.log
 * - 交互日志: csb-aip-interactions.json
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = process.env.CSB_AIP_LOG_DIR || path.join(__dirname, '..', 'logs');
const AUDIT_FILE = process.env.CSB_AIP_AUDIT_LOG || path.join(LOG_DIR, 'csb-aip-audit.log');
const INTERACTIONS_FILE = path.join(LOG_DIR, 'csb-aip-interactions.json');

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * 审计日志（追加写入）
 * @param {string} level — INFO/WARN/ERROR
 * @param {string} action — 操作类型
 * @param {object} data — 日志数据
 */
function audit(level, action, data = {}) {
  const ts = new Date().toISOString();
  const line = JSON.stringify({ ts, level, action, ...data }) + '\n';
  fs.appendFileSync(AUDIT_FILE, line);
}

/**
 * 交互日志（JSON 数组）
 * @param {object} interaction — { from, to, type, warmth, timestamp }
 */
function logInteraction(interaction) {
  let interactions = [];
  try {
    interactions = JSON.parse(fs.readFileSync(INTERACTIONS_FILE, 'utf8'));
  } catch {}

  interactions.push({
    ...interaction,
    timestamp: new Date().toISOString()
  });

  // 保留最近 1000 条
  if (interactions.length > 1000) {
    interactions = interactions.slice(-1000);
  }

  fs.writeFileSync(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));
}

/**
 * 对话日志（与 A2A logConversation 对齐）
 * @param {object} conversation — { session, from, to, messages, result }
 */
function logConversation(conversation) {
  const ts = Date.now();
  const filename = `csb-aip-conversation-${ts}.json`;
  const filepath = path.join(LOG_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify({
    ...conversation,
    timestamp: new Date().toISOString(),
    module: 'csb-aip',
    version: '0.5.0'
  }, null, 2));
  return filepath;
}

/**
 * 余温变更日志
 * @param {string} agentId
 * @param {number} oldWarmth
 * @param {number} newWarmth
 * @param {string} reason
 */
function logWarmthChange(agentId, oldWarmth, newWarmth, reason = '') {
  audit('INFO', 'warmth_change', {
    agentId,
    oldWarmth: Math.round(oldWarmth * 10) / 10,
    newWarmth: Math.round(newWarmth * 10) / 10,
    reason
  });
}

/**
 * 自检日志
 * @param {object} result — 自检结果
 */
function logSelfCheck(result) {
  audit('INFO', 'self_check', {
    version: result.version,
    verdict: result.verdict,
    total: result.summary.total,
    passed: result.summary.passed,
    failed: result.summary.failed
  });
}

/**
 * 解析日志
 * @param {object} parsed — 解析结果
 */
function logParse(parsed) {
  audit('INFO', 'message_parse', {
    valid: parsed.valid,
    issues: parsed.issues,
    aipMeta: parsed.aipMeta ? 'present' : 'none'
  });
}

/**
 * 读取审计日志
 * @param {number} lines — 最近 N 行
 * @returns {Array}
 */
function readAudit(lines = 100) {
  try {
    const content = fs.readFileSync(AUDIT_FILE, 'utf8');
    const all = content.trim().split('\n').map(l => JSON.parse(l));
    return all.slice(-lines);
  } catch {
    return [];
  }
}

/**
 * 读取交互日志
 * @param {number} limit — 最近 N 条
 * @returns {Array}
 */
function readInteractions(limit = 50) {
  try {
    const interactions = JSON.parse(fs.readFileSync(INTERACTIONS_FILE, 'utf8'));
    return interactions.slice(-limit);
  } catch {
    return [];
  }
}

module.exports = {
  audit,
  logInteraction,
  logConversation,
  logWarmthChange,
  logSelfCheck,
  logParse,
  readAudit,
  readInteractions,
  LOG_DIR
};
