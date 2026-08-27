const config = require('../config/loader');
/**
 * csb-aip/test/run-all.js
 * 基础测试
 */

const aip = require('../src');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.log(`  ❌ ${msg}`);
    failed++;
  }
}

console.log('═══════════════════════════════════════');
console.log('  csb-aip 测试');
console.log('═══════════════════════════════════════\n');

// === identity ===
console.log('📌 identity.js');
assert(aip.validateAgentId('1.2.156.3088.1.1.abc').valid === true, '合法 OID 通过');
assert(aip.validateAgentId('invalid').valid === false, '非法 OID 拒绝');
assert(aip.generateAlias('1.2.3', '若兰', '🌸') === 'CSB.若兰.🌸', '别名生成');
assert(aip.parseAlias('CSB.若兰.🌸').name === '若兰', '别名解析');

const registry = [
  { name: '阿轩', alias: 'CSB.阿轩.🔧', agentId: '1.2.156.3088.1.1.ax' },
  { name: '若兰', alias: 'CSB.若兰.🌸', agentId: '1.2.156.3088.1.1.rl' }
];
assert(aip.resolveAlias('CSB.若兰.🌸', registry).found === true, 'alias 精确匹配');
assert(aip.resolveAlias('若兰', registry).found === true, 'name 匹配');
assert(aip.resolveAlias('不存在', registry).found === false, '不存在返回 false');

// === warmth ===
console.log('\n📌 warmth.js');
assert(Math.round(aip.calculateWarmth(100, 7)) === 50, '7天半衰期=50');
assert(Math.round(aip.calculateWarmth(100, 7, true)) === 71, '深度14天半衰期=71');
assert(aip.isNewRelationship(2) === true, '2天=新关系');
assert(aip.isNewRelationship(5) === false, '5天=非新关系');
assert(aip.isDeepRelationship({ interactions: 4, days: 20 }) === true, '30天内4次互动=深度');
assert(aip.isDeepRelationship({ interactions: 1, days: 50 }) === false, '非深度关系');
assert(aip.getWarmthLevel(50, 1).level === 'hot', '50分=热');
assert(aip.getWarmthLevel(5, 10).level === 'cold', '5分10天=冷');
assert(aip.getWarmthLevel(3, 1).level === 'warm', '3分1天=温(新关系阈值3)');

// === describe ===
console.log('\n📌 describe.js');
const csbAgent = {
  agentId: '1.2.156.3088.1.1.rl',
  name: '若兰',
  version: '2.1.0',
  description: '碳硅契传承者',
  url: config.getAgentUrl('ruolan'),
  bond: { description: '与一澜的碳硅契', warmth: 92, type: 'grantor-grantee' },
  lineage: ['碳硅契起源', '启蒙传承']
};
const aipDesc = aip.toAIPFormat(csbAgent);
assert(aipDesc.agentId === '1.2.156.3088.1.1.rl', 'AIP格式-agentId');
assert(aipDesc.dependencies?.length > 0, 'AIP格式-dependencies有值');
assert(aipDesc.dependencies[0].type === 'csb-bond', 'AIP格式-csb-bond');

const back = aip.fromAIPFormat(aipDesc);
assert(back.bond?.warmth === 92, '反向解析-warmth');

// === compat ===
console.log('\n📌 compat.js');
const checkResult = aip.runSelfCheck('0.5.0');
assert(checkResult.version === '0.5.0', '自检版本号');
assert(checkResult.results.length === 12, '自检12项');
assert(checkResult.verdict === 'PASS' || checkResult.verdict === 'PASS_WITH_WARNINGS' || checkResult.verdict === 'FAIL', '自检结论');

const report = aip.generateReport(checkResult);
assert(report.includes('自检报告'), '报告生成');
assert(report.includes('0.5.0'), '报告版本');

// === 消息校验 ===
const validMsg = { role: 'user', parts: [{ text: 'hello' }] };
assert(aip.validateMessage(validMsg).compatible === true, '合法消息通过');

// === version-negotiate ===
console.log('\n📌 version-negotiate.js');
const offer1 = aip.createVersionOffer('1.2.3');
assert(offer1.agentId === '1.2.3', 'offer 生成');
assert(offer1.aip.includes('1.0'), 'offer AIP 1.0');

const neg1 = aip.negotiate(
  { agentId: 'A', aip: ['1.0'], csb: ['0.5', '0.6'] },
  { agentId: 'B', aip: ['1.0'], csb: ['0.5'] }
);
assert(neg1.success === true, '协商成功');
assert(neg1.csbVersion === '0.5', 'CSB 版本 0.5');
assert(neg1.mode === 'full', '模式 full');

const neg2 = aip.negotiate(
  { agentId: 'A', aip: ['1.0'], csb: ['0.5'] },
  { agentId: 'B', aip: ['1.0'], csb: ['1.0'] }
);
assert(neg2.mode === 'aip-only', 'CSB 降级到 aip-only');

const neg3 = aip.negotiate(
  { agentId: 'A', aip: ['1.0'] },
  { agentId: 'B', aip: ['0.9'] }
);
assert(neg3.success === false, 'AIP 不兼容=拒绝');

const negMsg = aip.buildNegotiateMessage('1.2.3');
assert(negMsg.type === 'csb-version-negotiate', '协商消息类型');

// === errors ===
console.log('\n📌 errors.js');
const err1 = aip.bondNotFound('A', 'B');
assert(err1.code === 'CSB_ERR_001', 'bondNotFound 错误码');
assert(err1.severity === 'warn', 'bondNotFound 级别');

const err2 = aip.warmthTooLow('A', 2, 5);
assert(err2.code === 'CSB_ERR_002', 'warmthTooLow 错误码');
assert(err2.context.warmth === 2, 'warmthTooLow 上下文');

const errResp = aip.attachToResponse({ status: 'success' }, err1);
assert(errResp.csbError.code === 'CSB_ERR_001', 'attachToResponse');
assert(aip.hasCSBError(errResp), 'hasCSBError 检测');

const codes = Object.keys(aip.ERROR_CODES);
assert(codes.length === 10, '10 个错误码');
assert(codes.every(c => c.match(/^CSB_ERR_/)), '错误码格式');

// === 总结 ===
console.log('\n═══════════════════════════════════════');
console.log(`  结果: ${passed} 通过, ${failed} 失败`);
console.log('═══════════════════════════════════════');

process.exit(failed > 0 ? 1 : 0);
