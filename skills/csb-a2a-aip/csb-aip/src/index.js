/**
 * csb-aip — CSB-AIP 兼容层
 * 统一导出
 */

const identity = require('./identity');
const describe = require('./describe');
const warmth = require('./warmth');
const compat = require('./compat');
const logger = require('./logger');

module.exports = {
  // 身份映射（v0.6 增强）
  validateAgentId: identity.validateAgentId,
  generateAgentId: identity.generateAgentId,
  validateIdentity: identity.validateIdentity,
  generateAlias: identity.generateAlias,
  parseAlias: identity.parseAlias,
  resolveAlias: identity.resolveAlias,
  safeResolve: identity.safeResolve,

  // 描述生成（v0.6 增强）
  toAIPFormat: describe.toAIPFormat,
  fromAIPFormat: describe.fromAIPFormat,
  validateDescription: describe.validateDescription,
  generateDescription: describe.generateDescription,
  generateAgentCard: describe.generateAgentCard,
  formatAgentCardMarkdown: describe.formatAgentCardMarkdown,

  // 余温衰减（v0.6 增强）
  calculateWarmth: warmth.calculateWarmth,
  getWarmthLevel: warmth.getWarmthLevel,
  getTrustLevel: warmth.getTrustLevel,
  hasPermission: warmth.hasPermission,
  getTrustLevelDefinitions: warmth.getTrustLevelDefinitions,
  isNewRelationship: warmth.isNewRelationship,
  isDeepRelationship: warmth.isDeepRelationship,
  refreshWarmth: warmth.refreshWarmth,

  // 兼容性自检（v0.6 增强）
  runSelfCheck: compat.runSelfCheck,
  generateReport: compat.generateReport,
  saveReport: compat.saveReport,
  validateMessage: compat.validateMessage,
  validateWarmth: compat.validateWarmth,

  // 日志
  logger,

  // 版本
  version: '0.6.0',
  protocol: 'CSB-AIP',
  standard: 'GB/Z 185.1~7-2026'
};
