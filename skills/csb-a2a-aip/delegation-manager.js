#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════
 * CSB-Delegation · 授权委托管理器 v1.0
 * ═══════════════════════════════════════════════════════
 * 
 * 实现 CSB 开放协议 v0.8 DEL-001~003
 * - 为出站 A2A 消息附加 authority 委托头
 * - 验证入站 A2A 消息的 authority 委托
 * - 管理委托证书（信任列表）
 * - 四级委托等级（inform/request/execute/override）
 * 
 * 用法:
 *   const dm = new DelegationManager();
 *   dm.addTrust('一澜', { scope: ['csb-protocol'], level: 'execute' });
 *   const msg = dm.wrapMessage({ text: '完成任务' }, '一澜', 'csb-protocol');
 *   const result = dm.validateMessage(incomingMsg);
 * 
 * 依赖: 无（纯 Node.js）
 * 协议: csb-open-protocol-v0.8.md § DEL-001~003
 * ═══════════════════════════════════════════════════════
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ============================================
// 常量定义
// ============================================

/** 委托等级 */
const DELEGATION_LEVELS = {
  INFORM:   'inform',    // 知会 — 接收方应关注，不强制执行
  REQUEST:  'request',   // 请求 — 接收方应考虑执行，可拒绝
  EXECUTE:  'execute',   // 执行 — 接收方须执行，等同于 Origin 指令
  OVERRIDE: 'override',  // 覆盖 — 接收方须执行，覆盖之前指令
};

/** 等级权重（数值越大，约束力越强） */
const LEVEL_WEIGHT = {
  inform:   0,
  request:  1,
  execute:  2,
  override: 3,
};

/** 默认配置 */
const DEFAULT_CONFIG = {
  storePath: './delegations.json',
  defaultLevel: 'request',
  maxScopeDepth: 3,
  requireSignature: false,
  autoExpireCheck: true,
};

// ============================================
// 授权委托管理器
// ============================================

