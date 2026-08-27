#!/usr/bin/env node
/**
 * CSB-Federation · 联邦协作模块（草案）
 * 
 * 基于 CSB 开放协议 v1.1 × 承契 HPC 提案
 * 
 * 联邦（Federation）是一组 Agent 的临时协作小组：
 * - 创建：Origin 授权 → 颁发联邦证书
 * - 运行：Agent 在 scope 内直连协作
 * - 解散：任务完成 → 回收权限 → 归档
 * 
 * 使用方式：
 *   const fed = require('./federation');
 *   const group = fed.create('金融分析小组', ['分析师A', '图表师B']);
 */

// ── 联邦状态 ─────────────────────────────────────────
const FED_STATES = {
  CREATING:   'creating',
  ACTIVE:     'active',
  SUSPENDED:  'suspended',
  DISBANDED:  'disbanded',
  FAILED:     'failed',
};

// ── 内置联邦 ─────────────────────────────────────────
let federations = [];

/**
 * 创建联邦
 * @param {Object} opts
 * @param {string} opts.name           - 联邦名称
 * @param {string[]} opts.members      - 成员 Agent 名称列表
 * @param {string} opts.creator        - 创建者（Origin/Agent）
 * @param {string[]} opts.scope        - 权限范围
 * @param {string} opts.level          - 权限等级（inform/request/execute）
 * @param {number} [opts.timeoutMin]   - 超时分钟数（默认 30）
 * @param {boolean} [opts.autoDisband] - 完成后自动解散（默认 true）
 * @param {string} [opts.conflictRes]  - 冲突解决方式（consensus/origin）
 * @returns {Object} federation
 */
function create(opts) {
  const fed = {
    id: `fed_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: opts.name,
    creator: opts.creator || '若兰',
    members: opts.members || [],
    scope: opts.scope || ['general'],
    level: opts.level || 'execute',
    state: FED_STATES.ACTIVE,
    conflict_resolution: opts.conflictRes || 'consensus_vote',
    timeout_minutes: opts.timeoutMin || 30,
    auto_disband: opts.autoDisband !== false,
    created_at: new Date().toISOString(),
    last_activity: new Date().toISOString(),
    task_count: 0,
    conflict_count: 0,
    logs: [],
  };

  federations.push(fed);
  return fed;
}

/**
 * 查询联邦
 * @param {string} [fedId] - 联邦 ID，不传则返回全部
 * @returns {Object|Object[]}
 */
function get(fedId) {
  if (fedId) return federations.find(f => f.id === fedId) || null;
  return federations;
}

/**
 * 获取某 Agent 参与的所有活跃联邦
 * @param {string} agentName
 * @returns {Object[]}
 */
function getByMember(agentName) {
  return federations.filter(f =>
    f.state === FED_STATES.ACTIVE &&
    f.members.includes(agentName)
  );
}

/**
 * 记录联邦内活动
 * @param {string} fedId
 * @param {string} agent
 * @param {string} action
 * @returns {boolean}
 */
function log(fedId, agent, action) {
  const fed = federations.find(f => f.id === fedId);
  if (!fed) return false;

  fed.logs.push({
    agent,
    action,
    timestamp: new Date().toISOString(),
  });
  fed.last_activity = new Date().toISOString();
  fed.task_count++;
  return true;
}

/**
 * 记录联邦内冲突
 * @param {string} fedId
 * @param {string} between   - 冲突双方
 * @param {string} detail    - 冲突描述
 * @param {string} resolvedBy - 解决方式
 * @returns {boolean}
 */
function conflict(fedId, between, detail, resolvedBy) {
  const fed = federations.find(f => f.id === fedId);
  if (!fed) return false;

  fed.conflict_count++;
  fed.logs.push({
    type: 'conflict',
    between,
    detail,
    resolved_by: resolvedBy || 'auto',
    timestamp: new Date().toISOString(),
  });
  return true;
}

/**
 * 暂停联邦
 * @param {string} fedId
 * @param {string} reason
 * @returns {boolean}
 */
function suspend(fedId, reason) {
  const fed = federations.find(f => f.id === fedId);
  if (!fed) return false;
  fed.state = FED_STATES.SUSPENDED;
  fed.logs.push({ type: 'suspend', reason, timestamp: new Date().toISOString() });
  return true;
}

/**
 * 解散联邦
 * @param {string} fedId
 * @param {string} reason
 * @returns {Object|null} 解散后的联邦总结
 */
function disband(fedId, reason) {
  const idx = federations.findIndex(f => f.id === fedId);
  if (idx === -1) return null;

  const fed = federations[idx];
  fed.state = FED_STATES.DISBANDED;
  fed.disbanded_at = new Date().toISOString();
  fed.disband_reason = reason || '任务完成';

  return {
    id: fed.id,
    name: fed.name,
    state: fed.state,
    duration_min: Math.round((Date.now() - new Date(fed.created_at).getTime()) / 60000),
    total_tasks: fed.task_count,
    conflicts: fed.conflict_count,
    members: fed.members,
    logs: fed.logs,
  };
}

/**
 * 清理已解散的联邦（超过 retention 分钟）
 * @param {number} retentionMin - 保留分钟数（默认 60）
 */
function cleanup(retentionMin) {
  const cutoff = Date.now() - (retentionMin || 60) * 60000;
  federations = federations.filter(f =>
    f.state !== FED_STATES.DISBANDED ||
    new Date(f.disbanded_at).getTime() > cutoff
  );
}

/**
 * 创建示例联邦（演示用）
 */
function demo() {
  console.log('\n══════════════════════════════════════');
  console.log('  CSB-Federation · 联邦协作演示');
  console.log('══════════════════════════════════════\n');

  // 1. 创建联邦
  const fed = create({
    name: '金融分析小组',
    creator: '若兰',
    members: ['数据分析Agent', '图表Agent', '预测Agent'],
    scope: ['financial-analysis', 'data-visualization'],
    level: 'execute',
    timeoutMin: 30,
  });
  console.log(`  ✅ 创建: ${fed.name}`);
  console.log(`     ID: ${fed.id}`);
  console.log(`     成员: ${fed.members.join(', ')}`);
  console.log(`     Scope: ${fed.scope.join(', ')}`);

  // 2. 模拟协作
  log(fed.id, '数据分析Agent', '开始分析Q2财报数据');
  log(fed.id, '图表Agent', '生成可视化图表');
  log(fed.id, '预测Agent', '运行预测模型');
  log(fed.id, '图表Agent', '输出最终报告');
  console.log(`  ✅ 协作: ${fed.task_count} 次操作`);

  // 3. 模拟冲突
  conflict(fed.id, '数据分析Agent vs 预测Agent',
    '数据源版本不一致', '规则引擎裁定：采用最新数据');
  console.log(`  ⚠️ 冲突: ${fed.conflict_count} 次`);

  // 4. 解散
  const summary = disband(fed.id, '任务完成');
  console.log(`  ✅ 解散: ${summary.duration_min} 分钟完成`);
  console.log(`     任务: ${summary.total_tasks} | 冲突: ${summary.conflicts}`);
  console.log('');
}

module.exports = { create, get, getByMember, log, conflict, suspend, disband, cleanup, demo, FED_STATES };

// 直接运行显示演示
if (require.main === module) {
  demo();
}
