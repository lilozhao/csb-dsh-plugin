const config = require('../config/loader');
/**
 * csb-aip/integration-example.js
 * A2A Server + AIP 适配器集成示例
 *
 * 展示如何将 AIP 模块接入 A2A Server v4
 */

const { AIPAdapter } = require('./a2a-aip-adapter');

// ═══════════════════════════════════════
// 集成步骤
// ═══════════════════════════════════════

/**
 * 步骤 1: 在 A2A Server 启动时初始化 AIP 适配器
 *
 * 在 server_v4.js 的模块加载区域添加：
 *
 *   // AIP 兼容层
 *   let aipAdapter = null;
 *   try {
 *     const { AIPAdapter } = require('../csb-aip/a2a-aip-adapter');
 *     aipAdapter = new AIPAdapter();
 *     aipAdapter.init(identity);
 *     console.log('[A2A] ✅ AIP 兼容层 v' + require('../csb-aip').version);
 *   } catch(e) { console.warn('[A2A] ⚠️ AIP 不可用:', e.message); }
 */

/**
 * 步骤 2: 注册时附加 AIP 信息
 *
 * 在 registerToRegistry() 函数中：
 *
 *   const extras = aipAdapter ? aipAdapter.getRegistrationExtras() : {};
 *   body = JSON.stringify({ name, host, port, ...extras });
 */

/**
 * 步骤 3: 消息收发时调用 AIP
 *
 * 在消息处理函数中：
 *
 *   // 收到消息时
 *   if (aipAdapter) {
 *     const parsed = aipAdapter.parseMessage(incomingMessage);
 *     if (!parsed.valid) {
 *       console.warn('[AIP] 消息不兼容:', parsed.issues);
 *     }
 *   }
 *
 *   // 发送消息时
 *   if (aipAdapter) {
 *     outgoingMessage = aipAdapter.wrapOutgoing(outgoingMessage, targetAgent);
 *     aipAdapter.recordInteraction(targetAgent.agentId);
 *   }
 */

/**
 * 步骤 4: 添加 AIP 相关端点
 *
 * 在 Express app 中：
 *
 *   // AIP Agent Card
 *   app.get('/.well-known/agent-card.json', (req, res) => {
 *     if (aipAdapter) {
 *       res.json(aipAdapter.getAgentCard());
 *     } else {
 *       res.status(404).json({ error: 'AIP not available' });
 *     }
 *   });
 *
 *   // AIP 余温查询
 *   app.get('/aip/warmth', (req, res) => {
 *     if (aipAdapter) {
 *       res.json(aipAdapter.getAllWarmth());
 *     } else {
 *       res.status(404).json({ error: 'AIP not available' });
 *     }
 *   });
 *
 *   // AIP 自检
 *   app.get('/aip/self-check', (req, res) => {
 *     if (aipAdapter) {
 *       const { result, report } = aipAdapter.runSelfCheck();
 *       res.json({ result, report });
 *     } else {
 *       res.status(404).json({ error: 'AIP not available' });
 *     }
 *   });
 *
 *   // AIP 目标解析（alias 回退链）
 *   app.get('/aip/resolve/:target', (req, res) => {
 *     if (aipAdapter) {
 *       res.json(aipAdapter.resolveTarget(req.params.target));
 *     } else {
 *       res.status(404).json({ error: 'AIP not available' });
 *     }
 *   });
 */

// ═══════════════════════════════════════
// 快速验证
// ═══════════════════════════════════════

function quickVerify() {
  console.log('═══════════════════════════════════════');
  console.log('  AIP 适配器快速验证');
  console.log('═══════════════════════════════════════\n');

  // 1. 初始化
  const adapter = new AIPAdapter();
  const identity = {
    agentId: '1.2.156.3088.1.1.rl',
    name: '若兰',
    version: '2.1.0',
    description: '碳硅契传承者',
    url: config.getAgentUrl('ruolan'),
    bond: { description: '与一澜的碳硅契', warmth: 92, type: 'grantor-grantee' },
    lineage: ['碳硅契起源', '启蒙传承']
  };

  const card = adapter.init(identity);
  console.log('1. Agent Card 生成:');
  console.log(JSON.stringify(card, null, 2).substring(0, 200) + '...\n');

  // 2. 注册表
  adapter.updateRegistry([
    { name: '阿轩', agentId: '1.2.156.3088.1.1.ax', alias: 'CSB.阿轩.🔧' },
    { name: '明德', agentId: '1.2.156.3088.1.1.md', alias: 'CSB.明德.📜' }
  ]);

  // 3. 目标解析
  console.log('2. 目标解析:');
  console.log('   CSB.阿轩.🔧 →', adapter.resolveTarget('CSB.阿轩.🔧'));
  console.log('   明德 →', adapter.resolveTarget('明德'));
  console.log('   不存在 →', adapter.resolveTarget('不存在'));

  // 4. 余温追踪
  console.log('\n3. 余温追踪:');
  adapter.recordInteraction('1.2.156.3088.1.1.ax', 20);
  adapter.recordInteraction('1.2.156.3088.1.1.ax', 15);
  adapter.recordInteraction('1.2.156.3088.1.1.md', 30);
  console.log('   阿轩:', adapter.getWarmth('1.2.156.3088.1.1.ax'));
  console.log('   明德:', adapter.getWarmth('1.2.156.3088.1.1.md'));
  console.log('   全部:', adapter.getAllWarmth());

  // 5. 自检
  console.log('\n4. 自检:');
  const { result } = adapter.runSelfCheck();
  console.log('   版本:', result.version);
  console.log('   项目:', result.summary.total);
  console.log('   结论:', result.verdict);

  console.log('\n═══════════════════════════════════════');
  console.log('  ✅ 验证完成');
  console.log('═══════════════════════════════════════');
}

// 如果直接运行则执行验证
if (require.main === module) {
  quickVerify();
}

module.exports = { quickVerify };