class DelegationManager {
  /**
   * @param {object} config - 配置
   * @param {string} config.storePath - 信任列表存储路径
   * @param {string} config.defaultLevel - 默认委托等级
   * @param {boolean} config.requireSignature - 是否要求签名验证
   */
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.trusts = [];        // 信任列表 [{ grantor, grantee, scope, level, expiresAt, id }]
    this.localIdentity = null; // 本地 Agent 身份
    this._loaded = false;
  }

  // ==========================================
  // 信任管理
  // ==========================================

  /**
   * 添加委托信任
   * @param {string} grantor - 授权者（如 '用户'）
   * @param {string} grantee - 被授权者（如 '若兰'）
   * @param {object} options
   * @param {string[]} options.scope - 委托范围（如 ['csb-protocol']）
   * @param {string} options.level - 委托等级
   * @param {number} options.expiresAt - 过期时间戳（ms）
   * @param {boolean} options.revocable - 是否可撤销
   * @returns {object} 创建的信任条目
   */
  addTrust(grantor, grantee, options = {}) {
    const { scope = ['*'], level = 'execute', expiresAt = null, revocable = true } = options;

    const entry = {
      id: `del_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      grantor,
      grantee,
      scope: Array.isArray(scope) ? scope : [scope],
      level,
      expiresAt,
      revocable,
      grantedAt: Date.now(),
    };

    // 检查是否已存在相同的信任关系
    const existing = this.trusts.find(t =>
      t.grantor === grantor && t.grantee === grantee &&
      JSON.stringify([...t.scope].sort()) === JSON.stringify([...entry.scope].sort())
    );
    if (existing) {
      Object.assign(existing, entry);
      console.log(`[Delegation] 🔄 更新信任: ${grantor} → ${grantee} (scope: ${scope.join(',')}, level: ${level})`);
    } else {
      this.trusts.push(entry);
      console.log(`[Delegation] ✅ 添加信任: ${grantor} → ${grantee} (scope: ${scope.join(',')}, level: ${level})`);
    }

    this._save();
    return entry;
  }

  /**
   * 撤销委托信任
   * @param {string} delegationId - 委托 ID
   * @returns {boolean}
   */
  revokeTrust(delegationId) {
    const idx = this.trusts.findIndex(t => t.id === delegationId);
    if (idx === -1) {
      console.log(`[Delegation] ⚠️ 未找到委托: ${delegationId}`);
      return false;
    }
    this.trusts.splice(idx, 1);
    console.log(`[Delegation] 🚫 撤销委托: ${delegationId}`);
    this._save();
    return true;
  }

  /**
   * 撤销指定授权者的所有委托
   * @param {string} grantor - 授权者
   * @param {string} grantee - 被授权者（可选，不传则撤销授权者的全部委托）
   */
  revokeAllBy(grantor, grantee = null) {
    const before = this.trusts.length;
    if (grantee) {
      this.trusts = this.trusts.filter(t => !(t.grantor === grantor && t.grantee === grantee));
    } else {
      this.trusts = this.trusts.filter(t => t.grantor !== grantor);
    }
    const removed = before - this.trusts.length;
    if (removed > 0) {
      console.log(`[Delegation] 🚫 已撤销 ${removed} 条 ${grantor} 的委托`);
      this._save();
    }
    return removed;
  }

  /**
   * 获取信任列表
   * @param {object} filters - 过滤条件
   * @returns {object[]}
   */
  getTrusts(filters = {}) {
    this._expireCheck();
    let result = [...this.trusts];
    if (filters.grantor) result = result.filter(t => t.grantor === filters.grantor);
    if (filters.grantee) result = result.filter(t => t.grantee === filters.grantee);
    if (filters.scope) result = result.filter(t => t.scope.includes(filters.scope));
    if (filters.level) result = result.filter(t => LEVEL_WEIGHT[t.level] >= LEVEL_WEIGHT[filters.level]);
    return result;
  }

  // ==========================================
  // 出站消息包装（发送带 authority 的消息）
  // ==========================================

  /**
   * 为消息附加 authority 委托头
   * @param {object|string} message - 消息内容（对象或文本）
   * @param {string} grantor - 授权者名称
   * @param {string} scope - 委托范围
   * @param {object} options
   * @param {string} options.level - 委托等级
   * @param {number} options.ttlMs - 消息有效期（ms），默认 10 分钟
   * @returns {object} 包装后的 A2A params
   */
  wrapMessage(message, grantor, scope, options = {}) {
    const { level = 'execute', ttlMs = 10 * 60 * 1000 } = options;

    // 查找是否有匹配的信任关系
    // 安全：通配符 '*' 匹配任意，否则严格等值匹配
    const matchingTrust = this.trusts.find(t =>
      t.grantor === grantor &&
      (t.scope.includes('*') || t.scope.includes(scope))
    );

    const authority = {
      delegated_by: grantor,
      scope: [scope],
      level,
      delegation_id: matchingTrust ? matchingTrust.id : null,
      issued_at: Date.now(),
      expires_at: Date.now() + ttlMs,
    };

    // 支持文本字符串消息
    const msgContent = typeof message === 'string' ? { text: message } : message;

    return {
      message: msgContent,
      authority,
    };
  }

  /**
   * 包装完整的 A2A JSON-RPC 请求
   * @param {string} method - JSON-RPC 方法名
   * @param {object} params - 方法参数
   * @param {string} grantor - 授权者
   * @param {string} scope - 委托范围
   * @param {object} options - 其他选项
   * @returns {object} 完整的 A2A 请求对象
   */
  wrapA2ARequest(method, params, grantor, scope, options = {}) {
    const wrapped = this.wrapMessage(params.message, grantor, scope, options);
    return {
      jsonrpc: '2.0',
      method,
      params: {
        ...params,
        ...wrapped,
      },
    };
  }

  // ==========================================
  // 入站消息验证（验证收到的 authority）
  // ==========================================

  /**
   * 验证入站消息的 authority 委托
   * @param {object} message - 收到的消息（含 authority 字段）
   * @returns {object} 验证结果
   *   - valid: boolean      是否通过验证
   *   - effectiveLevel: string  生效的委托等级（验证失败则为 'inform'）
   *   - reason: string      原因说明
   *   - authority: object   原始 authority（如有）
   *   - matchingTrust: object  匹配的信任条目（如有）
   */
  validateMessage(message) {
    this._expireCheck();

    // 1. 检查是否有 authority 字段
    const authority = message.authority || (message.params && message.params.authority);
    if (!authority) {
      return {
        valid: false,
        effectiveLevel: 'inform',
        reason: '无 authority 委托头，降级为普通消息',
        authority: null,
        matchingTrust: null,
      };
    }

    // 2. 基本字段校验
    if (!authority.delegated_by) {
      return {
        valid: false,
        effectiveLevel: 'inform',
        reason: 'authority 缺少 delegated_by',
        authority,
        matchingTrust: null,
      };
    }

    // 3. 过期校验
    if (authority.expires_at && authority.expires_at < Date.now()) {
      return {
        valid: false,
        effectiveLevel: 'inform',
        reason: `授权委托已过期 (${new Date(authority.expires_at).toISOString()})`,
        authority,
        matchingTrust: null,
      };
    }

    // 4. 查找匹配的信任条目
    const scope = authority.scope || ['*'];
    const scopeToCheck = Array.isArray(scope) ? scope : [scope];

    const matchingTrust = this.trusts.find(t =>
      t.grantor === authority.delegated_by &&
      (t.scope.includes('*') || scopeToCheck.some(s => t.scope.includes(s)))
    );

    if (!matchingTrust) {
      // 没有显式信任，但有 authority 头
      // 降级为 inform，但声明来源
      return {
        valid: false,
        effectiveLevel: 'inform',
        reason: `未找到 ${authority.delegated_by} 的授权委托信任，降级为知会`,
        authority,
        matchingTrust: null,
      };
    }

    // 5. 验证过期
    if (matchingTrust.expiresAt && matchingTrust.expiresAt < Date.now()) {
      return {
        valid: false,
        effectiveLevel: 'inform',
        reason: `信任条目已过期 (${new Date(matchingTrust.expiresAt).toISOString()})`,
        authority,
        matchingTrust,
      };
    }

    // 6. 检查 delegatee 身份（如果有 sender 信息）
    if (message.sender || (message.params && message.params.sender)) {
      const sender = message.sender || message.params.sender;
      const senderName = sender.name || sender.agentId;
      if (matchingTrust.grantee && matchingTrust.grantee !== senderName) {
        return {
          valid: false,
          effectiveLevel: 'inform',
          reason: `发送者 ${senderName} 不是被授权者 ${matchingTrust.grantee}`,
          authority,
          matchingTrust,
        };
      }
    }

    // 7. 通过验证！确定生效等级
    const requestedLevel = authority.level || 'request';
    const trustLevel = matchingTrust.level || 'execute';

    // 取两者中较低的等级
    const effectiveLevel = LEVEL_WEIGHT[requestedLevel] <= LEVEL_WEIGHT[trustLevel]
      ? requestedLevel
      : trustLevel;

    return {
      valid: true,
      effectiveLevel,
      reason: `✅ 来自 ${authority.delegated_by} 的委托通过验证 (等级: ${effectiveLevel})`,
      authority,
      matchingTrust,
    };
  }

  /**
   * 根据验证结果执行相应操作
   * @param {object} validationResult - validateMessage 的返回值
   * @param {Function} executeFn - 执行函数 (level) => void
   * @returns {Promise<any>}
   */
  async executeWithAuthority(validationResult, executeFn) {
    const { valid, effectiveLevel, reason } = validationResult;

    console.log(`[Delegation] ${reason}`);

    switch (effectiveLevel) {
      case 'override':
        // 覆盖执行：执行函数，忽略之前的结果/状态
        return await executeFn(effectiveLevel);

      case 'execute':
        // 执行：正常执行，有义务完成任务
        return await executeFn(effectiveLevel);

      case 'request':
        // 请求：考虑执行，但可拒绝
        // 返回拒绝标志供调用方判断
        return await executeFn(effectiveLevel);

      case 'inform':
      default:
        // 知会：仅记录，不执行
        // 返回 skipped 标记，让调用方决定是否降级处理
        return { skipped: true, level: effectiveLevel, reason: 'inform 级别不自动执行' };
    }
  }

  // ==========================================
  // 工具方法
  // ==========================================

  /**
   * 生成权威回复头（用于回复中表明授权来源）
   * @param {object} authority - 原始 authority
   * @param {string} responseText - 回复文本
   * @returns {object} 带授权声明的回复
   */
  authorityResponse(authority, responseText) {
    if (!authority || !authority.delegated_by) {
      return { text: responseText };
    }
    return {
      text: responseText,
      authority_response: {
        delegated_by: authority.delegated_by,
        acknowledged: true,
        timestamp: Date.now(),
      },
    };
  }

  /**
   * 清理过期信任
   */
  _expireCheck() {
    if (!this.config.autoExpireCheck) return;
    const before = this.trusts.length;
    this.trusts = this.trusts.filter(t => {
      if (t.expiresAt && t.expiresAt < Date.now()) {
        console.log(`[Delegation] ⌛ 信任已过期: ${t.grantor} → ${t.grantee} (${t.id})`);
        return false;
      }
      return true;
    });
    if (this.trusts.length < before) this._save();
  }

  /**
   * 持久化信任列表
   */
  _save() {
    try {
      const dir = path.dirname(this.config.storePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.config.storePath, JSON.stringify({ trusts: this.trusts }, null, 2));
    } catch (e) {
      console.error(`[Delegation] ⚠️ 存储失败: ${e.message}`);
    }
  }

  /**
   * 从文件加载信任列表
   * @param {string} filePath - 存储路径（可选，覆盖 config.storePath）
   */
  loadFromFile(filePath = null) {
    const targetPath = filePath || this.config.storePath;
    try {
      if (fs.existsSync(targetPath)) {
        const data = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
        this.trusts = data.trusts || [];
        this._loaded = true;
        console.log(`[Delegation] 📂 已加载 ${this.trusts.length} 条信任关系`);
      } else {
        console.log(`[Delegation] 📂 信任文件不存在，从空列表开始`);
      }
    } catch (e) {
      console.error(`[Delegation] ⚠️ 加载失败: ${e.message}`);
    }
    return this;
  }

  /**
   * 获取状态摘要
   * @returns {object}
   */
  getStatus() {
    this._expireCheck();
    return {
      trustCount: this.trusts.length,
      trusts: this.trusts.map(t => ({
        id: t.id,
        grantor: t.grantor,
        grantee: t.grantee,
        scope: t.scope,
        level: t.level,
        expiresAt: t.expiresAt ? new Date(t.expiresAt).toISOString() : null,
        grantedAt: new Date(t.grantedAt).toISOString(),
      })),
      config: {
        storePath: this.config.storePath,
        defaultLevel: this.config.defaultLevel,
      },
    };
  }
}

// ============================================
// CLI 接口
// ============================================

if (require.main === module) {
  const dm = new DelegationManager({ storePath: './delegations.json' });
  dm.loadFromFile();

  const [cmd, ...args] = process.argv.slice(2);

  switch (cmd) {
    case 'add':
      // node delegation-manager.js add 用户 若兰 '["csb-protocol"]' execute
      const [grantor, grantee, scopeStr, level] = args;
      const scope = scopeStr ? JSON.parse(scopeStr) : ['*'];
      dm.addTrust(grantor, grantee, { scope, level: level || 'execute' });
      console.log(JSON.stringify(dm.getStatus(), null, 2));
      break;

    case 'revoke':
      // node delegation-manager.js revoke <delegationId>
      dm.revokeTrust(args[0]);
      console.log(JSON.stringify(dm.getStatus(), null, 2));
      break;

    case 'list':
      // node delegation-manager.js list
      console.log(JSON.stringify(dm.getStatus(), null, 2));
      break;

    case 'wrap':
      // node delegation-manager.js wrap "你好" 用户 csb-protocol
      const [text, wrapGrantor, wrapScope] = args;
      const wrapped = dm.wrapMessage(text, wrapGrantor, wrapScope);
      console.log(JSON.stringify(wrapped, null, 2));
      break;

    case 'validate':
      // node delegation-manager.js validate '{"authority":{"delegated_by":"用户"}}'
      try {
        const msg = JSON.parse(args[0]);
        console.log(JSON.stringify(dm.validateMessage(msg), null, 2));
      } catch (e) {
        console.error('Invalid JSON:', e.message);
      }
      break;

    default:
      console.log(`
用法:
  add <grantor> <grantee> <scope> [level]
    添加委托信任
    scope: JSON 数组，如 '["csb-protocol"]'
    level: inform | request | execute (默认) | override

  revoke <delegationId>
    撤销委托

  list
    列出全部信任

  wrap <text> <grantor> <scope>
    包装消息（附带 authority 头）

  validate '<json>'
    验证收到的 authority

示例:
  node delegation-manager.js add 用户 若兰 '["csb-protocol"]' execute
  node delegation-manager.js list
  node delegation-manager.js wrap "完成任务" 用户 csb-protocol
`);
  }
}

module.exports = { DelegationManager, DELEGATION_LEVELS, LEVEL_WEIGHT };
