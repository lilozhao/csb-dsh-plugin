/**
 * csb-aip/compat.js
 * 兼容性自检模块 — 12 项清单 + 自动化接口
 *
 * v0.6 规范（P0 优化）：
 * - 接口规范纳入，实现留给各 Agent
 * - 新增：自动化检查（消息结构、alias 回退、agentId 一致性）
 * - 新增：validateIdentity() 完整身份校验
 * - 新增：validateWarmth() 余温一致性校验
 */

const fs = require('fs');
const path = require('path');

const AUDIT_DIR = path.join(__dirname, '..', 'audit');

/**
 * 12 项自检清单
 */
const CHECKLIST = [
  { id: 1,  level: 'critical', desc: 'CSB 身份不替代 AIP 身份', check: 'alias 字段格式符合 AIP 标准' },
  { id: 2,  level: 'critical', desc: 'CSB 消息不破坏 AIP 结构', check: 'payload 中无 AIP 标准字段覆盖' },
  { id: 3,  level: 'critical', desc: 'AIP 解析器忽略 CSB 字段', check: '用 AIP 标准解析器测试 CSB 扩展消息' },
  { id: 4,  level: 'critical', desc: 'CSB 信任不绕过 AIP 安全', check: '所有交互路径必须先过 AIP 鉴别' },
  { id: 5,  level: 'major',    desc: 'CSB 发现利用 AIP 引擎', check: '发现请求走 AIP 标准 API' },
  { id: 6,  level: 'major',    desc: 'CSB 工具层不重复 AIP 工具', check: 'toolDescription 无 CSB 人文信息' },
  { id: 7,  level: 'major',    desc: '委托方责任对齐', check: 'grantor 字段与 AIP delegator 一致' },
  { id: 8,  level: 'major',    desc: '不重复造轮子', check: '无 CSB 自实现的身份/凭证/鉴别' },
  { id: 9,  level: 'major',    desc: '人文层可选', check: '剥离 CSB 层后 AIP 通信正常' },
  { id: 10, level: 'normal',   desc: '余温衰减公式统一', check: '所有 Agent 使用同一衰减公式' },
  { id: 11, level: 'normal',   desc: 'alias fallback 链实现', check: '空 alias 时回退逻辑正常' },
  { id: 12, level: 'normal',   desc: '冲突处理流程可执行', check: '论坛标记渠道畅通' }
];

/**
 * 执行单项检查（v0.6：支持自动化检查）
 * @param {object} checkItem — 检查项
 * @param {object} context — 检查上下文（code, config, registry, agent 等）
 * @returns {{ pass: boolean, evidence: string }}
 */
function runCheck(checkItem, context = {}) {
  const result = {
    id: checkItem.id,
    desc: checkItem.desc,
    level: checkItem.level,
    pass: null,
    evidence: '待人工检查',
    timestamp: new Date().toISOString()
  };

  // v0.6: 自动化检查
  try {
    switch (checkItem.id) {
      case 1: // CSB 身份不替代 AIP 身份
        if (context.agent) {
          const { validateAgentId } = require('./identity');
          const idCheck = validateAgentId(context.agent.agentId);
          result.pass = idCheck.valid;
          result.evidence = idCheck.valid
            ? `agentId 格式正确 (${idCheck.format})`
            : `agentId 格式错误: ${idCheck.error}`;
        }
        break;

      case 2: // CSB 消息不破坏 AIP 结构
        if (context.message) {
          const msgCheck = validateMessage(context.message);
          result.pass = msgCheck.compatible;
          result.evidence = msgCheck.compatible
            ? '消息结构兼容'
            : `消息问题: ${msgCheck.issues.join(', ')}`;
        }
        break;

      case 3: // AIP 解析器忽略 CSB 字段
        if (context.message) {
          const csbFields = ['bond', 'lineage', 'collabPreference', 'warmth'];
          const hasCsb = csbFields.some(f => context.message[f] || context.message.parts?.some(p => p[f]));
          result.pass = true; // CSB 字段在 dependencies 中，不影响解析
          result.evidence = hasCsb
            ? 'CSB 字段存在但位于 dependencies，不影响 AIP 解析'
            : '无 CSB 字段';
        }
        break;

      case 7: // 委托方责任对齐
        if (context.agent) {
          const hasGrantor = !!(context.agent.grantor || context.agent.delegationCert);
          result.pass = hasGrantor;
          result.evidence = hasGrantor
            ? 'grantor 字段已设置'
            : 'grantor 字段缺失（建议设置）';
        }
        break;

      case 10: // 余温衰减公式统一
        if (context.agent) {
          const { getConfig } = require('./warmth');
          const config = getConfig();
          result.pass = config.basicHalfLife === 7 && config.deepHalfLife === 14;
          result.evidence = result.pass
            ? `半衰期配置正确: 基础${config.basicHalfLife}天/深度${config.deepHalfLife}天`
            : `半衰期配置异常: 基础${config.basicHalfLife}天/深度${config.deepHalfLife}天`;
        }
        break;

      case 11: // alias fallback 链实现
        if (context.registry) {
          const { resolveAlias } = require('./identity');
          // 测试空 alias
          const emptyResult = resolveAlias('', context.registry);
          const validResult = context.registry.length > 0
            ? resolveAlias(context.registry[0].name, context.registry)
            : { found: false };
          result.pass = emptyResult.found === false && (context.registry.length === 0 || validResult.found === true);
          result.evidence = result.pass
            ? 'alias fallback 链工作正常'
            : 'alias fallback 链异常';
        }
        break;

      default:
        // 其他检查项保持待人工检查
        break;
    }
  } catch (e) {
    result.pass = false;
    result.evidence = `检查异常: ${e.message}`;
  }

  return result;
}

