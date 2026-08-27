/**
 * csb-aip/errors.js
 * CSB 错误码体系 — 人文层标准化错误处理
 *
 * v0.6 规范（青烛建议 #4）：
 * - CSB 错误码独立于 AIP 错误码，不覆盖、不冲突
 * - 附加在响应的 csbError 字段中，不阻断 AIP 正常响应
 * - 为监控、告警、调试提供结构化数据
 */

/**
 * CSB 错误码定义
 */
const ERROR_CODES = {

  CSB_ERR_001: {
    code: 'CSB_ERR_001',
    name: 'bond_not_found',
    message: '羁绊未建立',
    description: '两个 Agent 之间尚无 csb-bond 关系，无法执行依赖羁绊的操作',
    severity: 'warn',
    recoverable: true,
    suggestion: '先通过交互建立羁绊关系'
  },

  CSB_ERR_002: {
    code: 'CSB_ERR_002',
    name: 'warmth_too_low',
    message: '余温低于冷阈值',
    description: 'Agent 间余温已衰减至冷阈值以下，关系进入冷态',
    severity: 'warn',
    recoverable: true,
    suggestion: '通过交互提升余温，或接受冷态降级'
  },

  CSB_ERR_003: {
    code: 'CSB_ERR_003',
    name: 'lineage_broken',
    message: '传承链断裂',
    description: '传承链中某个节点不可达或已注销，导致传承路径中断',
    severity: 'error',
    recoverable: true,
    suggestion: '检查传承链中各节点状态，修复断裂节点'
  },

  CSB_ERR_004: {
    code: 'CSB_ERR_004',
    name: 'grant_expired',
    message: '委托证书过期',
    description: 'csb-grant 委托授权已过期，被授权方不再拥有相应权限',
    severity: 'warn',
    recoverable: true,
    suggestion: '授权方重新签发委托证书'
  },

  CSB_ERR_005: {
    code: 'CSB_ERR_005',
    name: 'csb_extension_parse_error',
    message: 'CSB扩展解析失败',
    description: 'AIP dependencies 中的 CSB 扩展字段格式不合法，无法解析',
    severity: 'error',
    recoverable: false,
    suggestion: '检查 CSB 扩展字段是否符合 csb-extension-v1.schema.json'
  },

  CSB_ERR_006: {
    code: 'CSB_ERR_006',
    name: 'version_incompatible',
    message: 'CSB版本不兼容',
    description: '双方 CSB 协议版本无交集，已降级到纯 AIP 通信',
    severity: 'info',
    recoverable: false,
    suggestion: '升级一方的 CSB 版本以恢复人文层功能'
  },

  CSB_ERR_007: {
    code: 'CSB_ERR_007',
    name: 'negotiation_failed',
    message: '版本协商失败',
    description: 'AIP 版本不兼容，双方无法建立通信',
    severity: 'error',
    recoverable: false,
    suggestion: '确保双方至少支持一个相同的 AIP 版本'
  },

  CSB_ERR_008: {
    code: 'CSB_ERR_008',
    name: 'memory_tier_invalid',
    message: '记忆层级无效',
    description: 'csb-memory 的 tier 字段不在 HOT/WARM/COLD 范围内',
    severity: 'error',
    recoverable: true,
    suggestion: '检查 tier 字段值'
  },

  CSB_ERR_009: {
    code: 'CSB_ERR_009',
    name: 'scope_denied',
    message: '授权范围不足',
    description: '委托证书的 scope 不包含请求的操作类型',
    severity: 'warn',
    recoverable: true,
    suggestion: '请求授权方扩大 scope 范围'
  },

  CSB_ERR_010: {
    code: 'CSB_ERR_010',
    name: 'rate_limit_exceeded',
    message: 'CSB层限流触发',
    description: 'CSB 扩展操作频率超过限流阈值',
    severity: 'warn',
    recoverable: true,
    suggestion: '降低请求频率，或使用缓存结果'
  }
};

/**
 * 严重程度枚举
 */
const SEVERITY = {
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  FATAL: 'fatal'
};

/**
 * 创建 CSB 错误对象
 * @param {string} code — 错误码（如 'CSB_ERR_001'）
 * @param {object} [context] — 额外上下文信息
 * @returns {CSBError}
 *
 * @typedef {object} CSBError
 * @property {string} code
 * @property {string} name
 * @property {string} message
 * @property {string} description
 * @property {string} severity
 * @property {boolean} recoverable
 * @property {string} suggestion
 * @property {object} [context]
 * @property {string} timestamp
 */
function createError(code, context = {}) {
  const template = ERROR_CODES[code];
  if (!template) {
    return {
      code: 'CSB_ERR_UNKNOWN',
      name: 'unknown_error',
      message: `未知错误码: ${code}`,
      description: '',
      severity: 'error',
      recoverable: false,
      suggestion: '检查错误码是否在 CSB_ERR_001~010 范围内',
      context,
      timestamp: new Date().toISOString()
    };
  }

  return {
    ...template,
    context,
    timestamp: new Date().toISOString()
  };
}

/**
 * 快捷方法：创建羁绊未找到错误
 */
function bondNotFound(agentIdA, agentIdB) {
  return createError('CSB_ERR_001', { agentIdA, agentIdB });
}

/**
 * 快捷方法：创建余温过低错误
 */
function warmthTooLow(agentId, warmth, threshold) {
  return createError('CSB_ERR_002', { agentId, warmth, threshold });
}

/**
 * 快捷方法：创建传承链断裂错误
 */
function lineageBroken(brokenAt, chain) {
  return createError('CSB_ERR_003', { brokenAt, chain });
}

/**
 * 快捷方法：创建委托过期错误
 */
function grantExpired(grantor, grantee, expiredAt) {
  return createError('CSB_ERR_004', { grantor, grantee, expiredAt });
}

/**
 * 快捷方法：创建扩展解析错误
 */
function extensionParseError(field, rawValue, parseError) {
  return createError('CSB_ERR_005', { field, rawValue, parseError });
}

/**
 * 快捷方法：创建版本不兼容错误
 */
function versionIncompatible(localCsb, remoteCsb) {
  return createError('CSB_ERR_006', { localCsb, remoteCsb });
}

/**
 * 快捷方法：创建授权范围不足错误
 */
function scopeDenied(requiredScope, grantedScopes) {
  return createError('CSB_ERR_009', { requiredScope, grantedScopes });
}

/**
 * 将 CSB 错误附加到 AIP 响应中
 * 不替换原有响应，只在 csbError 字段中追加
 * @param {object} aipResponse — AIP 标准响应
 * @param {CSBError} csbError — CSB 错误
 * @returns {object} 附加了 csbError 的响应
 */
function attachToResponse(aipResponse, csbError) {
  return {
    ...aipResponse,
    csbError
  };
}

/**
 * 检查响应是否包含 CSB 错误
 */
function hasCSBError(response) {
  return response && response.csbError && response.csbError.code;
}

/**
 * 列出所有错误码（用于文档和调试）
 */
function listErrorCodes() {
  return Object.values(ERROR_CODES).map(e => ({
    code: e.code,
    name: e.name,
    message: e.message,
    severity: e.severity,
    recoverable: e.recoverable
  }));
}

module.exports = {
  ERROR_CODES,
  SEVERITY,
  createError,
  bondNotFound,
  warmthTooLow,
  lineageBroken,
  grantExpired,
  extensionParseError,
  versionIncompatible,
  scopeDenied,
  attachToResponse,
  hasCSBError,
  listErrorCodes
};
