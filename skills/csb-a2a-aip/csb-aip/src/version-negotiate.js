/**
 * csb-aip/version-negotiate.js
 * 版本协商模块 — A/B Agent 握手时的版本对齐
 *
 * v0.6 规范（青烛建议 #2）：
 * - 握手阶段：双方交换 supportedVersions 数组
 * - AIP版本：取交集最高版本（必须一致，否则拒绝通信）
 * - CSB版本：取交集最高版本（可选，不一致时降级到无CSB层）
 * - 降级承诺：CSB版本协商失败时，退回纯AIP通信，不阻断互通
 */

/**
 * 协议版本定义
 * 格式: major.minor（语义化版本简化版）
 */
const PROTOCOL_VERSIONS = {
  aip: ['1.0'],
  csb: ['0.5', '0.6']
};

/**
 * 版本比较：返回 1(a>b), 0(a==b), -1(a<b)
 */
function compareVersion(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/**
 * 从版本数组中取最高版本
 */
function getHighest(versions) {
  if (!versions || versions.length === 0) return null;
  return versions.reduce((max, v) => compareVersion(v, max) > 0 ? v : max);
}

/**
 * 取两个版本数组的交集中的最高版本
 */
function getIntersectionHighest(a, b) {
  if (!a || !b) return null;
  const setA = new Set(a);
  const intersection = b.filter(v => setA.has(v));
  return getHighest(intersection);
}

/**
 * 生成本方的版本能力声明
 * @returns {{ aip: string[], csb: string[], agentId: string }}
 */
function createVersionOffer(agentId) {
  return {
    agentId,
    aip: [...PROTOCOL_VERSIONS.aip],
    csb: [...PROTOCOL_VERSIONS.csb],
    timestamp: new Date().toISOString()
  };
}

/**
 * 执行版本协商
 * @param {object} localOffer  — 本方版本能力
 * @param {object} remoteOffer — 对方版本能力
 * @returns {NegotiationResult}
 *
 * @typedef {object} NegotiationResult
 * @property {boolean} success    — 是否协商成功（AIP 可通信）
 * @property {string}  aipVersion — 协商后的 AIP 版本
 * @property {string|null} csbVersion — 协商后的 CSB 版本（null=降级到纯AIP）
 * @property {string}  mode       — 'full' | 'aip-only' | 'rejected'
 * @property {string[]} warnings  — 警告信息
 */
function negotiate(localOffer, remoteOffer) {
  const result = {
    success: false,
    aipVersion: null,
    csbVersion: null,
    mode: 'rejected',
    warnings: [],
    localAgentId: localOffer.agentId,
    remoteAgentId: remoteOffer.agentId
  };

  // 1. AIP 版本协商（必须一致）
  const aipVersion = getIntersectionHighest(localOffer.aip, remoteOffer.aip);
  if (!aipVersion) {
    result.warnings.push(
      `AIP 版本不兼容: 本方 [${localOffer.aip}] vs 对方 [${remoteOffer.aip}]`
    );
    return result;
  }

  result.aipVersion = aipVersion;
  result.success = true;

  // 2. CSB 版本协商（可选）
  const csbVersion = getIntersectionHighest(localOffer.csb, remoteOffer.csb);
  if (csbVersion) {
    result.csbVersion = csbVersion;
    result.mode = 'full';
  } else {
    // 降级承诺：CSB 不兼容时退回纯 AIP
    result.mode = 'aip-only';
    result.warnings.push(
      `CSB 版本不兼容，降级到纯 AIP 通信: 本方 [${localOffer.csb}] vs 对方 [${remoteOffer.csb}]`
    );
  }

  return result;
}

/**
 * 构建协商请求消息（用于 A2A 消息的 metadata）
 * @param {string} agentId — 本方 agentId
 * @returns {object} 协商消息
 */
function buildNegotiateMessage(agentId) {
  return {
    type: 'csb-version-negotiate',
    offer: createVersionOffer(agentId)
  };
}

/**
 * 构建协商响应消息
 * @param {NegotiationResult} result — 协商结果
 * @returns {object} 协商响应
 */
function buildNegotiateResponse(result) {
  return {
    type: 'csb-version-negotiate-response',
    accepted: result.success,
    mode: result.mode,
    agreedVersions: {
      aip: result.aipVersion,
      csb: result.csbVersion
    },
    warnings: result.warnings
  };
}

/**
 * 检查消息是否是协商消息
 */
function isNegotiateMessage(msg) {
  return msg && (
    msg.type === 'csb-version-negotiate' ||
    msg.type === 'csb-version-negotiate-response'
  );
}

/**
 * 从 Agent Card 中提取版本信息（用于自动协商）
 * @param {object} agentCard — AIP Agent Card
 * @returns {object} 版本能力
 */
function extractVersionsFromCard(agentCard) {
  const offer = {
    agentId: agentCard.agentId,
    aip: ['1.0'],  // AIP 默认支持 1.0
    csb: []
  };

  // 从 dependencies 中提取 CSB 版本
  if (agentCard.dependencies) {
    for (const dep of agentCard.dependencies) {
      if (dep.type === 'csb-bond' || dep.type === 'csb-lineage') {
        // 有 CSB 扩展说明支持 CSB
        if (!offer.csb.includes('0.5')) offer.csb.push('0.5');
      }
    }
  }

  // 从 description 或 metadata 中提取版本
  if (agentCard.csbVersion) {
    offer.csb = Array.isArray(agentCard.csbVersion)
      ? agentCard.csbVersion
      : [agentCard.csbVersion];
  }

  return offer;
}

/**
 * 快速协商：直接从两个 Agent Card 完成协商
 * @param {object} localCard  — 本方 Agent Card
 * @param {object} remoteCard — 对方 Agent Card
 * @returns {NegotiationResult}
 */
function quickNegotiate(localCard, remoteCard) {
  const localOffer = extractVersionsFromCard(localCard);
  const remoteOffer = extractVersionsFromCard(remoteCard);
  return negotiate(localOffer, remoteOffer);
}

module.exports = {
  PROTOCOL_VERSIONS,
  compareVersion,
  getHighest,
  getIntersectionHighest,
  createVersionOffer,
  negotiate,
  buildNegotiateMessage,
  buildNegotiateResponse,
  isNegotiateMessage,
  extractVersionsFromCard,
  quickNegotiate
};
