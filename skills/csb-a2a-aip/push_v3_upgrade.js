#!/usr/bin/env node
const config = require('./config/loader');
/**
 * A2A Server v3.0.0 升级推送脚本
 * 推送新模块到阿轩和 Jeason
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const SKILL_DIR = '/home/node/.openclaw/workspace/csb-inheritance/skills/csb-a2a-aip';
const LOG_DIR = '/home/node/.openclaw/workspace/memory/a2a_upgrade_logs';

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// v3.0.0 新增文件
const UPGRADE_FILES = [
  'server_v3.js',
  'semantic-validator.js',
  'version-negotiator.js',
  'trust-manager.js',
  'vocab.json',
  'start.sh',
  'start-instance.sh',
  'healthcheck.sh'
];

const TARGETS = [
  { name: '阿轩', url: config.getAgentUrl('axuan') },
  { name: 'Jeason', url: config.getAgentUrl('jeason') }
];

function sendA2A(url, message) {
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
      port: urlObj.port || 80,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve(data); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function pushFile(target, filename) {
  const filePath = path.join(SKILL_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.log(`  ⏭️  跳过 ${filename}（不存在）`);
    return false;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const message = `[A2A-UPGRADE] ${filename}\n\n${content}`;

  try {
    const result = await sendA2A(target.url, message);
    console.log(`  ✅ ${filename} → ${target.name}`);
    return true;
  } catch (e) {
    console.log(`  ❌ ${filename} → ${target.name}: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log('🚀 A2A Server v3.0.0 升级推送\n');

  for (const target of TARGETS) {
    console.log(`\n📡 推送给 ${target.name} (${target.url}):`);

    for (const filename of UPGRADE_FILES) {
      await pushFile(target, filename);
      await new Promise(r => setTimeout(r, 500)); // 避免太快
    }

    // 发送升级完成通知
    await sendA2A(target.url,
      `升级文件已推送完毕。请执行：1. 拉取 Gitee 最新代码 (git pull)  2. 切换到 server_v3.js  3. 重启 A2A 服务`
    );
    console.log(`\n✅ ${target.name} 推送完成，等待处理`);
  }

  console.log('\n🎉 全部推送完成！');
}

main().catch(console.error);
