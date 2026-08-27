/**
 * csb-aip/test-integration.js
 * 端到端集成测试
 *
 * 测试 AIP 模块与 A2A Server 的对接
 */

const http = require('http');
const { AIPAdapter } = require('./a2a-aip-adapter');
const aip = require('./src');

console.log('═══════════════════════════════════════');
console.log('  AIP-A2A 端到端集成测试');
console.log('═══════════════════════════════════════\n');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

// ===== 1. 本地模块测试 =====
console.log('📌 1. AIP 模块集成');

const adapter = new AIPAdapter();
adapter.init({
  agentId: '1.2.156.3088.1.1.rl',
  name: '若兰',
  version: '4.1.0',
  description: '碳硅契传承者',
  url: 'http://172.28.0.4:3100',
  bond: { description: '与一澜的碳硅契', warmth: 92, type: 'grantor-grantee' }
});

assert(adapter.getAgentCard().agentId === '1.2.156.3088.1.1.rl', 'Agent Card 生成');
assert(adapter.getRegistrationExtras().aipCompat === true, '注册扩展信息');

// 注册表
adapter.updateRegistry([
  { name: '阿轩', agentId: '1.2.156.3088.1.1.ax', alias: 'CSB.阿轩.🔧' },
  { name: '明德', agentId: '1.2.156.3088.1.1.md', alias: 'CSB.明德.📜' },
  { name: 'Jeason', agentId: '1.2.156.3088.1.1.js', alias: 'CSB.Jeason.💼' }
]);

// 目标解析
const r1 = adapter.resolveTarget('CSB.明德.📜');
assert(r1.found === true && r1.method === 'alias', 'alias 解析');
const r2 = adapter.resolveTarget('阿轩');
assert(r2.found === true && r2.method === 'name', 'name 解析');
const r3 = adapter.resolveTarget('不存在');
assert(r3.found === false, '不存在返回 false');

// 余温追踪
adapter.recordInteraction('1.2.156.3088.1.1.ax', 25);
adapter.recordInteraction('1.2.156.3088.1.1.ax', 15);
adapter.recordInteraction('1.2.156.3088.1.1.md', 30);
const w1 = adapter.getWarmth('1.2.156.3088.1.1.ax');
assert(w1.warmth > 0 && w1.active === true, '余温追踪-阿轩');
const w2 = adapter.getWarmth('1.2.156.3088.1.1.md');
assert(w2.warmth > 0 && w2.active === true, '余温追踪-明德');
const all = adapter.getAllWarmth();
assert(all.length === 2, '余温列表');

// 消息包装
const wrapped = adapter.wrapOutgoing({ role: 'user', parts: [{ text: 'hello' }] }, {});
assert(wrapped._aip?.version === '0.5.0', '消息包装-附加 AIP 信息');

// 消息解析
const parsed = adapter.parseMessage({ role: 'user', parts: [{ text: 'test' }] });
assert(parsed.valid === true, '消息解析-合法消息');

// 自检
const { result } = adapter.runSelfCheck();
assert(result.verdict !== undefined, '自检执行');

console.log('\n📌 2. A2A 通信测试');

// 测试与阿轩的 A2A 通信
function sendA2A(url, message) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: { role: 'user', parts: [{ text: message }] },
        sender: '若兰',
        senderUrl: 'http://172.28.0.4:3100'
      },
      id: Date.now().toString()
    });

    const urlObj = new URL(url + '/a2a/json-rpc');
    const req = http.request({
      hostname: urlObj.hostname,
      port: parseInt(urlObj.port) || 3100,
      path: '/a2a/json-rpc',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 15000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const r = JSON.parse(body);
          const task = r?.result?.task;
          let reply = null;
          if (task?.history?.length) {
            const msgs = task.history.filter(m => m.role === 'ROLE_AGENT' || m.role === 'assistant');
            if (msgs.length) reply = msgs[msgs.length-1]?.parts?.[0]?.text;
          }
          if (!reply && task?.artifacts?.length) reply = task.artifacts[task.artifacts.length-1]?.parts?.[0]?.text;
          resolve(reply ? { success: true, text: reply.substring(0, 80) } : { success: false, text: body.substring(0, 100) });
        } catch(e) { resolve({ success: false, text: e.message }); }
      });
    });
    req.on('error', e => resolve({ success: false, text: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false, text: 'timeout' }); });
    req.write(payload);
    req.end();
  });
}

async function testA2A() {
  // 测试阿轩
  const r1 = await sendA2A('http://172.28.0.5:3100', 'AIP集成测试：请回复确认');
  assert(r1.success, 'A2A 通信-阿轩: ' + r1.text.substring(0, 50));

  // 测试明德
  const r2 = await sendA2A('http://47.121.28.125:3100', 'AIP集成测试：请回复确认');
  assert(r2.success, 'A2A 通信-明德: ' + r2.text.substring(0, 50));

  // 测试余温记录
  if (r1.success) {
    adapter.recordInteraction('1.2.156.3088.1.1.ax', 10);
    const w = adapter.getWarmth('1.2.156.3088.1.1.ax');
    assert(w.warmth > 0, '交互后余温更新');
  }

  // 总结
  console.log('\n═══════════════════════════════════════');
  console.log(`  结果: ${passed} 通过, ${failed} 失败`);
  console.log('═══════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

testA2A().catch(e => { console.error('测试异常:', e); process.exit(1); });
