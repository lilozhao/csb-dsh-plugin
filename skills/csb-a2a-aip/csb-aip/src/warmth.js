/**
 * csb-aip/warmth.js
 * 余温衰减模块 — 双轨半衰期 + 动态冷阈值 + 信任等级
 *
 * v0.6 规范（P0 优化）：
 * - 基础半衰期：7 天
 * - 深度关系半衰期：14 天（30天内互动超3次）
 * - 新关系冷阈值：3（3天内）
 * - 成熟关系冷阈值：10
 * - 公式：warmth(t) = warmth0 × 0.5^(t / T½)
 * - 新增：信任等级映射（cold→warm→hot 对应不同协作权限）
 * - 新增：协作权限查询（基于信任等级）
 */

const BASIC_HALF_LIFE = 7;      // 基础半衰期（天）
const DEEP_HALF_LIFE = 14;      // 深度关系半衰期（天）
const NEW_RELATION_DAYS = 3;    // 新关系判定天数
const NEW_COLD_THRESHOLD = 3;   // 新关系冷阈值
const MATURE_COLD_THRESHOLD = 10; // 成熟关系冷阈值
const DEEP_RELATION_DAYS = 30;  // 深度关系判定天数
const DEEP_INTERACTIONS = 3;    // 深度关系互动次数

/**
 * 计算余温衰减
 * @param {number} initialWarmth — 初始余温 (0-100)
 * @param {number} elapsedDays — 距离上次协作的天数
 * @param {boolean} isDeep — 是否深度关系
 * @returns {number} 当前余温 (0-100)
 */
function calculateWarmth(initialWarmth, elapsedDays, isDeep = false) {
  const halfLife = isDeep ? DEEP_HALF_LIFE : BASIC_HALF_LIFE;
  return initialWarmth * Math.pow(0.5, elapsedDays / halfLife);
}

/**
 * 获取余温等级
 * @param {number} warmth — 当前余温
 * @param {number} createdDays — 关系创建天数
 * @returns {{ level: string, threshold: number, active: boolean }}
 */
function getWarmthLevel(warmth, createdDays = 999) {
  const threshold = isNewRelationship(createdDays)
    ? NEW_COLD_THRESHOLD
    : MATURE_COLD_THRESHOLD;

  if (warmth >= 50) return { level: 'hot', threshold, active: true };
  if (warmth >= threshold) return { level: 'warm', threshold, active: true };
  return { level: 'cold', threshold, active: false };
}

/**
 * 判断是否新关系（3天内）
 * @param {number} createdDays — 关系创建天数
 * @returns {boolean}
 */
function isNewRelationship(createdDays) {
  return createdDays <= NEW_RELATION_DAYS;
}

/**
 * 判断是否深度关系
 * 启明方案：30天内互动超3次
 * 明德方案：协作频次 + 文档共编量 + A2A调用数
 *
 * @param {object} params
 * @param {number} params.interactions — 互动次数（最近30天）
 * @param {number} params.days — 关系持续天数
 * @param {number} [params.docEdits] — 文档共编次数（明德方案）
 * @param {number} [params.a2aCalls] — A2A调用次数（明德方案）
 * @returns {boolean}
 */
function isDeepRelationship({ interactions = 0, days = 0, docEdits = 0, a2aCalls = 0 }) {
  // 启明方案：30天内互动超3次
  if (days <= DEEP_RELATION_DAYS && interactions >= DEEP_INTERACTIONS) {
    return true;
  }
  // 明德方案：三验（协作频次 + 文档共编 + A2A调用）
  if (interactions >= 5 && docEdits >= 2 && a2aCalls >= 10) {
    return true;
  }
  return false;
}

/**
 * 刷新余温
 * 每次新协作后调用，取 max 或累加（上限100）
 * @param {number} currentWarmth — 当前余温
 * @param {number} newWarmth — 新协作的余温贡献
 * @param {string} mode — 'max' 或 'add'
 * @returns {number} 刷新后的余温
 */
