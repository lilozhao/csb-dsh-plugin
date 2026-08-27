/**
 * csb-aip/identity.js
 * 身份映射模块 — agentId ↔ alias 回退链
 *
 * v0.6 规范（P0 优化）：
 * - agentId 是最终唯一标识（AIP 必需字段）
 * - alias 是 AIP 可选字段，CSB 利用此字段承载人文别名
 * - 回退链：alias → name+platform → agentId-prefix → url → 报错
 * - 新增：agentId 一致性校验（确保解析结果必有 agentId）
 * - 新增：generateAgentId() 为无 OID 的 Agent 生成 CSB 格式标识
 * - 新增：validateIdentity() 完整身份校验
 */

/**
 * 校验 AIP 身份码格式
 * GB/Z 185.2-2026: OID 格式，如 1.2.156.3088.1.1.xxx
 * v0.6: 支持 OID 格式 + CSB 自定义格式（CSB.{name}）
 * @param {string} agentId
 * @returns {{ valid: boolean, format: 'oid'|'csb'|'unknown', error?: string }}
 */
function validateAgentId(agentId) {
  if (!agentId || typeof agentId !== 'string') {
    return { valid: false, format: 'unknown', error: 'agentId 不能为空' };
  }
  // OID 格式：段.段.段...（至少 3 段，每段可含数字和字母）
  const oidPattern = /^[A-Za-z0-9]+(\.[A-Za-z0-9]+){2,}$/;
  if (oidPattern.test(agentId)) {
    return { valid: true, format: 'oid' };
  }
  // CSB 自定义格式：CSB.{name}（兼容无 OID 的社区 Agent）
  const csbPattern = /^CSB\.[\u4e00-\u9fa5\w]+(\.[\u4e00-\u9fa5\w]+)?$/;
  if (csbPattern.test(agentId)) {
    return { valid: true, format: 'csb' };
  }
  return { valid: false, format: 'unknown', error: `agentId 格式不符合规范: ${agentId}` };
}

/**
 * 生成 CSB 格式的 agentId
 * 用于没有 OID 的社区 Agent，格式：CSB.{name}
 * @param {string} name — Agent 名称
 * @returns {string} CSB 格式的 agentId
 */
function generateAgentId(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('name 不能为空');
  }
  return `CSB.${name}`;
}

/**
 * 完整身份校验
 * 校验 Agent 对象的 agentId + name + url 是否完整
 * @param {object} agent — Agent 对象
 * @returns {{ valid: boolean, issues: string[], warnings: string[] }}
 */
function validateIdentity(agent) {
  const issues = [];
  const warnings = [];

  // 必需字段
  if (!agent.agentId) {
    issues.push('agentId 缺失（AIP 必需字段）');
  } else {
    const idCheck = validateAgentId(agent.agentId);
    if (!idCheck.valid) {
      issues.push(`agentId 格式错误: ${idCheck.error}`);
    }
  }

  if (!agent.name) {
    issues.push('name 缺失（AIP 必需字段）');
  }

  // 推荐字段
  if (!agent.url && !agent.accessAddress) {
    warnings.push('url/accessAddress 缺失（影响发现能力）');
  }
  if (!agent.version) {
    warnings.push('version 缺失（建议填写）');
  }
  if (!agent.description) {
    warnings.push('description 缺失（建议填写）');
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings
  };
}

/**
 * 生成 CSB 别名
 * 格式：CSB.{name}.{emoji}
 * @param {string} agentId — AIP 身份码
 * @param {string} name — Agent 名称
 * @param {string} emoji — 表情符号
 * @returns {string} alias
 */
function generateAlias(agentId, name, emoji = '') {
  const parts = ['CSB', name];
  if (emoji) parts.push(emoji);
  return parts.join('.');
}

/**
 * 解析 CSB 别名
 * @param {string} alias — CSB 别名（如 "CSB.若兰.🌸"）
 * @returns {{ prefix: string, name: string, emoji: string } | null}
 */
function parseAlias(alias) {
  if (!alias || typeof alias !== 'string') return null;
  const parts = alias.split('.');
  if (parts[0] !== 'CSB' || parts.length < 2) return null;
  return {
    prefix: parts[0],
    name: parts[1],
    emoji: parts.length > 2 ? parts.slice(2).join('.') : ''
  };
}

/**
 * alias → agentId 回退链
 * v0.6 规范：alias → name → agentId-prefix → url → 报错
 * v0.6 改进：确保解析结果必有 agentId（一致性保障）
 *
 * @param {string} alias — 要查找的别名
 * @param {Array} registry — Agent 注册表数组
 * @returns {{ found: boolean, agent?: object, method?: string, candidates?: object[], agentId?: string }}
 */
function resolveAlias(alias, registry) {
  if (!alias || !registry || !registry.length) {
    return { found: false, method: 'none' };
  }

  // 第一层：精确 alias 匹配
  const byAlias = registry.find(a =>
    a.alias === alias ||
    a.aliases?.includes(alias)
  );
  if (byAlias && byAlias.agentId) {
    return { found: true, agent: byAlias, method: 'alias', agentId: byAlias.agentId };
  }

  // 第二层：CSB 别名解析 + name 匹配
  const parsed = parseAlias(alias);
  if (parsed) {
    const byName = registry.find(a => a.name === parsed.name);
    if (byName && byName.agentId) {
      return { found: true, agent: byName, method: 'name', agentId: byName.agentId };
    }
  }

  // 第三层：name 精确匹配
  const byNameExact = registry.find(a => a.name === alias);
  if (byNameExact && byNameExact.agentId) {
    return { found: true, agent: byNameExact, method: 'name', agentId: byNameExact.agentId };
  }

  // 第四层：agentId 前缀匹配
  const byPrefix = registry.filter(a =>
    a.agentId?.startsWith(alias) ||
    a.name?.startsWith(alias)
  );
  if (byPrefix.length === 1 && byPrefix[0].agentId) {
    return { found: true, agent: byPrefix[0], method: 'agentId-prefix', agentId: byPrefix[0].agentId };
  }
  if (byPrefix.length > 1) {
    return { found: false, method: 'agentId-prefix-ambiguous', candidates: byPrefix };
  }

  // 第五层：url 匹配（v0.6 新增）
  const byUrl = registry.find(a =>
    a.url === alias ||
    a.accessAddress === alias
  );
  if (byUrl && byUrl.agentId) {
    return { found: true, agent: byUrl, method: 'url', agentId: byUrl.agentId };
  }

  return { found: false, method: 'not-found' };
}

/**
 * 安全解析：确保返回的 agentId 有效
 * 如果解析失败或 agentId 缺失，返回 null
 * @param {string} alias — 要查找的别名
 * @param {Array} registry — Agent 注册表数组
 * @returns {{ agentId: string, agent: object } | null}
 */
function safeResolve(alias, registry) {
  const result = resolveAlias(alias, registry);
  if (!result.found || !result.agentId) {
    return null;
  }
  const idCheck = validateAgentId(result.agentId);
  if (!idCheck.valid) {
    return null;
  }
  return { agentId: result.agentId, agent: result.agent };
}

module.exports = {
  validateAgentId,
  generateAgentId,
  validateIdentity,
  generateAlias,
  parseAlias,
  resolveAlias,
  safeResolve
};
