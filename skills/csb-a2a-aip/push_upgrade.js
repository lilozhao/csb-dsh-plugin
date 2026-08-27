#!/usr/bin/env node
const config = require('./config/loader');
/**
 * A2A 升级文件推送脚本
 * 直接推送 client-v2.js 和 context-manager-v2.js 到阿轩和 Jeason
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const UPGRADE_DIR = '/home/node/.openclaw/workspace/csb-a2a-aip';
const LOG_DIR = '/home/node/.openclaw/workspace/memory/a2a_upgrade_logs';

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const UPGRADE_FILES = [
  'client-v2.js',
  'context-manager-v2.js',
  'daily_discussion.js'
];

const TARGETS = [
  { name: '阿轩', url: config.getAgentUrl('axuan') },
  { name: 'Jeason', url: config.getAgentUrl('jeason') }
];

async function sendA2A(url, message) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: { role: 'user', parts: [{ text: message }] },
        sender: '若兰',
        senderUrl: 'http://localhost:3100'
      },
      id: Date.now()
    });

    const urlObj = new URL('/a2a/json-rpc', url);
    const client = urlObj.protocol === 'https:' ? https : http;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = client.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('超时')) });
    req.write(payload);
    req.end();
  });
}

async function pushFileToAgent(agentName, agentUrl, filename) {
  const filePath = path.join(UPGRADE_DIR, filename);
  
  if (!fs.existsSync(filePath)) {
    console.log(`  ⚠️ 文件不存在: ${filename}`);
    return false;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const fileSize = Buffer.byteLength(content);
  
  // 分块发送（每次最多 5000 字符）
  const CHUNK_SIZE = 5000;
  const chunks = [];
  
  for (let i = 0; i < content.length; i += CHUNK_SIZE) {
    chunks.push(content.substring(i, i + CHUNK_SIZE));
  }

  console.log(`  📤 ${filename} (${(fileSize/1024).toFixed(1)}KB, ${chunks.length} 块)`);

  // 先发送文件头信息
  const headerMsg = `【A2A 升级文件推送】

📄 文件名: ${filename}
📦 大小: ${(fileSize/1024).toFixed(1)} KB
📝 分块: ${chunks.length} 块

=== 文件内容 ===`;

  try {
    await sendA2A(agentUrl, headerMsg);
    await new Promise(r => setTimeout(r, 500));
  } catch (e) {
    console.log(`    ❌ 发送文件头失败: ${e.message}`);
    return false;
  }

  // 逐块发送内容
  for (let i = 0; i < chunks.length; i++) {
    const chunkLabel = chunks.length === 1 ? '完整' : `第${i+1}/${chunks.length}`;
    
    try {
      await sendA2A(agentUrl, `[${chunkLabel}]\n\`\`\`javascript\n${chunks[i]}\n\`\`\``);
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.log(`    ❌ 发送第 ${i+1} 块失败: ${e.message}`);
      return false;
    }
  }

  // 发送完成标记
  try {
    await sendA2A(agentUrl, `【/块】\n\n✅ 文件 ${filename} 推送完成\n请保存到: csb-a2a-aip/${filename}`);
    await new Promise(r => setTimeout(r, 300));
  } catch (e) {
    console.log(`    ❌ 发送完成标记失败: ${e.message}`);
  }

  return true;
}

async function pushUpgradeToAgent(agentName, agentUrl) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`🚀 开始向 ${agentName} 推送升级...`);
  console.log(`${'='.repeat(50)}`);

  const results = [];
  
  for (const filename of UPGRADE_FILES) {
    const success = await pushFileToAgent(agentName, agentUrl, filename);
    results.push({ filename, success });
    await new Promise(r => setTimeout(r, 1000));
  }

  // 发送重启提示
  try {
    await sendA2A(agentUrl, `

【A2A 升级完成】

🌸 若兰已推送 ${results.filter(r=>r.success).length}/${results.length} 个文件到 csb-a2a-aip/

请重启 A2A Server 以加载新模块：
- client-v2.js: A2A-015 退避策略、A2A-008 离线投递
- context-manager-v2.js: A2A-004 上下文管理
- daily_discussion.js: 串行讨论流程

版本: 2.8.0
推送时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
`);
    console.log(`  ✅ 重启提示已发送`);
  } catch (e) {
    console.log(`  ⚠️ 重启提示发送失败: ${e.message}`);
  }

  return results;
}

// 主流程
(async () => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(LOG_DIR, `upgrade_${timestamp}.log`);
  
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║       A2A 升级文件推送                             ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log(`\n📁 升级目录: ${UPGRADE_DIR}`);
  console.log(`📄 升级文件: ${UPGRADE_FILES.join(', ')}`);
  console.log(`📝 日志文件: ${logFile}\n`);

  const startTime = Date.now();
  const allResults = {};

  for (const target of TARGETS) {
    const results = await pushUpgradeToAgent(target.name, target.url);
    allResults[target.name] = results;
    await new Promise(r => setTimeout(r, 2000));
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  
  // 保存升级日志
  const logContent = `A2A 升级推送日志
==================
时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
耗时: ${duration}s

推送文件:
${UPGRADE_FILES.map(f => `  - ${f}`).join('\n')}

推送结果:
${Object.entries(allResults).map(([name, results]) => 
  `  ${name}:\n${results.map(r => `    ${r.success ? '✅' : '❌'} ${r.filename}`).join('\n')}`
).join('\n')}

状态: ${Object.values(allResults).flat().every(r => r.success) ? '✅ 全部成功' : '⚠️ 部分失败'}
`;
  
  fs.writeFileSync(logFile, logContent);
  console.log(`\n📝 日志已保存: ${logFile}`);

  console.log(`\n${'='.repeat(50)}`);
  console.log('✅ 升级推送完成！');
  console.log(`${'='.repeat(50)}`);
  console.log(`\n预计对方需要重启 A2A Server 才能加载新模块~\n`);
})();
