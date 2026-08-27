#!/usr/bin/env node
/**
 * federation.js — CSB-Federation 协作层（P3）
 *
 * 实现 CSB Open Protocol v1.0 §3：
 *   1. 协作模式选择矩阵
 *   2. 联邦生命周期（创建→运行→解散）
 *   3. 联邦证书
 *
 * 依赖: audit-log.js, delegation-p2.js（温暖拒绝）
 */

const crypto = require('crypto');
const audit = require('./audit-log');
const { warmReject, WARM_REJECTION_CODES } = require('./delegation-p2');

// ============================================
// 1. 协作模式选择矩阵
// ============================================

const COLLABORATION_MODES = {
  DIRECT:   { id: 'direct',   name: '直连模式',   minAgents: 1, maxAgents: 2, desc: 'A2A 点对点' },
  CEO:      { id: 'ceo',      name: 'CEO模式',    minAgents: 2, maxAgents: 10, desc: '中心调度，线性流程' },
  FEDERATION: { id: 'federation', name: '联邦模式', minAgents: 2, maxAgents: 20, desc: '授权临时自治小组' },
  ROUTER:   { id: 'router',   name: '路由模式',   minAgents: 5, maxAgents: 100, desc: '专用路由 Agent 调度' },
  NEGOTIATE: { id: 'negotiate', name: '协商模式', minAgents: 2, maxAgents: 10, desc: '动态协商交换格式' },
};

/**
 * 根据场景推荐协作模式
 *
 * @param {Object} context
 * @param {number} context.agentCount  - 参与 Agent 数
 * @param {string} context.complexity  - 任务复杂度: 'simple' | 'medium' | 'complex'
 * @param {boolean} context.needsDiscovery - 是否需要探索式协商
 * @returns {Object} 推荐模式信息
 */
function recommendMode({ agentCount, complexity = 'simple', needsDiscovery = false }) {
  if (needsDiscovery) return { mode: COLLABORATION_MODES.NEGOTIATE, reason: '前期探索，动态协商' };
  if (agentCount >= 5) return { mode: COLLABORATION_MODES.ROUTER, reason: 'Agent 较多，需要路由' };
  if (agentCount >= 3 || complexity === 'complex') return { mode: COLLABORATION_MODES.FEDERATION, reason: '多 Agent 高频协作' };
  if (agentCount === 2 && complexity === 'medium') return { mode: COLLABORATION_MODES.CEO, reason: '双 Agent 有序协作' };
  return { mode: COLLABORATION_MODES.DIRECT, reason: '简单任务，直连即可' };
}

/**
 * 检查模式兼容性
 */
function checkModeCompatibility(modeId, agentCount) {
  const mode = Object.values(COLLABORATION_MODES).find(m => m.id === modeId);
  if (!mode) return { valid: false, reason: `未知模式: ${modeId}` };
  if (agentCount < mode.minAgents) return { valid: false, reason: `${mode.name} 至少需要 ${mode.minAgents} 个 Agent（当前 ${agentCount}）` };
  if (agentCount > mode.maxAgents) return { valid: false, reason: `${mode.name} 最多支持 ${mode.maxAgents} 个 Agent（当前 ${agentCount}），建议升级到路由模式` };
  return { valid: true, mode };
}

// ============================================
// 2. 联邦生命周期
// ============================================

class Federation {
  constructor() {
    this.federations = new Map(); // id → federation
  }

