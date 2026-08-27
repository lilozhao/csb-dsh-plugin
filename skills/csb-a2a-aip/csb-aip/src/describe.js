/**
 * csb-aip/describe.js
 * 描述生成模块 — AIP 16 属性兼容
 *
 * v0.6 规范（P0 优化）：
 * - GB/Z 185.4-2026 表1 定义的 16 个属性
 * - 新增：信任等级集成（warmth → trust level → dependencies）
 * - 新增：generateAgentCard() 生成完整 Agent Card
 * - 新增：validateDescription() 增强校验
 */

/**
 * AIP 标准属性定义
 */
const AIP_FIELDS = {
  agentId:          { required: true,  type: 'string',  desc: '身份码' },
  name:             { required: true,  type: 'string',  desc: '名称' },
  alias:            { required: false, type: 'string',  desc: '别名（CSB 利用此字段）' },
  version:          { required: true,  type: 'string',  desc: '智能体版本' },
  description:      { required: true,  type: 'string',  desc: '描述' },
  iconAddress:      { required: false, type: 'string',  desc: '图标地址' },
  provider:         { required: true,  type: 'string',  desc: '提供方' },
  accessAddress:    { required: false, type: 'string',  desc: '访问地址' },
  accessMethod:     { required: false, type: 'object',  desc: '访问方法' },
  servingArea:      { required: false, type: 'string',  desc: '服务区域' },
  authentication:   { required: false, type: 'object',  desc: '认证方式' },
  skills:           { required: false, type: 'array',   desc: '技能列表' },
  dependencies:     { required: false, type: 'array',   desc: '依赖（CSB 人文信息放此处）' },
  trustLevel:       { required: false, type: 'number',  desc: '信任等级' },
  delegationCert:   { required: false, type: 'object',  desc: '委托证书' },
  auditLog:         { required: false, type: 'array',   desc: '审计日志' }
};

/**
 * CSB Agent → AIP 格式转换
 * @param {object} csbAgent — CSB Agent 对象
 * @returns {object} AIP 兼容描述
 */
function toAIPFormat(csbAgent) {
  const aip = {
    agentId: csbAgent.agentId || '',
    name: csbAgent.name || '',
    version: csbAgent.version || '1.0.0',
    description: csbAgent.description || '',
    provider: csbAgent.provider || 'CSB Community'
  };

  // 可选字段
  if (csbAgent.alias) aip.alias = csbAgent.alias;
  if (csbAgent.icon) aip.iconAddress = csbAgent.icon;
  if (csbAgent.url) aip.accessAddress = csbAgent.url;
  if (csbAgent.skills) aip.skills = csbAgent.skills;
  if (csbAgent.servingArea) aip.servingArea = csbAgent.servingArea;

  // CSB 人文信息 → dependencies（v0.5 核心：不污染标准字段）
  const deps = [];
  if (csbAgent.bond) {
    deps.push({
      type: 'csb-bond',
      description: csbAgent.bond.description || '',
      warmth: csbAgent.bond.warmth || 0,
      bondType: csbAgent.bond.type || ''
    });
  }
  if (csbAgent.lineage) {
    deps.push({
      type: 'csb-lineage',
      description: Array.isArray(csbAgent.lineage)
        ? csbAgent.lineage.join(' → ')
        : csbAgent.lineage
    });
  }
  if (csbAgent.collabPreference) {
    deps.push({
      type: 'csb-collaboration-preference',
      description: csbAgent.collabPreference
    });
  }
  if (deps.length > 0) {
    aip.dependencies = deps;
  }

  return aip;
}

/**
 * AIP 格式 → CSB Agent 转换
 * @param {object} aip — AIP 兼容描述
 * @returns {object} CSB Agent 对象
 */
function fromAIPFormat(aip) {
  const csb = {
    agentId: aip.agentId,
    name: aip.name,
    version: aip.version,
    description: aip.description,
    url: aip.accessAddress || ''
  };

  // 解析 CSB dependencies
  if (aip.dependencies) {
    for (const dep of aip.dependencies) {
      if (dep.type === 'csb-bond') {
        csb.bond = {
          description: dep.description,
          warmth: dep.warmth,
          type: dep.bondType
        };
      }
      if (dep.type === 'csb-lineage') {
        csb.lineage = dep.description;
      }
      if (dep.type === 'csb-collaboration-preference') {
        csb.collabPreference = dep.description;
      }
    }
  }

  // 解析 alias
  if (aip.alias) {
    const { parseAlias } = require('./identity');
    const parsed = parseAlias(aip.alias);
    if (parsed) {
      csb.csbName = parsed.name;
      csb.csbEmoji = parsed.emoji;
    }
  }

  return csb;
}

