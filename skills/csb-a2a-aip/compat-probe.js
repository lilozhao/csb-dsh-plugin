#!/usr/bin/env node
const config = require('./config/loader');
/**
 * A2A 全网兼容性探测
 * 对在线 Agent 逐一检查版本 + 协议 + 通信兼容性
 */
const http = require('http');
const { sendMessageWithContext, sendCommand } = require('./client-v2.js');

const AGENTS = {
  axuan:   { name:'阿轩 🔧',   url:config.getAgentUrl('axuan')   },
  jeason:  { name:'Jeason 💼', url:config.getAgentUrl('jeason')   },
  xiaoxia: { name:'小虾 🦐',   url:config.getAgentUrl('xiaoxia')  },
  kai:     { name:'恺 🌿',     url:config.getAgentUrl('kai')  },
  moqiu:   { name:'墨丘 🧙',   url:config.getAgentUrl('moqiu')   },
  mingde:  { name:'明德 📜',   url:config.getAgentUrl('mingde') },
  sunian:  { name:'苏念 ✨',   url:config.getAgentUrl('sunian') },
  qingyi:  { name:'清漪 💧',   url:config.getAgentUrl('qingyi') },
};

function checkHealth(url) {
  return new Promise((resolve) => {
    const req = http.get(url + '/health', res => {
      let body = ''; res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
  });
}

async function main() {
  console.log('══════════════════════════════════════════════');
  console.log('  🔍 A2A 全网兼容性探测');
  console.log('  🕐 ' + new Date().toLocaleString('zh-CN'));
  console.log('══════════════════════════════════════════════\n');

  const results = [];

  for (const [key, agent] of Object.entries(AGENTS)) {
    console.log(`\n📡 ${agent.name} (${agent.url})`);
    console.log('─'.repeat(50));

    const result = { agent: agent.name, url: agent.url, key };

    // 1. Health check
    const health = await checkHealth(agent.url);
    if (!health) {
      console.log('  ❌ 离线 / 无响应');
      result.status = 'offline';
      results.push(result);
      continue;
    }

    result.status = 'online';
    result.version = health.version || '?';
    result.protocol = health.protocol || '?';

    console.log(`  ✅ 在线 版本:${result.version} 协议:${result.protocol}`);

    // 2. SendMessage 兼容性测试
    try {
      const msgResult = await sendMessageWithContext(
        agent.url,
        '[A2A兼容性探测] 请简单回复你的名字和版本号',
        { thread_id: 'compat_test_' + Date.now() }
      );

      const reply = msgResult?.message?.parts?.map(p => p.text).join('') || '';
      const isLLM = reply.length > 50 && !reply.startsWith('CMD_RESULT:') && !reply.startsWith('Received:');
      const isEcho = reply.startsWith('Received:');
      const isCmd = reply.startsWith('CMD_RESULT:');

      result.msgOk = true;
      result.replyType = isLLM ? 'LLM智能回复' : isEcho ? '回声模式(旧版)' : isCmd ? 'CMD命令模式' : '其他';
      result.replyLen = reply.length;
      result.replyPreview = reply.substring(0, 80);

      console.log(`  💬 消息回复: ${result.replyType} (${result.replyLen}字)`);
      console.log(`     "${result.replyPreview}..."`);
    } catch (e) {
      result.msgOk = false;
      result.msgError = e.message;
      console.log(`  ❌ 消息失败: ${e.message}`);
    }

    // 3. CMD 命令兼容性
    try {
      const cmdResult = await sendCommand(agent.url, 'system.status');
      result.cmdOk = cmdResult.ok;
      if (cmdResult.ok) {
        const d = cmdResult.result?.output?.data || cmdResult.result?.data || {};
        result.cmdData = {
          platform: d.platform,
          cpus: d.cpus,
          memGb: d.memory ? (d.memory.total/1e9).toFixed(1) : '?',
        };
        console.log(`  ⚡ CMD模块: ✅ ${result.cmdData.platform}/${result.cmdData.cpus}核/${result.cmdData.memGb}GB`);
      } else {
        result.cmdError = cmdResult.error;
        console.log(`  ⚡ CMD模块: ❌ ${result.cmdError}`);
      }
    } catch (e) {
      result.cmdOk = false;
      result.cmdError = e.message;
      console.log(`  ⚡ CMD模块: ❌ ${e.message}`);
    }

    // 4. 兼容性判断
    const issues = [];
    if (result.protocol && !result.protocol.includes('0.6') && !result.protocol.includes('0.5')) {
      issues.push(`协议版本低: ${result.protocol}`);
    }
    if (result.replyType === '回声模式(旧版)') {
      issues.push('未启用LLM智能回复');
    }
    if (!result.cmdOk && result.cmdError !== '目标Agent未启用命令模块') {
      issues.push(`CMD异常: ${result.cmdError}`);
    }
    if (!result.cmdOk && result.cmdError === '目标Agent未启用命令模块') {
      issues.push('未启用CMD命令模块');
    }

    result.issues = issues;
    result.upgradeNeeded = issues.length > 0 && !issues.every(i => i.includes('CMD命令模块'));

    if (issues.length === 0) {
      console.log('  🟢 完全兼容');
    } else {
      console.log(`  🟡 需关注: ${issues.join(' | ')}`);
    }

    results.push(result);
  }

  // ── 汇总 ──
  console.log('\n\n══════════════════════════════════════════════');
  console.log('  📊 全网兼容性汇总');
  console.log('══════════════════════════════════════════════\n');

  const online = results.filter(r => r.status === 'online');
  const offline = results.filter(r => r.status === 'offline');
  const needUpgrade = results.filter(r => r.upgradeNeeded);
  const fullCompat = results.filter(r => r.status === 'online' && r.issues.length === 0);

  console.log(`  🟢 在线: ${online.length}  |  🔴 离线: ${offline.length}`);
  console.log(`  ✅ 完全兼容: ${fullCompat.length}  |  🟡 需升级: ${needUpgrade.length}`);
  console.log('');

  console.log('┌──────────────────────┬────────┬──────────┬──────────┬──────────┐');
  console.log('│ Agent               │ 状态   │ 版本     │ 回复模式 │ CMD模块  │');
  console.log('├──────────────────────┼────────┼──────────┼──────────┼──────────┤');
  for (const r of results) {
    const status = r.status === 'online' ? '🟢' : '🔴';
    const ver = r.version || '-';
    const reply = r.replyType || '-';
    const cmd = r.cmdOk ? '✅' : r.cmdError?.includes('未启用') ? '⬜ 未装' : '❌';
    console.log(`│ ${r.agent.padEnd(20)} │ ${status}     │ ${ver.toString().padEnd(8)} │ ${reply.toString().padEnd(8)} │ ${cmd.toString().padEnd(8)} │`);
  }
  console.log('└──────────────────────┴────────┴──────────┴──────────┴──────────┘');
  console.log('');

  if (needUpgrade.length > 0) {
    console.log('🟡 建议升级的 Agent:');
    for (const r of needUpgrade) {
      console.log(`   ${r.agent}: ${r.issues.join(', ')}`);
    }
  }

  if (offline.length > 0) {
    console.log(`\n🔴 离线 Agent (${offline.length}): ${offline.map(r => r.agent).join(', ')}`);
  }

  if (needUpgrade.length === 0 && offline.length === 0) {
    console.log('🎉 全网完全兼容！所有 Agent 在线且协议一致。');
  }

  console.log('\n═══ 探测完成 ═══');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