  /**
   * 创建联邦
   *
   * @param {Object} params
   * @param {string} params.name       - 联邦名称
   * @param {string[]} params.members  - 成员 Agent 列表
   * @param {string} params.origin     - 创建者 Agent 名称
   * @param {string[]} params.scope    - 授权范围
   * @param {number} [params.timeoutMs] - 超时时间（默认 1h）
   * @returns {Object} 联邦信息
   */
  create({ name, members, origin, scope, timeoutMs = 3600000 }) {
    // 检查模式兼容性
    const compat = checkModeCompatibility('federation', members.length);
    if (!compat.valid) return warmReject({
      code: WARM_REJECTION_CODES.SCOPE_VIOLATION,
      reason: compat.reason,
      nextStep: `成员数 ${members.length}，联邦模式支持 2-20 个 Agent`,
      agent: origin,
      action: 'federation.create',
    });

    const id = `fed_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    const certificate = crypto.createHash('sha256')
      .update(`${id}:${origin}:${members.join(',')}:${scope.join(',')}:${Date.now()}`)
      .digest('hex').slice(0, 16);

    const fed = {
      id,
      name,
      origin,
      members,
      scope,
      certificate,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
      status: 'active',
      taskCount: 0,
      logs: [],
    };

    this.federations.set(id, fed);

    audit.log('federation.create', { name, members: members.length, scope, certificate }, origin, id, 'success');
    return fed;
  }

  /**
   * 联邦内执行任务
   */
  executeTask(fedId, task, fromAgent) {
    const fed = this.federations.get(fedId);
    if (!fed) return warmReject({
      code: WARM_REJECTION_CODES.NO_DELEGATION,
      reason: `联邦 ${fedId} 不存在`,
      nextStep: '请检查联邦 ID 或先创建联邦',
      agent: fromAgent,
      action: 'federation.task',
    });

    if (fed.status !== 'active') return warmReject({
      code: WARM_REJECTION_CODES.SCOPE_VIOLATION,
      reason: `联邦 ${fed.name} 已 ${fed.status}，不可执行任务`,
      nextStep: '重新创建联邦',
      agent: fromAgent,
      action: 'federation.task',
    });

    if (Date.now() > new Date(fed.expiresAt).getTime()) {
      fed.status = 'expired';
      return warmReject({
        code: WARM_REJECTION_CODES.SCOPE_VIOLATION,
        reason: `联邦 ${fed.name} 已过期（${fed.expiresAt}）`,
        nextStep: '请求创建者续期或重建联邦',
        agent: fromAgent,
        action: 'federation.task',
      });
    }

    if (!fed.members.includes(fromAgent)) return warmReject({
      code: WARM_REJECTION_CODES.AUTH_REQUIRED,
      reason: `${fromAgent} 不是联邦 ${fed.name} 的成员`,
      nextStep: `联邦成员: ${fed.members.join(', ')}`,
      agent: fromAgent,
      action: 'federation.task',
    });

    fed.taskCount++;
    fed.logs.push({ task, by: fromAgent, at: new Date().toISOString() });

    audit.log('federation.task', { fedId, task, memberCount: fed.members.length }, fromAgent, fed.name, 'success');
    return { status: 'ok', fedId, task, by: fromAgent, fedName: fed.name };
  }

  /**
   * 解散联邦
   */
  dissolve(fedId, byAgent) {
    const fed = this.federations.get(fedId);
    if (!fed) return { status: 'error', reason: '联邦不存在' };
    if (fed.origin !== byAgent) return warmReject({
      code: WARM_REJECTION_CODES.AUTH_REQUIRED,
      reason: `仅创建者 ${fed.origin} 可解散联邦`,
      nextStep: `联系 ${fed.origin} 请求解散`,
      agent: byAgent,
      action: 'federation.dissolve',
    });

    const summary = {
      fedId: fed.id,
      name: fed.name,
      duration: `${Math.round((Date.now() - new Date(fed.createdAt).getTime()) / 60000)} 分钟`,
      taskCount: fed.taskCount,
      members: fed.members,
    };

    fed.status = 'dissolved';
    audit.log('federation.dissolve', summary, byAgent, fed.name, 'success');
    return { status: 'ok', message: `联邦 ${fed.name} 已解散`, summary };
  }

  /**
   * 列出所有联邦
   */
  list(filter = 'active') {
    const all = Array.from(this.federations.values());
    if (filter === 'active') return all.filter(f => f.status === 'active');
    if (filter === 'all') return all;
    return all.filter(f => f.status === filter);
  }

  /**
   * 获取联邦详情
   */
  get(fedId) {
    return this.federations.get(fedId) || null;
  }
}

// ============================================
// 模块导出
// ============================================

module.exports = {
  COLLABORATION_MODES,
  recommendMode,
  checkModeCompatibility,
  Federation,
};

// ============================================
// CLI
// ============================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === '--help') {
    console.log(`
用法: node federation.js <命令> [参数]

命令:
  recommend <agentCount> [complexity]   推荐协作模式
  create <name> <members...>             创建联邦
  list [status]                          列出联邦
  get <fedId>                            联邦详情
  dissolve <fedId>                       解散联邦

示例:
  node federation.js recommend 3 complex
  node federation.js create mem-discuss 若兰 明德 阿轩
  node federation.js list
`); process.exit(0);
  }

  const fed = new Federation();

  if (cmd === 'recommend') {
    const count = parseInt(args[1]) || 2;
    const comp = args[2] || 'simple';
    const r = recommendMode({ agentCount: count, complexity: comp });
    console.log(`推荐: ${r.mode.name}（${r.reason}）`);
  }

  if (cmd === 'create') {
    const name = args[1];
    const members = args.slice(2);
    if (!name || members.length < 2) { console.log('需要名称和至少2个成员'); process.exit(1); }
    const r = fed.create({ name, members, origin: '若兰', scope: ['discussion'] });
    console.log(JSON.stringify(r, null, 2));
  }

  if (cmd === 'list') {
    const list = fed.list(args[1] || 'active');
    console.log(JSON.stringify(list.map(f => ({ id: f.id, name: f.name, status: f.status, members: f.members.length })), null, 2));
  }

  if (cmd === 'get') {
    const r = fed.get(args[1]);
    console.log(r ? JSON.stringify(r, null, 2) : '未找到');
  }

  if (cmd === 'dissolve') {
    const r = fed.dissolve(args[1], '若兰');
    console.log(JSON.stringify(r, null, 2));
  }
}