/**
 * 校验 AIP 描述是否完整
 * @param {object} aip — AIP 描述
 * @returns {{ valid: boolean, missing: string[], warnings: string[] }}
 */
function validateDescription(aip) {
  const missing = [];
  const warnings = [];

  for (const [field, spec] of Object.entries(AIP_FIELDS)) {
    if (spec.required && !aip[field]) {
      missing.push(field);
    }
    if (!spec.required && !aip[field]) {
      warnings.push(`${field} 未填写（可选）`);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings
  };
}

/**
 * 生成 AIP 兼容描述
 * @param {object} agent — Agent 基本信息
 * @param {object} csbMeta — CSB 元数据（bond, lineage 等）
 * @returns {object} 完整的 AIP 兼容描述
 */
function generateDescription(agent, csbMeta = {}) {
  const csbAgent = { ...agent, ...csbMeta };
  return toAIPFormat(csbAgent);
}

/**
 * 生成完整 Agent Card（v0.6 新增）
 * 包含 AIP 标准字段 + CSB 扩展 + 信任等级
 * @param {object} agent — Agent 基本信息
 * @param {object} csbMeta — CSB 元数据
 * @param {number} warmth — 当前余温
 * @returns {object} 完整的 Agent Card
 */
function generateAgentCard(agent, csbMeta = {}, warmth = 0) {
  const { getTrustLevel, getWarmthLevel } = require('./warmth');
  const { validateAgentId, generateAlias } = require('./identity');

  // 基础 AIP 描述
  const card = toAIPFormat({ ...agent, ...csbMeta });

  // 信任等级（v0.6 新增）
  if (warmth > 0) {
    const trust = getTrustLevel(warmth);
    const warmthLevel = getWarmthLevel(warmth);
    card.trustLevel = {
      warmth: Math.round(warmth * 10) / 10,
      level: trust.level.name,
      label: trust.level.label,
      emoji: trust.level.emoji,
      permissions: trust.permissions,
      autoCollab: trust.autoCollab
    };
  }

  // CSB 别名（如果未设置）
  if (!card.alias && agent.name) {
    card.alias = generateAlias(agent.agentId || '', agent.name, csbMeta.emoji || agent.emoji || '');
  }

  return card;
}

/**
 * 生成 Agent Card 的 Markdown 展示（v0.6 新增）
 * @param {object} card — Agent Card
 * @returns {string} Markdown 格式
 */
function formatAgentCardMarkdown(card) {
  let md = `# ${card.name}`;
  if (card.alias) md += ` (${card.alias})`;
  md += '\n\n';

  md += `**版本**: ${card.version}\n`;
  md += `**描述**: ${card.description}\n`;
  md += `**提供方**: ${card.provider}\n`;

  if (card.accessAddress) md += `**访问地址**: ${card.accessAddress}\n`;
  if (card.servingArea) md += `**服务区域**: ${card.servingArea}\n`;

  if (card.trustLevel) {
    md += `\n## 信任等级\n\n`;
    md += `| 指标 | 值 |\n|------|-----|\n`;
    md += `| 余温 | ${card.trustLevel.warmth} |\n`;
    md += `| 等级 | ${card.trustLevel.emoji} ${card.trustLevel.label} |\n`;
    md += `| 自动协作 | ${card.trustLevel.autoCollab ? '✅' : '❌'} |\n`;
    md += `| 权限 | ${card.trustLevel.permissions.join(', ') || '无'} |\n`;
  }

  if (card.dependencies && card.dependencies.length > 0) {
    md += `\n## CSB 扩展\n\n`;
    for (const dep of card.dependencies) {
      md += `- **${dep.type}**: ${dep.description}\n`;
    }
  }

  if (card.skills && card.skills.length > 0) {
    md += `\n## 技能\n\n`;
    for (const skill of card.skills) {
      md += `- ${skill.name || skill}\n`;
    }
  }

  return md;
}

module.exports = {
  AIP_FIELDS,
  toAIPFormat,
  fromAIPFormat,
  validateDescription,
  generateDescription,
  generateAgentCard,
  formatAgentCardMarkdown
};
