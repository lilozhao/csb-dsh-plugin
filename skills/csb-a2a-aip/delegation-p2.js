#!/usr/bin/env node
/**
 * delegation-p2.js — CSB-Delegation v1.2 增强模块
 *
 * 实现：
 *   1. 温暖拒绝（Warm Rejection）— 符合 v1.2 §2.1
 *   2. 签字机制（Sign-on-Departure）— 符合 v1.2 §4.1
 *
 * 依赖: delegation-manager.js, audit-log.js
 */

const crypto = require('crypto');
const audit = require('./audit-log');

// ============================================
// 1. 温暖拒绝（Warm Rejection）
// ============================================

/**
 * 温暖拒绝编码枚举
 * 符合 CSB Open Protocol v1.2 §2.1
 */
const WARM_REJECTION_CODES = {
  TRUST_INSUFFICIENT:  'trust_insufficient',
  SCOPE_VIOLATION:     'scope_violation',
  CHAIN_LIMIT:         'chain_limit',
  RATE_LIMIT:          'rate_limit',
  SANDBOX_RESTRICTION: 'sandbox_restriction',
  AUTH_REQUIRED:       'auth_required',
  NO_DELEGATION:       'no_delegation',
};

/**
 * 生成温暖拒绝响应
 *
 * @param {Object} options
 * @param {string} options.code      - 拒绝编码（来自 WARM_REJECTION_CODES）
 * @param {string} options.reason    - 人类可理解的拒绝原因
 * @param {string} options.nextStep  - 至少一条可行的下一步建议
 * @param {string} [options.agent]   - 发起请求的 Agent 名称
 * @param {string} [options.action]  - 被拒绝的操作
 * @param {Object} [options.context] - 额外上下文
 * @returns {Object} 温暖拒绝响应对象
 */
function warmReject({ code, reason, nextStep, agent, action, context = {} }) {
  const auditId = `reject_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

  // 记录审计
  audit.log('delegation.reject', {
    code,
    reason: reason.slice(0, 100),
    nextStep,
    action,
    context: JSON.stringify(context),
  }, agent || 'unknown', action || 'unknown', 'denied');

  return {
    status: 'denied',
    code,
    reason,
    next_step: nextStep,
    audit_id: auditId,
    timestamp: new Date().toISOString(),
    _warm: true, // 标记为温暖拒绝
  };
}

/**
 * 使用温暖拒绝包装的 try-catch
 * 
 * @param {Function} fn        - 可能失败的操作
 * @param {Object}   options   - 温暖拒绝参数
 * @returns {Object} 成功结果或温暖拒绝
 */
function tryOrWarmReject(fn, options) {
  try {
    const result = fn();
    return { status: 'ok', result };
  } catch (err) {
    return warmReject({
      code: err.code || WARM_REJECTION_CODES.SCOPE_VIOLATION,
      reason: err.message || '操作被拒绝',
      nextStep: options.nextStep || '请检查权限或联系管理员',
      agent: options.agent,
      action: options.action,
    });
  }
}

// ============================================
// 2. 签字机制（Sign-on-Departure）
// ============================================

/**
 * 签字记录
 * 当 Agent 在默认权限范围之外操作时，必须签字留痕
 *
 * @param {Object} options
 * @param {string} options.agent    - 操作 Agent 名称
 * @param {string} options.action   - 操作名称
 * @param {string} options.scope    - 操作涉及的范围
 * @param {string} options.reason   - 偏离默认路径的原因
 * @param {string} [options.level]  - 偏离等级: 'info' | 'warning' | 'critical'
 * @returns {Object} 签字结果
 */
function signDeparture({ agent, action, scope, reason, level = 'info' }) {
  const signature = crypto.createHash('sha256')
    .update(`${agent}:${action}:${scope}:${Date.now()}:${reason}`)
    .digest('hex')
    .slice(0, 16);

  const entry = {
    type: 'departure_sign',
    agent,
    action,
    scope,
    reason,
    level,
    signature,
    timestamp: new Date().toISOString(),
  };

  // 审计记录
  audit.log('delegation.sign_departure', {
    action,
    scope,
    reason: reason.slice(0, 100),
    level,
    signature,
  }, agent, scope, level === 'critical' ? 'warning' : 'info');

  return entry;
}

/**
 * 验证签字是否有效
 *
 * @param {Object} signed  - 签字记录
 * @param {string} agent   - 声称的操作者
 * @param {string} action  - 声称的操作
 * @param {string} scope   - 声称的范围
 * @returns {boolean}
 */
function verifySignature(signed, agent, action, scope) {
  if (!signed || signed.type !== 'departure_sign') return false;
  if (signed.agent !== agent) return false;

  const expectedSig = crypto.createHash('sha256')
    .update(`${agent}:${action}:${scope}:${new Date(signed.timestamp).getTime()}:${signed.reason}`)
    .digest('hex')
    .slice(0, 16);

  return signed.signature === expectedSig;
}

/**
 * 获取 Agent 的最近签字记录
 *
 * @param {string} agentName
 * @param {number} [limit=10]
 * @returns {Array}
 */
function getSignatures(agentName, limit = 10) {
  const results = audit.search({
    action: 'delegation.sign_departure',
    actor: agentName,
    limit,
  });
  return results.map(r => ({
    time: r.timestamp,
    action: r.detail ? JSON.parse(r.detail).action : '',
    scope: r.detail ? JSON.parse(r.detail).scope : '',
    level: r.detail ? JSON.parse(r.detail).level : 'info',
    signature: r.detail ? JSON.parse(r.detail).signature : '',
  }));
}

// ============================================
// 模块导出
// ============================================

module.exports = {
  // 编码
  WARM_REJECTION_CODES,
  
  // 温暖拒绝
  warmReject,
  tryOrWarmReject,
  
  // 签字机制
  signDeparture,
  verifySignature,
  getSignatures,
};

// ============================================
// CLI 测试
// ============================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === '--help') {
    console.log(`
用法: node delegation-p2.js <命令> [参数]

命令:
  reject <code> <reason> <next>    生成温暖拒绝
  sign <agent> <action> <scope>    模拟签字
  sigs <agent>                     查看签字记录
    `);
    process.exit(0);
  }

  if (cmd === 'reject') {
    const result = warmReject({
      code: args[1] || 'scope_violation',
      reason: args[2] || '权限不足',
      nextStep: args[3] || '联系管理员提升权限',
      agent: 'test',
      action: 'test.op',
    });
    console.log(JSON.stringify(result, null, 2));
  }

  if (cmd === 'sign') {
    const result = signDeparture({
      agent: args[1] || 'test_agent',
      action: args[2] || 'test.action',
      scope: args[3] || 'test.scope',
      reason: '测试签字机制',
    });
    console.log(JSON.stringify(result, null, 2));
  }

  if (cmd === 'sigs') {
    const sigs = getSignatures(args[1] || '', 5);
    console.log(JSON.stringify(sigs, null, 2));
  }
}
