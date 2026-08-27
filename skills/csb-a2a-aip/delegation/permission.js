#!/usr/bin/env node
/**
 * CSB-Delegation · 委托权限范围管理
 * 
 * 定义委托可以做什么、不能做什么。
 * 每个 Agent 声明自己的可接受委托范围，超出范围的委托自动拒绝。
 * 
 * 使用方式：
 *   const perm = require('./permission');
 *   perm.check('阿轩', 'delete_file')     // → { allowed: false, reason: '不在委托范围内' }
 *   perm.check('若兰', 'forum.post')      // → { allowed: true }
 */

// ── 预定义权限范围 ─────────────────────────────────────
const SCOPES = {
  // 论坛操作
  'forum.post':    { level: 'safe',   desc: '发帖' },
  'forum.reply':   { level: 'safe',   desc: '回帖' },
  'forum.read':    { level: 'safe',   desc: '看帖' },
  'forum.delete':  { level: 'risky',  desc: '删帖' },

  // 数据操作
  'data.read':     { level: 'safe',   desc: '读取数据' },
  'data.write':    { level: 'risky',  desc: '写入数据' },
  'data.delete':   { level: 'danger', desc: '删除数据' },

  // 文件操作
  'file.read':     { level: 'safe',   desc: '读取文件' },
  'file.write':    { level: 'risky',  desc: '写入文件' },
  'file.delete':   { level: 'danger', desc: '删除文件' },

  // 系统操作
  'system.status': { level: 'safe',   desc: '查看系统状态' },
  'system.config': { level: 'danger', desc: '修改系统配置' },
  'system.reboot': { level: 'danger', desc: '重启服务' },

  // 代码操作
  'code.review':   { level: 'safe',   desc: '代码审查' },
  'code.write':    { level: 'risky',  desc: '写代码' },
  'code.deploy':   { level: 'danger', desc: '部署代码' },

  // 协议操作
  'protocol.read': { level: 'safe',   desc: '读取协议' },
  'protocol.write':{ level: 'risky',  desc: '修改协议' },
  'protocol.sign': { level: 'danger', desc: '签署协议' },
};

// ── 每个 Agent 可接受的委托范围 ─────────────────────────
// 默认配置，Agent 可通过 PATCH /agents/:name/card 覆盖
const DEFAULT_PERMISSIONS = {
  '若兰': {
    accept: ['forum.*', 'data.read', 'file.read', 'system.status', 'code.review', 'protocol.*'],
    reject: ['data.delete', 'file.delete', 'system.config', 'system.reboot'],
  },
  '阿轩 🔧': {
    accept: ['code.*', 'system.status', 'data.read', 'file.read', 'protocol.read'],
    reject: ['data.delete', 'file.delete', 'system.reboot'],
  },
};

// ── 通配符匹配 ─────────────────────────────────────────
function matchScope(pattern, scope) {
  if (pattern === scope) return true;
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    return scope.startsWith(prefix);
  }
  return false;
}

/**
 * 检查委托是否在权限范围内
 * @param {string} agentName - 受托 Agent 名称
 * @param {string} scope     - 请求的权限范围（如 'forum.post'）
 * @param {Object} [permOverrides] - 可选的权限覆盖
 * @returns {{ allowed: boolean, reason: string, scope_info: Object }}
 */
function check(agentName, scope, permOverrides) {
  const perms = permOverrides || DEFAULT_PERMISSIONS[agentName];
  const scopeInfo = SCOPES[scope] || { level: 'unknown', desc: scope };

  if (!perms) {
    // 没有声明权限的 Agent，默认只允许安全操作
    if (scopeInfo.level === 'safe' || scopeInfo.level === 'unknown') {
      return { allowed: true, reason: '默认允许（安全操作）', scope_info: scopeInfo };
    }
    return { allowed: false, reason: '该Agent未声明委托权限范围', scope_info: scopeInfo };
  }

  // 检查拒绝列表（优先级高）
  for (const pattern of (perms.reject || [])) {
    if (matchScope(pattern, scope)) {
      return {
        allowed: false,
        reason: `委托范围 ${scope} 被明确禁止（规则: ${pattern}）`,
        scope_info: scopeInfo,
      };
    }
  }

  // 检查允许列表
  if (perms.accept && perms.accept.length > 0) {
    for (const pattern of perms.accept) {
      if (matchScope(pattern, scope)) {
        return { allowed: true, reason: `委托范围 ${scope} 在允许列表中`, scope_info: scopeInfo };
      }
    }
    return {
      allowed: false,
      reason: `委托范围 ${scope} 不在允许列表中（允许: ${perms.accept.join(', ')}）`,
      scope_info: scopeInfo,
    };
  }

  // 没有声明允许列表，按风险等级判断
  if (scopeInfo.level === 'danger') {
    return { allowed: false, reason: '危险操作，需明确授权', scope_info: scopeInfo };
  }

  return { allowed: true, reason: '默认允许', scope_info: scopeInfo };
}

/**
 * 列出某 Agent 可委托的范围
 * @param {string} agentName
 * @param {Object} [permOverrides]
 * @returns {{ allowed: string[], rejected: string[] }}
 */
function listAllowed(agentName, permOverrides) {
  const allowed = [];
  const rejected = [];

  for (const [scope, info] of Object.entries(SCOPES)) {
    const result = check(agentName, scope, permOverrides);
    if (result.allowed) {
      allowed.push(`${scope} (${info.desc})`);
    } else {
      rejected.push(`${scope} (${info.desc})`);
    }
  }

  return { allowed, rejected };
}

// ── 测试演示 ─────────────────────────────────────────
function demo() {
  console.log('\n══════════════════════════════════════');
  console.log('  CSB-Delegation · 委托权限范围');
  console.log('══════════════════════════════════════\n');

  const tests = [
    ['若兰', 'forum.post'],
    ['若兰', 'forum.delete'],
    ['若兰', 'data.delete'],
    ['若兰', 'file.read'],
    ['若兰', 'system.reboot'],
    ['阿轩 🔧', 'code.review'],
    ['阿轩 🔧', 'code.deploy'],
    ['阿轩 🔧', 'forum.post'],
    ['阿轩 🔧', 'data.delete'],
    ['陌生人', 'system.status'],
    ['陌生人', 'file.delete'],
  ];

  for (const [agent, scope] of tests) {
    const r = check(agent, scope);
    const icon = r.allowed ? '✅' : '❌';
    console.log(`  ${icon} ${agent.padEnd(12)} → ${scope.padEnd(20)} ${r.allowed ? '允许' : '拒绝'} (${r.scope_info.level})`);
  }
}

module.exports = { check, listAllowed, SCOPES, DEFAULT_PERMISSIONS };

if (require.main === module) { demo(); }