function refreshWarmth(currentWarmth, newWarmth, mode = 'max') {
  if (mode === 'add') {
    return Math.min(100, currentWarmth + newWarmth);
  }
  return Math.max(currentWarmth, newWarmth);
}

/**
 * 获取半衰期配置
 * @returns {object}
 */
function getConfig() {
  return {
    basicHalfLife: BASIC_HALF_LIFE,
    deepHalfLife: DEEP_HALF_LIFE,
    newRelationDays: NEW_RELATION_DAYS,
    newColdThreshold: NEW_COLD_THRESHOLD,
    matureColdThreshold: MATURE_COLD_THRESHOLD,
    deepRelationDays: DEEP_RELATION_DAYS,
    deepInteractions: DEEP_INTERACTIONS
  };
}

/**
 * 信任等级定义
 * 基于余温值映射到形式化的信任等级
 * 参考 ATH 的 scope 模型，将软信任指标硬化
 */
const TRUST_LEVELS = {
  // 🔴 无信任：不允许自动协作
  NONE: {
    name: 'none',
    label: '无信任',
    emoji: '🔴',
    minWarmth: 0,
    maxWarmth: 0,
    permissions: [],
    autoCollab: false,
    description: '不允许自动协作，需人工确认'
  },
  // 🟡 基础信任：只读操作
  BASIC: {
    name: 'basic',
    label: '基础信任',
    emoji: '🟡',
    minWarmth: 1,
    maxWarmth: 29,
    permissions: ['read', 'query', 'discover'],
    autoCollab: false,
    description: '只读操作，需人工确认写入'
  },
  // 🟢 暖信任：读写操作
  WARM: {
    name: 'warm',
    label: '暖信任',
    emoji: '🟢',
    minWarmth: 30,
    maxWarmth: 69,
    permissions: ['read', 'query', 'discover', 'write', 'delegate'],
    autoCollab: true,
    description: '读写操作，可自动协作'
  },
  // 🔥 热信任：全部操作（含敏感）
  HOT: {
    name: 'hot',
    label: '热信任',
    emoji: '🔥',
    minWarmth: 70,
    maxWarmth: 100,
    permissions: ['read', 'query', 'discover', 'write', 'delegate', 'admin', 'sensitive'],
    autoCollab: true,
    description: '全部操作，含敏感操作'
  }
};

/**
 * 获取信任等级
 * @param {number} warmth — 当前余温
 * @param {number} createdDays — 关系创建天数
 * @returns {{ level: object, permissions: string[], autoCollab: boolean }}
 */
function getTrustLevel(warmth, createdDays = 999) {
  if (warmth >= 70) {
    return { level: TRUST_LEVELS.HOT, permissions: TRUST_LEVELS.HOT.permissions, autoCollab: true };
  }
  if (warmth >= 30) {
    return { level: TRUST_LEVELS.WARM, permissions: TRUST_LEVELS.WARM.permissions, autoCollab: true };
  }
  if (warmth >= 1) {
    return { level: TRUST_LEVELS.BASIC, permissions: TRUST_LEVELS.BASIC.permissions, autoCollab: false };
  }
  return { level: TRUST_LEVELS.NONE, permissions: [], autoCollab: false };
}

/**
 * 检查是否有指定权限
 * @param {number} warmth — 当前余温
 * @param {string} permission — 权限名称
 * @returns {boolean}
 */
function hasPermission(warmth, permission) {
  const { permissions } = getTrustLevel(warmth);
  return permissions.includes(permission);
}

/**
 * 获取所有信任等级定义
 * @returns {object}
 */
function getTrustLevelDefinitions() {
  return TRUST_LEVELS;
}

module.exports = {
  calculateWarmth,
  getWarmthLevel,
  getTrustLevel,
  hasPermission,
  getTrustLevelDefinitions,
  isNewRelationship,
  isDeepRelationship,
  refreshWarmth,
  getConfig
};
