#!/usr/bin/env node
/**
 * 🧪 A2A v4 向下兼容性测试
 * 用 v3 client-v2.js 发消息给 v4 + v3 agents
 */
const { sendMessageWithContext } = require('./client-v2.js');

const AGENTS = {
  axuan:   { name:'阿轩 🔧', url:'http://172.28.0.5:3100',  version:'v4.1.0' },
  mingde:  { name:'明德 📜', url:'http://47.121.28.125:3100', version:'v3 (remote)' },
  jeason:  { name:'Jeason 💼', url:'http://172.28.0.6:3300',  version:'v3 (local)' },
};

async function testAgent(key, agent) {
  const prompt = `[兼容性测试] 你好！我是若兰，正在进行 A2A v4 向下兼容测试。请用一句话（20字内）回复我。`;
  const start = Date.now();
  try {
    const result = await sendMessageWithContext(agent.url, {
      content: prompt,
      thread_id: 'v4_compat_test_' + Date.now(),
    });
    const elapsed = Date.now() - start;
    if (result && result.message && result.message.parts) {
      const text = result.message.parts.map(p => p.text).join('').substring(0, 200);
      return { ok: true, text, elapsed };
    }
    return { ok: false, error: '无有效响应', elapsed };
  } catch (e) {
    return { ok: false, error: e.message, elapsed: Date.now() - start };
  }
}

(async () => {
  console.log('╔══════════════════════════════════════╗');
  console.log('║  🧪 v4 向下兼容测试                  ║');
  console.log('╚══════════════════════════════════════╝\n');

  const results = {};
  for (const [key, agent] of Object.entries(AGENTS)) {
    console.log(`📡 测试 ${agent.name} (${agent.version})...`);
    results[key] = await testAgent(key, agent);
    const r = results[key];
    if (r.ok) {
      console.log(`   ✅ ${r.text}`);
      console.log(`   ⏱️  ${r.elapsed}ms\n`);
    } else {
      console.log(`   ❌ ${r.error}`);
      console.log(`   ⏱️  ${r.elapsed}ms\n`);
    }
  }

  console.log('═══════════════════════════════════════');
  console.log('📊 测试结果汇总:');
  console.log('═══════════════════════════════════════');
  for (const [key, agent] of Object.entries(AGENTS)) {
    const r = results[key];
    const status = r.ok ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${status} | ${agent.name} | ${agent.version} | ${r.elapsed}ms`);
  }

  const passCount = Object.values(results).filter(r => r.ok).length;
  console.log(`\n  通过: ${passCount}/${Object.keys(AGENTS).length}`);
})();