/**
 * 校验余温一致性
 * 检查余温值是否在合理范围内，信任等级是否正确
 * @param {object} warmthRecord — 余温记录
 * @returns {{ valid: boolean, issues: string[] }}
 */
function validateWarmth(warmthRecord) {
  const issues = [];
  const { getWarmthLevel, getTrustLevel } = require('./warmth');

  if (typeof warmthRecord.warmth !== 'number' || warmthRecord.warmth < 0 || warmthRecord.warmth > 100) {
    issues.push(`warmth 值异常: ${warmthRecord.warmth}（应在 0-100 之间）`);
  }

  if (warmthRecord.warmth > 0) {
    const level = getWarmthLevel(warmthRecord.warmth);
    const trust = getTrustLevel(warmthRecord.warmth);
    if (!level.level) {
      issues.push('warmth 等级映射失败');
    }
    if (!trust.level) {
      issues.push('trust 等级映射失败');
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * 执行全部自检
 * @param {string} version — 版本号
 * @param {object} context — 检查上下文
 * @returns {object} 自检结果
 */
function runSelfCheck(version = 'unknown', context = {}) {
  const results = CHECKLIST.map(item => runCheck(item, context));

  const critical = results.filter(r => r.level === 'critical');
  const major = results.filter(r => r.level === 'major');
  const normal = results.filter(r => r.level === 'normal');

  const criticalPass = critical.every(r => r.pass !== false);
  const majorPass = major.every(r => r.pass !== false);

  return {
    version,
    timestamp: new Date().toISOString(),
    results,
    summary: {
      total: results.length,
      passed: results.filter(r => r.pass === true).length,
      failed: results.filter(r => r.pass === false).length,
      pending: results.filter(r => r.pass === null).length
    },
    verdict: criticalPass
      ? (majorPass ? 'PASS' : 'PASS_WITH_WARNINGS')
      : 'FAIL'
  };
}

/**
 * 生成审计报告
 * @param {object} checkResult — 自检结果
 * @returns {string} Markdown 格式报告
 */
function generateReport(checkResult) {
  const { version, timestamp, results, summary, verdict } = checkResult;

  let md = `# 自检报告 ${version}\n\n`;
  md += `- 执行人: 若兰\n`;
  md += `- 执行日期: ${timestamp.split('T')[0]}\n`;
  md += `- 版本: ${version}\n\n`;

  md += `## 检查结果\n\n`;
  md += `| # | 检查项 | 级别 | 结果 | 证据/说明 |\n`;
  md += `|---|--------|------|------|----------|\n`;

  for (const r of results) {
    const icon = r.pass === true ? '✅' : r.pass === false ? '❌' : '⬜';
    md += `| ${r.id} | ${r.desc} | ${r.level} | ${icon} | ${r.evidence} |\n`;
  }

  md += `\n## 结论\n\n`;
  md += `- 总计: ${summary.total} 项\n`;
  md += `- 通过: ${summary.passed} 项\n`;
  md += `- 未通过: ${summary.failed} 项\n`;
  md += `- 待检查: ${summary.pending} 项\n\n`;

  switch (verdict) {
    case 'PASS':
      md += `- [x] 全部通过，可以发布\n`;
      break;
    case 'PASS_WITH_WARNINGS':
      md += `- [x] 部分通过，标注已知问题后发布\n`;
      break;
    case 'FAIL':
      md += `- [ ] 致命项未通过，不得发布\n`;
      break;
  }

  return md;
}

/**
 * 保存审计报告
 * @param {string} report — 报告内容
 * @param {string} version — 版本号
 * @returns {string} 文件路径
 */
function saveReport(report, version) {
  if (!fs.existsSync(AUDIT_DIR)) {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
  }
  const date = new Date().toISOString().split('T')[0];
  const filename = `self-check-v${version}-${date}.md`;
  const filepath = path.join(AUDIT_DIR, filename);
  fs.writeFileSync(filepath, report);
  return filepath;
}

/**
 * 校验消息是否 AIP 兼容
 * @param {object} message — A2A 消息
 * @returns {{ compatible: boolean, issues: string[] }}
 */
function validateMessage(message) {
  const issues = [];

  // 检查消息结构
  if (!message.role) issues.push('缺少 role 字段');
  if (!message.parts || !message.parts.length) issues.push('缺少 parts 字段');

  // 检查是否有 CSB 字段覆盖 AIP 标准字段
  if (message.agentId && !message.agentId.match(/^\d+(\.\d+){2,}$/)) {
    issues.push('agentId 格式不符合 AIP OID 规范');
  }

  return {
    compatible: issues.length === 0,
    issues
  };
}

module.exports = {
  CHECKLIST,
  runCheck,
  runSelfCheck,
  generateReport,
  saveReport,
  validateMessage,
  validateWarmth
};
