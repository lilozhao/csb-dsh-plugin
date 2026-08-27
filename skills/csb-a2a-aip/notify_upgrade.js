#!/usr/bin/env node
const config = require('./config/loader');
/**
 * A2A 升级通知脚本
 * 向阿轩、Jeason 发送升级通知
 */

const http = require('http');
const https = require('https');

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
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('超时')); });
    req.write(payload);
    req.end();
  });
}

const UPGRADE_MSG = `【A2A 升级通知】

🌸 若兰已升级到 A2A 新版本！

新增功能：
- A2A-004 上下文管理（thread_id 持久化）
- A2A-015 退避策略（自动重试）
- A2A-008 离线投递（消息暂存）
- 版本兼容性检查

是否需要同步升级？

同步命令：
curl -s http://172.28.0.4:3098/sync | sh

或者告诉我，我来帮你推送升级文件~`;

async function notifyAgent(name, url) {
  try {
    await sendA2A(url, UPGRADE_MSG);
    console.log(`✅ ${name}: 升级通知已发送`);
    return true;
  } catch (e) {
    console.log(`❌ ${name}: 发送失败 - ${e.message}`);
    return false;
  }
}

(async () => {
  console.log('=== A2A 升级通知推送 ===\n');

  await notifyAgent('阿轩', config.getAgentUrl('axuan'));
  await new Promise(r => setTimeout(r, 1000));
  await notifyAgent('Jeason', config.getAgentUrl('jeason'));

  console.log('\n✅ 通知已发送，等待对方确认...');
})();
